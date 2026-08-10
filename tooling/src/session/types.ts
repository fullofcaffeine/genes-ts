import type { HaxeWaitServerEvent } from "../haxe-server/types.js";
import type { HxmlInventoryOptions } from "../hxml/types.js";
import type { ReconciliationResult } from "../watch/types.js";

export const DEVELOPMENT_SESSION_EVENT_PROTOCOL =
  "genes.tooling.development-session-event" as const;
export const DEVELOPMENT_SESSION_EVENT_VERSION = 1 as const;

/** A JSON value whose bytes can participate in a stable compatibility digest. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** The lifecycle stage that produced a structured session failure. */
export type FailurePhase =
  | "recovery"
  | "inventory"
  | "watch"
  | "compile"
  | "validate"
  | "publish"
  | "shutdown";

/**
 * Framework-neutral diagnostics produced by session mechanics themselves.
 *
 * A validator still returns the host's `Diagnostic` type. Core failures need
 * an equally structured representation because the session, rather than the
 * host, owns inventory, compiler-process, watch, publication, and shutdown
 * mechanics. Hosts may format these facts for a terminal, but must not parse a
 * log sentence to discover the phase or code.
 */
export type DevelopmentSessionDiagnostic = Readonly<
  Record<string, JsonValue> & {
    readonly code: string;
    readonly message: string;
  }
>;

/**
 * The exact public-output change admitted as one generation.
 *
 * Paths are project-relative, slash-normalized, sorted by UTF-8 byte order,
 * unique within each list, and disjoint across all three lists. Keeping this
 * representation portable lets framework adapters resolve files without
 * learning private candidate paths.
 */
export interface FileDelta {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly deleted: readonly string[];
}

/** A complete candidate that passed host validation and public publication. */
export interface AcceptedGeneration {
  /** Increments only after successful admission and publication. */
  readonly generation: number;

  /** The newest observed input snapshot represented by this generation. */
  readonly revision: number;

  readonly acceptedAt: number;
  readonly manifestDigest: string;
  readonly compilerMode: "connected" | "direct";
  readonly files: FileDelta;
  readonly entryChanged: boolean;
}

/**
 * A host-presentable failure plus the generation that remains safe to use.
 *
 * Core tooling never turns `diagnostic` into terminal or browser prose. A host
 * validator's rejection is wrapped as a core diagnostic after every JSON
 * string is stripped of private candidate, state, and project paths.
 */
export interface SessionFailure<Diagnostic extends JsonValue> {
  readonly phase: FailurePhase;
  readonly revision: number | null;
  readonly recoverable: boolean;
  readonly diagnostic: Diagnostic | DevelopmentSessionDiagnostic;
  readonly retained: AcceptedGeneration | null;
}

/**
 * The small state machine a host uses to present development progress.
 *
 * `blocked` means this session has not admitted a generation yet. `degraded`
 * means a newer revision failed while the recorded accepted generation stays
 * public and usable.
 */
export type DevelopmentState<Diagnostic extends JsonValue> =
  | { readonly kind: "opening" }
  | {
      readonly kind: "building";
      readonly revision: number;
      readonly retained: AcceptedGeneration | null;
    }
  | {
      readonly kind: "blocked";
      readonly failure: SessionFailure<Diagnostic>;
    }
  | {
      readonly kind: "ready";
      readonly accepted: AcceptedGeneration;
    }
  | {
      readonly kind: "degraded";
      readonly accepted: AcceptedGeneration;
      readonly failure: SessionFailure<Diagnostic>;
    }
  | {
      readonly kind: "closing";
      readonly retained: AcceptedGeneration | null;
    }
  | {
      readonly kind: "closed";
      readonly retained: AcceptedGeneration | null;
    };

/** Framework-neutral facts emitted by one development session. */
export type DevelopmentEventBody<Diagnostic extends JsonValue> =
  | { readonly kind: "state"; readonly state: DevelopmentState<Diagnostic> }
  | {
      readonly kind: "inputs-changed";
      readonly revision: number;
      readonly paths: readonly string[];
    }
  | { readonly kind: "build-started"; readonly revision: number }
  | {
      readonly kind: "candidate-generated";
      readonly revision: number;
      readonly manifestDigest: string;
    }
  | {
      readonly kind: "candidate-superseded";
      readonly revision: number;
      readonly newestRevision: number;
    }
  | {
      readonly kind: "generation-accepted";
      readonly accepted: AcceptedGeneration;
    }
  | {
      readonly kind: "failed";
      readonly failure: SessionFailure<Diagnostic>;
    }
  | {
      /** Reuses the exact process-ownership facts from the wait-server API. */
      readonly kind: "compiler-lifecycle";
      readonly event: HaxeWaitServerEvent;
    }
  | { readonly kind: "closed" };

/** One event in a session-local, strictly increasing sequence. */
export interface DevelopmentEvent<Diagnostic extends JsonValue> {
  readonly protocol: typeof DEVELOPMENT_SESSION_EVENT_PROTOCOL;
  readonly version: typeof DEVELOPMENT_SESSION_EVENT_VERSION;
  readonly sequence: number;
  readonly at: number;
  readonly event: DevelopmentEventBody<Diagnostic>;
}

/**
 * One side-effect-free, JSON-serializable view of the session right now.
 *
 * A late-attaching host or agent reads this after subscribing, then ignores
 * buffered events whose sequence is not greater than `lastSequence`. Every
 * current fact a client needs after that cutoff is represented here; the
 * omitted input/build/candidate events are history, not commands. That closes
 * the subscribe/inspect gap without requiring terminal-log replay.
 * `lastCompilerEvent` is historical lifecycle evidence, not a promise that a
 * previously started process is still alive.
 */
export interface DevelopmentSnapshot<Diagnostic extends JsonValue> {
  readonly state: DevelopmentState<Diagnostic>;

  /** Zero before the first event; otherwise the newest emitted sequence. */
  readonly lastSequence: number;

  /** Zero before input registration creates revision 1. */
  readonly newestRevision: number;

  /**
   * Null before the first admission; otherwise the same last accepted
   * generation referenced by the current state or retained failure.
   */
  readonly accepted: AcceptedGeneration | null;
  readonly lastCompilerEvent: HaxeWaitServerEvent | null;
}

/**
 * A lease around one read that may touch the public generated tree.
 *
 * Publication takes the write side of the same writer-priority gate. A host
 * adapter acquires this lease before serving a generated file and releases it
 * when that individual read completes, preventing mixed bytes during commit.
 */
export interface PublishedReadLease {
  readonly generation: number;
  /** Idempotent. */
  release(): void;
}

/**
 * A framework-neutral admitted-generation lifecycle.
 *
 * The session watches and builds one Genes project. It does not start a web
 * server, install process-wide signal handlers, choose a TypeScript policy, or
 * write user-facing diagnostics. The host supplies those responsibilities.
 */
export interface DevelopmentSession<Diagnostic extends JsonValue> {
  readonly state: DevelopmentState<Diagnostic>;

  /**
   * Resolves on this session's first admitted generation. Recoverable initial
   * failures leave it pending; closing or a fatal failure before admission
   * rejects it.
   */
  readonly firstAccepted: Promise<AcceptedGeneration>;

  /** Returns one synchronous snapshot suitable for humans or automation. */
  inspect(): DevelopmentSnapshot<Diagnostic>;

  /**
   * Recovers publication state, registers inputs, and requests revision 1.
   * The promise covers startup mechanics, not the first successful build.
   */
  start(): Promise<void>;

  /** Records an explicit host-owned input change without adding a watcher. */
  invalidate(change: ExternalChange): void;

  /** Forces the session's existing watcher to compare authoritative inputs. */
  reconcile(): ReconciliationResult;

  /** Resolves when no build, follow-up, validation, or publication is active. */
  waitForIdle(): Promise<void>;

  /**
   * Protects one generated-file read from overlapping publication.
   * Rejects before this session has admitted a generation or after it closes.
   */
  acquirePublishedRead(): Promise<PublishedReadLease>;

  /** Subscribes to future events; the returned unsubscribe is idempotent. */
  subscribe(
    listener: (event: DevelopmentEvent<Diagnostic>) => void,
  ): () => void;

  /** Bounded and idempotent; never stops a process the session does not own. */
  close(): Promise<void>;
}

/** One file presented to a host validator at its eventual logical location. */
export interface CandidateFile {
  /** Project-relative path after publication. */
  readonly logicalPath: string;

  /** Absolute path in the private candidate tree. */
  readonly physicalPath: string;

  readonly digest: string;
}

/**
 * One exact file created before Haxe typing starts.
 *
 * The session copies these bytes into a private revision directory. A file may
 * also name a project-relative `publishPath`; that copy becomes public only
 * when the same revision's Genes output passes validation and publication.
 */
export interface PreparedRevisionFile {
  /** Portable path below this revision's private candidate directory. */
  readonly relativePath: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly publishPath?: string;
}

/** Private Haxe inputs and optional public files prepared for one revision. */
export interface PreparedRevision {
  /** Portable directories below the private candidate directory. */
  readonly classPaths: readonly string[];
  readonly files: readonly PreparedRevisionFile[];
}

/** A typed host result for pre-typing input preparation. */
export type PreparationResult<Diagnostic extends JsonValue> =
  | { readonly ok: true; readonly prepared: PreparedRevision }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * One file produced by successful host validation.
 *
 * A host can use this for a loader-agreement receipt or another small piece of
 * evidence that only exists after validation. The file is published in the
 * same transaction as the candidate it describes.
 */
export interface AdmittedArtifact {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
}

/** A complete tree checked before it is allowed to replace public output. */
export interface ValidationTree {
  readonly kind: "candidate" | "recovered-live";
  readonly revision: number | null;
  readonly logicalOutputRoot: string;
  readonly physicalRoot: string;
  readonly entryLogicalPath: string;
  readonly manifestDigest: string;
  readonly files: readonly CandidateFile[];
  /** Host-prepared or validator-produced files outside the Genes manifest. */
  readonly extraFiles: readonly CandidateFile[];
}

/** The host's typed admission decision for one complete candidate tree. */
export type AdmissionResult<Diagnostic extends JsonValue> =
  | { readonly ok: true; readonly artifacts?: readonly AdmittedArtifact[] }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** Exact Haxe command and compatibility evidence resolved by the host. */
export interface HaxeInvocation {
  readonly executable: string;
  readonly cwd: string;

  /**
   * Structured arguments only. A conforming session accepts only the exact
   * ordered top-level HXML files here. Build flags belong inside the HXML,
   * where the session can inspect them before Haxe runs.
   */
  readonly args: readonly string[];

  /** Reviewed compiler target/output capability matrix selected by the host. */
  readonly ioPolicy: "haxe-4.3.7-development-js-v1";

  /**
   * Optional overrides for the current Node process environment. The session
   * copies the complete effective environment once per revision, includes it
   * in the compiler-server identity, and uses those same bytes for Haxe.
   */
  readonly env?: Readonly<Record<string, string>>;

  /** Canonical JSON facts used to decide whether a Haxe server is reusable. */
  readonly compatibilityFacts: JsonValue;
}

/** What an explicit host-owned change invalidates. */
export interface ChangeImpact {
  /**
   * Set this to `false` only when the changed file cannot affect generated
   * output or validation. The session still reports the change, but it does
   * not discard an otherwise valid build that is already in progress.
   */
  readonly rebuild?: boolean;
  readonly reinventory?: boolean;
  readonly restartCompiler?: boolean;
  readonly revalidate?: boolean;
}

/** A host-owned input invalidation delivered to an existing session. */
export interface ExternalChange {
  readonly path: string;
  readonly impact: ChangeImpact;
}

/** An explicit extra input observed by the session within an allowed root. */
export interface ObservedExtraInput extends ExternalChange {}

/** Host policy and project identity supplied to a DevelopmentSession. */
export interface GenesDevelopmentOptions<Diagnostic extends JsonValue> {
  readonly projectRoot: string;
  readonly projectIdentity: string;
  /**
   * HXML resolver, containment, and budget policy. Entry files, working
   * directory, and environment come only from the immutable Haxe invocation.
   */
  readonly hxml: Omit<
    HxmlInventoryOptions,
    "entryFiles" | "workingDirectory" | "environment" | "signal"
  >;

  /** Explicit public entry owned by this session; never inferred from output. */
  readonly publicOutputFile: string;

  /** Private candidates and compiler leases live here; publication recovery is output-scoped. */
  readonly stateDirectory: string;

  readonly extraInputs?: readonly ObservedExtraInput[];

  /**
   * Creates exact private inputs before Haxe types this revision.
   *
   * The callback returns bytes rather than writing into session directories.
   * Tooling validates their paths, computes their identity, writes a private
   * copy, and adds only the declared class paths to this Haxe request.
   */
  readonly prepareRevision?: (context: {
    readonly revision: number;
    readonly signal: AbortSignal;
  }) =>
    | PreparationResult<Diagnostic>
    | Promise<PreparationResult<Diagnostic>>;

  resolveInvocation(context: {
    readonly signal: AbortSignal;
  }): HaxeInvocation | Promise<HaxeInvocation>;

  /**
   * Runs against a complete candidate before public mutation. Recovery uses
   * the same policy against a complete intended live tree. The validator must
   * stop promptly when `signal` aborts so session shutdown stays bounded.
   */
  validate(
    tree: ValidationTree,
    context: {
      readonly signal: AbortSignal;
      readonly recovery: boolean;
    },
  ): Promise<AdmissionResult<Diagnostic>>;

  /** Canonical JSON that invalidates an earlier admission when it changes. */
  readonly validatorPolicyFacts: JsonValue;

  readonly debounceMs?: number;
  readonly pollIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
