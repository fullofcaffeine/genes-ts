import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalDigest,
  sha256Bytes,
  type CanonicalJson,
} from "../artifacts/index.js";
import type { CandidateFile } from "./types.js";
import {
  logicalOutputPath,
  type SessionLayout,
} from "./layout.js";

const MANIFEST_HEADER = "genes-output-manifest-v2";
const OWNER_PREFIX = "owner-base64:";
const READABLE_SCOPE_LIMIT = 48;

export interface GenesOwnedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly mode: number;
}

export interface GenesOutputInventory {
  readonly root: string;
  readonly ownerIdentity: string;
  readonly manifestName: string;
  readonly manifestPath: string;
  readonly manifestFile: GenesOwnedFile;
  readonly files: readonly GenesOwnedFile[];
  /** Digest of paths and bytes, not merely of the ownership-list text. */
  readonly manifestDigest: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    value.normalize("NFC") === value &&
    value
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !segment.startsWith(".genes-output-"),
      )
  );
}

function ownerManifestName(ownerIdentity: string): string {
  let sanitized = "";
  // Haxe's String iteration here is over UTF-16 code units. Match that exact
  // compiler spelling so a non-BMP entry name receives two replacement
  // underscores rather than one JavaScript code-point replacement.
  for (let index = 0; index < ownerIdentity.length; index += 1) {
    const code = ownerIdentity.charCodeAt(index);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      code === 45 ||
      code === 95 ||
      code === 46;
    sanitized += allowed ? ownerIdentity[index] : "_";
  }
  const readable = (sanitized.length === 0 ? "output" : sanitized).slice(
    0,
    READABLE_SCOPE_LIMIT,
  );
  return `.genes-output-${readable}-${sha256Bytes(ownerIdentity)}.manifest`;
}

function decodeOwner(line: string, manifestPath: string): string {
  if (!line.startsWith(OWNER_PREFIX)) {
    throw new Error(`Genes output manifest has no owner identity: ${manifestPath}`);
  }
  const encoded = line.slice(OWNER_PREFIX.length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (
    decoded.length === 0 ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    Buffer.from(decoded, "utf8").toString("base64") !== encoded
  ) {
    throw new Error(`Genes output manifest owner is invalid: ${manifestPath}`);
  }
  return decoded;
}

function readOwnedFile(root: string, relativePath: string): GenesOwnedFile {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const relativeBack = path.relative(root, absolutePath);
  if (
    path.isAbsolute(relativeBack) ||
    relativeBack === ".." ||
    relativeBack.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Genes output path escapes its root: ${relativePath}`);
  }
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Genes output path is not a real file: ${absolutePath}`);
  }
  const bytes = readFileSync(absolutePath);
  return Object.freeze({
    relativePath,
    absolutePath,
    digest: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength,
    mode: stats.mode & 0o777,
  });
}

/** Reads the exact compiler-owned output inventory and every named file. */
export function readGenesOutput(
  root: string,
  ownerIdentity: string,
  required: boolean,
): GenesOutputInventory | null {
  const manifestName = ownerManifestName(ownerIdentity);
  const manifestPath = path.join(root, manifestName);
  if (!existsSync(manifestPath)) {
    if (required) {
      throw new Error(
        `Genes did not produce its ownership manifest for ${ownerIdentity}`,
      );
    }
    return null;
  }
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`Genes output root is not a directory: ${root}`);
  }
  const manifestStats = lstatSync(manifestPath);
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    throw new Error(`Genes output manifest is not a real file: ${manifestPath}`);
  }
  const lines = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines[0] !== MANIFEST_HEADER) {
    throw new Error(`Unsupported Genes output manifest: ${manifestPath}`);
  }
  if (decodeOwner(lines[1] ?? "", manifestPath) !== ownerIdentity) {
    throw new Error(`Genes output manifest owner mismatch: ${manifestPath}`);
  }
  const entries = lines.slice(2);
  if (entries.at(-1) === "") entries.pop();
  let previous: string | null = null;
  const portable = new Set<string>();
  for (const entry of entries) {
    if (!validRelative(entry)) {
      throw new Error(`Invalid Genes output manifest path: ${entry}`);
    }
    if (previous !== null && compareCodeUnits(previous, entry) >= 0) {
      throw new Error(`Genes output paths are not strictly sorted: ${manifestPath}`);
    }
    const key = entry.toLowerCase();
    if (portable.has(key)) {
      throw new Error(`Genes output paths collide by case: ${manifestPath}`);
    }
    portable.add(key);
    previous = entry;
  }
  const files = Object.freeze(entries.map((entry) => readOwnedFile(root, entry)));
  const manifestFile = readOwnedFile(root, manifestName);
  const manifestDigest = canonicalDigest({
    protocol: "genes.tooling.genes-output-inventory.v1",
    ownerIdentity,
    ownershipManifest: {
      sha256: manifestFile.digest,
      sizeBytes: manifestFile.sizeBytes,
      mode: manifestFile.mode,
    },
    files: files.map((file) => ({
      path: file.relativePath,
      sha256: file.digest,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
  } as CanonicalJson);
  return Object.freeze({
    root,
    ownerIdentity,
    manifestName,
    manifestPath,
    manifestFile,
    files,
    manifestDigest,
  });
}

export function validationFiles(
  layout: SessionLayout,
  inventory: GenesOutputInventory,
): readonly CandidateFile[] {
  return Object.freeze(
    inventory.files.map((file) =>
      Object.freeze({
        logicalPath: logicalOutputPath(layout, file.relativePath),
        physicalPath: file.absolutePath,
        digest: file.digest,
      }),
    ),
  );
}

/** Guards against private compiler leftovers entering the outer transaction. */
export function assertCandidateContainsOnlyOwnedFiles(
  inventory: GenesOutputInventory,
): void {
  const expected = new Set([
    inventory.manifestName,
    ...inventory.files.map((file) => file.relativePath),
  ]);
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`candidate output contains a symbolic link: ${absolute}`);
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`candidate output contains a special file: ${absolute}`);
      }
      const relative = path.relative(inventory.root, absolute).split(path.sep).join("/");
      if (!expected.has(relative)) {
        throw new Error(`candidate output contains an unowned file: ${relative}`);
      }
    }
  };
  visit(inventory.root);
}
