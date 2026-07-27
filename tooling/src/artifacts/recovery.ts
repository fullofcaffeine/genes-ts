import { readFileSync } from "node:fs";
import path from "node:path";

import { ArtifactTransactionError, artifactFailure } from "./error.js";
import {
  absolutePath,
  assertFileState,
  canonicalProjectRoot,
  ensureDirectoryNoFollow,
  inspectParentsNoFollow,
  lstatPresent,
  readFileState,
  removeTreeNoFollow,
  renameDurable,
  sameFileState,
  unlinkDurable,
  writeDurableFile,
} from "./filesystem.js";
import {
  createPublicationJournal,
  currentHostIdentity,
  encodeRecord,
  JOURNAL_FILE,
  JOURNAL_TEMP_FILE,
  LOCK_FILE,
  parsePublicationJournal,
  parsePublicationLock,
  WORK_DIRECTORY,
} from "./records.js";
import type {
  ArtifactCheckpoint,
  ArtifactTransition,
  PublicationJournal,
  PublicationPlan,
  RecoverOptions,
  RecoveryOutcome,
} from "./types.js";
import { validatePortableRelativePath } from "./validate-plan.js";

const CONTROL_FILE_MODE = 0o600;
const CONTROL_DIRECTORY_MODE = 0o700;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: string }).code
    : undefined;
}

function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function backupRelative(
  plan: PublicationPlan,
  pathname: string,
): string {
  return `${plan.transactionRoot}/${WORK_DIRECTORY}/backup/${pathname}`;
}

function checkpointPath(
  transition: ArtifactTransition,
  plan: PublicationPlan,
): string {
  return transition === plan.commitMarker
    ? "commit-marker"
    : transition.path;
}

function persistPhase(
  root: string,
  journal: PublicationJournal,
  phase: PublicationJournal["phase"],
): PublicationJournal {
  const next = createPublicationJournal(
    journal.plan,
    journal.transactionId,
    phase,
  );
  const temporary = absolutePath(
    root,
    `${journal.plan.transactionRoot}/${JOURNAL_TEMP_FILE}`,
  );
  if (lstatPresent(temporary) !== null) {
    artifactFailure("control-path-collision", temporary);
  }
  writeDurableFile(
    temporary,
    encodeRecord(next),
    CONTROL_FILE_MODE,
    true,
  );
  renameDurable(
    temporary,
    absolutePath(
      root,
      `${journal.plan.transactionRoot}/${JOURNAL_FILE}`,
    ),
  );
  return next;
}

function rollbackTransition(
  root: string,
  journal: PublicationJournal,
  transition: ArtifactTransition,
  faultInjector?: (checkpoint: ArtifactCheckpoint) => void,
): void {
  if (sameFileState(transition.prior, transition.next)) {
    assertFileState(
      root,
      transition.path,
      transition.prior,
      "recovery-conflict",
    );
    return;
  }
  const pointPath = checkpointPath(transition, journal.plan);
  const live = readFileState(root, transition.path, "recovery-conflict");
  const backupPath = backupRelative(
    journal.plan,
    transition.path,
  );
  const backup = readFileState(root, backupPath, "recovery-conflict");

  if (transition.prior.kind === "absent") {
    if (backup.kind !== "absent") {
      artifactFailure("recovery-conflict", transition.path);
    }
    if (sameFileState(live, transition.next)) {
      unlinkDurable(absolutePath(root, transition.path));
      faultInjector?.(`after-remove-next:${pointPath}`);
    } else if (live.kind !== "absent") {
      artifactFailure("recovery-conflict", transition.path);
    }
    return;
  }

  if (
    sameFileState(live, transition.prior) &&
    backup.kind === "absent"
  ) {
    return;
  }
  if (!sameFileState(backup, transition.prior)) {
    artifactFailure("recovery-conflict", transition.path);
  }
  if (sameFileState(live, transition.next) && live.kind === "file") {
    unlinkDurable(absolutePath(root, transition.path));
    faultInjector?.(`after-remove-next:${pointPath}`);
  } else if (live.kind !== "absent") {
    artifactFailure("recovery-conflict", transition.path);
  }
  faultInjector?.(`before-restore-prior:${pointPath}`);
  const liveParent = path.dirname(absolutePath(root, transition.path));
  const relativeParent = path.relative(root, liveParent).split(path.sep).join("/");
  if (relativeParent.length > 0) {
    ensureDirectoryNoFollow(root, relativeParent, 0o755);
  }
  renameDurable(
    absolutePath(root, backupPath),
    absolutePath(root, transition.path),
  );
  faultInjector?.(`after-restore-prior:${pointPath}`);
}

function exactControlBytes(absolute: string, expected: string): void {
  let actual: string;
  try {
    actual = readFileSync(absolute, "utf8");
  } catch {
    artifactFailure("orphan-control-state", absolute);
  }
  if (actual !== expected) {
    artifactFailure("recovery-conflict", absolute);
  }
}

function cleanupTerminal(
  root: string,
  journal: PublicationJournal,
  lockBytes: string,
  faultInjector?: (checkpoint: ArtifactCheckpoint) => void,
): void {
  const journalAbsolute = absolutePath(
    root,
    `${journal.plan.transactionRoot}/${JOURNAL_FILE}`,
  );
  const lockAbsolute = absolutePath(
    root,
    `${journal.plan.transactionRoot}/${LOCK_FILE}`,
  );
  unlinkDurable(
    absolutePath(
      root,
      `${journal.plan.transactionRoot}/${JOURNAL_TEMP_FILE}`,
    ),
  );
  faultInjector?.("after-cleanup:journal");
  removeTreeNoFollow(
    absolutePath(
      root,
      `${journal.plan.transactionRoot}/${WORK_DIRECTORY}`,
    ),
  );
  faultInjector?.("after-cleanup:work-root");
  exactControlBytes(lockAbsolute, lockBytes);
  unlinkDurable(lockAbsolute);
  exactControlBytes(journalAbsolute, encodeRecord(journal));
  unlinkDurable(journalAbsolute);
  faultInjector?.("after-cleanup:lock");
}

export function rollbackTransaction(
  root: string,
  journal: PublicationJournal,
  lockBytes: string,
  faultInjector?: (checkpoint: ArtifactCheckpoint) => void,
): RecoveryOutcome {
  const rolling =
    journal.phase === "rolling-back"
      ? journal
      : persistPhase(root, journal, "rolling-back");
  if (journal.phase !== "rolling-back") {
    faultInjector?.("after-phase-rolling-back");
  }
  const transitions = [
    rolling.plan.commitMarker,
    ...[...rolling.plan.artifacts].reverse(),
  ];
  for (const transition of transitions) {
    rollbackTransition(root, rolling, transition, faultInjector);
  }
  for (const transition of [
    ...rolling.plan.artifacts,
    rolling.plan.commitMarker,
  ]) {
    assertFileState(
      root,
      transition.path,
      transition.prior,
      "recovery-conflict",
    );
  }
  const committed = persistPhase(root, rolling, "committed");
  cleanupTerminal(root, committed, lockBytes, faultInjector);
  return {
    action: "rolled-back",
    transactionId: journal.transactionId,
  };
}

export async function recoverArtifacts(
  options: RecoverOptions,
): Promise<RecoveryOutcome> {
  const transactionRoot = validatePortableRelativePath(
    options.transactionRoot,
    "$.transactionRoot",
  );
  const root = canonicalProjectRoot(options.projectRoot);
  inspectParentsNoFollow(root, transactionRoot, true);
  const control = absolutePath(root, transactionRoot);
  const lockAbsolute = path.join(control, LOCK_FILE);
  const journalAbsolute = path.join(control, JOURNAL_FILE);
  const lockPresent = lstatPresent(lockAbsolute);
  const journalPresent = lstatPresent(journalAbsolute);
  if (lockPresent === null && journalPresent === null) {
    return { action: "none", transactionId: null };
  }
  if (journalPresent === null) {
    artifactFailure(
      "orphan-control-state",
      `${transactionRoot}/${LOCK_FILE}`,
    );
  }
  if (journalPresent.isSymbolicLink()) {
    artifactFailure("symlink-traversal", transactionRoot);
  }
  if (!journalPresent.isFile()) {
    artifactFailure("control-path-collision", transactionRoot);
  }
  let journalBytes: string;
  try {
    journalBytes = readFileSync(journalAbsolute, "utf8");
  } catch {
    artifactFailure("filesystem-permission", transactionRoot);
  }
  let journal: ReturnType<typeof parsePublicationJournal>;
  try {
    journal = parsePublicationJournal(journalBytes);
  } catch (error) {
    if (
      error instanceof ArtifactTransactionError &&
      error.failure.kind === "malformed-journal" &&
      ["authorizationDigest", "planDigest", "projectIdentity"].includes(
        error.failure.subject,
      )
    ) {
      throw error;
    }
    artifactFailure(
      "malformed-journal",
      `${transactionRoot}/${JOURNAL_FILE}`,
    );
  }
  if (
    journal.plan.transactionRoot !== transactionRoot ||
    journal.projectIdentity !== options.projectIdentity
  ) {
    artifactFailure("malformed-journal", transactionRoot);
  }
  if (lockPresent === null) {
    if (journal.phase !== "committed") {
      artifactFailure(
        "orphan-control-state",
        `${transactionRoot}/${JOURNAL_FILE}`,
      );
    }
    const transitions = [
      ...journal.plan.artifacts,
      journal.plan.commitMarker,
    ];
    const livePrior = transitions.every((transition) =>
      sameFileState(
        readFileState(root, transition.path, "recovery-conflict"),
        transition.prior,
      ),
    );
    const liveNext = transitions.every((transition) =>
      sameFileState(
        readFileState(root, transition.path, "recovery-conflict"),
        transition.next,
      ),
    );
    if (!livePrior && !liveNext) {
      artifactFailure("recovery-conflict", transactionRoot);
    }
    exactControlBytes(journalAbsolute, journalBytes);
    unlinkDurable(journalAbsolute);
    options.faultInjector?.("after-cleanup:journal");
    return {
      action: liveNext ? "committed" : "rolled-back",
      transactionId: journal.transactionId,
    };
  }
  if (lockPresent.isSymbolicLink()) {
    artifactFailure("symlink-traversal", transactionRoot);
  }
  if (!lockPresent.isFile()) {
    artifactFailure("control-path-collision", transactionRoot);
  }
  let lockBytes: string;
  try {
    lockBytes = readFileSync(lockAbsolute, "utf8");
  } catch {
    artifactFailure("filesystem-permission", transactionRoot);
  }
  let lock: ReturnType<typeof parsePublicationLock>;
  try {
    lock = parsePublicationLock(lockBytes);
  } catch {
    artifactFailure("untrusted-lock", `${transactionRoot}/${LOCK_FILE}`);
  }
  if (
    lock.projectIdentity !== options.projectIdentity ||
    lock.transactionId !== journal.transactionId ||
    lock.hostIdentity !== currentHostIdentity()
  ) {
    artifactFailure("untrusted-lock", `${transactionRoot}/${LOCK_FILE}`);
  }
  if (lock.pid !== process.pid && pidIsLive(lock.pid)) {
    artifactFailure("active-writer", `${transactionRoot}/${LOCK_FILE}`);
  }
  exactControlBytes(lockAbsolute, lockBytes);
  exactControlBytes(journalAbsolute, journalBytes);

  const transitions = [...journal.plan.artifacts, journal.plan.commitMarker];
  for (const transition of transitions) {
    options.faultInjector?.(
      `inject-unexpected-live:${transition.path}`,
    );
  }
  const intended = transitions.every((transition) =>
    sameFileState(
      readFileState(root, transition.path, "recovery-conflict"),
      transition.next,
    ),
  );
  if (intended && (await options.admitIntended(journal.plan))) {
    const committed =
      journal.phase === "committed"
        ? journal
        : persistPhase(root, journal, "committed");
    cleanupTerminal(root, committed, lockBytes, options.faultInjector);
    return {
      action: "committed",
      transactionId: journal.transactionId,
    };
  }
  return rollbackTransaction(
    root,
    journal,
    lockBytes,
    options.faultInjector,
  );
}
