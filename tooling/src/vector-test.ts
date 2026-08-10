import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ArtifactTransactionError,
  artifactFailure,
  canonicalDigest,
  canonicalJson,
  publishArtifacts,
  recoverArtifacts,
  sha256Bytes,
  type ArtifactCheckpoint,
  type ArtifactFailureFact,
  type ExpectedFileState,
  type PublicationJournal,
  type PublicationLock,
  type PublicationPlan,
} from "./index.js";
import {
  createPublicationJournal,
  createPublicationLock,
  currentHostIdentity,
  encodeRecord,
} from "./artifacts/records.js";

interface BlobRecord {
  readonly id: string;
  readonly utf8: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

type EntryMutation =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly blob: string; readonly mode: number }
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "special" };

interface Mutation {
  readonly at?: "after-preflight";
  readonly area: "project-root" | "live" | "stage" | "backup" | "control";
  readonly path: string;
  readonly entry: EntryMutation;
}

interface Fault {
  readonly kind:
    | "process-exit"
    | "io-error"
    | "permission-denied"
    | "cross-device";
  readonly at: ArtifactCheckpoint;
}

interface ExpectedStep {
  readonly outcome:
    | "published"
    | "unchanged"
    | "committed"
    | "rolled-back"
    | "none"
    | "failed"
    | "crashed";
  readonly failure: ArtifactFailureFact | null;
  readonly live: "prior" | "next" | "recoverable" | "ambiguous";
  readonly control: "absent" | "durable" | "preserved";
}

interface VectorStep {
  readonly action: "publish" | "recover";
  readonly admitPlan: boolean;
  readonly admitIntended: boolean;
  readonly fault: Fault | null;
  readonly expect: ExpectedStep;
}

interface Vector {
  readonly id: string;
  readonly covers: readonly string[];
  readonly plan: string;
  readonly planMutation:
    | "none"
    | "absolute-live-path"
    | "traversal-live-path"
    | "backslash-live-path"
    | "portable-case-collision"
    | "duplicate-commit-marker"
    | "staged-path-with-absent-next"
    | "missing-staged-path-for-file";
  readonly initial: "prior" | "next" | "absent";
  readonly stage: "complete" | "absent";
  readonly control: {
    readonly lock:
      | "none"
      | "active-same-host"
      | "dead-same-host"
      | "foreign-host"
      | "malformed"
      | "orphan";
    readonly journal:
      | "none"
      | "prepared"
      | "publishing"
      | "published"
      | "rolling-back"
      | "committed"
      | "malformed"
      | "orphan"
      | "authorization-mismatch"
      | "plan-digest-mismatch";
  };
  readonly mutations: readonly Mutation[];
  readonly steps: readonly VectorStep[];
}

interface Corpus {
  readonly protocol: string;
  readonly version: 1;
  readonly blobs: readonly BlobRecord[];
  readonly plans: readonly {
    readonly id: string;
    readonly plan: PublicationPlan;
  }[];
  readonly vectors: readonly Vector[];
}

const corpus = JSON.parse(
  readFileSync(
    path.resolve("artifact-transactions/v1/vectors.json"),
    "utf8",
  ),
) as Corpus;
const blobs = new Map(corpus.blobs.map((blob) => [blob.id, blob]));
const blobsByDigest = new Map(
  corpus.blobs.map((blob) => [blob.sha256, blob]),
);
const plans = new Map(corpus.plans.map((entry) => [entry.id, entry.plan]));
const TRANSACTION_ID = "d".repeat(64);
const OTHER_DIGEST = "e".repeat(64);

function clonePlan(plan: PublicationPlan): PublicationPlan {
  return JSON.parse(JSON.stringify(plan)) as PublicationPlan;
}

function mutatePlan(
  source: PublicationPlan,
  mutation: Vector["planMutation"],
): PublicationPlan {
  const plan = clonePlan(source);
  if (mutation === "none") {
    return plan;
  }
  const first = plan.artifacts[0]!;
  const remove = plan.artifacts.find(
    (transition) => transition.next.kind === "absent",
  )!;
  switch (mutation) {
    case "absolute-live-path":
      (first as { path: string }).path = "/generated/create.js";
      break;
    case "traversal-live-path":
      (first as { path: string }).path = "../generated/create.js";
      break;
    case "backslash-live-path":
      (first as { path: string }).path = "generated\\create.js";
      break;
    case "portable-case-collision":
      (plan.artifacts as PublicationPlan["artifacts"] as Array<typeof first>).push({
        ...first,
        path: "Generated/create.js",
        stagedPath: ".genes-tooling/stage/Generated/create.js",
      });
      break;
    case "duplicate-commit-marker":
      (plan.artifacts as PublicationPlan["artifacts"] as Array<typeof first>).push(
        plan.commitMarker,
      );
      (plan.artifacts as Array<typeof first>).sort((left, right) =>
        left.path.localeCompare(right.path),
      );
      break;
    case "staged-path-with-absent-next":
      (remove as { stagedPath: string | null }).stagedPath =
        ".genes-tooling/stage/generated/remove.js";
      break;
    case "missing-staged-path-for-file":
      (first as { stagedPath: string | null }).stagedPath = null;
      break;
  }
  return plan;
}

function writeEntry(
  root: string,
  relative: string,
  state: ExpectedFileState,
): void {
  if (state.kind === "absent") {
    return;
  }
  const blob = blobsByDigest.get(state.sha256);
  assert.ok(blob, `missing blob ${state.sha256}`);
  const absolute = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, blob.utf8, { mode: state.mode });
  chmodSync(absolute, state.mode);
}

function materializeState(
  root: string,
  plan: PublicationPlan,
  which: "prior" | "next" | "absent",
): void {
  if (which === "absent") {
    return;
  }
  for (const transition of [...plan.artifacts, plan.commitMarker]) {
    writeEntry(root, transition.path, transition[which]);
  }
}

function materializeStage(
  root: string,
  plan: PublicationPlan,
  stage: Vector["stage"],
): void {
  if (stage === "absent") {
    return;
  }
  for (const transition of [...plan.artifacts, plan.commitMarker]) {
    if (transition.stagedPath !== null) {
      writeEntry(root, transition.stagedPath, transition.next);
    }
  }
}

function withDigest<T extends object>(
  value: T,
  field: "lockDigest" | "journalDigest",
): T & Record<typeof field, string> {
  return {
    ...value,
    [field]: canonicalDigest(value as never),
  } as T & Record<typeof field, string>;
}

function lockRecord(
  plan: PublicationPlan,
  state: Vector["control"]["lock"],
): PublicationLock {
  const base = createPublicationLock(plan, TRANSACTION_ID);
  const { lockDigest: _discard, ...withoutDigest } = base;
  return withDigest(
    {
      ...withoutDigest,
      pid: state === "active-same-host" ? process.pid : 2_147_483_647,
      hostIdentity:
        state === "foreign-host" ? OTHER_DIGEST : currentHostIdentity(),
    },
    "lockDigest",
  );
}

function journalRecord(
  plan: PublicationPlan,
  state: Vector["control"]["journal"],
): PublicationJournal {
  const phase =
    state === "authorization-mismatch" ||
    state === "plan-digest-mismatch" ||
    state === "orphan"
      ? "publishing"
      : state;
  const base = createPublicationJournal(
    plan,
    TRANSACTION_ID,
    phase as PublicationJournal["phase"],
  );
  const { journalDigest: _discard, ...withoutDigest } = base;
  return withDigest(
    {
      ...withoutDigest,
      authorizationDigest:
        state === "authorization-mismatch"
          ? OTHER_DIGEST
          : withoutDigest.authorizationDigest,
      planDigest:
        state === "plan-digest-mismatch"
          ? OTHER_DIGEST
          : withoutDigest.planDigest,
    },
    "journalDigest",
  );
}

function materializeBackups(root: string, plan: PublicationPlan): void {
  for (const transition of [...plan.artifacts, plan.commitMarker]) {
    if (
      transition.prior.kind === "file" &&
      JSON.stringify(transition.prior) !== JSON.stringify(transition.next)
    ) {
      writeEntry(
        root,
        `${plan.transactionRoot}/work/backup/${transition.path}`,
        transition.prior,
      );
    }
  }
}

function materializeControl(
  root: string,
  plan: PublicationPlan,
  control: Vector["control"],
): void {
  const controlRoot = path.join(root, ...plan.transactionRoot.split("/"));
  if (control.lock === "none" && control.journal === "none") {
    return;
  }
  mkdirSync(controlRoot, { recursive: true });
  if (control.lock !== "none") {
    const lockPath = path.join(controlRoot, "lock");
    writeFileSync(
      lockPath,
      control.lock === "malformed"
        ? "{"
        : encodeRecord(lockRecord(plan, control.lock)),
      { mode: 0o600 },
    );
  }
  if (control.journal !== "none") {
    const journalPath = path.join(controlRoot, "journal.json");
    writeFileSync(
      journalPath,
      control.journal === "malformed"
        ? "{"
        : encodeRecord(journalRecord(plan, control.journal)),
      { mode: 0o600 },
    );
    if (
      control.journal === "published" ||
      control.journal === "committed"
    ) {
      materializeBackups(root, plan);
    }
  }
}

function replaceEntry(
  root: string,
  mutation: Mutation,
  projectContainer: string,
): string {
  if (mutation.area === "project-root") {
    const real = path.join(projectContainer, "real-project");
    const exposed = path.join(projectContainer, "project");
    mkdirSync(real, { recursive: true });
    return exposed;
  }
  const absolute = path.join(root, ...mutation.path.split("/"));
  rmSync(absolute, { recursive: true, force: true });
  if (mutation.entry.kind === "absent") {
    return root;
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  if (mutation.entry.kind === "file") {
    const blob = blobs.get(mutation.entry.blob)!;
    writeFileSync(absolute, blob.utf8, { mode: mutation.entry.mode });
    chmodSync(absolute, mutation.entry.mode);
  } else if (mutation.entry.kind === "symlink") {
    symlinkSync(mutation.entry.target, absolute);
  } else {
    const result = spawnSync("mkfifo", [absolute]);
    assert.equal(result.status, 0, result.stderr?.toString());
  }
  return root;
}

function applyRootSymlink(
  container: string,
  realRoot: string,
  exposedRoot: string,
): void {
  rmSync(exposedRoot, { recursive: true, force: true });
  symlinkSync(path.relative(container, realRoot), exposedRoot);
}

function controlPresent(root: string, plan: PublicationPlan): boolean {
  const control = path.join(root, ...plan.transactionRoot.split("/"));
  const presentNoFollow = (candidate: string): boolean => {
    try {
      lstatSync(candidate);
      return true;
    } catch {
      return false;
    }
  };
  if (presentNoFollow(control) && !lstatSync(control).isDirectory()) {
    return true;
  }
  return (
    presentNoFollow(path.join(control, "lock")) ||
    presentNoFollow(path.join(control, "journal.json")) ||
    presentNoFollow(path.join(control, "work"))
  );
}

function stateMatches(
  root: string,
  plan: PublicationPlan,
  which: "prior" | "next",
): boolean {
  return [...plan.artifacts, plan.commitMarker].every((transition) => {
    const absolute = path.join(root, ...transition.path.split("/"));
    if (transition[which].kind === "absent") {
      return !existsSync(absolute);
    }
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      return false;
    }
    const bytes = readFileSync(absolute);
    const expected = transition[which];
    return (
      expected.kind === "file" &&
      sha256Bytes(bytes) === expected.sha256 &&
      bytes.byteLength === expected.sizeBytes &&
      (lstatSync(absolute).mode & 0o777) === expected.mode
    );
  });
}

function directFault(
  root: string,
  fault: Fault | null,
): ((point: ArtifactCheckpoint) => void) | undefined {
  if (fault === null) {
    return undefined;
  }
  return (point) => {
    if (point !== fault.at) {
      return;
    }
    const subject = point.includes(":")
      ? point.slice(point.indexOf(":") + 1)
      : point;
    if (fault.kind === "io-error") {
      const blob = blobs.get("alien")!;
      const absolute = path.join(root, ...subject.split("/"));
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, blob.utf8, { mode: 0o644 });
      chmodSync(absolute, 0o644);
      return;
    }
    artifactFailure(
      fault.kind === "permission-denied"
        ? "filesystem-permission"
        : "filesystem-unsupported",
      subject,
    );
  };
}

function runChild(
  root: string,
  plan: PublicationPlan,
  step: VectorStep,
): { readonly outcome: string; readonly failure?: ArtifactFailureFact } {
  const requestPath = path.join(root, "vector-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify({
      action: step.action,
      projectRoot: root,
      plan,
      admitPlan: step.admitPlan,
      admitIntended: step.admitIntended,
      fault: step.fault,
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "vector-fixture.js",
      ),
    ],
    {
      env: {
        ...process.env,
        GENES_TOOLING_VECTOR_REQUEST: requestPath,
      },
      encoding: "utf8",
    },
  );
  if (step.fault?.kind === "process-exit") {
    assert.equal(result.status, 73, result.stderr);
    return { outcome: "crashed" };
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim()) as {
    readonly outcome: string;
    readonly failure?: ArtifactFailureFact;
  };
}

async function runDirect(
  root: string,
  plan: PublicationPlan,
  step: VectorStep,
): Promise<{ readonly outcome: string; readonly failure?: ArtifactFailureFact }> {
  try {
    const outcome =
      step.action === "publish"
        ? await publishArtifacts({
            projectRoot: root,
            plan,
            admitIntended: () => step.admitIntended,
            faultInjector: directFault(root, step.fault),
          })
        : await recoverArtifacts({
            projectRoot: root,
            transactionRoot: plan.transactionRoot,
            projectIdentity: plan.projectIdentity,
            admitPlan: () => step.admitPlan,
            admitIntended: () => step.admitIntended,
            faultInjector: directFault(root, step.fault),
          });
    return { outcome: outcome.action };
  } catch (error) {
    if (error instanceof ArtifactTransactionError) {
      return { outcome: "failed", failure: error.failure };
    }
    throw error;
  }
}

const failures: string[] = [];
for (const vector of corpus.vectors) {
  const container = mkdtempSync(
    path.join(realpathSync.native(tmpdir()), "genes-tooling-vector-"),
  );
  try {
    const sourcePlan = plans.get(vector.plan)!;
    const plan = mutatePlan(sourcePlan, vector.planMutation);
    let root = path.join(container, "project");
    mkdirSync(root);
    materializeState(root, sourcePlan, vector.initial);
    materializeStage(root, sourcePlan, vector.stage);
    materializeControl(root, sourcePlan, vector.control);
    const setupMutations = vector.mutations.filter(
      (mutation) => mutation.at === undefined,
    );
    const rootMutation = setupMutations.find(
      (mutation) => mutation.area === "project-root",
    );
    for (const mutation of setupMutations) {
      if (mutation !== rootMutation) {
        replaceEntry(root, mutation, container);
      }
    }
    if (rootMutation !== undefined) {
      const realRoot = path.join(container, "real-project");
      rmSync(realRoot, { recursive: true, force: true });
      renameProject(root, realRoot);
      applyRootSymlink(container, realRoot, root);
    }
    for (const mutation of vector.mutations.filter(
      (candidate) => candidate.at === "after-preflight",
    )) {
      replaceEntry(root, mutation, container);
    }

    for (const step of vector.steps) {
      const actual =
        step.fault?.kind === "process-exit"
          ? runChild(root, plan, step)
          : await runDirect(root, plan, step);
      assert.equal(actual.outcome, step.expect.outcome);
      if (step.expect.failure !== null) {
        assert.deepEqual(actual.failure, step.expect.failure);
      }
      const realRoot = realpathOrSelf(root);
      if (step.expect.live === "prior") {
        assert.equal(stateMatches(realRoot, sourcePlan, "prior"), true);
      } else if (step.expect.live === "next") {
        assert.equal(stateMatches(realRoot, sourcePlan, "next"), true);
      }
      if (step.expect.control === "absent") {
        assert.equal(controlPresent(realRoot, sourcePlan), false);
      } else {
        assert.equal(controlPresent(realRoot, sourcePlan), true);
      }
    }
  } catch (error) {
    failures.push(
      `${vector.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
}

function renameProject(source: string, destination: string): void {
  renameSync(source, destination);
}

function realpathOrSelf(candidate: string): string {
  return existsSync(candidate) ? realpathSync.native(candidate) : candidate;
}

if (failures.length > 0) {
  throw new Error(
    `artifact vector failures (${failures.length}/${corpus.vectors.length}):\n${failures.join("\n")}`,
  );
}
process.stdout.write(
  `genes tooling artifact vectors: ${corpus.vectors.length} passed\n`,
);
