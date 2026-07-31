import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  canonicalDigest,
  publishArtifacts,
  recoverArtifacts,
  type CanonicalJson,
  type PublicationPlan,
  type PublicationOutcome,
  type RecoveryOutcome,
} from "../artifacts/index.js";
import { inventoryHxml, type HxmlInventory } from "../hxml/index.js";
import { SerializedDirtyLoop } from "../loop/index.js";
import {
  watchReconciledInputs,
  type ReconciledWatchOptions,
  type ReconciledWatchSession,
  type WatchInput,
} from "../watch/index.js";
import type { HaxeWaitServerEvent } from "../haxe-server/index.js";
import { HaxeSessionCompiler, type SessionCompiler } from "./haxe-driver.js";
import {
  assertCandidateContainsOnlyOwnedFiles,
  readGenesOutput,
  validationFiles,
  type GenesOutputInventory,
} from "./genes-output.js";
import {
  logicalOutputPath,
  resolveSessionLayout,
  type SessionLayout,
} from "./layout.js";
import {
  admissionDigest,
  preparePublication,
  readPublishedManifestDigest,
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

function pathsOverlap(left: string, right: string): boolean {
  return containedBy(left, right) || containedBy(right, left);
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
  #accepted: AcceptedGeneration | null = null;
  #inventory: HxmlInventory | null = null;
  #watch: ReconciledWatchSession | null = null;
  #lock: SessionLock | null = null;
  #started = false;
  #startPromise: Promise<void> | null = null;
  #closing: Promise<void> | null = null;
  #activeAbort: AbortController | null = null;
  #compilerEpoch = 0;
  #publishedManifestDigest: string | null = null;
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
            diagnostic("SESSION_LOOP_FAILED", error.message),
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
      if (this.#closing !== null) return;
      this.#publishedManifestDigest = readPublishedManifestDigest(this.#layout);
      this.#mayCleanCandidates = true;
      this.#cleanCandidates();
      startupPhase = "inventory";
      this.#inventory = await this.#reinventoryGapSafe();
      if (this.#closing !== null) return;
      this.#acceptWatchChanges = true;
      this.#newestRevision = 1;
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
            normalized.message,
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

  reconcile(): void {
    this.#watch?.reconcile();
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
    this.#closing = this.#close();
    return this.#closing;
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
          diagnostic: diagnostic("SESSION_SHUTDOWN_FAILED", asError(error).message),
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
            diagnostic("INPUT_WATCH_FAILED", error.message),
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
    for (const classPath of inventory.classPaths) {
      inputs.push({
        kind: "tree",
        path: classPath,
        include: (relative) => relative.endsWith(".hx"),
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
        diagnostic("WATCH_PATH_ESCAPED_PROJECT", absolutePath),
      );
      return;
    }
    this.#newestRevision += 1;
    const relative = path
      .relative(this.#layout.projectRoot, absolutePath)
      .split(path.sep)
      .join("/");
    this.#emit({
      kind: "inputs-changed",
      revision: this.#newestRevision,
      paths: Object.freeze([relative]),
    });
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
    this.#setState(
      Object.freeze({
        kind: "building",
        revision: cause.revision,
        retained: this.#accepted,
      }),
    );
    this.#emit({ kind: "build-started", revision: cause.revision });
    const abort = new AbortController();
    this.#activeAbort = abort;
    let candidateStageRelative: string | null = null;
    let failurePhase: FailurePhase = cause.reinventory
      ? "inventory"
      : "compile";
    try {
      if (cause.reinventory) {
        this.#inventory = await this.#reinventoryGapSafe();
      }
      if (cause.restartCompiler) this.#compilerEpoch += 1;
      const inventory = this.#inventory;
      if (inventory === null) throw new Error("HXML inventory is unavailable");
      const invocation = await this.#options.resolveInvocation({
        signal: abort.signal,
      });
      const compatibilityDigest = this.#compatibilityDigest(invocation, inventory);
      candidateStageRelative = `${this.#layout.candidatesRelative}/revision-${cause.revision}-${this.#dependencies.nonce()}`;
      const outputRoot = path.join(
        this.#layout.projectRoot,
        ...candidateStageRelative.split("/"),
        "output",
      );
      const candidateOutputFile = path.join(outputRoot, this.#layout.outputIdentity);
      const compiler = await this.#compiler.compile(
        invocation,
        compatibilityDigest,
        candidateOutputFile,
        abort.signal,
      );
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
      failurePhase = "validate";
      const admission = await this.#options.validate(
        this.#validationTree("candidate", cause.revision, candidate),
        { signal: abort.signal, recovery: false },
      );
      if (!admission.ok) {
        this.#fail("validate", cause.revision, true, admission.diagnostic);
        return;
      }
      this.#watch?.reconcile();
      if (cause.revision !== this.#newestRevision) {
        this.#emit({
          kind: "candidate-superseded",
          revision: cause.revision,
          newestRevision: this.#newestRevision,
        });
        return;
      }

      failurePhase = "publish";
      await this.#gate.runWrite(async () => {
        this.#watch?.reconcile();
        if (cause.revision !== this.#newestRevision) {
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
        const recordedManifestDigest = readPublishedManifestDigest(this.#layout);
        if (recordedManifestDigest !== this.#publishedManifestDigest) {
          throw new Error(
            "the accepted-generation marker changed outside this session",
          );
        }
        if (
          recordedManifestDigest !== null &&
          (prior === null || prior.manifestDigest !== recordedManifestDigest)
        ) {
          throw new Error(
            "the public generated tree changed after its accepted generation",
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
        );
        const ticket = prepared.plan.authorizationDigest;
        await this.#dependencies.publish({
          projectRoot: this.#layout.projectRoot,
          plan: prepared.plan,
          admitIntended: (plan) => plan.authorizationDigest === ticket,
        });
        this.#accepted = prepared.accepted;
        this.#publishedManifestDigest = candidate.manifestDigest;
        this.#setState(
          Object.freeze({ kind: "ready", accepted: prepared.accepted }),
          acceptedAt,
        );
        this.#emit({ kind: "generation-accepted", accepted: prepared.accepted });
        if (!this.#firstAcceptedSettled) {
          this.#firstAcceptedSettled = true;
          this.#resolveFirstAccepted(prepared.accepted);
        }
      }, abort.signal);
    } catch (error) {
      if (this.#closing !== null || abort.signal.aborted) return;
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
          normalized.message,
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

  #compatibilityDigest(
    invocation: HaxeInvocation,
    inventory: HxmlInventory,
  ): string {
    const hxml = inventory.hxmlFiles.map((file) => ({
      file: path.relative(this.#layout.projectRoot, file).split(path.sep).join("/"),
      digest: canonicalDigest(readFileSync(file, "utf8")),
    }));
    return canonicalDigest({
      protocol: "genes.tooling.haxe-compatibility.v1",
      compilerEpoch: this.#compilerEpoch,
      executable: invocation.executable,
      cwd: invocation.cwd,
      args: invocation.args,
      environment: invocation.env ?? {},
      compatibilityFacts: invocation.compatibilityFacts,
      hxml,
      classPaths: inventory.classPaths,
      resources: inventory.resourceInputs,
      libraries: inventory.libraries.map((library) => ({
        request: library.request,
        name: library.name,
        version: library.version,
        fromFile: library.fromFile,
      })),
    } as CanonicalJson);
  }

  async #reinventoryGapSafe(): Promise<HxmlInventory> {
    let candidate = await this.#dependencies.inventory(this.#options.hxml);
    this.#assertInventoryContained(candidate);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.#closing !== null) {
        throw new Error("development session startup was cancelled");
      }
      this.#replaceWatch(candidate);
      const confirmation = await this.#dependencies.inventory(this.#options.hxml);
      this.#assertInventoryContained(confirmation);
      if (
        this.#inventoryIdentity(candidate) ===
        this.#inventoryIdentity(confirmation)
      ) {
        return candidate;
      }
      candidate = confirmation;
    }
    throw new Error(
      "HXML input identity kept changing while the watch graph was registered",
    );
  }

  #inventoryIdentity(inventory: HxmlInventory): string {
    return canonicalDigest({
      hxml: inventory.hxmlFiles.map((file) => ({
        file,
        bytes: canonicalDigest(readFileSync(file, "utf8")),
      })),
      classPaths: inventory.classPaths,
      resourceInputs: inventory.resourceInputs,
      libraries: inventory.libraries.map((library) => ({
        request: library.request,
        name: library.name,
        version: library.version,
        fromFile: library.fromFile,
      })),
    } as CanonicalJson);
  }

  #assertInventoryContained(inventory: HxmlInventory): void {
    for (const candidate of [
      ...inventory.hxmlFiles,
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
        pathsOverlap(candidate, this.#layout.stateRoot) ||
        pathsOverlap(candidate, this.#layout.publicOutputRoot)
      ) {
        throw new Error(
          `development-session input overlaps state or generated output: ${candidate}`,
        );
      }
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
