import type {
  ArtifactFailureFact,
  ArtifactFailureKind,
} from "./types.js";

export class ArtifactTransactionError extends Error {
  readonly failure: ArtifactFailureFact;

  constructor(kind: ArtifactFailureKind, subject: string) {
    super(`${kind}: ${subject}`);
    this.name = "ArtifactTransactionError";
    this.failure = { kind, subject };
  }
}

export function artifactFailure(
  kind: ArtifactFailureKind,
  subject: string,
): never {
  throw new ArtifactTransactionError(kind, subject);
}
