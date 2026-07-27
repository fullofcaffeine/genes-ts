import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | JsonObject;
type JsonObject = { readonly [key: string]: Json };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const protocolRoot = path.join(
  repoRoot,
  "tooling/artifact-transactions/v1",
);
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(subject: string, message: string): never {
  throw new Error(`${subject}: ${message}`);
}

function parse(file: string): Json {
  const source = readFileSync(file, "utf8");
  try {
    return JSON.parse(source) as Json;
  } catch (error) {
    fail(
      path.relative(repoRoot, file),
      error instanceof Error ? error.message : "invalid JSON",
    );
  }
}

function object(value: Json, subject: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(subject, "expected an object");
  }
  return value;
}

function array(value: Json, subject: string): Json[] {
  if (!Array.isArray(value)) {
    fail(subject, "expected an array");
  }
  return value;
}

function text(value: Json, subject: string): string {
  if (typeof value !== "string") {
    fail(subject, "expected a string");
  }
  return value;
}

function integer(value: Json, subject: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(subject, "expected an integer");
  }
  return value;
}

function boolean(value: Json, subject: string): boolean {
  if (typeof value !== "boolean") {
    fail(subject, "expected a boolean");
  }
  return value;
}

function exact(
  value: JsonObject,
  keys: readonly string[],
  subject: string,
): void {
  deepStrictEqual(
    Object.keys(value).sort(),
    [...keys].sort(),
    `${subject}: object must have exact keys`,
  );
}

function oneOf<T extends string>(
  value: Json,
  allowed: readonly T[],
  subject: string,
): T {
  const candidate = text(value, subject);
  if (!allowed.includes(candidate as T)) {
    fail(subject, `expected one of ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function id(value: Json, subject: string): string {
  const candidate = text(value, subject);
  if (!ID.test(candidate)) {
    fail(subject, "expected a lowercase kebab-case identifier");
  }
  return candidate;
}

function digest(value: Json, subject: string): string {
  const candidate = text(value, subject);
  if (!SHA256.test(candidate)) {
    fail(subject, "expected a lowercase SHA-256 digest");
  }
  return candidate;
}

function portablePath(value: Json, subject: string): string {
  const candidate = text(value, subject);
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    candidate.normalize("NFC") !== candidate ||
    candidate.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    fail(subject, "expected a normalized portable relative path");
  }
  return candidate;
}

type FileState = {
  readonly kind: "file";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mode: number;
};

type ExpectedState = { readonly kind: "absent" } | FileState;

function state(value: Json, subject: string): ExpectedState {
  const candidate = object(value, subject);
  const kind = text(candidate.kind, `${subject}.kind`);
  if (kind === "absent") {
    exact(candidate, ["kind"], subject);
    return { kind };
  }
  if (kind !== "file") {
    fail(`${subject}.kind`, "expected absent or file");
  }
  exact(candidate, ["kind", "sha256", "sizeBytes", "mode"], subject);
  const sizeBytes = integer(candidate.sizeBytes, `${subject}.sizeBytes`);
  const mode = integer(candidate.mode, `${subject}.mode`);
  if (sizeBytes < 0) {
    fail(`${subject}.sizeBytes`, "must be non-negative");
  }
  if (mode < 0 || mode > 0o777) {
    fail(`${subject}.mode`, "must contain only Unix permission bits");
  }
  return {
    kind,
    sha256: digest(candidate.sha256, `${subject}.sha256`),
    sizeBytes,
    mode,
  };
}

function sameState(left: ExpectedState, right: ExpectedState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type Blob = {
  readonly id: string;
  readonly utf8: string;
  readonly sha256: string;
  readonly sizeBytes: number;
};

type Transition = {
  readonly path: string;
  readonly prior: ExpectedState;
  readonly next: ExpectedState;
  readonly stagedPath: string | null;
};

function transition(
  value: Json,
  subject: string,
  blobsByDigest: ReadonlyMap<string, Blob>,
): Transition {
  const candidate = object(value, subject);
  exact(candidate, ["path", "prior", "next", "stagedPath"], subject);
  const prior = state(candidate.prior, `${subject}.prior`);
  const next = state(candidate.next, `${subject}.next`);
  const stagedPath =
    candidate.stagedPath === null
      ? null
      : portablePath(candidate.stagedPath, `${subject}.stagedPath`);

  for (const [name, expected] of [
    ["prior", prior],
    ["next", next],
  ] as const) {
    if (expected.kind === "file") {
      const blob = blobsByDigest.get(expected.sha256);
      if (blob === undefined || blob.sizeBytes !== expected.sizeBytes) {
        fail(
          `${subject}.${name}`,
          "file state must reference one corpus blob with matching size",
        );
      }
    }
  }

  const changes = !sameState(prior, next);
  if (next.kind === "file" && changes && stagedPath === null) {
    fail(subject, "a changed next file requires a staged path");
  }
  if ((!changes || next.kind === "absent") && stagedPath !== null) {
    fail(subject, "an unchanged or absent next state cannot have a staged path");
  }

  return {
    path: portablePath(candidate.path, `${subject}.path`),
    prior,
    next,
    stagedPath,
  };
}

function assertUnique(
  values: readonly string[],
  subject: string,
  portable = false,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = portable ? value.normalize("NFC").toLocaleLowerCase("en-US") : value;
    if (seen.has(key)) {
      fail(subject, `duplicate${portable ? " portable" : ""} identity ${value}`);
    }
    seen.add(key);
  }
}

function validatePlan(
  value: Json,
  subject: string,
  blobsByDigest: ReadonlyMap<string, Blob>,
): void {
  const candidate = object(value, subject);
  exact(
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
    subject,
  );
  strictEqual(
    text(candidate.protocol, `${subject}.protocol`),
    "genes.tooling.artifact-transition",
  );
  strictEqual(integer(candidate.version, `${subject}.version`), 1);
  digest(candidate.projectIdentity, `${subject}.projectIdentity`);
  digest(candidate.authorizationDigest, `${subject}.authorizationDigest`);
  const transactionRoot = portablePath(
    candidate.transactionRoot,
    `${subject}.transactionRoot`,
  );
  const stageRoot = portablePath(candidate.stageRoot, `${subject}.stageRoot`);
  if (
    stageRoot === transactionRoot ||
    stageRoot.startsWith(`${transactionRoot}/`) ||
    transactionRoot.startsWith(`${stageRoot}/`)
  ) {
    fail(subject, "stage and transaction roots must be disjoint");
  }
  const artifacts = array(candidate.artifacts, `${subject}.artifacts`).map(
    (item, index) =>
      transition(item, `${subject}.artifacts[${index}]`, blobsByDigest),
  );
  const marker = transition(
    candidate.commitMarker,
    `${subject}.commitMarker`,
    blobsByDigest,
  );
  if (sameState(marker.prior, marker.next)) {
    fail(`${subject}.commitMarker`, "commit marker must change");
  }

  const artifactPaths = artifacts.map((item) => item.path);
  deepStrictEqual(
    artifactPaths,
    [...artifactPaths].sort(),
    `${subject}.artifacts must be sorted by path`,
  );
  const livePaths = [...artifactPaths, marker.path];
  assertUnique(livePaths, `${subject} live paths`, true);
  const stagePaths = [...artifacts, marker]
    .flatMap((item) => item.stagedPath === null ? [] : [item.stagedPath]);
  for (const stagePath of stagePaths) {
    if (!stagePath.startsWith(`${stageRoot}/`)) {
      fail(subject, `staged path ${stagePath} is outside stageRoot`);
    }
  }
  assertUnique(stagePaths, `${subject} staged paths`, true);
  assertUnique(
    [...livePaths, ...stagePaths, transactionRoot, stageRoot],
    `${subject} public and control paths`,
    true,
  );
  for (const livePath of livePaths) {
    if (
      livePath === transactionRoot ||
      livePath.startsWith(`${transactionRoot}/`) ||
      transactionRoot.startsWith(`${livePath}/`) ||
      livePath === stageRoot ||
      livePath.startsWith(`${stageRoot}/`) ||
      stageRoot.startsWith(`${livePath}/`)
    ) {
      fail(subject, "a private root overlaps a live path");
    }
  }
}

function validateMutation(value: Json, subject: string, blobs: Set<string>): void {
  const candidate = object(value, subject);
  const hasTiming = Object.hasOwn(candidate, "at");
  exact(
    candidate,
    hasTiming ? ["at", "area", "path", "entry"] : ["area", "path", "entry"],
    subject,
  );
  if (hasTiming) {
    oneOf(candidate.at, ["setup", "after-preflight"], `${subject}.at`);
  }
  oneOf(
    candidate.area,
    ["project-root", "live", "stage", "backup", "control"],
    `${subject}.area`,
  );
  text(candidate.path, `${subject}.path`);
  const entry = object(candidate.entry, `${subject}.entry`);
  const kind = oneOf(
    entry.kind,
    ["absent", "file", "symlink", "directory", "special"],
    `${subject}.entry.kind`,
  );
  if (kind === "absent" || kind === "directory" || kind === "special") {
    exact(entry, ["kind"], `${subject}.entry`);
  } else if (kind === "symlink") {
    exact(entry, ["kind", "target"], `${subject}.entry`);
    text(entry.target, `${subject}.entry.target`);
  } else {
    exact(entry, ["kind", "blob", "mode"], `${subject}.entry`);
    const blob = id(entry.blob, `${subject}.entry.blob`);
    if (!blobs.has(blob)) {
      fail(`${subject}.entry.blob`, `unknown blob ${blob}`);
    }
    const mode = integer(entry.mode, `${subject}.entry.mode`);
    if (mode < 0 || mode > 0o777) {
      fail(`${subject}.entry.mode`, "must contain only Unix permission bits");
    }
  }
}

const FAILURE_KINDS = [
  "invalid-plan",
  "unexpected-staged-state",
  "undeclared-staged-entry",
  "unexpected-live-state",
  "path-escape",
  "portable-path-collision",
  "symlink-traversal",
  "active-writer",
  "untrusted-lock",
  "malformed-journal",
  "orphan-control-state",
  "recovery-conflict",
  "filesystem-unsupported",
  "filesystem-permission",
  "control-path-collision",
] as const;

type StepFact = {
  readonly action: "publish" | "recover";
  readonly outcome:
    | "published"
    | "unchanged"
    | "committed"
    | "rolled-back"
    | "none"
    | "crashed"
    | "failed";
  readonly faultKind: string | null;
  readonly faultAt: string | null;
};

function validateStep(value: Json, subject: string): StepFact {
  const candidate = object(value, subject);
  exact(candidate, ["action", "admitIntended", "fault", "expect"], subject);
  const action = oneOf(
    candidate.action,
    ["publish", "recover"],
    `${subject}.action`,
  );
  boolean(candidate.admitIntended, `${subject}.admitIntended`);
  let faultKind: string | null = null;
  let faultAt: string | null = null;
  if (candidate.fault !== null) {
    const fault = object(candidate.fault, `${subject}.fault`);
    exact(fault, ["kind", "at"], `${subject}.fault`);
    faultKind = oneOf(
      fault.kind,
      ["process-exit", "permission-denied", "cross-device", "io-error"],
      `${subject}.fault.kind`,
    );
    faultAt = text(fault.at, `${subject}.fault.at`);
  }

  const expect = object(candidate.expect, `${subject}.expect`);
  exact(expect, ["outcome", "failure", "live", "control"], `${subject}.expect`);
  const outcome = oneOf(
    expect.outcome,
    ["published", "unchanged", "committed", "rolled-back", "none", "crashed", "failed"],
    `${subject}.expect.outcome`,
  );
  oneOf(expect.live, ["prior", "next", "recoverable", "ambiguous"], `${subject}.expect.live`);
  oneOf(expect.control, ["absent", "durable", "preserved"], `${subject}.expect.control`);

  if (outcome === "failed") {
    const failure = object(expect.failure, `${subject}.expect.failure`);
    exact(failure, ["kind", "subject"], `${subject}.expect.failure`);
    oneOf(failure.kind, FAILURE_KINDS, `${subject}.expect.failure.kind`);
    text(failure.subject, `${subject}.expect.failure.subject`);
  } else if (expect.failure !== null) {
    fail(`${subject}.expect.failure`, "only a failed outcome may carry a failure fact");
  }
  if (outcome === "crashed" && faultKind !== "process-exit") {
    fail(subject, "a crashed outcome requires a process-exit fault");
  }
  if (outcome !== "crashed" && faultKind === "process-exit") {
    fail(subject, "a process-exit fault requires a crashed outcome");
  }

  return { action, outcome, faultKind, faultAt };
}

const REQUIRED_COVERAGE = [
  "create",
  "replace",
  "remove",
  "unchanged",
  "mode-change",
  "commit-marker-only",
  "commit-marker-last",
  "first-generation",
  "replacement-generation",
  "missing-staged-file",
  "modified-staged-file",
  "modified-staged-mode",
  "undeclared-staged-file",
  "unowned-live-collision",
  "live-state-race",
  "lexical-traversal",
  "absolute-path",
  "portable-case-collision",
  "symlink-project-root",
  "symlink-live-parent",
  "symlink-live-destination",
  "symlink-stage",
  "symlink-backup",
  "symlink-lock",
  "symlink-journal",
  "active-writer",
  "dead-same-host-writer",
  "foreign-writer",
  "unauthenticated-lock",
  "orphan-lock",
  "orphan-journal",
  "malformed-journal",
  "canonical-journal",
  "forward-crash",
  "rollback-crash",
  "second-crash-recovery",
  "complete-intended-finalization",
  "partial-state-rollback",
  "unexpected-live-recovery-refusal",
  "idempotent-recovery",
  "cross-device-filesystem",
  "permission-failure",
  "control-path-collision",
  "authorization-binding",
  "plan-binding",
] as const;

const REQUIRED_FORWARD_CHECKPOINTS = [
  "after-journal-prepared",
  "after-phase-publishing",
  "after-publish:generated/create.js",
  "after-backup:generated/remove.js",
  "after-backup:generated/update.js",
  "after-publish:generated/update.js",
  "after-backup:commit-marker",
  "after-publish:commit-marker",
  "after-phase-published",
  "after-cleanup:work-root",
  "after-cleanup:journal",
  "after-cleanup:lock",
] as const;

const REQUIRED_ROLLBACK_CHECKPOINTS = [
  "after-phase-rolling-back",
  "after-remove-next:commit-marker",
  "after-restore-prior:commit-marker",
  "after-remove-next:generated/create.js",
  "after-remove-next:generated/update.js",
  "after-restore-prior:generated/update.js",
  "after-restore-prior:generated/remove.js",
  "after-cleanup:work-root",
  "after-cleanup:journal",
  "after-cleanup:lock",
] as const;

function validateCorpus(value: Json): void {
  const root = object(value, "$");
  exact(root, ["protocol", "version", "blobs", "plans", "vectors"], "$");
  strictEqual(
    text(root.protocol, "$.protocol"),
    "genes.tooling.artifact-transition-vectors",
  );
  strictEqual(integer(root.version, "$.version"), 1);

  const blobs = array(root.blobs, "$.blobs").map((item, index): Blob => {
    const candidate = object(item, `$.blobs[${index}]`);
    exact(candidate, ["id", "utf8", "sha256", "sizeBytes"], `$.blobs[${index}]`);
    const utf8 = text(candidate.utf8, `$.blobs[${index}].utf8`);
    const actualDigest = createHash("sha256").update(utf8).digest("hex");
    const actualSize = Buffer.byteLength(utf8);
    const declaredDigest = digest(candidate.sha256, `$.blobs[${index}].sha256`);
    const declaredSize = integer(candidate.sizeBytes, `$.blobs[${index}].sizeBytes`);
    strictEqual(declaredDigest, actualDigest, `$.blobs[${index}]: digest`);
    strictEqual(declaredSize, actualSize, `$.blobs[${index}]: byte size`);
    return {
      id: id(candidate.id, `$.blobs[${index}].id`),
      utf8,
      sha256: declaredDigest,
      sizeBytes: declaredSize,
    };
  });
  assertUnique(blobs.map((blob) => blob.id), "$.blobs ids");
  assertUnique(blobs.map((blob) => blob.sha256), "$.blobs digests");
  const blobsByDigest = new Map(blobs.map((blob) => [blob.sha256, blob]));
  const blobIds = new Set(blobs.map((blob) => blob.id));

  const plans = array(root.plans, "$.plans");
  const planIds = plans.map((item, index) => {
    const candidate = object(item, `$.plans[${index}]`);
    exact(candidate, ["id", "plan"], `$.plans[${index}]`);
    const planId = id(candidate.id, `$.plans[${index}].id`);
    validatePlan(candidate.plan, `$.plans[${index}].plan`, blobsByDigest);
    return planId;
  });
  assertUnique(planIds, "$.plans ids");
  const knownPlans = new Set(planIds);

  const vectorIds: string[] = [];
  const coverage = new Set<string>();
  const forwardCheckpoints = new Set<string>();
  const rollbackCheckpoints = new Set<string>();
  for (const [index, item] of array(root.vectors, "$.vectors").entries()) {
    const subject = `$.vectors[${index}]`;
    const candidate = object(item, subject);
    exact(
      candidate,
      ["id", "covers", "plan", "planMutation", "initial", "stage", "control", "mutations", "steps"],
      subject,
    );
    const vectorId = id(candidate.id, `${subject}.id`);
    vectorIds.push(vectorId);
    for (const [coverIndex, cover] of array(candidate.covers, `${subject}.covers`).entries()) {
      coverage.add(id(cover, `${subject}.covers[${coverIndex}]`));
    }
    const plan = id(candidate.plan, `${subject}.plan`);
    if (!knownPlans.has(plan)) {
      fail(`${subject}.plan`, `unknown plan ${plan}`);
    }
    oneOf(
      candidate.planMutation,
      [
        "none",
        "absolute-live-path",
        "traversal-live-path",
        "backslash-live-path",
        "portable-case-collision",
        "duplicate-commit-marker",
        "staged-path-with-absent-next",
        "missing-staged-path-for-file",
      ],
      `${subject}.planMutation`,
    );
    oneOf(candidate.initial, ["prior", "next", "absent"], `${subject}.initial`);
    oneOf(candidate.stage, ["complete", "absent"], `${subject}.stage`);
    const control = object(candidate.control, `${subject}.control`);
    exact(control, ["lock", "journal"], `${subject}.control`);
    oneOf(
      control.lock,
      ["none", "active-same-host", "dead-same-host", "foreign-host", "malformed", "orphan"],
      `${subject}.control.lock`,
    );
    oneOf(
      control.journal,
      [
        "none",
        "prepared",
        "publishing",
        "published",
        "rolling-back",
        "committed",
        "malformed",
        "orphan",
        "authorization-mismatch",
        "plan-digest-mismatch",
      ],
      `${subject}.control.journal`,
    );
    for (const [mutationIndex, mutation] of array(candidate.mutations, `${subject}.mutations`).entries()) {
      validateMutation(mutation, `${subject}.mutations[${mutationIndex}]`, blobIds);
    }
    const steps = array(candidate.steps, `${subject}.steps`).map((step, stepIndex) =>
      validateStep(step, `${subject}.steps[${stepIndex}]`)
    );
    if (steps.length === 0) {
      fail(`${subject}.steps`, "expected at least one invocation");
    }
    for (const step of steps) {
      if (step.faultKind !== "process-exit" || step.faultAt === null) {
        continue;
      }
      if (step.action === "publish") {
        forwardCheckpoints.add(step.faultAt);
      } else {
        rollbackCheckpoints.add(step.faultAt);
      }
    }
  }
  assertUnique(vectorIds, "$.vectors ids");
  for (const required of REQUIRED_COVERAGE) {
    ok(coverage.has(required), `missing required coverage ${required}`);
  }
  for (const required of REQUIRED_FORWARD_CHECKPOINTS) {
    ok(
      forwardCheckpoints.has(required),
      `missing forward process-exit checkpoint ${required}`,
    );
  }
  for (const required of REQUIRED_ROLLBACK_CHECKPOINTS) {
    ok(
      rollbackCheckpoints.has(required),
      `missing rollback process-exit checkpoint ${required}`,
    );
  }
}

function expectRejected(
  name: string,
  value: Json,
  messageFragment: string,
): void {
  let observed: Error | null = null;
  try {
    validateCorpus(value);
  } catch (error) {
    observed = error instanceof Error ? error : new Error(String(error));
  }
  ok(observed !== null, `${name}: malformed corpus was accepted`);
  ok(
    observed.message.includes(messageFragment),
    `${name}: expected ${JSON.stringify(messageFragment)}, received ${observed.message}`,
  );
}

const protocolSchema = parse(path.join(protocolRoot, "protocol.schema.json"));
const vectorSchema = parse(path.join(protocolRoot, "vectors.schema.json"));
const corpus = parse(path.join(protocolRoot, "vectors.json"));
for (const [name, schema] of [
  ["protocol.schema.json", protocolSchema],
  ["vectors.schema.json", vectorSchema],
] as const) {
  const root = object(schema, name);
  strictEqual(
    text(root.$schema, `${name}.$schema`),
    "https://json-schema.org/draft/2020-12/schema",
  );
  ok(typeof root.$id === "string", `${name}: missing schema identity`);
}

validateCorpus(corpus);

const corpusRoot = object(corpus, "$");
expectRejected(
  "unknown root field",
  { ...corpusRoot, unexpected: true },
  "object must have exact keys",
);

const corpusBlobs = array(corpusRoot.blobs, "$.blobs");
const firstBlob = object(corpusBlobs[0] ?? fail("$.blobs", "missing blob"), "$.blobs[0]");
expectRejected(
  "modified blob digest",
  {
    ...corpusRoot,
    blobs: [
      { ...firstBlob, sha256: "0".repeat(64) },
      ...corpusBlobs.slice(1),
    ],
  },
  "digest",
);

const corpusPlans = array(corpusRoot.plans, "$.plans");
const firstPlanWrapper = object(
  corpusPlans[0] ?? fail("$.plans", "missing plan"),
  "$.plans[0]",
);
const firstPlan = object(firstPlanWrapper.plan, "$.plans[0].plan");
const firstPlanArtifacts = array(firstPlan.artifacts, "$.plans[0].plan.artifacts");
const firstTransition = object(
  firstPlanArtifacts[0] ??
    fail("$.plans[0].plan.artifacts", "missing transition"),
  "$.plans[0].plan.artifacts[0]",
);
expectRejected(
  "traversing plan path",
  {
    ...corpusRoot,
    plans: [
      {
        ...firstPlanWrapper,
        plan: {
          ...firstPlan,
          artifacts: [
            { ...firstTransition, path: "../escape.js" },
            ...firstPlanArtifacts.slice(1),
          ],
        },
      },
      ...corpusPlans.slice(1),
    ],
  },
  "portable relative path",
);

process.stdout.write(
  `artifact transaction protocol v1: ${array(corpusRoot.vectors, "$.vectors").length} vectors and 3 negative controls validated\n`,
);
