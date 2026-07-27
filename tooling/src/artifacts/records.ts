import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

import {
  canonicalDigest,
  canonicalJson,
  sha256Bytes,
  type CanonicalJson,
} from "./canonical-json.js";
import type {
  PublicationJournal,
  PublicationLock,
  PublicationPhase,
  PublicationPlan,
  Sha256,
} from "./types.js";
import {
  ARTIFACT_PLAN_PROTOCOL,
  ARTIFACT_PLAN_VERSION,
  ARTIFACT_JOURNAL_PROTOCOL,
  ARTIFACT_LOCK_PROTOCOL,
  CANONICALIZATION,
} from "./types.js";
import { artifactFailure } from "./error.js";
import { validatePublicationPlan } from "./validate-plan.js";

export const LOCK_FILE = "lock";
export const JOURNAL_FILE = "journal.json";
export const JOURNAL_TEMP_FILE = "journal.json.tmp";
export const WORK_DIRECTORY = "work";

function asCanonical(value: object): CanonicalJson {
  return value as unknown as CanonicalJson;
}

export function randomDigest(): Sha256 {
  return randomBytes(32).toString("hex");
}

export function currentHostIdentity(): Sha256 {
  return sha256Bytes(`genes.tooling.host\0${hostname()}`);
}

export function publicationPlanDigest(plan: PublicationPlan): Sha256 {
  return canonicalDigest(asCanonical(plan));
}

export function createPublicationJournal(
  plan: PublicationPlan,
  transactionId: Sha256,
  phase: PublicationPhase,
): PublicationJournal {
  const withoutDigest = {
    protocol: ARTIFACT_JOURNAL_PROTOCOL,
    version: 1 as const,
    canonicalization: CANONICALIZATION,
    journalDigestAlgorithm:
      "sha256-rfc8785-without-journalDigest-v1" as const,
    transactionId,
    projectIdentity: plan.projectIdentity,
    authorizationDigest: plan.authorizationDigest,
    phase,
    planDigest: publicationPlanDigest(plan),
    plan,
  };
  return {
    ...withoutDigest,
    journalDigest: canonicalDigest(asCanonical(withoutDigest)),
  };
}

export function createPublicationLock(
  plan: PublicationPlan,
  transactionId: Sha256,
): PublicationLock {
  const withoutDigest = {
    protocol: ARTIFACT_LOCK_PROTOCOL,
    version: 1 as const,
    canonicalization: CANONICALIZATION,
    lockDigestAlgorithm: "sha256-rfc8785-without-lockDigest-v1" as const,
    transactionId,
    projectIdentity: plan.projectIdentity,
    hostIdentity: currentHostIdentity(),
    pid: process.pid,
    nonce: randomDigest(),
  };
  return {
    ...withoutDigest,
    lockDigest: canonicalDigest(asCanonical(withoutDigest)),
  };
}

export function encodeRecord(value: object): string {
  return canonicalJson(asCanonical(value));
}

type JsonObject = Record<string, unknown>;
const SHA256 = /^[0-9a-f]{64}$/;
const PHASES = new Set<PublicationPhase>([
  "prepared",
  "publishing",
  "published",
  "rolling-back",
  "committed",
]);

function malformed(subject: string): never {
  artifactFailure("malformed-journal", subject);
}

function objectValue(value: unknown, subject: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    malformed(subject);
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  keys: readonly string[],
  subject: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    malformed(subject);
  }
}

function digestValue(value: unknown, subject: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) {
    malformed(subject);
  }
  return value;
}

function lockDigestValue(value: unknown, subject: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) {
    artifactFailure("untrusted-lock", subject);
  }
  return value;
}

function stateValue(value: unknown, subject: string) {
  const candidate = objectValue(value, subject);
  if (candidate.kind === "absent") {
    exactKeys(candidate, ["kind"], subject);
    return { kind: "absent" } as const;
  }
  exactKeys(candidate, ["kind", "sha256", "sizeBytes", "mode"], subject);
  if (
    candidate.kind !== "file" ||
    !Number.isSafeInteger(candidate.sizeBytes) ||
    (candidate.sizeBytes as number) < 0 ||
    !Number.isInteger(candidate.mode) ||
    (candidate.mode as number) < 0 ||
    (candidate.mode as number) > 0o777
  ) {
    malformed(subject);
  }
  return {
    kind: "file" as const,
    sha256: digestValue(candidate.sha256, `${subject}.sha256`),
    sizeBytes: candidate.sizeBytes as number,
    mode: candidate.mode as number,
  };
}

function transitionValue(value: unknown, subject: string) {
  const candidate = objectValue(value, subject);
  exactKeys(
    candidate,
    ["path", "prior", "next", "stagedPath"],
    subject,
  );
  if (
    typeof candidate.path !== "string" ||
    (candidate.stagedPath !== null &&
      typeof candidate.stagedPath !== "string")
  ) {
    malformed(subject);
  }
  return {
    path: candidate.path,
    prior: stateValue(candidate.prior, `${subject}.prior`),
    next: stateValue(candidate.next, `${subject}.next`),
    stagedPath: candidate.stagedPath as string | null,
  };
}

export function parsePublicationPlan(value: unknown): PublicationPlan {
  const candidate = objectValue(value, "$.plan");
  exactKeys(
    candidate,
    [
      "protocol",
      "version",
      "projectIdentity",
      "authorizationDigest",
      "transactionRoot",
      "stageRoot",
      "artifacts",
      "commitMarker",
    ],
    "$.plan",
  );
  if (
    candidate.protocol !== ARTIFACT_PLAN_PROTOCOL ||
    candidate.version !== ARTIFACT_PLAN_VERSION ||
    typeof candidate.transactionRoot !== "string" ||
    typeof candidate.stageRoot !== "string" ||
    !Array.isArray(candidate.artifacts)
  ) {
    malformed("$.plan");
  }
  const plan: PublicationPlan = {
    protocol: ARTIFACT_PLAN_PROTOCOL,
    version: ARTIFACT_PLAN_VERSION,
    projectIdentity: digestValue(
      candidate.projectIdentity,
      "$.plan.projectIdentity",
    ),
    authorizationDigest: digestValue(
      candidate.authorizationDigest,
      "$.plan.authorizationDigest",
    ),
    transactionRoot: candidate.transactionRoot,
    stageRoot: candidate.stageRoot,
    artifacts: candidate.artifacts.map((entry, index) =>
      transitionValue(entry, `$.plan.artifacts[${index}]`),
    ),
    commitMarker: transitionValue(
      candidate.commitMarker,
      "$.plan.commitMarker",
    ),
  };
  try {
    return validatePublicationPlan(plan);
  } catch {
    malformed("$.plan");
  }
}

function parseCanonicalObject(bytes: string, subject: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    malformed(subject);
  }
  const object = objectValue(parsed, subject);
  if (encodeRecord(object) !== bytes) {
    malformed(subject);
  }
  return object;
}

export function parsePublicationJournal(bytes: string): PublicationJournal {
  const candidate = parseCanonicalObject(bytes, "$.journal");
  exactKeys(
    candidate,
    [
      "protocol",
      "version",
      "canonicalization",
      "journalDigestAlgorithm",
      "journalDigest",
      "transactionId",
      "projectIdentity",
      "authorizationDigest",
      "phase",
      "planDigest",
      "plan",
    ],
    "$.journal",
  );
  if (
    candidate.protocol !== ARTIFACT_JOURNAL_PROTOCOL ||
    candidate.version !== 1 ||
    candidate.canonicalization !== CANONICALIZATION ||
    candidate.journalDigestAlgorithm !==
      "sha256-rfc8785-without-journalDigest-v1" ||
    typeof candidate.phase !== "string" ||
    !PHASES.has(candidate.phase as PublicationPhase)
  ) {
    malformed("$.journal");
  }
  const plan = parsePublicationPlan(candidate.plan);
  const journal: PublicationJournal = {
    protocol: ARTIFACT_JOURNAL_PROTOCOL,
    version: 1,
    canonicalization: CANONICALIZATION,
    journalDigestAlgorithm:
      "sha256-rfc8785-without-journalDigest-v1",
    journalDigest: digestValue(
      candidate.journalDigest,
      "$.journal.journalDigest",
    ),
    transactionId: digestValue(
      candidate.transactionId,
      "$.journal.transactionId",
    ),
    projectIdentity: digestValue(
      candidate.projectIdentity,
      "$.journal.projectIdentity",
    ),
    authorizationDigest: digestValue(
      candidate.authorizationDigest,
      "$.journal.authorizationDigest",
    ),
    phase: candidate.phase as PublicationPhase,
    planDigest: digestValue(
      candidate.planDigest,
      "$.journal.planDigest",
    ),
    plan,
  };
  const { journalDigest, ...withoutDigest } = journal;
  if (canonicalDigest(asCanonical(withoutDigest)) !== journalDigest) {
    malformed("$.journal");
  }
  if (publicationPlanDigest(plan) !== journal.planDigest) {
    malformed("planDigest");
  }
  if (journal.authorizationDigest !== plan.authorizationDigest) {
    malformed("authorizationDigest");
  }
  if (journal.projectIdentity !== plan.projectIdentity) {
    malformed("projectIdentity");
  }
  return journal;
}

export function parsePublicationLock(bytes: string): PublicationLock {
  const candidate = parseCanonicalObject(bytes, "$.lock");
  exactKeys(
    candidate,
    [
      "protocol",
      "version",
      "canonicalization",
      "lockDigestAlgorithm",
      "lockDigest",
      "transactionId",
      "projectIdentity",
      "hostIdentity",
      "pid",
      "nonce",
    ],
    "$.lock",
  );
  if (
    candidate.protocol !== ARTIFACT_LOCK_PROTOCOL ||
    candidate.version !== 1 ||
    candidate.canonicalization !== CANONICALIZATION ||
    candidate.lockDigestAlgorithm !==
      "sha256-rfc8785-without-lockDigest-v1" ||
    !Number.isSafeInteger(candidate.pid) ||
    (candidate.pid as number) < 1
  ) {
    artifactFailure("untrusted-lock", "$.lock");
  }
  const lock: PublicationLock = {
    protocol: ARTIFACT_LOCK_PROTOCOL,
    version: 1,
    canonicalization: CANONICALIZATION,
    lockDigestAlgorithm: "sha256-rfc8785-without-lockDigest-v1",
    lockDigest: lockDigestValue(candidate.lockDigest, "$.lock.lockDigest"),
    transactionId: lockDigestValue(
      candidate.transactionId,
      "$.lock.transactionId",
    ),
    projectIdentity: lockDigestValue(
      candidate.projectIdentity,
      "$.lock.projectIdentity",
    ),
    hostIdentity: lockDigestValue(
      candidate.hostIdentity,
      "$.lock.hostIdentity",
    ),
    pid: candidate.pid as number,
    nonce: lockDigestValue(candidate.nonce, "$.lock.nonce"),
  };
  const { lockDigest, ...withoutDigest } = lock;
  if (canonicalDigest(asCanonical(withoutDigest)) !== lockDigest) {
    artifactFailure("untrusted-lock", "$.lock");
  }
  return lock;
}
