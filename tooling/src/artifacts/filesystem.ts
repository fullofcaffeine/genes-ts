import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from "node:fs";
import path from "node:path";

import { artifactFailure } from "./error.js";
import { sha256Bytes } from "./canonical-json.js";
import type {
  ExpectedFileState,
  FileState,
  PortableRelativePath,
} from "./types.js";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: string }).code
    : undefined;
}

function filesystemFailure(error: unknown, subject: string): never {
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    artifactFailure("filesystem-permission", subject);
  }
  if (code === "EXDEV" || code === "ENOTSUP" || code === "EOPNOTSUPP") {
    artifactFailure("filesystem-unsupported", subject);
  }
  artifactFailure("filesystem-unsupported", subject);
}

export function lstatPresent(candidate: string): Stats | null {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    filesystemFailure(error, candidate);
  }
}

export function canonicalProjectRoot(candidate: string): string {
  const absolute = path.resolve(candidate);
  const rootStats = lstatPresent(absolute);
  if (rootStats === null || !rootStats.isDirectory()) {
    artifactFailure("filesystem-unsupported", candidate);
  }
  if (rootStats.isSymbolicLink()) {
    artifactFailure("symlink-traversal", candidate);
  }
  let real: string;
  try {
    real = realpathSync.native(absolute);
  } catch (error) {
    filesystemFailure(error, candidate);
  }
  if (path.normalize(real) !== path.normalize(absolute)) {
    artifactFailure("symlink-traversal", candidate);
  }
  return real;
}

export function absolutePath(
  root: string,
  relative: PortableRelativePath,
): string {
  const candidate = path.resolve(root, ...relative.split("/"));
  const back = path.relative(root, candidate);
  if (
    back === ".." ||
    back.startsWith(`..${path.sep}`) ||
    path.isAbsolute(back)
  ) {
    artifactFailure("path-escape", relative);
  }
  return candidate;
}

export function inspectParentsNoFollow(
  root: string,
  relative: PortableRelativePath,
  includeLeaf: boolean,
): void {
  const segments = relative.split("/");
  const limit = includeLeaf ? segments.length : segments.length - 1;
  let current = root;
  for (let index = 0; index < limit; index += 1) {
    current = path.join(current, segments[index]!);
    const stats = lstatPresent(current);
    if (stats === null) {
      return;
    }
    if (stats.isSymbolicLink()) {
      artifactFailure("symlink-traversal", relative);
    }
    if (!stats.isDirectory() && index < segments.length - 1) {
      artifactFailure("unexpected-live-state", relative);
    }
  }
}

export function ensureDirectoryNoFollow(
  root: string,
  relative: PortableRelativePath,
  mode: number,
): string {
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const stats = lstatPresent(current);
    if (stats === null) {
      try {
        mkdirSync(current, { mode });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          filesystemFailure(error, relative);
        }
      }
      const created = lstatPresent(current);
      if (created === null || !created.isDirectory() || created.isSymbolicLink()) {
        artifactFailure("control-path-collision", relative);
      }
      syncDirectory(path.dirname(current));
      continue;
    }
    if (stats.isSymbolicLink()) {
      artifactFailure("symlink-traversal", relative);
    }
    if (!stats.isDirectory()) {
      artifactFailure("control-path-collision", relative);
    }
  }
  return current;
}

export function readFileState(
  root: string,
  relative: PortableRelativePath,
  mismatchKind:
    | "unexpected-live-state"
    | "unexpected-staged-state"
    | "recovery-conflict",
): ExpectedFileState {
  inspectParentsNoFollow(root, relative, false);
  const absolute = absolutePath(root, relative);
  const stats = lstatPresent(absolute);
  if (stats === null) {
    return { kind: "absent" };
  }
  if (stats.isSymbolicLink()) {
    artifactFailure("symlink-traversal", relative);
  }
  if (!stats.isFile()) {
    artifactFailure(mismatchKind, relative);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolute);
  } catch (error) {
    filesystemFailure(error, relative);
  }
  return {
    kind: "file",
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength,
    mode: stats.mode & 0o777,
  };
}

export function sameFileState(
  actual: ExpectedFileState,
  expected: ExpectedFileState,
): boolean {
  return (
    actual.kind === expected.kind &&
    (actual.kind === "absent" ||
      (expected.kind === "file" &&
        actual.sha256 === expected.sha256 &&
        actual.sizeBytes === expected.sizeBytes &&
        actual.mode === expected.mode))
  );
}

export function assertFileState(
  root: string,
  relative: PortableRelativePath,
  expected: ExpectedFileState,
  kind:
    | "unexpected-live-state"
    | "unexpected-staged-state"
    | "recovery-conflict",
): void {
  const actual = readFileState(root, relative, kind);
  if (!sameFileState(actual, expected)) {
    artifactFailure(kind, relative);
  }
}

export function listFilesNoFollow(
  root: string,
  relative: PortableRelativePath,
): readonly PortableRelativePath[] {
  inspectParentsNoFollow(root, relative, true);
  const start = absolutePath(root, relative);
  const startStats = lstatPresent(start);
  if (startStats === null) {
    return [];
  }
  if (startStats.isSymbolicLink()) {
    artifactFailure("symlink-traversal", relative);
  }
  if (!startStats.isDirectory()) {
    artifactFailure("control-path-collision", relative);
  }
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      filesystemFailure(error, relative);
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const child = path.join(directory, entry.name);
      const childRelative = `${prefix}/${entry.name}`;
      const stats = lstatPresent(child);
      if (stats === null) {
        artifactFailure("unexpected-staged-state", childRelative);
      }
      if (stats.isSymbolicLink()) {
        artifactFailure("symlink-traversal", childRelative);
      }
      if (stats.isDirectory()) {
        visit(child, childRelative);
      } else if (stats.isFile()) {
        files.push(childRelative);
      } else {
        artifactFailure("unexpected-staged-state", childRelative);
      }
    }
  };
  visit(start, relative);
  return files;
}

export function syncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    filesystemFailure(error, directory);
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

export function writeDurableFile(
  absolute: string,
  bytes: string,
  mode: number,
  exclusive: boolean,
): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      absolute,
      exclusive
        ? constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        : constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY,
      mode,
    );
    writeFileSync(descriptor, bytes, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    throw error;
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
  syncDirectory(path.dirname(absolute));
}

export function renameDurable(source: string, destination: string): void {
  try {
    renameSync(source, destination);
  } catch (error) {
    filesystemFailure(error, `${source} -> ${destination}`);
  }
  syncDirectory(path.dirname(source));
  if (path.dirname(source) !== path.dirname(destination)) {
    syncDirectory(path.dirname(destination));
  }
}

export function unlinkDurable(absolute: string): void {
  try {
    unlinkSync(absolute);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    filesystemFailure(error, absolute);
  }
  syncDirectory(path.dirname(absolute));
}

export function removeTreeNoFollow(absolute: string): void {
  const stats = lstatPresent(absolute);
  if (stats === null) {
    return;
  }
  if (stats.isSymbolicLink()) {
    artifactFailure("symlink-traversal", absolute);
  }
  try {
    rmSync(absolute, { recursive: true, force: false });
  } catch (error) {
    filesystemFailure(error, absolute);
  }
  syncDirectory(path.dirname(absolute));
}

export function expectedStateMode(state: FileState): number {
  return state.mode;
}
