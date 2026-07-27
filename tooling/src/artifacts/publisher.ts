import {
  readFileSync,
} from "node:fs";
import path from "node:path";

import { artifactFailure } from "./error.js";
import {
  absolutePath,
  assertFileState,
  canonicalProjectRoot,
  ensureDirectoryNoFollow,
  inspectParentsNoFollow,
  listFilesNoFollow,
  lstatPresent,
  readFileState,
  removeTreeNoFollow,
  renameDurable,
  sameFileState,
  syncDirectory,
  unlinkDurable,
  writeDurableFile,
} from "./filesystem.js";
import {
  createPublicationJournal,
  createPublicationLock,
  currentHostIdentity,
  encodeRecord,
  JOURNAL_FILE,
  JOURNAL_TEMP_FILE,
  LOCK_FILE,
  parsePublicationJournal,
  randomDigest,
  parsePublicationLock,
  WORK_DIRECTORY,
} from "./records.js";
import { rollbackTransaction } from "./recovery.js";
import type {
  ArtifactCheckpoint,
  ArtifactTransition,
  PublicationJournal,
  PublicationOutcome,
  PublicationPlan,
  PublishOptions,
} from "./types.js";
import { validatePublicationPlan } from "./validate-plan.js";

const CONTROL_DIRECTORY_MODE = 0o700;
const PUBLIC_DIRECTORY_MODE = 0o755;
const CONTROL_FILE_MODE = 0o600;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: string }).code
    : undefined;
}

function checkpoint(
  options: PublishOptions,
  point: ArtifactCheckpoint,
): void {
  options.faultInjector?.(point);
}

function parentRelative(relative: string): string | null {
  const segments = relative.split("/");
  segments.pop();
  return segments.length === 0 ? null : segments.join("/");
}

function verifyStage(root: string, plan: PublicationPlan): void {
  const stagedTransitions = [...plan.artifacts, plan.commitMarker].filter(
    (
      transition,
    ): transition is ArtifactTransition & { readonly stagedPath: string } =>
      transition.stagedPath !== null,
  );
  const declared = new Set(
    stagedTransitions.map((transition) => transition.stagedPath),
  );
  for (const transition of stagedTransitions) {
    assertFileState(
      root,
      transition.stagedPath,
      transition.next,
      "unexpected-staged-state",
    );
  }
  for (const actual of listFilesNoFollow(root, plan.stageRoot)) {
    if (!declared.has(actual)) {
      artifactFailure("undeclared-staged-entry", actual);
    }
  }
}

function liveDisposition(
  root: string,
  plan: PublicationPlan,
): "prior" | "next" {
  const transitions = [...plan.artifacts, plan.commitMarker];
  const states = transitions.map((transition) =>
    readFileState(root, transition.path, "unexpected-live-state"),
  );
  const allPrior = states.every((state, index) =>
    sameFileState(state, transitions[index]!.prior),
  );
  if (allPrior) {
    return "prior";
  }
  const allNext = states.every((state, index) =>
    sameFileState(state, transitions[index]!.next),
  );
  if (allNext) {
    return "next";
  }
  const conflict = transitions.find(
    (transition, index) =>
      !sameFileState(states[index]!, transition.prior) &&
      !sameFileState(states[index]!, transition.next),
  );
  artifactFailure(
    "unexpected-live-state",
    conflict?.path ?? plan.commitMarker.path,
  );
}

interface LockHandle {
  readonly absolute: string;
  readonly bytes: string;
  release(): void;
}

function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function acquireLock(
  root: string,
  plan: PublicationPlan,
  transactionId: string,
  allowDeadReclaim = true,
): LockHandle {
  const control = ensureDirectoryNoFollow(
    root,
    plan.transactionRoot,
    CONTROL_DIRECTORY_MODE,
  );
  const lockAbsolute = path.join(control, LOCK_FILE);
  const journalAbsolute = path.join(control, JOURNAL_FILE);
  const lock = createPublicationLock(plan, transactionId);
  const bytes = encodeRecord(lock);
  try {
    writeDurableFile(lockAbsolute, bytes, CONTROL_FILE_MODE, true);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      if (
        errorCode(error) === "EACCES" ||
        errorCode(error) === "EPERM" ||
        errorCode(error) === "EROFS"
      ) {
        artifactFailure("filesystem-permission", plan.transactionRoot);
      }
      artifactFailure("filesystem-unsupported", plan.transactionRoot);
    }
    const existingStats = lstatPresent(lockAbsolute);
    if (existingStats?.isSymbolicLink()) {
      artifactFailure("symlink-traversal", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    let existingBytes: string;
    try {
      existingBytes = readFileSync(lockAbsolute, "utf8");
    } catch {
      artifactFailure("untrusted-lock", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    const parsed = parsePublicationLock(existingBytes);
    if (
      parsed.projectIdentity !== plan.projectIdentity ||
      parsed.hostIdentity !== currentHostIdentity()
    ) {
      artifactFailure("untrusted-lock", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    if (lstatPresent(journalAbsolute) !== null) {
      artifactFailure("orphan-control-state", plan.transactionRoot);
    }
    if (pidIsLive(parsed.pid)) {
      artifactFailure("active-writer", plan.transactionRoot);
    }
    if (!allowDeadReclaim) {
      artifactFailure("untrusted-lock", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    let currentBytes: string;
    try {
      currentBytes = readFileSync(lockAbsolute, "utf8");
    } catch {
      artifactFailure("untrusted-lock", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    if (currentBytes !== existingBytes) {
      artifactFailure("untrusted-lock", `${plan.transactionRoot}/${LOCK_FILE}`);
    }
    unlinkDurable(lockAbsolute);
    return acquireLock(root, plan, transactionId, false);
  }
  let released = false;
  return {
    absolute: lockAbsolute,
    bytes,
    release(): void {
      if (released) {
        return;
      }
      let current: string;
      try {
        current = readFileSync(lockAbsolute, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          released = true;
          return;
        }
        artifactFailure("filesystem-permission", lockAbsolute);
      }
      if (current !== bytes) {
        artifactFailure("untrusted-lock", lockAbsolute);
      }
      unlinkDurable(lockAbsolute);
      released = true;
    },
  };
}

function persistJournal(
  root: string,
  plan: PublicationPlan,
  journal: PublicationJournal,
): void {
  const control = absolutePath(root, plan.transactionRoot);
  const journalAbsolute = path.join(control, JOURNAL_FILE);
  const temporaryAbsolute = path.join(control, JOURNAL_TEMP_FILE);
  if (lstatPresent(temporaryAbsolute) !== null) {
    artifactFailure("control-path-collision", temporaryAbsolute);
  }
  writeDurableFile(
    temporaryAbsolute,
    encodeRecord(journal),
    CONTROL_FILE_MODE,
    true,
  );
  renameDurable(temporaryAbsolute, journalAbsolute);
}

function updateJournal(
  root: string,
  plan: PublicationPlan,
  transactionId: string,
  phase: PublicationJournal["phase"],
): void {
  const control = absolutePath(root, plan.transactionRoot);
  const journalAbsolute = path.join(control, JOURNAL_FILE);
  const temporaryAbsolute = path.join(control, JOURNAL_TEMP_FILE);
  writeDurableFile(
    temporaryAbsolute,
    encodeRecord(createPublicationJournal(plan, transactionId, phase)),
    CONTROL_FILE_MODE,
    true,
  );
  renameDurable(temporaryAbsolute, journalAbsolute);
}

function backupRelative(pathname: string): string {
  return `backup/${pathname}`;
}

function publishTransition(
  root: string,
  workRoot: string,
  transition: ArtifactTransition,
  options: PublishOptions,
  checkpointPath: string,
): void {
  if (sameFileState(transition.prior, transition.next)) {
    return;
  }
  const liveAbsolute = absolutePath(root, transition.path);
  if (transition.prior.kind === "file") {
    const backup = path.join(workRoot, ...backupRelative(transition.path).split("/"));
    const backupParent = path.dirname(backup);
    ensureDirectoryNoFollow(
      root,
      path.relative(root, backupParent).split(path.sep).join("/"),
      CONTROL_DIRECTORY_MODE,
    );
    renameDurable(liveAbsolute, backup);
    checkpoint(options, `after-backup:${checkpointPath}`);
  }
  if (transition.next.kind === "file") {
    checkpoint(options, `before-publish:${checkpointPath}`);
    const parent = parentRelative(transition.path);
    if (parent !== null) {
      ensureDirectoryNoFollow(root, parent, PUBLIC_DIRECTORY_MODE);
    }
    const stagedAbsolute = absolutePath(root, transition.stagedPath!);
    renameDurable(stagedAbsolute, liveAbsolute);
    syncDirectory(path.dirname(liveAbsolute));
    checkpoint(options, `after-publish:${checkpointPath}`);
  }
}

export function publishArtifacts(options: PublishOptions): PublicationOutcome {
  const plan = validatePublicationPlan(options.plan);
  const root = canonicalProjectRoot(options.projectRoot);
  for (const transition of [...plan.artifacts, plan.commitMarker]) {
    inspectParentsNoFollow(root, transition.path, false);
    if (transition.stagedPath !== null) {
      inspectParentsNoFollow(root, transition.stagedPath, true);
    }
  }
  inspectParentsNoFollow(root, plan.transactionRoot, true);
  const disposition = liveDisposition(root, plan);
  if (disposition === "next") {
    return { action: "unchanged", transactionId: null };
  }
  verifyStage(root, plan);

  const transactionId = randomDigest();
  const lock = acquireLock(root, plan, transactionId);
  let journalPrepared = false;
  try {
    // Close the preflight/write race after lock acquisition.
    verifyStage(root, plan);
    if (liveDisposition(root, plan) !== "prior") {
      artifactFailure("unexpected-live-state", plan.commitMarker.path);
    }
    const workParent = `${plan.transactionRoot}/${WORK_DIRECTORY}`;
    ensureDirectoryNoFollow(root, workParent, CONTROL_DIRECTORY_MODE);
    const workRoot = ensureDirectoryNoFollow(
      root,
      workParent,
      CONTROL_DIRECTORY_MODE,
    );
    persistJournal(
      root,
      plan,
      createPublicationJournal(plan, transactionId, "prepared"),
    );
    journalPrepared = true;
    checkpoint(options, "after-journal-prepared");
    updateJournal(root, plan, transactionId, "publishing");
    checkpoint(options, "after-phase-publishing");

    for (const transition of plan.artifacts) {
      publishTransition(
        root,
        workRoot,
        transition,
        options,
        transition.path,
      );
    }
    publishTransition(
      root,
      workRoot,
      plan.commitMarker,
      options,
      "commit-marker",
    );
    updateJournal(root, plan, transactionId, "published");
    checkpoint(options, "after-phase-published");
    updateJournal(root, plan, transactionId, "committed");

    removeTreeNoFollow(workRoot);
    checkpoint(options, "after-cleanup:work-root");
    lock.release();
    checkpoint(options, "after-cleanup:lock");
    unlinkDurable(
      absolutePath(root, `${plan.transactionRoot}/${JOURNAL_FILE}`),
    );
    checkpoint(options, "after-cleanup:journal");
    return { action: "published", transactionId };
  } catch (error) {
    if (!journalPrepared) {
      lock.release();
    } else {
      let journalBytes: string;
      try {
        journalBytes = readFileSync(
          absolutePath(root, `${plan.transactionRoot}/${JOURNAL_FILE}`),
          "utf8",
        );
      } catch {
        throw error;
      }
      const journal = parsePublicationJournal(journalBytes);
      rollbackTransaction(root, journal, lock.bytes);
    }
    throw error;
  }
}
