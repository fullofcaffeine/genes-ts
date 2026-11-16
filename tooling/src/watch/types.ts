export interface ExactWatchInput<Cause> {
  readonly kind: "exact";
  readonly path: string;
  readonly cause: Cause;
}

export interface TreeWatchInput<Cause> {
  readonly kind: "tree";
  readonly path: string;
  readonly cause: Cause;
  readonly include: (relativePath: string) => boolean;
  readonly ignore?: (relativePath: string) => boolean;
  /**
   * Fail when the watched tree contains a symbolic link instead of silently
   * skipping it. Use this when another tool, such as a compiler, may follow
   * that link and read files the watcher cannot observe safely.
   */
  readonly rejectSymlinks?: boolean;
}

export type WatchInput<Cause> =
  | ExactWatchInput<Cause>
  | TreeWatchInput<Cause>;

export interface ReconciledWatchChange<Cause> {
  readonly path: string;
  readonly cause: Cause;
  readonly origin: "native" | "poll" | "registration";
  /**
   * How the path changed between two snapshots: it appeared (`created`), it
   * disappeared (`deleted`), or it was there before and after with another
   * fingerprint (`modified`). A compiler host needs this because a new or
   * removed source file can change name lookups in files that did not change.
   */
  readonly existence: "created" | "deleted" | "modified";
}

export interface ReconciledWatchOptions<Cause> {
  readonly inputs: readonly WatchInput<Cause>[];
  readonly merge: (left: Cause, right: Cause) => Cause;
  readonly onChange: (change: ReconciledWatchChange<Cause>) => void;
  readonly onError: (error: Error) => void;
  readonly pollIntervalMs?: number;
  readonly nativeEvents?: boolean;
  readonly maxSnapshotEntries?: number;
  /**
   * Called after initial native subscriptions and before the mandatory
   * registration-gap reconciliation.
   */
  readonly onRegistered?: () => void;
}

/** Result of one caller-requested authoritative filesystem comparison. */
export type ReconciliationResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly error: Error };

export interface ReconciledWatchSession {
  reconcile(): ReconciliationResult;
  close(): void;
}
