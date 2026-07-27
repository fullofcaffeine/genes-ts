export const ARTIFACT_PLAN_PROTOCOL =
  "genes.tooling.artifact-transition" as const;
export const ARTIFACT_PLAN_VERSION = 1 as const;
export const ARTIFACT_JOURNAL_PROTOCOL =
  "genes.tooling.artifact-transition-journal" as const;
export const ARTIFACT_LOCK_PROTOCOL =
  "genes.tooling.artifact-transition-lock" as const;
export const CANONICALIZATION = "rfc8785-jcs" as const;

export type Sha256 = string;
export type PortableRelativePath = string;

export interface AbsentState {
  readonly kind: "absent";
}

export interface FileState {
  readonly kind: "file";
  readonly sha256: Sha256;
  readonly sizeBytes: number;
  readonly mode: number;
}

export type ExpectedFileState = AbsentState | FileState;

export interface ArtifactTransition {
  readonly path: PortableRelativePath;
  readonly prior: ExpectedFileState;
  readonly next: ExpectedFileState;
  readonly stagedPath: PortableRelativePath | null;
}

export interface PublicationPlan {
  readonly protocol: typeof ARTIFACT_PLAN_PROTOCOL;
  readonly version: typeof ARTIFACT_PLAN_VERSION;
  readonly projectIdentity: Sha256;
  readonly authorizationDigest: Sha256;
  readonly transactionRoot: PortableRelativePath;
  readonly stageRoot: PortableRelativePath;
  readonly artifacts: readonly ArtifactTransition[];
  readonly commitMarker: ArtifactTransition;
}

export type PublicationPhase =
  | "prepared"
  | "publishing"
  | "published"
  | "rolling-back"
  | "committed";

export interface PublicationJournal {
  readonly protocol: typeof ARTIFACT_JOURNAL_PROTOCOL;
  readonly version: 1;
  readonly canonicalization: typeof CANONICALIZATION;
  readonly journalDigestAlgorithm:
    "sha256-rfc8785-without-journalDigest-v1";
  readonly journalDigest: Sha256;
  readonly transactionId: Sha256;
  readonly projectIdentity: Sha256;
  readonly authorizationDigest: Sha256;
  readonly phase: PublicationPhase;
  readonly planDigest: Sha256;
  readonly plan: PublicationPlan;
}

export interface PublicationLock {
  readonly protocol: typeof ARTIFACT_LOCK_PROTOCOL;
  readonly version: 1;
  readonly canonicalization: typeof CANONICALIZATION;
  readonly lockDigestAlgorithm: "sha256-rfc8785-without-lockDigest-v1";
  readonly lockDigest: Sha256;
  readonly transactionId: Sha256;
  readonly projectIdentity: Sha256;
  readonly hostIdentity: Sha256;
  readonly pid: number;
  readonly nonce: Sha256;
}

export type ArtifactFailureKind =
  | "invalid-plan"
  | "unexpected-staged-state"
  | "undeclared-staged-entry"
  | "unexpected-live-state"
  | "path-escape"
  | "portable-path-collision"
  | "symlink-traversal"
  | "active-writer"
  | "untrusted-lock"
  | "malformed-journal"
  | "orphan-control-state"
  | "recovery-conflict"
  | "filesystem-unsupported"
  | "filesystem-permission"
  | "control-path-collision";

export interface ArtifactFailureFact {
  readonly kind: ArtifactFailureKind;
  readonly subject: string;
}

export interface PublicationOutcome {
  readonly action: "published" | "unchanged";
  readonly transactionId: Sha256 | null;
}

export interface RecoveryOutcome {
  readonly action: "none" | "committed" | "rolled-back";
  readonly transactionId: Sha256 | null;
}

export type ArtifactCheckpoint =
  | "after-journal-prepared"
  | "after-phase-publishing"
  | `after-backup:${PortableRelativePath}`
  | `before-publish:${PortableRelativePath}`
  | `after-publish:${PortableRelativePath}`
  | "after-phase-published"
  | "after-phase-rolling-back"
  | `after-remove-next:${PortableRelativePath}`
  | `before-restore-prior:${PortableRelativePath}`
  | `after-restore-prior:${PortableRelativePath}`
  | "after-cleanup:journal"
  | "after-cleanup:work-root"
  | "after-cleanup:lock"
  | `inject-unexpected-live:${PortableRelativePath}`;

export interface PublishOptions {
  readonly projectRoot: string;
  readonly plan: PublicationPlan;
  readonly faultInjector?: (checkpoint: ArtifactCheckpoint) => void;
}

export interface RecoverOptions {
  readonly projectRoot: string;
  readonly transactionRoot: PortableRelativePath;
  readonly projectIdentity: Sha256;
  readonly admitIntended: (plan: PublicationPlan) => boolean | Promise<boolean>;
  readonly faultInjector?: (checkpoint: ArtifactCheckpoint) => void;
}
