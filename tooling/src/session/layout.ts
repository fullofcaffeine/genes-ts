import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { ensureDirectoryNoFollow } from "../artifacts/filesystem.js";
import { validatePortableRelativePath } from "../artifacts/validate-plan.js";

export interface SessionLayout {
  readonly projectRoot: string;
  readonly projectIdentity: string;
  readonly publicOutputFile: string;
  readonly publicOutputRelative: string;
  readonly publicOutputRoot: string;
  readonly publicOutputRootRelative: string | null;
  readonly outputIdentity: string;
  readonly stateRoot: string;
  readonly stateRelative: string;
  readonly candidatesRelative: string;
  readonly transactionRelative: string;
  readonly generationMarkerRelative: string;
  readonly serverLeaseRelative: string;
  readonly sessionLockRelative: string;
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

function overlap(left: string, right: string): boolean {
  return containedBy(left, right) || containedBy(right, left);
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
  if (overlap(publicOutputRoot, stateRoot)) {
    throw new Error("stateDirectory and public output root must not overlap");
  }
  assertExistingParentsAreReal(projectRoot, publicOutputRoot);
  assertExistingParentsAreReal(projectRoot, stateRoot);

  const stateRelative = portable(projectRoot, stateRoot, "stateDirectory");
  ensureDirectoryNoFollow(projectRoot, stateRelative, 0o700);
  const candidatesRelative = `${stateRelative}/candidates`;
  ensureDirectoryNoFollow(projectRoot, candidatesRelative, 0o700);

  const publicOutputRootRelative =
    publicOutputRoot === projectRoot
      ? null
      : portable(projectRoot, publicOutputRoot, "publicOutputRoot");
  const publicOutputRelative = portable(
    projectRoot,
    publicOutputFile,
    "publicOutputFile",
  );
  const lockDirectory = ".genes/tooling/session-locks";
  ensureDirectoryNoFollow(projectRoot, lockDirectory, 0o700);
  const lockScope = createHash("sha256")
    .update(publicOutputRelative)
    .digest("hex");

  return Object.freeze({
    projectRoot,
    projectIdentity,
    publicOutputFile,
    publicOutputRelative,
    publicOutputRoot,
    publicOutputRootRelative,
    outputIdentity,
    stateRoot,
    stateRelative,
    candidatesRelative,
    transactionRelative: `${stateRelative}/publication`,
    generationMarkerRelative: `${stateRelative}/accepted-generation.json`,
    serverLeaseRelative: `${stateRelative}/haxe-server.json`,
    sessionLockRelative: `${lockDirectory}/${lockScope}.json`,
  });
}

export function logicalOutputPath(
  layout: SessionLayout,
  outputRelative: string,
): string {
  return layout.publicOutputRootRelative === null
    ? outputRelative
    : `${layout.publicOutputRootRelative}/${outputRelative}`;
}
