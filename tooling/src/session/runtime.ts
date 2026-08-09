import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalDigest,
  publishArtifacts,
  recoverArtifacts,
  type CanonicalJson,
  type PublicationPlan,
  type PublicationOutcome,
  type RecoveryOutcome,
  type ExpectedFileState,
} from "../artifacts/index.js";
import { sameFileState } from "../artifacts/filesystem.js";
import { inventoryHxml, type HxmlInventory } from "../hxml/index.js";
import { SerializedDirtyLoop } from "../loop/index.js";
import {
  watchReconciledInputs,
  type ReconciledWatchOptions,
  type ReconciledWatchSession,
  type WatchInput,
} from "../watch/index.js";
import type { HaxeWaitServerEvent } from "../haxe-server/index.js";
import {
  HaxeSessionCompiler,
  snapshotHaxeInvocation,
  type SessionCompiler,
} from "./haxe-driver.js";
import {
  bindHaxeInvocation,
  buildEffectiveHaxeInvocationPlan,
  type EffectiveHaxeInvocationPlan,
} from "./effective-invocation.js";
import {
  assertCandidateContainsOnlyOwnedFiles,
  readGenesOutput,
  validationFiles,
  type GenesOutputInventory,
} from "./genes-output.js";
import {
  logicalOutputPath,
  portableProjectPathsOverlap,
  resolveSessionLayout,
  type SessionLayout,
} from "./layout.js";
import {
  admissionDigest,
  preparePublication,
  readPublishedMarker,
  sessionProjectDigest,
} from "./publication.js";
import { PublicationGate } from "./read-write-gate.js";
import { acquireSessionLock, type SessionLock } from "./session-lock.js";
import {
  DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  DEVELOPMENT_SESSION_EVENT_VERSION,
  type AcceptedGeneration,
  type DevelopmentEvent,
  type DevelopmentEventBody,
  type DevelopmentSession,
  type DevelopmentSessionDiagnostic,
  type DevelopmentSnapshot,
  type DevelopmentState,
  type ExternalChange,
  type FailurePhase,
  type GenesDevelopmentOptions,
  type HaxeInvocation,
  type JsonValue,
  type SessionFailure,
  type ValidationTree,
} from "./types.js";

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const ABSENT_FILE_STATE: ExpectedFileState = Object.freeze({ kind: "absent" });
interface BuildCause {
  readonly revision: number;
  readonly paths: readonly string[];
  readonly reinventory: boolean;
  readonly restartCompiler: boolean;
  readonly rebuild: boolean;
}

interface SessionDependencies<Diagnostic extends JsonValue> {
  readonly now: () => number;
  readonly inventory: typeof inventoryHxml;
  readonly watch: <Cause>(
    options: ReconciledWatchOptions<Cause>,
  ) => ReconciledWatchSession;
  readonly createCompiler: (
    layout: SessionLayout,
    onEvent: (event: HaxeWaitServerEvent) => void,
    shutdownTimeoutMs: number,
  ) => SessionCompiler;
  readonly publish: (options: Parameters<typeof publishArtifacts>[0]) => Promise<PublicationOutcome>;
  readonly recover: (options: Parameters<typeof recoverArtifacts>[0]) => Promise<RecoveryOutcome>;
  readonly acquireLock: typeof acquireSessionLock;
  readonly nonce: () => string;
}

const REAL_DEPENDENCIES: SessionDependencies<JsonValue> = {
  now: () => Date.now(),
  inventory: inventoryHxml,
  watch: watchReconciledInputs,
  createCompiler: (layout, onEvent, shutdownTimeoutMs) =>
    new HaxeSessionCompiler(layout, onEvent, shutdownTimeoutMs),
  publish: publishArtifacts,
  recover: recoverArtifacts,
  acquireLock: acquireSessionLock,
  nonce: () => randomBytes(16).toString("hex"),
};

function diagnostic(
  code: string,
  message: string,
  details?: JsonValue,
): DevelopmentSessionDiagnostic {
  return Object.freeze({
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Replaces one private path whether a host reports `/` or `\\` separators. */
function replacePathSpellings(
  value: string,
  privatePath: string,
  replacement: string,
): string {
  const slash = privatePath.replaceAll("\\", "/");
  const backslash = privatePath.replaceAll("/", "\\");
  return [...new Set([privatePath, slash, backslash])]
    .sort((left, right) => right.length - left.length)
    .reduce(
      (current, spelling) => current.replaceAll(spelling, replacement),
      value,
    );
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function bytewise(values: Iterable<string>): string[] {
  return [...values].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function assertRealPath(root: string, candidate: string, label: string): void {
  const absolute = path.resolve(candidate);
  if (!containedBy(root, absolute)) {
    throw new Error(`${label} must be inside projectRoot`);
  }
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link: ${current}`);
    }
  }
}

function assertClassPathTreeIsReal(classPath: string): void {
  if (!existsSync(classPath)) return;
  const visit = (directory: string): void => {
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        throw new Error(
          `development-session class path contains a symbolic link: ${absolute}`,
        );
      }
      if (child.isDirectory()) visit(absolute);
    }
  };
  const stats = lstatSync(classPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `development-session class path must be a real directory: ${classPath}`,
    );
  }
  visit(classPath);
}

function mergeCause(left: BuildCause, right: BuildCause): BuildCause {
  return Object.freeze({
    revision: Math.max(left.revision, right.revision),
    paths: Object.freeze(bytewise(new Set([...left.paths, ...right.paths]))),
    reinventory: left.reinventory || right.reinventory,
    restartCompiler: left.restartCompiler || right.restartCompiler,
    rebuild: left.rebuild || right.rebuild,
  });
}

class DevelopmentSessionRuntime<Diagnostic extends JsonValue>
  implements DevelopmentSession<Diagnostic>
{
  readonly #options: GenesDevelopmentOptions<Diagnostic>;
  readonly #dependencies: SessionDependencies<Diagnostic>;
  readonly #layout: SessionLayout;
  readonly #gate = new PublicationGate();
  readonly #listeners = new Set<
    (event: DevelopmentEvent<Diagnostic>) => void
  >();
  readonly #sessionNonce: string;
  readonly #loop: SerializedDirtyLoop<BuildCause>;
  readonly #compiler: SessionCompiler;
  readonly #firstAcceptedPromise: Promise<AcceptedGeneration>;
  #resolveFirstAccepted!: (accepted: AcceptedGeneration) => void;
  #rejectFirstAccepted!: (error: Error) => void;
  #firstAcceptedSettled = false;
  #state: DevelopmentState<Diagnostic> = Object.freeze({ kind: "opening" });
  #lastSequence = 0;
  #lastCompilerEvent: DevelopmentSnapshot<Diagnostic>["lastCompilerEvent"] = null;
  #newestRevision = 0;
  #newestRebuildRevision = 0;
  #accepted: AcceptedGeneration | null = null;
  #inventory: HxmlInventory | null = null;
  #effectivePlan: EffectiveHaxeInvocationPlan | null = null;
  #watch: ReconciledWatchSession | null = null;
  #lock: SessionLock | null = null;
  #started = false;
  #startPromise: Promise<void> | null = null;
  #closing: Promise<void> | null = null;
  #activeAbort: AbortController | null = null;
  readonly #startupAbort = new AbortController();
  #startupReady = false;
  #compilerEpoch = 0;
  #publishedManifestDigest: string | null = null;
  #publishedMarkerState: ExpectedFileState = ABSENT_FILE_STATE;
  #mayCleanCandidates = false;
  #acceptWatchChanges = false;

  constructor(
    options: GenesDevelopmentOptions<Diagnostic>,
    dependencies: SessionDependencies<Diagnostic>,
  ) {
    this.#options = options;
    this.#dependencies = dependencies;
    this.#layout = resolveSessionLayout(
      options.projectRoot,
      options.projectIdentity,
      options.publicOutputFile,
      options.stateDirectory,
    );
    this.#sessionNonce = dependencies.nonce();
    const shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
      throw new Error("shutdownTimeoutMs must be a positive integer");
    }
    this.#compiler = dependencies.createCompiler(
      this.#layout,
      (event) => {
        this.#lastCompilerEvent = event;
        this.#emit({ kind: "compiler-lifecycle", event });
      },
      shutdownTimeoutMs,
    );
    this.#firstAcceptedPromise = new Promise((resolve, reject) => {
      this.#resolveFirstAccepted = resolve;
      this.#rejectFirstAccepted = reject;
    });
    // A host may attach after start. Keep Node from classifying the deliberate
    // fatal/close rejection as unhandled before that attachment.
    void this.#firstAcceptedPromise.catch(() => undefined);
    this.#loop = new SerializedDirtyLoop<BuildCause>({
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      merge: mergeCause,
      run: (cause) => this.#build(cause),
      onError: (error) => {
        if (this.#closing === null) {
          this.#fail(
            "publish",
            this.#newestRevision || null,
            true,
            diagnostic(
              "SESSION_LOOP_FAILED",
              this.#sanitizeCoreMessage(error.message),
            ),
          );
        }
      },
    });
  }

  get state(): DevelopmentState<Diagnostic> {
    return this.#state;
  }

  get firstAccepted(): Promise<AcceptedGeneration> {
    return this.#firstAcceptedPromise;
  }

  inspect(): DevelopmentSnapshot<Diagnostic> {
    return Object.freeze({
      state: this.#state,
      lastSequence: this.#lastSequence,
      newestRevision: this.#newestRevision,
      accepted: this.#accepted,
      lastCompilerEvent: this.#lastCompilerEvent,
    });
  }

  start(): Promise<void> {
    if (this.#closing !== null) return Promise.resolve();
    this.#startPromise ??= this.#start();
    return this.#startPromise;
  }

  async #start(): Promise<void> {
    this.#started = true;
    let startupPhase: FailurePhase = "recovery";
    try {
      this.#lock = this.#dependencies.acquireLock(this.#layout);
      await this.#recover();
      if (this.#closing !== null || this.#startupAbort.signal.aborted) return;
      const published = readPublishedMarker(this.#layout);
      this.#publishedManifestDigest = published.manifestDigest;
      this.#publishedMarkerState = published.state;
      this.#mayCleanCandidates = true;
      this.#cleanCandidates();
      startupPhase = "inventory";
      this.#effectivePlan = await this.#replanGapSafe(
        this.#startupAbort.signal,
      );
      this.#inventory = this.#effectivePlan.inventory;
      if (this.#closing !== null || this.#startupAbort.signal.aborted) return;
      if (this.#newestRevision !== 0) {
        throw new Error("initial revision was already assigned");
      }
      this.#newestRevision = 1;
      this.#newestRebuildRevision = 1;
      this.#startupReady = true;
      this.#acceptWatchChanges = true;
      this.#loop.request(
        Object.freeze({
          revision: 1,
          paths: Object.freeze([]),
          reinventory: false,
          restartCompiler: false,
          rebuild: true,
        }),
      );
    } catch (error) {
      const normalized = asError(error);
      if (this.#closing === null) {
        this.#fail(
          startupPhase,
          null,
          false,
          diagnostic(
            startupPhase === "inventory"
              ? "HXML_INVENTORY_FAILED"
              : "SESSION_RECOVERY_FAILED",
            this.#sanitizeCoreMessage(normalized.message),
          ),
        );
      }
      this.#lock?.release();
      this.#lock = null;
    }
  }

  invalidate(change: ExternalChange): void {
    if (this.#closing !== null) return;
    if (!this.#started) {
      throw new Error("development session has not started");
    }
    if (!this.#startupReady) {
      throw new Error("development session startup has not completed");
    }
    if (
      this.#state.kind === "blocked" &&
      !this.#state.failure.recoverable
    ) {
      throw new Error("development session cannot recover from its startup failure");
    }
    const absolute = path.resolve(this.#layout.projectRoot, change.path);
    if (!containedBy(this.#layout.projectRoot, absolute)) {
      throw new Error("external invalidation path escapes projectRoot");
    }
    this.#observe(absolute, {
      reinventory: change.impact.reinventory === true,
      restartCompiler: change.impact.restartCompiler === true,
      rebuild:
        change.impact.rebuild !== false ||
        change.impact.revalidate === true ||
        change.impact.reinventory === true ||
        change.impact.restartCompiler === true,
    });
  }

  reconcile(): ReturnType<ReconciledWatchSession["reconcile"]> {
    if (this.#watch === null) {
      return Object.freeze({
        ok: false,
        error: new Error("development session inputs are not registered"),
      });
    }
    return this.#watch.reconcile();
  }

  async waitForIdle(): Promise<void> {
    await this.#loop.waitForIdle();
  }

  async acquirePublishedRead(): Promise<{
    readonly generation: number;
    release(): void;
  }> {
    if (this.#accepted === null || this.#closing !== null) {
      throw new Error("no admitted generation is available to read");
    }
    const release = await this.#gate.acquireRead();
    const accepted = this.#accepted;
    if (accepted === null || this.#closing !== null) {
      release();
      throw new Error("no admitted generation is available to read");
    }
    return Object.freeze({ generation: accepted.generation, release });
  }

  subscribe(
    listener: (event: DevelopmentEvent<Diagnostic>) => void,
  ): () => void {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  close(): Promise<void> {
    if (this.#closing !== null) return this.#closing;
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    const closing = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    this.#closing = closing;
    this.#startupAbort.abort();
    void this.#close().then(resolveClose, rejectClose);
    return closing;
  }

  async #close(): Promise<void> {
    this.#setState(
      Object.freeze({ kind: "closing", retained: this.#accepted }),
    );
    this.#closeWatch();
    this.#activeAbort?.abort();
    this.#gate.close();
    if (this.#startPromise !== null) {
      await this.#startPromise;
      this.#closeWatch();
    }
    await this.#loop.close();
    try {
      await this.#compiler.close();
    } catch (error) {
      this.#emit({
        kind: "failed",
        failure: Object.freeze({
          phase: "shutdown",
          revision: this.#newestRevision || null,
          recoverable: false,
          diagnostic: diagnostic(
            "SESSION_SHUTDOWN_FAILED",
            this.#sanitizeCoreMessage(asError(error).message),
          ),
          retained: this.#accepted,
        }),
      });
    }
    this.#lock?.release();
    this.#lock = null;
    this.#cleanCandidates();
    if (!this.#firstAcceptedSettled) {
      this.#firstAcceptedSettled = true;
      this.#rejectFirstAccepted(
        new Error("development session closed before its first admission"),
      );
    }
    this.#setState(Object.freeze({ kind: "closed", retained: this.#accepted }));
    this.#emit({ kind: "closed" });
    this.#listeners.clear();
  }

  async #recover(): Promise<void> {
    await this.#dependencies.recover({
      projectRoot: this.#layout.projectRoot,
      transactionRoot: this.#layout.transactionRelative,
      projectIdentity: sessionProjectDigest(this.#layout),
      admitIntended: async (plan) => await this.#admitRecovered(plan),
    });
  }

  #closeWatch(): void {
    this.#watch?.close();
    this.#watch = null;
  }

  #requireReconciliation(): void {
    const result = this.reconcile();
    if (!result.ok) {
      throw new Error(
        `authoritative input reconciliation failed: ${result.error.message}`,
      );
    }
  }

  async #admitRecovered(plan: PublicationPlan): Promise<boolean> {
    const live = readGenesOutput(
      this.#layout.publicOutputRoot,
      this.#layout.outputIdentity,
      true,
    )!;
    if (
      plan.authorizationDigest !==
      admissionDigest(
        this.#layout,
        live.manifestDigest,
        this.#options.validatorPolicyFacts,
      )
    ) {
      return false;
    }
    const tree = this.#validationTree("recovered-live", null, live);
    const abort = new AbortController();
    this.#activeAbort = abort;
    try {
      const result = await this.#options.validate(tree, {
        signal: abort.signal,
        recovery: true,
      });
      return result.ok;
    } finally {
      if (this.#activeAbort === abort) this.#activeAbort = null;
    }
  }

  #replaceWatch(inventory: HxmlInventory): void {
    const next = this.#dependencies.watch<{
      readonly reinventory: boolean;
      readonly restartCompiler: boolean;
      readonly rebuild: boolean;
    }>({
      inputs: this.#watchInputs(inventory),
      merge: (left, right) => ({
        reinventory: left.reinventory || right.reinventory,
        restartCompiler: left.restartCompiler || right.restartCompiler,
        rebuild: left.rebuild || right.rebuild,
      }),
      onChange: (change) => {
        if (this.#acceptWatchChanges) {
          this.#observe(change.path, change.cause);
        }
      },
      onError: (error) => {
        if (this.#closing === null) {
          this.#fail(
            "watch",
            this.#newestRevision || null,
            true,
            diagnostic(
              "INPUT_WATCH_FAILED",
              this.#sanitizeCoreMessage(error.message),
            ),
          );
        }
      },
      pollIntervalMs: this.#options.pollIntervalMs,
    });
    const previous = this.#watch;
    this.#watch = next;
    previous?.close();
  }

  #watchInputs(
    inventory: HxmlInventory,
  ): readonly WatchInput<{
    readonly reinventory: boolean;
    readonly restartCompiler: boolean;
    readonly rebuild: boolean;
  }>[] {
    const inputs: WatchInput<{
      readonly reinventory: boolean;
      readonly restartCompiler: boolean;
      readonly rebuild: boolean;
    }>[] = [];
    for (const hxml of inventory.hxmlFiles) {
      inputs.push({
        kind: "exact",
        path: hxml,
        cause: { reinventory: true, restartCompiler: true, rebuild: true },
      });
    }
    for (const provenance of inventory.libraryProvenanceFiles) {
      inputs.push({
        kind: "exact",
        path: provenance,
        cause: { reinventory: true, restartCompiler: true, rebuild: true },
      });
    }
    for (const classPath of inventory.classPaths) {
      inputs.push({
        kind: "tree",
        path: classPath,
        include: (relative) => relative.endsWith(".hx"),
        rejectSymlinks: true,
        cause: { reinventory: false, restartCompiler: false, rebuild: true },
      });
    }
    for (const resource of inventory.resourceInputs) {
      inputs.push({
        kind: "exact",
        path: resource,
        cause: { reinventory: false, restartCompiler: false, rebuild: true },
      });
    }
    for (const extra of this.#options.extraInputs ?? []) {
      const absolute = path.resolve(this.#layout.projectRoot, extra.path);
      inputs.push({
        kind: "exact",
        path: absolute,
        cause: {
          reinventory: extra.impact.reinventory === true,
          restartCompiler: extra.impact.restartCompiler === true,
          rebuild:
            extra.impact.rebuild !== false ||
            extra.impact.revalidate === true ||
            extra.impact.reinventory === true ||
            extra.impact.restartCompiler === true,
        },
      });
    }
    return Object.freeze(inputs);
  }

  #observe(
    absolutePath: string,
    impact: {
      readonly reinventory: boolean;
      readonly restartCompiler: boolean;
      readonly rebuild: boolean;
    },
  ): void {
    if (this.#closing !== null) return;
    if (!containedBy(this.#layout.projectRoot, absolutePath)) {
      this.#fail(
        "watch",
        this.#newestRevision || null,
        false,
        diagnostic(
          "WATCH_PATH_ESCAPED_PROJECT",
          "watch input escaped projectRoot",
        ),
      );
      return;
    }
    this.#newestRevision += 1;
    if (impact.rebuild) {
      this.#newestRebuildRevision = this.#newestRevision;
    }
    const relative = path
      .relative(this.#layout.projectRoot, absolutePath)
      .split(path.sep)
      .join("/");
    this.#emit({
      kind: "inputs-changed",
      revision: this.#newestRevision,
      paths: Object.freeze([relative]),
    });
    if (this.#closing !== null) return;
    this.#loop.request(
      Object.freeze({
        revision: this.#newestRevision,
        paths: Object.freeze([relative]),
        ...impact,
      }),
    );
  }

  async #build(cause: BuildCause): Promise<void> {
    if (this.#closing !== null || !cause.rebuild) return;
    const abort = new AbortController();
    this.#activeAbort = abort;
    let candidateStageRelative: string | null = null;
    let failurePhase: FailurePhase = cause.reinventory
      ? "inventory"
      : "compile";
    try {
      this.#setState(
        Object.freeze({
          kind: "building",
          revision: cause.revision,
          retained: this.#accepted,
        }),
      );
      if (this.#closing !== null || abort.signal.aborted) return;
      this.#emit({ kind: "build-started", revision: cause.revision });
      if (this.#closing !== null || abort.signal.aborted) return;
      if (cause.reinventory) {
        this.#effectivePlan = await this.#replanGapSafe(abort.signal);
        this.#inventory = this.#effectivePlan.inventory;
        if (this.#closing !== null || abort.signal.aborted) return;
        failurePhase = "compile";
      }
      if (cause.restartCompiler) this.#compilerEpoch += 1;
      const retainedPlan = this.#effectivePlan;
      if (retainedPlan === null) {
        throw new Error("effective Haxe invocation is unavailable");
      }
      const executionPlan = await this.#resolveEffectivePlan(abort.signal);
      if (this.#closing !== null || abort.signal.aborted) return;
      if (retainedPlan.identity !== executionPlan.identity) {
        this.#observe(executionPlan.inventory.entryHxmlFiles[0]!, {
          reinventory: true,
          restartCompiler: true,
          rebuild: true,
        });
        this.#emit({
          kind: "candidate-superseded",
          revision: cause.revision,
          newestRevision: this.#newestRevision,
        });
        return;
      }
      const compatibilityDigest = this.#compatibilityDigest(executionPlan);
      candidateStageRelative = `${this.#layout.candidatesRelative}/revision-${cause.revision}-${this.#dependencies.nonce()}`;
      const candidateStageRoot = path.join(
        this.#layout.projectRoot,
        ...candidateStageRelative.split("/"),
      );
      const outputRoot = path.join(
        candidateStageRoot,
        "output",
      );
      const candidateOutputFile = path.join(outputRoot, this.#layout.outputIdentity);
      mkdirSync(path.join(candidateStageRoot, "haxe-target"), {
        recursive: true,
        mode: 0o700,
      });
      const boundInvocation = bindHaxeInvocation(
        executionPlan,
        candidateStageRoot,
        candidateOutputFile,
      );
      const compiler = await this.#compiler.compile(
        boundInvocation,
        compatibilityDigest,
        abort.signal,
        async () => {
          const finalPlan = await this.#resolveEffectivePlan(abort.signal);
          if (executionPlan.identity !== finalPlan.identity) {
            this.#observe(finalPlan.inventory.entryHxmlFiles[0]!, {
              reinventory: true,
              restartCompiler: true,
              rebuild: true,
            });
            throw new Error(
              "HXML input changed after invocation validation and before execution",
            );
          }
        },
      );
      if (this.#closing !== null || abort.signal.aborted) return;
      const candidate = readGenesOutput(
        outputRoot,
        this.#layout.outputIdentity,
        true,
      )!;
      assertCandidateContainsOnlyOwnedFiles(candidate);
      this.#emit({
        kind: "candidate-generated",
        revision: cause.revision,
        manifestDigest: candidate.manifestDigest,
      });
      if (this.#closing !== null || abort.signal.aborted) return;
      failurePhase = "validate";
      const admission = await this.#options.validate(
        this.#validationTree("candidate", cause.revision, candidate),
        { signal: abort.signal, recovery: false },
      );
      if (this.#closing !== null || abort.signal.aborted) return;
      if (!admission.ok) {
        this.#fail(
          "validate",
          cause.revision,
          true,
          diagnostic(
            "VALIDATION_REJECTED",
            "The host validator rejected the private candidate",
            this.#sanitizePublicJson(admission.diagnostic),
          ),
        );
        return;
      }
      this.#requireReconciliation();
      if (cause.revision < this.#newestRebuildRevision) {
        this.#emit({
          kind: "candidate-superseded",
          revision: cause.revision,
          newestRevision: this.#newestRevision,
        });
        return;
      }

      failurePhase = "publish";
      await this.#gate.runWrite(async () => {
        if (this.#closing !== null || abort.signal.aborted) return;
        this.#requireReconciliation();
        if (cause.revision < this.#newestRebuildRevision) {
          this.#emit({
            kind: "candidate-superseded",
            revision: cause.revision,
            newestRevision: this.#newestRevision,
          });
          return;
        }
        const prior = readGenesOutput(
          this.#layout.publicOutputRoot,
          this.#layout.outputIdentity,
          false,
        );
        const recordedMarker = readPublishedMarker(this.#layout);
        if (
          recordedMarker.manifestDigest !== this.#publishedManifestDigest ||
          !sameFileState(recordedMarker.state, this.#publishedMarkerState)
        ) {
          throw new Error(
            "the accepted-generation marker changed outside this session",
          );
        }
        if (
          recordedMarker.manifestDigest !== null &&
          (prior === null ||
            prior.manifestDigest !== recordedMarker.manifestDigest)
        ) {
          throw new Error(
            "the public generated tree changed after its accepted generation",
          );
        }
        if (recordedMarker.manifestDigest === null && prior !== null) {
          throw new Error(
            "the public output contains an ownership manifest with no accepted generation",
          );
        }
        const generation = (this.#accepted?.generation ?? 0) + 1;
        const acceptedAt = this.#dependencies.now();
        const prepared = preparePublication(
          this.#layout,
          candidateStageRelative!,
          candidate,
          prior,
          cause.revision,
          generation,
          acceptedAt,
          compiler.mode,
          this.#options.validatorPolicyFacts,
          this.#sessionNonce,
          this.#publishedMarkerState,
        );
        const ticket = prepared.plan.authorizationDigest;
        await this.#dependencies.publish({
          projectRoot: this.#layout.projectRoot,
          plan: prepared.plan,
          admitIntended: (plan) => plan.authorizationDigest === ticket,
        });
        this.#accepted = prepared.accepted;
        this.#publishedManifestDigest = candidate.manifestDigest;
        this.#publishedMarkerState = prepared.plan.commitMarker.next;
        this.#setState(
          Object.freeze({ kind: "ready", accepted: prepared.accepted }),
          acceptedAt,
        );
        if (this.#closing !== null || abort.signal.aborted) return;
        this.#emit({ kind: "generation-accepted", accepted: prepared.accepted });
        if (this.#closing !== null || abort.signal.aborted) return;
        if (!this.#firstAcceptedSettled) {
          this.#firstAcceptedSettled = true;
          this.#resolveFirstAccepted(prepared.accepted);
        }
      }, abort.signal);
    } catch (error) {
      if (this.#closing !== null || abort.signal.aborted) return;
      if (cause.revision < this.#newestRebuildRevision) {
        this.#emit({
          kind: "candidate-superseded",
          revision: cause.revision,
          newestRevision: this.#newestRevision,
        });
        return;
      }
      const normalized = asError(error);
      this.#fail(
        failurePhase,
        cause.revision,
        true,
        diagnostic(
          failurePhase === "inventory"
            ? "HXML_INVENTORY_FAILED"
            : failurePhase === "validate"
              ? "HOST_VALIDATION_FAILED"
              : failurePhase === "publish"
                ? "PUBLICATION_FAILED"
                : "HAXE_COMPILE_FAILED",
          this.#sanitizeCoreMessage(normalized.message),
        ),
      );
    } finally {
      if (this.#activeAbort === abort) this.#activeAbort = null;
      if (candidateStageRelative !== null) {
        rmSync(
          path.join(
            this.#layout.projectRoot,
            ...candidateStageRelative.split("/"),
          ),
          { recursive: true, force: true },
        );
      }
    }
  }

  #validationTree(
    kind: ValidationTree["kind"],
    revision: number | null,
    inventory: GenesOutputInventory,
  ): ValidationTree {
    return Object.freeze({
      kind,
      revision,
      logicalOutputRoot: this.#layout.publicOutputRootRelative ?? ".",
      physicalRoot: inventory.root,
      entryLogicalPath: this.#layout.publicOutputRelative,
      manifestDigest: inventory.manifestDigest,
      files: validationFiles(this.#layout, inventory),
    });
  }

  #compatibilityDigest(plan: EffectiveHaxeInvocationPlan): string {
    return canonicalDigest({
      protocol: "genes.tooling.haxe-compatibility.v2",
      compilerEpoch: this.#compilerEpoch,
      effectiveInvocationIdentity: plan.identity,
    } as CanonicalJson);
  }

  async #resolveEffectivePlan(
    signal: AbortSignal,
  ): Promise<EffectiveHaxeInvocationPlan> {
    const invocation = snapshotHaxeInvocation(
      await this.#options.resolveInvocation({ signal }),
    );
    const plan = await buildEffectiveHaxeInvocationPlan(
      invocation,
      this.#options.hxml,
      signal,
      this.#dependencies.inventory,
    );
    this.#assertInventoryContained(plan.inventory);
    return plan;
  }

  async #replanGapSafe(
    signal: AbortSignal,
  ): Promise<EffectiveHaxeInvocationPlan> {
    let candidate = await this.#resolveEffectivePlan(signal);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.#closing !== null || signal.aborted) {
        throw new Error("development session startup was cancelled");
      }
      this.#replaceWatch(candidate.inventory);
      const confirmation = await this.#resolveEffectivePlan(signal);
      if (candidate.identity === confirmation.identity) {
        return candidate;
      }
      candidate = confirmation;
    }
    throw new Error(
      "HXML input identity kept changing while the watch graph was registered",
    );
  }

  #assertInventoryContained(inventory: HxmlInventory): void {
    if (!inventory.libraryClosureComplete) {
      throw new Error(
        "DevelopmentSession requires authoritative HXML resolution for every -lib request",
      );
    }
    for (const candidate of [
      ...inventory.hxmlFiles,
      ...inventory.libraryProvenanceFiles,
      ...inventory.classPaths,
      ...inventory.resourceInputs,
      ...(this.#options.extraInputs ?? []).map((extra) =>
        path.resolve(this.#layout.projectRoot, extra.path),
      ),
    ]) {
      if (!containedBy(this.#layout.projectRoot, candidate)) {
        throw new Error(
          `development-session input must be inside projectRoot: ${candidate}`,
        );
      }
      if (
        portableProjectPathsOverlap(
          this.#layout.projectRoot,
          candidate,
          this.#layout.stateRoot,
        ) ||
        portableProjectPathsOverlap(
          this.#layout.projectRoot,
          candidate,
          this.#layout.publicOutputRoot,
        ) ||
        portableProjectPathsOverlap(
          this.#layout.projectRoot,
          candidate,
          this.#layout.publicationControlRoot,
        )
      ) {
        throw new Error(
          `development-session input overlaps state, publication control, or generated output: ${candidate}`,
        );
      }
    }
    for (const classPath of inventory.classPaths) {
      assertClassPathTreeIsReal(classPath);
    }
  }

  #cleanCandidates(): void {
    if (!this.#mayCleanCandidates) return;
    const absolute = path.join(
      this.#layout.projectRoot,
      ...this.#layout.candidatesRelative.split("/"),
    );
    rmSync(absolute, { recursive: true, force: true });
  }

  #sanitizeCoreMessage(message: string): string {
    const candidateRoot = path.join(
      this.#layout.projectRoot,
      ...this.#layout.candidatesRelative.split("/"),
    );
    const withCandidateRoot = replacePathSpellings(
      message,
      candidateRoot,
      "<private-candidate-root>",
    );
    const withoutCandidateNonce = withCandidateRoot.replace(
      /<private-candidate-root>[\\/][^\\/\s:]+/gu,
      "<private-candidate>",
    );
    return replacePathSpellings(
      replacePathSpellings(
        withoutCandidateNonce,
        this.#layout.stateRoot,
        "<private-state>",
      ),
      this.#layout.projectRoot,
      "<project>",
    );
  }

  /** Removes session-private paths from every host-authored JSON string. */
  #sanitizePublicJson(value: JsonValue): JsonValue {
    if (typeof value === "string") return this.#sanitizeCoreMessage(value);
    if (value === null || typeof value !== "object") return value;
    if (isJsonArray(value)) {
      return Object.freeze(value.map((entry) => this.#sanitizePublicJson(entry)));
    }
    const sanitized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      sanitized[this.#sanitizeCoreMessage(key)] =
        this.#sanitizePublicJson(value[key]!);
    }
    return Object.freeze(sanitized);
  }

  #fail(
    phase: SessionFailure<Diagnostic>["phase"],
    revision: number | null,
    recoverable: boolean,
    failureDiagnostic: SessionFailure<Diagnostic>["diagnostic"],
  ): void {
    if (this.#closing !== null) return;
    const failure: SessionFailure<Diagnostic> = Object.freeze({
      phase,
      revision,
      recoverable,
      diagnostic: failureDiagnostic,
      retained: this.#accepted,
    });
    this.#setState(
      this.#accepted === null
        ? Object.freeze({ kind: "blocked", failure })
        : Object.freeze({ kind: "degraded", accepted: this.#accepted, failure }),
    );
    if (this.#closing !== null) return;
    this.#emit({ kind: "failed", failure });
    if (!recoverable && !this.#firstAcceptedSettled) {
      this.#firstAcceptedSettled = true;
      this.#rejectFirstAccepted(new Error(`${phase}: fatal session failure`));
    }
  }

  #setState(state: DevelopmentState<Diagnostic>, at?: number): void {
    this.#state = state;
    this.#emit({ kind: "state", state }, at);
  }

  #emit(event: DevelopmentEventBody<Diagnostic>, at?: number): void {
    const record: DevelopmentEvent<Diagnostic> = Object.freeze({
      protocol: DEVELOPMENT_SESSION_EVENT_PROTOCOL,
      version: DEVELOPMENT_SESSION_EVENT_VERSION,
      sequence: ++this.#lastSequence,
      at: at ?? this.#dependencies.now(),
      event,
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(record);
      } catch {
        // Observers cannot change lifecycle ownership or publication.
      }
    }
  }
}

/** Creates one framework-neutral admitted-generation session. */
export function createGenesDevelopmentSession<Diagnostic extends JsonValue>(
  options: GenesDevelopmentOptions<Diagnostic>,
): DevelopmentSession<Diagnostic> {
  return new DevelopmentSessionRuntime(
    options,
    REAL_DEPENDENCIES as SessionDependencies<Diagnostic>,
  );
}

/** @internal Exact dependency seam used only by conformance fixtures. */
export function createGenesDevelopmentSessionWithDependencies<
  Diagnostic extends JsonValue,
>(
  options: GenesDevelopmentOptions<Diagnostic>,
  dependencies: SessionDependencies<Diagnostic>,
): DevelopmentSession<Diagnostic> {
  return new DevelopmentSessionRuntime(options, dependencies);
}

export type { SessionDependencies };
