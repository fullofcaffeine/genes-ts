import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_PLAN_PROTOCOL,
  ArtifactTransactionError,
  canonicalDigest,
  canonicalJson,
  type ArtifactCheckpoint,
  type FileState,
  type PublicationPlan,
  publishArtifacts,
  recoverArtifacts,
  sha256Bytes,
  validatePublicationPlan,
} from "./index.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const ABSENT = { kind: "absent" } as const;
const FILE = {
  kind: "file",
  sha256: DIGEST_A,
  sizeBytes: 3,
  mode: 0o644,
} as const;

const plan: PublicationPlan = {
  protocol: ARTIFACT_PLAN_PROTOCOL,
  version: 1,
  projectIdentity: DIGEST_A,
  authorizationDigest: DIGEST_B,
  transactionRoot: ".genes-tooling/transactions",
  stageRoot: ".genes-tooling/stage",
  artifacts: [
    {
      path: "generated/a.js",
      prior: ABSENT,
      next: FILE,
      stagedPath: ".genes-tooling/stage/generated/a.js",
    },
  ],
  commitMarker: {
    path: "generated/manifest.json",
    prior: ABSENT,
    next: FILE,
    stagedPath: ".genes-tooling/stage/generated/manifest.json",
  },
};

assert.equal(validatePublicationPlan(plan), plan);
assert.equal(
  canonicalJson({ z: 1, a: ["x", true, null] }),
  '{"a":["x",true,null],"z":1}',
);
assert.equal(canonicalDigest({ a: 1 }), canonicalDigest({ a: 1 }));

function expectFailure(
  kind: ArtifactTransactionError["failure"]["kind"],
  action: () => void,
): void {
  assert.throws(action, (error: unknown) => {
    return (
      error instanceof ArtifactTransactionError &&
      error.failure.kind === kind
    );
  });
}

expectFailure("path-escape", () =>
  validatePublicationPlan({ ...plan, stageRoot: "../stage" }),
);
expectFailure("invalid-plan", () =>
  validatePublicationPlan({
    ...plan,
    artifacts: [...plan.artifacts].reverse(),
    commitMarker: { ...plan.commitMarker, stagedPath: null },
  }),
);
expectFailure("portable-path-collision", () =>
  validatePublicationPlan({
    ...plan,
    artifacts: [
      ...plan.artifacts,
      {
        ...plan.artifacts[0]!,
        path: "GENERATED/A.JS",
        stagedPath: ".genes-tooling/stage/GENERATED/A.JS",
      },
    ],
  }),
);
expectFailure("control-path-collision", () =>
  validatePublicationPlan({
    ...plan,
    artifacts: [
      {
        ...plan.artifacts[0]!,
        path: ".genes-tooling/transactions/live.js",
      },
    ],
  }),
);

function fileState(bytes: string, mode: number): FileState {
  return {
    kind: "file",
    sha256: sha256Bytes(bytes),
    sizeBytes: Buffer.byteLength(bytes),
    mode,
  };
}

function writeFixture(
  root: string,
  relative: string,
  bytes: string,
  mode: number,
): void {
  const absolute = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes, { mode });
  chmodSync(absolute, mode);
}

const publishPlan: PublicationPlan = {
  protocol: ARTIFACT_PLAN_PROTOCOL,
  version: 1,
  projectIdentity: DIGEST_A,
  authorizationDigest: DIGEST_B,
  transactionRoot: ".genes-tooling/transactions",
  stageRoot: ".genes-tooling/stage",
  artifacts: [
    {
      path: "generated/create.js",
      prior: ABSENT,
      next: fileState("created\n", 0o644),
      stagedPath: ".genes-tooling/stage/generated/create.js",
    },
    {
      path: "generated/remove.js",
      prior: fileState("old remove\n", 0o644),
      next: ABSENT,
      stagedPath: null,
    },
    {
      path: "generated/unchanged.js",
      prior: fileState("stable\n", 0o644),
      next: fileState("stable\n", 0o644),
      stagedPath: null,
    },
    {
      path: "generated/update.js",
      prior: fileState("old update\n", 0o644),
      next: fileState("new update\n", 0o755),
      stagedPath: ".genes-tooling/stage/generated/update.js",
    },
  ],
  commitMarker: {
    path: "generated/owner.json",
    prior: fileState("old owner\n", 0o600),
    next: fileState("new owner\n", 0o644),
    stagedPath: ".genes-tooling/stage/generated/owner.json",
  },
};

function materializeMixedFixture(root: string): void {
  writeFixture(root, "generated/update.js", "old update\n", 0o644);
  writeFixture(root, "generated/remove.js", "old remove\n", 0o644);
  writeFixture(root, "generated/unchanged.js", "stable\n", 0o644);
  writeFixture(root, "generated/owner.json", "old owner\n", 0o600);
  writeFixture(
    root,
    ".genes-tooling/stage/generated/create.js",
    "created\n",
    0o644,
  );
  writeFixture(
    root,
    ".genes-tooling/stage/generated/update.js",
    "new update\n",
    0o755,
  );
  writeFixture(
    root,
    ".genes-tooling/stage/generated/owner.json",
    "new owner\n",
    0o644,
  );
}

const publishRoot = mkdtempSync(
  path.join(realpathSync.native(tmpdir()), "genes-tooling-publish-"),
);
try {
  materializeMixedFixture(publishRoot);
  const checkpoints: ArtifactCheckpoint[] = [];
  const result = await publishArtifacts({
    projectRoot: publishRoot,
    plan: publishPlan,
    faultInjector: (point) => checkpoints.push(point),
  });
  assert.equal(result.action, "published");
  assert.match(result.transactionId!, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(path.join(publishRoot, "generated/create.js"), "utf8"), "created\n");
  assert.equal(readFileSync(path.join(publishRoot, "generated/update.js"), "utf8"), "new update\n");
  assert.equal(statSync(path.join(publishRoot, "generated/update.js")).mode & 0o777, 0o755);
  assert.equal(readFileSync(path.join(publishRoot, "generated/unchanged.js"), "utf8"), "stable\n");
  assert.equal(readFileSync(path.join(publishRoot, "generated/owner.json"), "utf8"), "new owner\n");
  assert.equal(
    checkpoints.indexOf("after-publish:commit-marker") >
      checkpoints.indexOf("after-publish:generated/update.js"),
    true,
  );
  assert.equal(
    (await publishArtifacts({
      projectRoot: publishRoot,
      plan: publishPlan,
    })).action,
    "unchanged",
  );
} finally {
  rmSync(publishRoot, { recursive: true, force: true });
}

const rollbackRoot = mkdtempSync(
  path.join(realpathSync.native(tmpdir()), "genes-tooling-rollback-"),
);
try {
  materializeMixedFixture(rollbackRoot);
  await assert.rejects(
    () =>
      publishArtifacts({
        projectRoot: rollbackRoot,
        plan: publishPlan,
        faultInjector: (point) => {
          if (point === "before-publish:generated/update.js") {
            throw new Error("injected caught failure");
          }
        },
      }),
    /injected caught failure/,
  );
  assert.equal(
    readFileSync(path.join(rollbackRoot, "generated/update.js"), "utf8"),
    "old update\n",
  );
  assert.equal(
    readFileSync(path.join(rollbackRoot, "generated/remove.js"), "utf8"),
    "old remove\n",
  );
  assert.equal(
    readFileSync(path.join(rollbackRoot, "generated/owner.json"), "utf8"),
    "old owner\n",
  );
  assert.equal(
    existsSync(path.join(rollbackRoot, "generated/create.js")),
    false,
  );
  assert.equal(
    existsSync(
      path.join(
        rollbackRoot,
        ".genes-tooling/transactions/journal.json",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      path.join(rollbackRoot, ".genes-tooling/transactions/lock"),
    ),
    false,
  );
} finally {
  rmSync(rollbackRoot, { recursive: true, force: true });
}

for (const admission of [
  {
    readonlyName: "rejected",
    admit: async (): Promise<boolean> => false,
    expected: /intended-state-rejected/u,
  },
  {
    readonlyName: "thrown",
    admit: async (): Promise<boolean> => {
      throw new Error("host validator failed");
    },
    expected: /host validator failed/u,
  },
] as const) {
  const admissionRoot = mkdtempSync(
    path.join(
      realpathSync.native(tmpdir()),
      `genes-tooling-admission-${admission.readonlyName}-`,
    ),
  );
  try {
    materializeMixedFixture(admissionRoot);
    await assert.rejects(
      () =>
        publishArtifacts({
          projectRoot: admissionRoot,
          plan: publishPlan,
          admitIntended: admission.admit,
        }),
      admission.expected,
    );
    assert.equal(
      readFileSync(
        path.join(admissionRoot, "generated/update.js"),
        "utf8",
      ),
      "old update\n",
    );
    assert.equal(
      readFileSync(
        path.join(admissionRoot, "generated/remove.js"),
        "utf8",
      ),
      "old remove\n",
    );
    assert.equal(
      readFileSync(
        path.join(admissionRoot, "generated/owner.json"),
        "utf8",
      ),
      "old owner\n",
    );
    assert.equal(
      existsSync(path.join(admissionRoot, "generated/create.js")),
      false,
    );
  } finally {
    rmSync(admissionRoot, { recursive: true, force: true });
  }
}

const changedDuringAdmissionRoot = mkdtempSync(
  path.join(
    realpathSync.native(tmpdir()),
    "genes-tooling-admission-live-change-",
  ),
);
try {
  materializeMixedFixture(changedDuringAdmissionRoot);
  await assert.rejects(
    () =>
      publishArtifacts({
        projectRoot: changedDuringAdmissionRoot,
        plan: publishPlan,
        admitIntended: () => {
          writeFileSync(
            path.join(changedDuringAdmissionRoot, "generated/update.js"),
            "changed by another writer\n",
            "utf8",
          );
          return true;
        },
      }),
    (error: unknown) =>
      error instanceof ArtifactTransactionError &&
      error.failure.kind === "recovery-conflict",
    "a changed live file must not become an accepted publication",
  );
  assert.equal(
    readFileSync(
      path.join(changedDuringAdmissionRoot, "generated/update.js"),
      "utf8",
    ),
    "changed by another writer\n",
    "recovery must not overwrite bytes written by another process",
  );
} finally {
  rmSync(changedDuringAdmissionRoot, { recursive: true, force: true });
}

function crashPublish(
  root: string,
  checkpoint: ArtifactCheckpoint,
): void {
  materializeMixedFixture(root);
  const planPath = path.join(root, "publication-plan.json");
  writeFileSync(planPath, JSON.stringify(publishPlan));
  const result = spawnSync(
    process.execPath,
    [path.join(path.dirname(fileURLToPath(import.meta.url)), "crash-fixture.js")],
    {
      cwd: root,
      env: {
        ...process.env,
        GENES_TOOLING_FIXTURE_ROOT: root,
        GENES_TOOLING_FIXTURE_PLAN: planPath,
        GENES_TOOLING_FIXTURE_CRASH_AT: checkpoint,
      },
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    73,
    `crash fixture failed: ${result.stdout}\n${result.stderr}`,
  );
}

const recoverRollbackRoot = mkdtempSync(
  path.join(realpathSync.native(tmpdir()), "genes-tooling-recover-rollback-"),
);
try {
  crashPublish(
    recoverRollbackRoot,
    "after-publish:generated/update.js",
  );
  let admissions = 0;
  const recovery = await recoverArtifacts({
    projectRoot: recoverRollbackRoot,
    transactionRoot: publishPlan.transactionRoot,
    projectIdentity: publishPlan.projectIdentity,
    admitIntended: () => {
      admissions += 1;
      return false;
    },
  });
  assert.equal(recovery.action, "rolled-back");
  assert.equal(admissions, 0);
  assert.equal(
    readFileSync(
      path.join(recoverRollbackRoot, "generated/update.js"),
      "utf8",
    ),
    "old update\n",
  );
  assert.equal(
    readFileSync(
      path.join(recoverRollbackRoot, "generated/owner.json"),
      "utf8",
    ),
    "old owner\n",
  );
  assert.equal(
    existsSync(path.join(recoverRollbackRoot, "generated/create.js")),
    false,
  );
} finally {
  rmSync(recoverRollbackRoot, { recursive: true, force: true });
}

const recoverPlanRejectionRoot = mkdtempSync(
  path.join(
    realpathSync.native(tmpdir()),
    "genes-tooling-recover-plan-rejection-",
  ),
);
try {
  crashPublish(
    recoverPlanRejectionRoot,
    "after-publish:generated/update.js",
  );
  const publicText = (relative: string): string | null => {
    const absolute = path.join(recoverPlanRejectionRoot, relative);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  };
  const publicSnapshot = () => Object.freeze({
    update: publicText("generated/update.js"),
    remove: publicText("generated/remove.js"),
    create: publicText("generated/create.js"),
    owner: publicText("generated/owner.json"),
  });
  const before = publicSnapshot();
  let intendedAdmissions = 0;
  await assert.rejects(
    () =>
      recoverArtifacts({
        projectRoot: recoverPlanRejectionRoot,
        transactionRoot: publishPlan.transactionRoot,
        projectIdentity: publishPlan.projectIdentity,
        admitPlan: () => false,
        admitIntended: () => {
          intendedAdmissions += 1;
          return true;
        },
      }),
    (error: unknown) =>
      error instanceof ArtifactTransactionError &&
      error.failure.kind === "recovery-conflict",
    "a host must be able to reject an outdated recovery plan before mutation",
  );
  assert.equal(intendedAdmissions, 0);
  assert.deepEqual(
    publicSnapshot(),
    before,
    "plan rejection must leave every public file exactly as recovery found it",
  );
  assert.equal(
    existsSync(
      path.join(
        recoverPlanRejectionRoot,
        ".genes-tooling/transactions/journal.json",
      ),
    ),
    true,
    "the untouched journal remains available after the host fixes its policy",
  );
} finally {
  rmSync(recoverPlanRejectionRoot, { recursive: true, force: true });
}

const recoverPlanMutationRoot = mkdtempSync(
  path.join(
    realpathSync.native(tmpdir()),
    "genes-tooling-recover-plan-mutation-",
  ),
);
try {
  crashPublish(
    recoverPlanMutationRoot,
    "after-publish:generated/update.js",
  );
  let mutationApplied: boolean | null = null;
  const outcome = await recoverArtifacts({
    projectRoot: recoverPlanMutationRoot,
    transactionRoot: publishPlan.transactionRoot,
    projectIdentity: publishPlan.projectIdentity,
    admitPlan: (plan) => {
      assert.equal(Object.isFrozen(plan), true);
      assert.equal(Object.isFrozen(plan.artifacts), true);
      assert.equal(Object.isFrozen(plan.artifacts[0]), true);
      assert.equal(Object.isFrozen(plan.artifacts[0]!.prior), true);
      assert.equal(Object.isFrozen(plan.artifacts[0]!.next), true);
      mutationApplied = Reflect.set(plan, "artifacts", Object.freeze([]));
      assert.equal(
        Reflect.set(plan.artifacts[0]!, "path", "generated/skipped.js"),
        false,
      );
      return true;
    },
    admitIntended: () => true,
  });
  assert.equal(
    mutationApplied,
    false,
    "a host callback must receive a recovery plan it cannot modify",
  );
  assert.equal(outcome.action, "rolled-back");
  assert.equal(
    readFileSync(
      path.join(recoverPlanMutationRoot, "generated/update.js"),
      "utf8",
    ),
    "old update\n",
  );
  assert.equal(
    readFileSync(
      path.join(recoverPlanMutationRoot, "generated/remove.js"),
      "utf8",
    ),
    "old remove\n",
  );
  assert.equal(
    existsSync(path.join(recoverPlanMutationRoot, "generated/create.js")),
    false,
  );
} finally {
  rmSync(recoverPlanMutationRoot, { recursive: true, force: true });
}

const recoverCommitRoot = mkdtempSync(
  path.join(realpathSync.native(tmpdir()), "genes-tooling-recover-commit-"),
);
try {
  crashPublish(recoverCommitRoot, "after-phase-published");
  let admissions = 0;
  const recovery = await recoverArtifacts({
    projectRoot: recoverCommitRoot,
    transactionRoot: publishPlan.transactionRoot,
    projectIdentity: publishPlan.projectIdentity,
    admitIntended: () => {
      admissions += 1;
      return true;
    },
  });
  assert.equal(recovery.action, "committed");
  assert.equal(admissions, 1);
  assert.equal(
    readFileSync(
      path.join(recoverCommitRoot, "generated/update.js"),
      "utf8",
    ),
    "new update\n",
  );
  assert.equal(
    readFileSync(
      path.join(recoverCommitRoot, "generated/owner.json"),
      "utf8",
    ),
    "new owner\n",
  );
  assert.equal(
    existsSync(
      path.join(
        recoverCommitRoot,
        ".genes-tooling/transactions/journal.json",
      ),
    ),
    false,
  );
} finally {
  rmSync(recoverCommitRoot, { recursive: true, force: true });
}

const recoverCommittedCleanupRoot = mkdtempSync(
  path.join(
    realpathSync.native(tmpdir()),
    "genes-tooling-recover-committed-cleanup-",
  ),
);
try {
  crashPublish(recoverCommittedCleanupRoot, "after-cleanup:work-root");
  let admissions = 0;
  const recovery = await recoverArtifacts({
    projectRoot: recoverCommittedCleanupRoot,
    transactionRoot: publishPlan.transactionRoot,
    projectIdentity: publishPlan.projectIdentity,
    admitIntended: () => {
      admissions += 1;
      return false;
    },
  });
  assert.equal(
    recovery.action,
    "committed",
    "a committed journal must finish cleanup after rollback files are gone",
  );
  assert.equal(
    admissions,
    0,
    "terminal cleanup must not ask the host to validate an already committed update again",
  );
  assert.equal(
    readFileSync(
      path.join(recoverCommittedCleanupRoot, "generated/update.js"),
      "utf8",
    ),
    "new update\n",
  );
  assert.equal(
    existsSync(
      path.join(
        recoverCommittedCleanupRoot,
        ".genes-tooling/transactions/journal.json",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      path.join(
        recoverCommittedCleanupRoot,
        ".genes-tooling/transactions/lock",
      ),
    ),
    false,
  );
} finally {
  rmSync(recoverCommittedCleanupRoot, { recursive: true, force: true });
}

process.stdout.write("genes tooling artifact foundations: ok\n");
