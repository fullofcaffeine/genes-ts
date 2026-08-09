import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalDigest,
  sha256Bytes,
  type CanonicalJson,
  type ExpectedFileState,
} from "../artifacts/index.js";
import {
  portablePathIdentity,
  validatePortableRelativePath,
} from "../artifacts/validate-plan.js";
import type {
  AdmittedArtifact,
  CandidateFile,
  PreparedRevision,
} from "./types.js";
import type { SessionLayout } from "./layout.js";

const DEFAULT_MODE = 0o644;
const RESERVED_STAGE_PATHS = ["admission", "generation.json", "output"] as const;

/** Exact staged bytes that may join the outer accepted generation. */
export interface SupplementalFile {
  readonly path: string;
  readonly stagedPath: string;
  readonly absolutePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly mode: number;
}

/** Checked private inputs for one Haxe request. */
export interface StagedPreparedRevision {
  readonly digest: string;
  readonly classPaths: readonly string[];
  readonly publicFiles: readonly SupplementalFile[];
  /** Files with no public owner are removed before artifact publication. */
  readonly privateFiles: readonly string[];
}

function bytesOf(content: string | Uint8Array): Buffer {
  return typeof content === "string"
    ? Buffer.from(content, "utf8")
    : Buffer.from(content);
}

function checkedMode(mode: number | undefined, subject: string): number {
  const actual = mode ?? DEFAULT_MODE;
  if (!Number.isInteger(actual) || actual < 0 || actual > 0o777) {
    throw new Error(`${subject} mode must be an integer from 000 through 777`);
  }
  return actual;
}

function uniquePortablePaths(paths: readonly string[], subject: string): void {
  const seen = new Map<string, string>();
  for (const candidate of paths) {
    const identity = portablePathIdentity(candidate);
    const previous = seen.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `${subject} paths collide on a portable filesystem: ${previous} and ${candidate}`,
      );
    }
    seen.set(identity, candidate);
  }
}

function assertPreparedPathAvailable(candidate: string, subject: string): void {
  const identity = portablePathIdentity(candidate);
  for (const reserved of RESERVED_STAGE_PATHS) {
    const reservedIdentity = portablePathIdentity(reserved);
    if (
      identity === reservedIdentity ||
      identity.startsWith(`${reservedIdentity}/`)
    ) {
      throw new Error(`${subject} path uses reserved session name: ${candidate}`);
    }
  }
}

function stagedFile(
  layout: SessionLayout,
  stagedPath: string,
  publicPath: string,
  content: string | Uint8Array,
  mode: number | undefined,
): SupplementalFile {
  const bytes = bytesOf(content);
  const absolutePath = path.join(
    layout.projectRoot,
    ...stagedPath.split("/"),
  );
  mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  writeFileSync(absolutePath, bytes, { mode: checkedMode(mode, publicPath) });
  chmodSync(absolutePath, checkedMode(mode, publicPath));
  return Object.freeze({
    path: publicPath,
    stagedPath,
    absolutePath,
    digest: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength,
    mode: checkedMode(mode, publicPath),
  });
}

/**
 * Copies host-prepared bytes into one private revision.
 *
 * The callback that produced these bytes never receives a writable session
 * path. This function therefore remains the only writer for the prepared tree,
 * can reject portable path aliases before writing, and can compute the exact
 * request identity from the bytes Haxe will read.
 */
export function stagePreparedRevision(
  layout: SessionLayout,
  candidateStageRelative: string,
  prepared: PreparedRevision,
): StagedPreparedRevision {
  const relativePaths = prepared.files.map((file, index) =>
    validatePortableRelativePath(
      file.relativePath,
      `prepareRevision.files[${index}].relativePath`,
    ),
  );
  const classPathRelatives = prepared.classPaths.map((classPath, index) =>
    validatePortableRelativePath(
      classPath,
      `prepareRevision.classPaths[${index}]`,
    ),
  );
  const publicPaths = prepared.files.flatMap((file, index) =>
    file.publishPath === undefined
      ? []
      : [
          validatePortableRelativePath(
            file.publishPath,
            `prepareRevision.files[${index}].publishPath`,
          ),
        ],
  );
  uniquePortablePaths(relativePaths, "prepared input");
  uniquePortablePaths(classPathRelatives, "prepared class path");
  uniquePortablePaths(publicPaths, "prepared public");
  for (const relativePath of relativePaths) {
    assertPreparedPathAvailable(relativePath, "prepared input");
  }
  for (const classPath of classPathRelatives) {
    assertPreparedPathAvailable(classPath, "prepared class path");
  }

  // Keep prepared paths beside `output`, not under an extra private directory.
  // When a generated Haxe source uses the same relative and public path, its
  // source-map name then resolves to the public companion after publication.
  const preparedRootRelative = candidateStageRelative;
  const preparedRoot = path.join(
    layout.projectRoot,
    ...preparedRootRelative.split("/"),
  );
  mkdirSync(preparedRoot, { recursive: true, mode: 0o700 });

  const publicFiles: SupplementalFile[] = [];
  const privateFiles: string[] = [];
  const digestFiles: Array<{
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly mode: number;
    readonly publishPath: string | null;
  }> = [];
  for (const [index, file] of prepared.files.entries()) {
    const relativePath = relativePaths[index]!;
    const stagedPath = `${preparedRootRelative}/${relativePath}`;
    const publicPath = file.publishPath === undefined
      ? null
      : validatePortableRelativePath(
          file.publishPath,
          `prepareRevision.files[${index}].publishPath`,
        );
    const staged = stagedFile(
      layout,
      stagedPath,
      publicPath ?? relativePath,
      file.content,
      file.mode,
    );
    digestFiles.push({
      path: relativePath,
      sha256: staged.digest,
      sizeBytes: staged.sizeBytes,
      mode: staged.mode,
      publishPath: publicPath,
    });
    if (publicPath === null) {
      privateFiles.push(staged.absolutePath);
    } else {
      publicFiles.push(Object.freeze({ ...staged, path: publicPath }));
    }
  }

  const classPaths = classPathRelatives.map((relativePath) => {
    const absolute = path.join(preparedRoot, ...relativePath.split("/"));
    if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) {
      throw new Error(
        `prepared class path ${relativePath} is not a generated directory`,
      );
    }
    return absolute;
  });
  const digest = canonicalDigest({
    protocol: "genes.tooling.prepared-revision.v1",
    classPaths: classPathRelatives,
    files: digestFiles,
  } as CanonicalJson);
  return Object.freeze({
    digest,
    classPaths: Object.freeze(classPaths),
    publicFiles: Object.freeze(publicFiles),
    privateFiles: Object.freeze(privateFiles),
  });
}

/** Writes evidence returned by a successful host validator into the candidate. */
export function stageAdmittedArtifacts(
  layout: SessionLayout,
  candidateStageRelative: string,
  artifacts: readonly AdmittedArtifact[],
): readonly SupplementalFile[] {
  const paths = artifacts.map((artifact, index) =>
    validatePortableRelativePath(
      artifact.path,
      `admission.artifacts[${index}].path`,
    ),
  );
  uniquePortablePaths(paths, "admitted artifact");
  return Object.freeze(
    artifacts.map((artifact, index) =>
      stagedFile(
        layout,
        `${candidateStageRelative}/admission/${paths[index]!}`,
        paths[index]!,
        artifact.content,
        artifact.mode,
      ),
    ),
  );
}

export function supplementalState(file: SupplementalFile): ExpectedFileState {
  return Object.freeze({
    kind: "file" as const,
    sha256: file.digest,
    sizeBytes: file.sizeBytes,
    mode: file.mode,
  });
}

export function supplementalCandidateFiles(
  files: readonly SupplementalFile[],
): readonly CandidateFile[] {
  return Object.freeze(
    files.map((file) =>
      Object.freeze({
        logicalPath: file.path,
        physicalPath: file.absolutePath,
        digest: file.digest,
      }),
    ),
  );
}

export function removePrivatePreparedFiles(files: readonly string[]): void {
  for (const file of files) rmSync(file, { force: true });
}

export function readLiveSupplementalFile(
  layout: SessionLayout,
  file: {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly mode: number;
  },
): CandidateFile {
  const absolutePath = path.join(layout.projectRoot, ...file.path.split("/"));
  const bytes = readFileSync(absolutePath);
  if (
    bytes.byteLength !== file.sizeBytes ||
    sha256Bytes(bytes) !== file.sha256 ||
    (lstatSync(absolutePath).mode & 0o777) !== file.mode
  ) {
    throw new Error(`accepted supplemental file changed: ${file.path}`);
  }
  return Object.freeze({
    logicalPath: file.path,
    physicalPath: absolutePath,
    digest: file.sha256,
  });
}
