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
  logicalOutputPath,
  portableProjectPathsOverlap,
  type SessionLayout,
} from "./layout.js";
import type { PublishedSupplementalFile } from "./publication.js";
import type { GenesOutputInventory } from "./genes-output.js";
import type {
  CandidateFile,
  ExistingGenerationImport,
  ExistingGenerationPolicy,
} from "./types.js";

/** Copies and validates the optional host claim before the session starts. */
export function snapshotExistingGenerationPolicy(
  policy: ExistingGenerationPolicy | undefined,
): ExistingGenerationPolicy | null {
  if (policy === undefined) return null;
  const imported = policy.import;
  if (imported === undefined) return Object.freeze({});
  const seen = new Map<string, string>();
  const snapshotFiles = (
    files: ExistingGenerationImport["genesFiles"],
    subject: "genesFiles" | "supplementalFiles",
  ) =>
    files.map((file, index) => {
      const portablePath = validatePortableRelativePath(
        file.path,
        `existingGeneration.import.${subject}[${index}].path`,
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
        throw new Error(
          `existing generation file has an invalid SHA-256 digest: ${portablePath}`,
        );
      }
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
        throw new Error(
          `existing generation file has an invalid byte size: ${portablePath}`,
        );
      }
      if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
        throw new Error(
          `existing generation file has an invalid mode: ${portablePath}`,
        );
      }
      return Object.freeze({
        path: portablePath,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mode: file.mode,
      });
    });
  const genesFiles = snapshotFiles(imported.genesFiles, "genesFiles");
  const supplementalFiles = snapshotFiles(
    imported.supplementalFiles,
    "supplementalFiles",
  );
  genesFiles.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  supplementalFiles.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return Object.freeze({
    import: Object.freeze({
      genesFiles: Object.freeze(genesFiles),
      supplementalFiles: Object.freeze(supplementalFiles),
    }),
  });
}

/** Checks the older host's exact claim for every compiler-owned output file. */
export function checkExistingGenesFiles(
  layout: SessionLayout,
  imported: ExistingGenerationImport,
  live: GenesOutputInventory,
): void {
  const actual = live.files.map((file) => Object.freeze({
    path: logicalOutputPath(layout, file.relativePath),
    sha256: file.digest,
    sizeBytes: file.sizeBytes,
    mode: file.mode,
  }));
  if (actual.length !== imported.genesFiles.length) {
    throw new Error("existing generation import names a different Genes file set");
  }
  for (const [index, expected] of imported.genesFiles.entries()) {
    const file = actual[index]!;
    if (
      expected.path !== file.path ||
      expected.sha256 !== file.sha256 ||
      expected.sizeBytes !== file.sizeBytes ||
      expected.mode !== file.mode
    ) {
      throw new Error(`existing Genes output changed: ${expected.path}`);
    }
  }
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
  files: readonly PublishedSupplementalFile[],
): void {
  if (imported === undefined) return;
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
