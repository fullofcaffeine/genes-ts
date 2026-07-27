import { readFileSync } from "node:fs";

import {
  ArtifactTransactionError,
  artifactFailure,
  publishArtifacts,
  recoverArtifacts,
  type ArtifactCheckpoint,
  type PublicationPlan,
} from "./index.js";

interface Request {
  readonly action: "publish" | "recover";
  readonly projectRoot: string;
  readonly plan: PublicationPlan;
  readonly admitIntended: boolean;
  readonly fault: {
    readonly kind: "process-exit";
    readonly at: ArtifactCheckpoint;
  } | null;
}

const requestPath = process.env.GENES_TOOLING_VECTOR_REQUEST;
if (requestPath === undefined) {
  throw new Error("GENES_TOOLING_VECTOR_REQUEST is required");
}
const request = JSON.parse(readFileSync(requestPath, "utf8")) as Request;
const faultInjector = (point: ArtifactCheckpoint): void => {
  if (request.fault?.at === point) {
    process.exit(73);
  }
};

try {
  const outcome =
    request.action === "publish"
      ? publishArtifacts({
          projectRoot: request.projectRoot,
          plan: request.plan,
          faultInjector,
        })
      : await recoverArtifacts({
          projectRoot: request.projectRoot,
          transactionRoot: request.plan.transactionRoot,
          projectIdentity: request.plan.projectIdentity,
          admitIntended: () => request.admitIntended,
          faultInjector,
        });
  process.stdout.write(`${JSON.stringify({ outcome: outcome.action })}\n`);
} catch (error) {
  if (error instanceof ArtifactTransactionError) {
    process.stdout.write(
      `${JSON.stringify({ outcome: "failed", failure: error.failure })}\n`,
    );
    process.exit(0);
  }
  artifactFailure("filesystem-unsupported", "vector fixture");
}
