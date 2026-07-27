import assert from "node:assert/strict";

import {
  ARTIFACT_PLAN_PROTOCOL,
  ArtifactTransactionError,
  canonicalDigest,
  canonicalJson,
  type PublicationPlan,
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

process.stdout.write("genes tooling artifact foundations: ok\n");
