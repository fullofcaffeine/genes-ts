import path from "node:path";

import {
  readFileState,
  sameFileState,
} from "../artifacts/filesystem.js";
import {
  portablePathIdentity,
  validatePortableRelativePath,
} from "../artifacts/validate-plan.js";
import {
  portableProjectPathsOverlap,
  type SessionLayout,
} from "./layout.js";
import type { PublishedSupplementalFile } from "./publication.js";
import type {
  CandidateFile,
  ExistingGenerationImport,
  ExistingGenerationPolicy,
} from "./types.js";

export interface CheckedExistingGeneration {
  readonly manifestDigest: string;
  readonly supplementalFiles: readonly PublishedSupplementalFile[];
}

/** Copies and validates the optional host claim before the session starts. */
export function snapshotExistingGenerationPolicy(
  policy: ExistingGenerationPolicy | undefined,
): ExistingGenerationPolicy | null {
  if (policy === undefined) return null;
  const imported = policy.import;
  if (imported === undefined) return Object.freeze({});
  if (!/^[0-9a-f]{64}$/u.test(imported.manifestDigest)) {
    throw new Error("existing generation manifestDigest must be one lowercase SHA-256 digest");
  }
  const seen = new Map<string, string>();
  const supplementalFiles = imported.supplementalFiles.map((file, index) => {
    const portablePath = validatePortableRelativePath(
      file.path,
      `existingGeneration.import.supplementalFiles[${index}].path`,
    );
    const identity = portablePathIdentity(portablePath);
    const previous = seen.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `existing generation paths collide on a portable filesystem: ${previous} and ${portablePath}`,
      );
    }
    seen.set(identity, portablePath);
    if (!/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw new Error(`existing generation file has an invalid SHA-256 digest: ${portablePath}`);
    }
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error(`existing generation file has an invalid byte size: ${portablePath}`);
    }
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw new Error(`existing generation file has an invalid mode: ${portablePath}`);
    }
    return Object.freeze({
      path: portablePath,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    });
  });
  supplementalFiles.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  return Object.freeze({
    import: Object.freeze({
      manifestDigest: imported.manifestDigest,
      supplementalFiles: Object.freeze(supplementalFiles),
    }),
  });
}

/** Checks every claimed file against the live tree without following links. */
export function checkExistingGenerationFiles(
  layout: SessionLayout,
  imported: ExistingGenerationImport,
): {
  readonly published: readonly PublishedSupplementalFile[];
  readonly candidates: readonly CandidateFile[];
} {
  const published = imported.supplementalFiles.map((file) => {
    const absolute = path.join(layout.projectRoot, ...file.path.split("/"));
    if (
      portableProjectPathsOverlap(layout.projectRoot, absolute, layout.publicOutputRoot) ||
      portableProjectPathsOverlap(layout.projectRoot, absolute, layout.stateRoot) ||
      portableProjectPathsOverlap(layout.projectRoot, absolute, layout.stableControlRoot)
    ) {
      throw new Error(`existing generation file overlaps session-owned paths: ${file.path}`);
    }
    const actual = readFileState(
      layout.projectRoot,
      file.path,
      "unexpected-live-state",
    );
    const expected = Object.freeze({
      kind: "file" as const,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    });
    if (!sameFileState(actual, expected)) {
      throw new Error(`existing generation file changed: ${file.path}`);
    }
    return Object.freeze({
      source: "validator" as const,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    });
  });
  return Object.freeze({
    published: Object.freeze(published),
    candidates: Object.freeze(
      published.map((file) =>
        Object.freeze({
          logicalPath: file.path,
          physicalPath: path.join(layout.projectRoot, ...file.path.split("/")),
          digest: file.sha256,
        }),
      ),
    ),
  });
}

/** Requires an optional old-host claim to agree with the session marker. */
export function assertImportMatchesPublished(
  imported: ExistingGenerationImport | undefined,
  manifestDigest: string,
  files: readonly PublishedSupplementalFile[],
): void {
  if (imported === undefined) return;
  if (imported.manifestDigest !== manifestDigest) {
    throw new Error("existing generation import names a different Genes manifest");
  }
  if (imported.supplementalFiles.length !== files.length) {
    throw new Error("existing generation import names a different supplemental file set");
  }
  for (const [index, file] of imported.supplementalFiles.entries()) {
    const published = files[index]!;
    if (
      file.path !== published.path ||
      file.sha256 !== published.sha256 ||
      file.sizeBytes !== published.sizeBytes ||
      file.mode !== published.mode
    ) {
      throw new Error(`existing generation import differs at ${file.path}`);
    }
  }
}
