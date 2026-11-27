import type { HaxeWaitServerEvent } from "../haxe-server/types.js";
import type { HxmlInventoryOptions } from "../hxml/types.js";
import type { ReconciliationResult } from "../watch/types.js";
import type { ProcessCounterDelta } from "./process-counters.js";

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
  /** `external` means Genes checked and reused an earlier generated tree. */
  readonly compilerMode: "connected" | "direct" | "external";
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

/**
 * A build whose candidate the Genes rolling replay audit found stale (see
 * `GenerationReuseOptions`). After Genes wrote the private candidate, it
 * printed some of the modules that it had replayed once more, and the new
 * print of `modules` differs from the replayed output. The session did not
 * validate or publish that candidate: it builds the same revision again at
 * once, on the same server, and Genes, which dropped its generation cache,
 * prints every module in that build.
 *
 * `code: "AUDIT_REPEATED"`: a module of this event was also in the previous
 * replay-audit event, with no clean audit of it in between. The session then
 * turns generation reuse off for the rest of its life (later builds print
 * every module), so that a defect that stays cannot make every build run
 * twice.
 */
export interface ReplayAuditCheck {
  readonly check: "replay-audit";
  /** The input revision of the discarded candidate (and of the rebuild). */
  readonly revision: number;
  readonly result: "differs";
  /** The Haxe modules whose new print differs, sorted, at most 50. */
  readonly modules: readonly string[];
  readonly code?: "AUDIT_REPEATED";
}

/**
 * The result of one cold build (see `GenerationReuseOptions`): after
 * `generation` was accepted and the session stayed idle, the session built
 * its revision in a new Haxe process with no cache and compared that Genes
 * tree with the published one.
 *
 * - `equal`: the trees have the same bytes.
 * - `differs`: `paths` lists up to 50 project-relative paths whose bytes
 *   differ. With `code: "COLD_BUILD_FAILED"` the cold Haxe process failed
 *   although the warm build passed; `message` holds its output, private paths
 *   removed, at most 2,000 characters. Either way the session starts a new
 *   Haxe server and builds the revision again, then runs a cold build once
 *   more as soon as that build is accepted. With
 *   `code: "COLD_DIFFERS_AFTER_REPAIR"` the difference survived that rebuild
 *   with a new server: the session reports it and repairs no cold difference
 *   any more in this session.
 * - `cancelled`: an edit arrived (also one that only a reconciliation of the
 *   inputs found) or a newer generation was accepted; the check stays due.
 * - `failed`: the check could not compare: `PREPARED_FILES_CHANGED` (the host
 *   preparation gave other files for the same revision),
 *   `COLD_BUILD_UNSUPPORTED` (the compiler adapter has no cold build) or
 *   `COLD_CHECK_ERROR` (any other error of the check itself).
 */
export interface ColdBuildCheck {
  readonly check: "cold-build";
  readonly revision: number;
  readonly generation: number;
  readonly result: "equal" | "differs" | "cancelled" | "failed";
  readonly paths: readonly string[];
  readonly code?:
    | "COLD_BUILD_FAILED"
    | "COLD_DIFFERS_AFTER_REPAIR"
    | "PREPARED_FILES_CHANGED"
    | "COLD_BUILD_UNSUPPORTED"
    | "COLD_CHECK_ERROR";
  readonly message?: string;
}

/**
 * One check that the public tree equals the output that Genes gives without
 * reuse: a replay-audit difference or a cold-build result.
 */
export type OutputCheck = ReplayAuditCheck | ColdBuildCheck;

/**
 * One file of a module preview (`preview-generated`): its project-relative
 * public path (the path that the program request publishes it at, for
 * example `src-gen/ui/Button.ts`), the SHA-256 digest of its bytes, and its
 * size. The bytes stay in the memory of the session; a host reads them with
 * `DevelopmentSession.readPreviewFile`.
 */
export interface PreviewFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/**
 * The bytes of one file of a pending preview, as
 * `DevelopmentSession.readPreviewFile` returns them. `bytes` is a new copy.
 */
export interface PreviewFileContent {
  /** The input revision of the preview. */
  readonly revision: number;
  /** The Haxe module of the preview, for example `ui.Button`. */
  readonly module: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

/**
 * Why the session itself sent no module request, or published no preview,
 * for a build (`preview-refused` with `source: "session"`). Genes' own
 * refusal codes (`source: "genes"`, for example `public-shape-changed`) are
 * the codes of `genes.incremental.ModuleRequest`.
 *
 * - `not-module-edit`: a change of this build is not a content edit of a
 *   `.hx` module on a declared class path (a created or removed file, an
 *   HXML file, an extra input, a host invalidation).
 * - `several-modules`: more than one module changed in this build; a module
 *   request has one root.
 * - `module-path-unknown`: the edited file names no Haxe module (for
 *   example `import.hx`, or a file below two nested class paths).
 * - `previews-stopped`: an earlier preview of this module differed from the
 *   program result (`preview-corrected` with `cause: "differs"`).
 * - `reuse-off`: generation reuse is off for the rest of the session
 *   (`AUDIT_REPEATED`); a module request needs it.
 * - `server-unavailable`: no warm compiler server holds the records of the
 *   last program request (no program request on it yet, a new server, a
 *   broken pipe, builds without a server).
 * - `compile-failed`: Haxe reported an error for the module request, or
 *   the host's `prepareRevision` rejected its revision; the program request
 *   that follows reports the error of the program.
 * - `no-report`: Genes wrote no readable module report.
 */
export type SessionPreviewRefusalCode =
  | "not-module-edit"
  | "several-modules"
  | "module-path-unknown"
  | "previews-stopped"
  | "reuse-off"
  | "server-unavailable"
  | "compile-failed"
  | "no-report";

/**
 * The module-preview facts of `DevelopmentSnapshot`, present only with
 * `GenesDevelopmentOptions.modulePreview`.
 */
export interface ModulePreviewSnapshot {
  /**
   * Previews whose bytes differed from the accepted program result although
   * their sources did not move since (`preview-corrected` with
   * `cause: "differs"`; each one a Genes defect).
   */
  readonly differences: number;
  /** The modules that get no preview any more in this session, sorted. */
  readonly stoppedModules: readonly string[];
}

/** Framework-neutral facts emitted by one development session. */
export type DevelopmentEventBody<Diagnostic extends JsonValue> =
  | { readonly kind: "state"; readonly state: DevelopmentState<Diagnostic> }
  | {
      readonly kind: "inputs-changed";
      readonly revision: number;
      /**
       * Project-relative input paths, or private external-root names for
       * inputs in another declared HXML root. The root uses
       * `@external/<root-index>`. A child adds its path after that name.
       */
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
  | {
      /**
       * Emitted only with `GenesDevelopmentOptions.generationReuse`. A host
       * must ignore an event kind that it does not know.
       */
      readonly kind: "output-check";
      readonly outputCheck: OutputCheck;
    }
  | {
      /**
       * Emitted only with `GenesDevelopmentOptions.modulePreview`: a module
       * request published `files` for `module`, and Genes proved that the
       * program request prints the same bytes. The public tree has not
       * changed; the program request of this revision follows after the
       * quiet time and confirms or corrects the preview.
       */
      readonly kind: "preview-generated";
      readonly revision: number;
      readonly module: string;
      readonly files: readonly PreviewFile[];
    }
  | {
      /**
       * Emitted only with `modulePreview`: this build shows no preview, so
       * the edit is pending until the program request publishes it (a
       * `generation-accepted` event with a revision of at least `revision`,
       * or a `failed` event). `module` is null when the session found no
       * single edited module. See `SessionPreviewRefusalCode` for the
       * session's codes.
       */
      readonly kind: "preview-refused";
      readonly revision: number;
      readonly module: string | null;
      readonly source: "genes" | "session";
      readonly code: string;
    }
  | {
      /**
       * Emitted only with `GenesDevelopmentOptions.processCounters`, after a
       * program request (`request: "program"`, `module` null) or a module
       * request (`request: "module"`) that ran on the owned server: what the
       * request cost the server process. A host must ignore an event kind
       * that it does not know.
       */
      readonly kind: "request-measured";
      readonly revision: number;
      readonly request: "program" | "module";
      readonly module: string | null;
      readonly process: ProcessCounterDelta;
    }
  | {
      /**
       * Emitted only with `modulePreview`, after `generation-accepted`:
       * the accepted generation holds every file of the preview of
       * `revision` with the previewed bytes. `paths` lists them.
       */
      readonly kind: "preview-confirmed";
      readonly revision: number;
      readonly module: string;
      readonly generation: number;
      readonly paths: readonly string[];
    }
  | {
      /**
       * Emitted only with `modulePreview`, after `generation-accepted`:
       * the accepted generation has other bytes, or no file, at `paths`, so
       * a host that showed the preview must show the accepted files there.
       * `cause: "differs"`: the preview's sources did not move after
       * `revision` (each later change was proven by an admitted preview of
       * another module), so Genes previewed wrong bytes, or the accepted
       * generation also changed a Genes file that no settled preview named
       * (then `paths` lists that file too); the session counts it, keeps the
       * evidence and shows no further preview of `module`.
       * `cause: "newer-revision"`: a later edit changed the files: a change
       * of the module's own file, or a change that reached a build without a
       * preview (a refusal, a change that is no module edit, or a build that
       * a newer change cancelled).
       */
      readonly kind: "preview-corrected";
      readonly revision: number;
      readonly module: string;
      readonly generation: number;
      readonly paths: readonly string[];
      readonly cause: "differs" | "newer-revision";
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

  /** Present only with `GenesDevelopmentOptions.modulePreview`. */
  readonly modulePreview?: ModulePreviewSnapshot;
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

  /**
   * Records an explicit host-owned input change without adding a watcher.
   * The session cannot tell what kind of change it was, so the next build
   * restarts the owned Haxe server and types everything from an empty cache.
   */
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

  /**
   * Sends one read-only request (`CompilerServerQueryMethod`) to the owned
   * Haxe server and resolves with the server's JSON-RPC answer text, or with
   * null when no server runs (before the first build, in `direct` mode, or
   * after close).
   *
   * Why: the owned server takes requests only on a pipe that the session
   * holds, so a test or a host check cannot connect to it. Example: a gate
   * compares `server/contexts` after each build to prove that the session
   * keeps one cache. The request waits for a running build and counts as a
   * server request like any other.
   */
  queryCompilerServer(
    method: CompilerServerQueryMethod,
    signal?: AbortSignal,
  ): Promise<string | null>;

  /**
   * Returns a copy of the bytes of one file of a pending module preview,
   * by its project-relative public path (as `preview-generated` lists it),
   * or null when no pending preview has that file.
   *
   * A preview stays pending from its `preview-generated` event until the
   * `preview-confirmed` or `preview-corrected` event of an accepted
   * generation, or until a newer preview of the same module replaces it.
   * Example: a browser host calls it in its `preview-generated` listener
   * and serves the bytes from memory; the public tree does not change.
   */
  readPreviewFile(path: string): PreviewFileContent | null;

  /** Subscribes to future events; the returned unsubscribe is idempotent. */
  subscribe(
    listener: (event: DevelopmentEvent<Diagnostic>) => void,
  ): () => void;

  /** Bounded and idempotent; never stops a process the session does not own. */
  close(): Promise<void>;
}

/**
 * A compiler-server method that `DevelopmentSession.queryCompilerServer` may
 * send. `server/contexts` only reads the cache: it lists the caches by define
 * signature. A method that changes the cache, such as `server/invalidate`,
 * stays with the session, which must know about each change.
 * `server/memory` is left out on purpose: on Haxe 4.3.7 for macOS arm64 it
 * ends the server with SIGBUS.
 */
export type CompilerServerQueryMethod = "server/contexts";

/** One file presented to a host validator at its eventual logical location. */
export interface CandidateFile {
  /** Project-relative path after publication. */
  readonly logicalPath: string;

  /** Absolute path in the private candidate tree. */
  readonly physicalPath: string;

  readonly digest: string;
}

/** One required private data value that Haxe must produce for each revision. */
export interface CompilerDataDeclaration {
  /** Stable logical identity. This value is not a file path. */
  readonly id: string;

  /** Largest accepted value for this declaration. */
  readonly maxBytes: number;
}

/** One copy of compiler-created data with no filesystem path. */
export interface CompilerDataFile {
  /** Stable logical identity from the session declaration. */
  readonly id: string;

  /** Lowercase SHA-256 digest of the exact bytes. */
  readonly digest: string;

  /** Exact byte count of the captured value. */
  readonly sizeBytes: number;

  /** Returns a new copy while the current validation call is active. */
  readBytes(): Uint8Array;
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

/** One exact generated file named by an older host ownership record. */
export interface ExistingGenerationFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mode: number;
}

/**
 * Exact evidence for a generated tree that predates DevelopmentSession.
 *
 * The host derives this claim from its own trusted ownership record. Tooling
 * checks every live byte and then asks the normal validator to accept the
 * complete tree. It never infers ownership from a directory scan.
 */
export interface ExistingGenerationImport {
  /** Files inside the main Genes output, from the older host record. */
  readonly genesFiles: readonly ExistingGenerationFile[];

  /** Files outside the main Genes output, such as framework entry files. */
  readonly supplementalFiles: readonly ExistingGenerationFile[];
}

/**
 * Opts into reusing a validated public generation when a session starts.
 *
 * An empty object can reuse a generation already recorded by
 * DevelopmentSession. `import` is required only for the first handoff from an
 * older host publisher. `replace` explicitly admits a different complete tree
 * against an exact prior acceptance record.
 */
export interface ExistingGenerationPolicy {
  readonly import?: ExistingGenerationImport;
  /** Explicit replacement; mutually exclusive with a first-generation import. */
  readonly replace?: ExistingGenerationReplacement;
}

/**
 * Host-authorized handoff after another publisher installed a complete tree.
 * The digest binds the exact previous acceptance record, including its scope
 * and supplemental ownership. File claims alone cannot replace that authority.
 * An exact retry after uncertain completion revalidates and reuses the current
 * committed replacement. A later accepted generation invalidates that proof.
 */
export interface ExistingGenerationReplacement {
  readonly previousMarkerSha256: string;
  readonly files: ExistingGenerationImport;
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
  /** Required private data produced by Haxe for this candidate. */
  readonly compilerData: readonly CompilerDataFile[];
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
   * in the compiler-server identity, and uses those same bytes for Haxe. The
   * combined UTF-8 names and values must not exceed 64 KiB.
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
  /**
   * Set this to `true` when Haxe and its macros never read this input. The
   * session then keeps the owned Haxe server and its cache when the input
   * changes, instead of starting a new server with an empty cache.
   *
   * By default, a change to a watched path that is not a content edit of a
   * `.hx` module on a class path restarts the server: a macro may read any
   * file without telling Haxe, and a warm cache would keep the macro's old
   * result.
   *
   * "Read" includes everything a macro can do with the input: read its bytes,
   * check that it exists, list its folder, or start a tool that does any of
   * these. If a macro does read an input declared with `keepCache`, the next
   * builds keep that macro's old result, so the published output can differ
   * from a cold build until the session restarts. The session cannot detect
   * this; leave `keepCache` off when you are not sure.
   *
   * Use it for an input that reaches Haxe only through the files that
   * `prepareRevision` writes (for example a stylesheet that the host turns
   * into a Haxe companion; the digest of the prepared files already selects a
   * separate Haxe cache), or for an input that only a validator or another
   * tool reads.
   *
   * `keepCache` never covers a `.hx` file (Haxe always searches its working
   * directory as a class path, so a `.hx` file in any declared input can be a
   * module), anything that is not a regular file (a directory or a link), or
   * a path that a host invalidation names and that no longer exists. Those
   * changes still restart the server. It cannot be combined with
   * `restartCompiler`.
   */
  readonly keepCache?: boolean;
}

/** A host-owned input invalidation delivered to an existing session. */
export interface ExternalChange {
  readonly path: string;
  readonly impact: ChangeImpact;
}

/**
 * An explicit host-owned input observed within an allowed root.
 *
 * `exact` watches one file or path. `tree` watches every real descendant below
 * one directory, including empty folders and later additions or removals.
 * Trees reject symbolic links so a compiler or macro cannot read input that
 * the watcher missed.
 */
export interface ObservedExtraInput extends ExternalChange {
  readonly kind?: "exact" | "tree";
}

/**
 * Turns on Genes generation reuse (Stage 3) for the session's builds, with
 * the two checks that keep a reuse defect from staying unseen.
 *
 * What changes: each request asks Genes to reuse the facts of its passes
 * after typing and to replay the stored output of each module that its clean
 * rules call unchanged (`afterTyping: "reuse"`, `generation: "reuse"` in the
 * request descriptor), instead of printing it again. A warm build then skips
 * most of Genes' per-module work. Without this option the session asks for
 * neither, and every build prints every module.
 *
 * Why the checks: the clean rules are reasoned and tested, but reviews have
 * found holes in them. A hole publishes stale TypeScript for a module that
 * did change. Two checks run by default:
 *
 * - the rolling replay audit (`auditModules`): after Genes writes a private
 *   candidate, it prints a few of the replayed modules again into memory and
 *   compares the bytes. A difference makes Genes drop its generation cache
 *   and warn `GENES-INCREMENTAL-AUDIT-001`. The session does not publish that
 *   candidate: it reports an `output-check` event (`ReplayAuditCheck`) and
 *   builds the revision again at once, now in full. The audit runs inside
 *   the Haxe request, so its time is part of the time before publication.
 * - the cold build (`coldCheckEvery`, `coldCheckIdleMs`): after every Nth
 *   accepted generation, once the session has been idle for
 *   `coldCheckIdleMs`, the session builds the accepted revision in a new
 *   Haxe process with no cache, and compares that tree with the published
 *   one (`ColdBuildCheck`). An edit cancels it. A difference starts a new
 *   Haxe server and builds the revision again.
 *
 * What only the cold build sees: the audit prints a module with the facts of
 * this request, so it checks the bytes of one module against a print with
 * the same inputs. It cannot see a stale fact that the request itself used:
 * a stale member list, module set or runtime request list that the walk
 * with stored edges took from the cache, a stale fact of the passes after
 * typing, or a stale Haxe cache. Example: when a stored walk adds an enum
 * that an after-typing `exclude()` made extern, the module that owns the
 * enum prints it in the new print too. With `coldCheckEvery: 0` this class
 * of defect is not checked at all.
 *
 * Example: `generationReuse: {}` uses the defaults (audit 2 modules per
 * build; cold build every 20 accepted generations after 5 s idle);
 * `generationReuse: { coldCheckEvery: 0 }` keeps reuse and the audit but
 * runs no cold build.
 *
 * Limits: the cold build calls `prepareRevision` once more for the accepted
 * revision, and reports `PREPARED_FILES_CHANGED` instead of a comparison when
 * the prepared files differ. It compares only the Genes output tree, not
 * prepared or admitted extra files.
 */
export interface GenerationReuseOptions {
  /**
   * Replayed modules that Genes prints again after each build (the rolling
   * replay audit). A whole number from 0 to 1,000,000; 0 turns the audit
   * off. Default 2.
   */
  readonly auditModules?: number;

  /**
   * Accepted generations between two cold builds. A whole number, 0 or more;
   * 0 turns the cold build off. Default 20.
   */
  readonly coldCheckEvery?: number;

  /**
   * Milliseconds without a build or an edit before a due cold build starts,
   * so that it does not start after each accepted generation only to be
   * cancelled by the next edit. A whole number from 0 to 600,000. Default
   * 5,000. An edit in that time postpones the cold build to the next
   * accepted generation, without an event.
   */
  readonly coldCheckIdleMs?: number;
}

/**
 * Turns on the module-first path (G3): for each save of one Haxe module,
 * the session first sends a module request and shows its files as a
 * preview, then sends the program request, which stays the only writer of
 * the public tree.
 *
 * What happens for one save of `ui/Button.hx`:
 *
 * 1. After the start delay (`startDelayMs`), the session sends a module
 *    request to the warm compiler server: the program's arguments with the
 *    module as the only root (`--main`, class names and each
 *    `--macro include(...)` are removed), its own output folder, and a
 *    request descriptor with `"kind": "module"`. Genes prints only that
 *    module and publishes its files only when it can prove that a program
 *    request prints the same bytes.
 * 2. When Genes publishes them, the session reads them into memory, emits
 *    `preview-generated` and keeps them for `readPreviewFile`. Otherwise it
 *    emits `preview-refused` and sends the program request at once.
 * 3. After a preview, it waits until no save came for `quietMs`, then
 *    sends the program request. A save in that time cancels it: the next
 *    module request starts after the start delay instead.
 *    A save while the module request runs makes its result late: the session
 *    shows no preview for it and starts the build of the newer save.
 * 4. When the program request's candidate exists, the session compares
 *    each preview file with the candidate's file. After the candidate is
 *    accepted it emits `preview-confirmed` or `preview-corrected`. A
 *    difference of a preview whose sources did not move since is a Genes
 *    defect: the session counts it (`DevelopmentSnapshot.modulePreview`),
 *    keeps both files in `<stateDirectory>/preview-evidence/`, and shows no
 *    further preview of that module.
 *
 * Why the output stays correct: the public tree is written only by program
 * requests, with all their checks. A preview lives only in memory, and only
 * until an accepted generation settles it. When the program request after
 * a preview fails (for example a type error in an importer, which the
 * module request did not type), the session emits `failed` as for any
 * build, and the preview stays pending until the next accepted generation
 * confirms or corrects it. Until then a host that showed it runs code that
 * is not published; it shows the failure, and keeps or hides the preview
 * by its own rule.
 *
 * Needs `generationReuse`: a module request compares the edit with the
 * records that the program request keeps with generation reuse
 * (`"moduleRecords": true`). Without it the session constructor throws.
 *
 * With the option, while generation reuse is active and the newest revision
 * that needs a build is accepted, a save that leaves each changed `.hx`
 * file with the bytes of the last accepted build starts no build.
 *
 * Limits: one module per build (`several-modules`); no preview on a new
 * server or without a server; with `prepareRevision`, the session prepares
 * the revision once more for the module request, and Genes refuses when the
 * prepared files load as other modules (`other-modules-typed`). A
 * shape-changing edit is refused (`public-shape-changed`) and stays pending
 * until the program request.
 */
export interface ModulePreviewOptions {
  /**
   * Milliseconds without a save before the program request that follows a
   * preview. A whole number from 0 to 600,000. Default: `debounceMs`.
   */
  readonly quietMs?: number;
}

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
   * Complete list of private data values that Haxe must create for a revision.
   *
   * The session copies and validates this list when it is constructed. The
   * files stay private unless the host returns approved public artifacts.
   */
  readonly compilerData?: readonly CompilerDataDeclaration[];

  /**
   * Revalidates an existing complete tree before the first new compilation.
   * This lets a host keep its last accepted application running while a broken
   * first edit is repaired. The default remains a fresh session-owned build.
   */
  readonly existingGeneration?: ExistingGenerationPolicy;

  /**
   * Turns on Genes generation reuse with its two checks; absent (the
   * default) keeps every build a full generation. See
   * `GenerationReuseOptions`.
   */
  readonly generationReuse?: GenerationReuseOptions;

  /**
   * Turns on the module-first path: a module request and a preview before
   * each program request. Needs `generationReuse`. See
   * `ModulePreviewOptions`.
   */
  readonly modulePreview?: ModulePreviewOptions;

  /**
   * Creates exact private inputs before Haxe types this revision.
   *
   * The callback returns bytes rather than writing into session directories.
   * Tooling validates their paths, computes their identity, writes a private
   * copy, and adds only the declared class paths to this Haxe request.
   *
   * Cache cost: the digest of the prepared files is a define, and Haxe keeps
   * one set of caches per define set. Each new digest therefore types the
   * whole program again and adds about three Haxe caches to the owned server,
   * which are not freed until the server stops. A digest seen before reuses
   * its caches. On the small compiler-server fixture, six digests gave 20
   * caches and a server of 450 to 870 MB (two runs). genes-f8vc.23 tracks a
   * bound.
   */
  readonly prepareRevision?: (context: {
    readonly revision: number;
    readonly signal: AbortSignal;
  }) =>
    | PreparationResult<Diagnostic>
    | Promise<PreparationResult<Diagnostic>>;

  /**
   * Returns the Haxe invocation: executable, working directory, top-level
   * HXML files, environment overrides, and compatibility facts.
   *
   * The session calls it at startup and again only when a plan input
   * changes: an HXML or library provenance file, the process environment, or
   * an extra input with `reinventory` or `restartCompiler`. It is not called
   * for an ordinary source edit, because a call can be slow (Caffeine hashes
   * the compiler binary here). Declare every other file that this callback
   * reads, such as the compiler binary or `.haxerc`, as such an extra input,
   * or the session keeps using the older invocation.
   */
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

  /**
   * The quiet time in milliseconds before a build that follows a running
   * build: saves during a build start one follow-up build, after no save
   * came for this long. Default 100.
   */
  readonly debounceMs?: number;

  /**
   * The delay in milliseconds between the file event of a save after an
   * idle period and the start of its build. Default 10; a value above
   * `debounceMs` acts as `debounceMs`. A save in this delay restarts it, so
   * the writes of one save still give one build. If a build reads a file
   * while an editor still writes it, the build fails or shows that text,
   * and the event of the last write starts a follow-up build.
   */
  readonly startDelayMs?: number;

  /**
   * Requests that compile nothing, sent while the owned Haxe server is
   * idle, so that Haxe 4.3.7's periodic full collection (after every tenth
   * request) runs then and not between the requests of a build. Default
   * `{ delayMs: 250 }`: after 250 ms of idle time, and only when fewer than
   * four requests remain before the next tenth request. Haxe then collects
   * after every 7th build when each build sends one request (without idle
   * requests: every 10th), and after every 4th when each sends two
   * (without: every 5th). `false` sends none.
   */
  readonly compilerServerIdleCollection?: false | { readonly delayMs?: number };

  /**
   * True reads the counters of the owned Haxe server before and after each
   * program request and module request that runs on it
   * (`readProcessCounters`), and emits a `request-measured` event for each.
   * While generation reuse is active it also asks Genes for its request
   * measure (`"requestMeasure": true` in the request descriptor).
   * Retired instructions repeat within about 2% on a busy host, where wall
   * time varies by 160%, so a benchmark compares them, not milliseconds.
   * On macOS without `--experimental-ffi` each read starts a short helper
   * process (50 to 140 ms per read, before and after the request, outside
   * its counters); on a Node without `node:ffi` (Node 24) instructions are
   * unavailable and no helper starts. Default false: no reads.
   */
  readonly processCounters?: boolean;
  readonly pollIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
