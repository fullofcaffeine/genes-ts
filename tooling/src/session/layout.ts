import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { ensureDirectoryNoFollow } from "../artifacts/filesystem.js";
import {
  portablePathIdentity,
  validatePortableRelativePath,
} from "../artifacts/validate-plan.js";

export interface SessionLayout {
  readonly projectRoot: string;
  readonly projectIdentity: string;
  readonly publicOutputFile: string;
  readonly publicOutputRelative: string;
  /** NFC/case-folded identity used by locks and recovery authority. */
  readonly publicOutputRootAuthority: string;
  /** NFC/case-folded identity of the one entry admitted within that root. */
  readonly publicEntryAuthority: string;
  readonly publicOutputRoot: string;
  readonly publicOutputRootRelative: string | null;
  readonly outputIdentity: string;
  readonly stateRoot: string;
  readonly stateRelative: string;
  readonly candidatesRelative: string;
  readonly transactionRelative: string;
  readonly generationMarkerRelative: string;
  /** Entry-scoped v1 paths read only while an existing project upgrades. */
  readonly legacyTransactionRelative: string;
  readonly legacyGenerationMarkerRelative: string;
  readonly legacySessionLockRelative: string;
  /** Stable v1-to-v2 migration evidence and transaction workspace. */
  readonly authorityMigrationRelative: string;
  readonly authorityMigrationReceiptRelative: string;
  /** Stable project-local locks and recovery records for every output scope. */
  readonly stableControlRoot: string;
  readonly publicationControlRelative: string;
  readonly publicationControlRoot: string;
  readonly serverLeaseRelative: string;
  readonly sessionLockRelative: string;
  readonly rootOwnerRelative: string;
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

/**
 * Proves that two exact path spellings directly name the same existing object.
 * A final symbolic link is never accepted as evidence of native case folding.
 */
export function samePhysicalSessionPath(
  left: string,
  right: string,
  kind: "file" | "directory",
): boolean {
  try {
    const leftStats = lstatSync(left);
    const rightStats = lstatSync(right);
    const expectedKind =
      kind === "file"
        ? leftStats.isFile() && rightStats.isFile()
        : leftStats.isDirectory() && rightStats.isDirectory();
    return (
      !leftStats.isSymbolicLink() &&
      !rightStats.isSymbolicLink() &&
      expectedKind &&
      realpathSync.native(left) === realpathSync.native(right)
    );
  } catch {
    return false;
  }
}

function portableContains(root: string, candidate: string): boolean {
  const rootIdentity = portablePathIdentity(root);
  const candidateIdentity = portablePathIdentity(candidate);
  return (
    rootIdentity.length === 0 ||
    candidateIdentity === rootIdentity ||
    candidateIdentity.startsWith(`${rootIdentity}/`)
  );
}

function portableOverlap(left: string, right: string): boolean {
  return portableContains(left, right) || portableContains(right, left);
}

function portable(root: string, candidate: string, label: string): string {
  const relative = path.relative(root, candidate).split(path.sep).join("/");
  if (relative.length === 0) {
    throw new Error(`${label} must be below projectRoot`);
  }
  return validatePortableRelativePath(relative, label);
}

function assertExistingParentsAreReal(root: string, candidate: string): void {
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    if (!existsSync(current)) return;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`session path traverses a symbolic link: ${current}`);
    }
    if (current !== candidate && !stats.isDirectory()) {
      throw new Error(`session path parent is not a directory: ${current}`);
    }
  }
}

/**
 * Resolves the one public output scope and the private state scope.
 *
 * Both must be real children of the canonical project root and must not
 * overlap. That keeps state changes out of generated output and prevents a
 * publisher cleanup from treating its own journal or candidates as artifacts.
 */
export function resolveSessionLayout(
  projectRootOption: string,
  projectIdentity: string,
  publicOutputOption: string,
  stateDirectoryOption: string,
): SessionLayout {
  if (projectIdentity.trim().length === 0) {
    throw new Error("projectIdentity must not be empty");
  }
  const projectAbsolute = path.resolve(projectRootOption);
  const projectStats = lstatSync(projectAbsolute);
  if (projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
    throw new Error("projectRoot must be a real directory");
  }
  const projectRoot = realpathSync.native(projectAbsolute);
  if (path.normalize(projectRoot) !== path.normalize(projectAbsolute)) {
    throw new Error("projectRoot must not traverse a symbolic link");
  }

  const publicOutputFile = path.resolve(projectRoot, publicOutputOption);
  const stateRoot = path.resolve(projectRoot, stateDirectoryOption);
  if (!containedBy(projectRoot, publicOutputFile)) {
    throw new Error("publicOutputFile escapes projectRoot");
  }
  if (!containedBy(projectRoot, stateRoot) || stateRoot === projectRoot) {
    throw new Error("stateDirectory must be a project-contained directory");
  }
  const outputIdentity = path.basename(publicOutputFile);
  if (
    outputIdentity.length === 0 ||
    outputIdentity === "." ||
    outputIdentity === ".." ||
    !/\.(?:js|jsx|mjs|ts|tsx)$/u.test(outputIdentity)
  ) {
    throw new Error(
      "publicOutputFile must name one .js, .jsx, .mjs, .ts, or .tsx entry",
    );
  }
  const publicOutputRoot = path.dirname(publicOutputFile);
  assertExistingParentsAreReal(projectRoot, publicOutputRoot);
  assertExistingParentsAreReal(projectRoot, stateRoot);

  const stateRelative = portable(projectRoot, stateRoot, "stateDirectory");
  const publicOutputRootRelative =
    publicOutputRoot === projectRoot
      ? null
      : portable(projectRoot, publicOutputRoot, "publicOutputRoot");
  const publicOutputRelative = portable(
    projectRoot,
    publicOutputFile,
    "publicOutputFile",
  );
  const publicOutputRootAuthority =
    publicOutputRootRelative === null
      ? "project-root:."
      : `project-relative:${portablePathIdentity(publicOutputRootRelative)}`;
  const publicEntryAuthority = portablePathIdentity(publicOutputRelative);
  const stableControlDirectory = ".genes/tooling";
  if (portableOverlap(publicOutputRootRelative ?? "", stableControlDirectory)) {
    throw new Error(
      "public output root and stable session-control directory must not overlap",
    );
  }
  if (portableOverlap(publicOutputRootRelative ?? "", stateRelative)) {
    throw new Error("stateDirectory and public output root must not overlap");
  }
  if (portableOverlap(stableControlDirectory, stateRelative)) {
    throw new Error(
      "stateDirectory and stable session-control directory must not overlap",
    );
  }
  if (portableContains(stableControlDirectory, publicOutputRelative)) {
    throw new Error(
      "publicOutputFile must not be inside the stable session-control directory",
    );
  }
  const stableControlRoot = path.join(
    projectRoot,
    ...stableControlDirectory.split("/"),
  );
  const candidatesRelative = `${stateRelative}/candidates`;
  const lockDirectory = `${stableControlDirectory}/session-locks`;
  const lockScope = createHash("sha256")
    .update(publicOutputRootAuthority)
    .digest("hex");
  const legacyLockScope = createHash("sha256")
    .update(publicEntryAuthority)
    .digest("hex");
  const publicationControlDirectory = `${stableControlDirectory}/session-publications/${lockScope}`;
  const legacyPublicationControlDirectory = `${stableControlDirectory}/session-publications/${legacyLockScope}`;
  const publicationControlRoot = path.join(
    projectRoot,
    ...publicationControlDirectory.split("/"),
  );

  return Object.freeze({
    projectRoot,
    projectIdentity,
    publicOutputFile,
    publicOutputRelative,
    publicOutputRootAuthority,
    publicEntryAuthority,
    publicOutputRoot,
    publicOutputRootRelative,
    outputIdentity,
    stateRoot,
    stateRelative,
    candidatesRelative,
    transactionRelative: `${publicationControlDirectory}/transactions`,
    generationMarkerRelative: `${publicationControlDirectory}/accepted-generation.json`,
    legacyTransactionRelative: `${legacyPublicationControlDirectory}/transactions`,
    legacyGenerationMarkerRelative: `${legacyPublicationControlDirectory}/accepted-generation.json`,
    legacySessionLockRelative: `${lockDirectory}/${legacyLockScope}.json`,
    authorityMigrationRelative: `${publicationControlDirectory}/authority-migration`,
    authorityMigrationReceiptRelative: `${publicationControlDirectory}/authority-migration/receipt.json`,
    stableControlRoot,
    publicationControlRelative: publicationControlDirectory,
    publicationControlRoot,
    serverLeaseRelative: `${stateRelative}/haxe-server.json`,
    sessionLockRelative: `${lockDirectory}/${lockScope}.json`,
    rootOwnerRelative: `${publicationControlDirectory}/root-owner.json`,
  });
}

/** Creates only the common lock directory needed before lifetime exclusion. */
export function materializeSessionLockLayout(layout: SessionLayout): void {
  ensureDirectoryNoFollow(
    layout.projectRoot,
    path.posix.dirname(layout.sessionLockRelative),
    0o700,
  );
}

/** Creates root-scoped authority storage after both lifetime locks are held. */
export function materializeSessionAuthorityLayout(layout: SessionLayout): void {
  ensureDirectoryNoFollow(
    layout.projectRoot,
    layout.publicationControlRelative,
    0o700,
  );
}

/** Creates caller-owned compiler state without creating publication records. */
export function materializeSessionPrivateLayout(layout: SessionLayout): void {
  ensureDirectoryNoFollow(layout.projectRoot, layout.stateRelative, 0o700);
  ensureDirectoryNoFollow(layout.projectRoot, layout.candidatesRelative, 0o700);
}

/** Completes runtime storage after startup authority is excluded. */
export function materializeSessionRuntimeLayout(layout: SessionLayout): void {
  materializeSessionPrivateLayout(layout);
  materializeSessionAuthorityLayout(layout);
}

/**
 * Compares two project-related paths with the same portable identity model as
 * artifact publication. Paths outside the project cannot alias a contained
 * output on a portable filesystem and therefore do not overlap here.
 */
export function portableProjectPathsOverlap(
  projectRoot: string,
  left: string,
  right: string,
): boolean {
  if (!containedBy(projectRoot, left) || !containedBy(projectRoot, right)) {
    return false;
  }
  const relative = (candidate: string): string =>
    path.relative(projectRoot, candidate).split(path.sep).join("/");
  return portableOverlap(relative(left), relative(right));
}

export function logicalOutputPath(
  layout: SessionLayout,
  outputRelative: string,
): string {
  return layout.publicOutputRootRelative === null
    ? outputRelative
    : `${layout.publicOutputRootRelative}/${outputRelative}`;
}
