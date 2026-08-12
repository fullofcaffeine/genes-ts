import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
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
import { inventoryHxmlForDevelopmentSession } from "../hxml/inventory.js";
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
  captureCompilerData,
  snapshotCompilerDataDeclarations,
  stageCompilerData,
} from "./compiler-data.js";
import {
  auditSessionAuthority,
  establishSessionAuthority,
} from "./authority-migration.js";
import {
  assertCandidateContainsOnlyOwnedFiles,
  readGenesOutput,
  validationFiles,
  type GenesOutputInventory,
} from "./genes-output.js";
import {
  logicalOutputPath,
  materializeSessionPrivateLayout,
  materializeSessionRuntimeLayout,
  portableProjectPathsOverlap,
  resolveSessionLayout,
  type SessionLayout,
} from "./layout.js";
import {
  assertImportMatchesPublished,
  checkExistingGenerationFiles,
  snapshotExistingGenerationPolicy,
} from "./existing-generation.js";
import {
  legacyAdmissionDigest,
  legacySessionProjectDigest,
  prepareExistingGenerationImport,
  preparePublication,
  readPublishedMarker,
  recoveredAdmissionMode,
  sessionProjectDigest,
  type AdmissionRecoveryMode,
  type PublishedSupplementalFile,
} from "./publication.js";
import {
  readLiveSupplementalFile,
  recoveredArtifactsMatchPublishedFiles,
  removePrivatePreparedFiles,
  stageAdmittedArtifacts,
  stagePreparedRevision,
  supplementalCandidateFiles,
  type StagedPreparedRevision,
  type SupplementalFile,
} from "./prepared-files.js";
import { PublicationGate } from "./read-write-gate.js";
import { acquireSessionLock, type SessionLock } from "./session-lock.js";
import {
  DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  DEVELOPMENT_SESSION_EVENT_VERSION,
  type AcceptedGeneration,
  type AdmissionResult,
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
  readonly establishAuthority: (
    layout: SessionLayout,
  ) => Promise<void>;
  readonly nonce: () => string;
}

const REAL_DEPENDENCIES: SessionDependencies<JsonValue> = {
  now: () => Date.now(),
  inventory: inventoryHxmlForDevelopmentSession,
  watch: watchReconciledInputs,
  createCompiler: (layout, onEvent, shutdownTimeoutMs) =>
    new HaxeSessionCompiler(layout, onEvent, shutdownTimeoutMs),
  publish: publishArtifacts,
  recover: recoverArtifacts,
  acquireLock: acquireSessionLock,
  establishAuthority: async (layout) =>
    await establishSessionAuthority(layout, {
      publish: publishArtifacts,
      recover: recoverArtifacts,
    }),
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

function supplementalIdentity(
  files: readonly PublishedSupplementalFile[],
): string {
  return canonicalDigest({
    files: files.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
  } as CanonicalJson);
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

function inputOverlapsProjectPath(
  projectRoot: string,
  input: string,
  projectPath: string,
): boolean {
  return containedBy(projectRoot, input)
    ? portableProjectPathsOverlap(projectRoot, input, projectPath)
    : pathsOverlap(input, projectPath);
}

function usesExternalLogicalNamespace(
  projectRoot: string,
  input: string,
): boolean {
  if (!containedBy(projectRoot, input)) return false;
  const relative = path.relative(projectRoot, input).split(path.sep).join("/");
  return relative === "@external" || relative.startsWith("@external/");
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
  readonly #compilerDataDeclarations: ReturnType<
    typeof snapshotCompilerDataDeclarations
  >;
  readonly #existingGeneration: ReturnType<
    typeof snapshotExistingGenerationPolicy
  >;
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
  #publishedSupplementalFiles: readonly PublishedSupplementalFile[] = Object.freeze([]);
  #mayCleanCandidates = false;
  #acceptWatchChanges = false;

  constructor(
    options: GenesDevelopmentOptions<Diagnostic>,
    dependencies: SessionDependencies<Diagnostic>,
  ) {
    this.#options = options;
    this.#compilerDataDeclarations = snapshotCompilerDataDeclarations(
      options.compilerData,
    );
    this.#existingGeneration = snapshotExistingGenerationPolicy(
      options.existingGeneration,
    );
    this.#dependencies = dependencies;
    this.#layout = resolveSessionLayout(
      options.projectRoot,
      options.projectIdentity,
      options.publicOutputFile,
      options.stateDirectory,
    );
    // The Haxe server validates its private lease parent in its constructor.
    // This creates no publication or migration authority; both public control
    // universes remain untouched until start() holds their lifetime locks.
    materializeSessionPrivateLayout(this.#layout);
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
      materializeSessionRuntimeLayout(this.#layout);
      // Read the current authored Haxe inputs before an older interrupted
      // update can restore or remove any generated file.
      startupPhase = "inventory";
      let recoveryPlan = await this.#resolveEffectivePlan(
        this.#startupAbort.signal,
      );
      startupPhase = "recovery";
      recoveryPlan = await this.#recover(recoveryPlan);
      if (this.#closing !== null || this.#startupAbort.signal.aborted) return;
      const published = readPublishedMarker(this.#layout);
      this.#publishedManifestDigest = published.manifestDigest;
      this.#publishedMarkerState = published.state;
      this.#publishedSupplementalFiles = published.supplementalFiles;
      this.#mayCleanCandidates = true;
      this.#cleanCandidates();
      startupPhase = "inventory";
      this.#effectivePlan = await this.#replanGapSafe(
        this.#startupAbort.signal,
        recoveryPlan,
      );
      this.#inventory = this.#effectivePlan.inventory;
      this.#assertSupplementalPaths(
        this.#inventory,
        this.#publishedSupplementalFiles.map((file) => file.path),
      );
      const existing = await this.#resumeExistingGeneration(published);
      if (this.#closing !== null || this.#startupAbort.signal.aborted) return;
      if (this.#newestRevision !== 0) {
        throw new Error("initial revision was already assigned");
      }
      const firstBuildRevision = (existing?.revision ?? 0) + 1;
      this.#newestRevision = firstBuildRevision;
      this.#newestRebuildRevision = firstBuildRevision;
      this.#startupReady = true;
      this.#acceptWatchChanges = true;
      this.#loop.request(
        Object.freeze({
          revision: firstBuildRevision,
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

  async #resumeExistingGeneration(
    published: ReturnType<typeof readPublishedMarker>,
  ): Promise<AcceptedGeneration | null> {
    if (this.#existingGeneration === null) return null;
    const live = readGenesOutput(
      this.#layout.publicOutputRoot,
      this.#layout.outputIdentity,
      false,
    );
    if (published.manifestDigest === null) {
      const imported = this.#existingGeneration.import;
      if (live === null) {
        if (imported === undefined) return null;
        throw new Error("existing generation import has no live Genes output");
      }
      if (imported === undefined) {
        throw new Error(
          "existing Genes output has no session marker; provide an exact import claim",
        );
      }
      const checked = checkExistingGenerationFiles(this.#layout, imported);
      const inventory = this.#inventory;
      if (inventory === null) {
        throw new Error("existing generation import has no HXML inventory");
      }
      this.#assertSupplementalPaths(
        inventory,
        checked.published.map((file) => file.path),
      );
      const admission = await this.#options.validate(
        this.#validationTree(
          "recovered-live",
          null,
          live,
          checked.candidates,
        ),
        { signal: this.#startupAbort.signal, recovery: true },
      );
      if (!admission.ok) {
        throw new Error("the host validator rejected the existing generation");
      }
      if (
        !recoveredArtifactsMatchPublishedFiles(
          admission.artifacts ?? [],
          checked.published,
          "v4",
        )
      ) {
        throw new Error(
          "the host validator did not reproduce the exact existing supplemental files",
        );
      }
      const stageRelativePath =
        `${this.#layout.candidatesRelative}/existing-${this.#dependencies.nonce()}`;
      try {
        const prepared = prepareExistingGenerationImport(
          this.#layout,
          stageRelativePath,
          live,
          checked.published,
          this.#dependencies.now(),
          this.#options.validatorPolicyFacts,
          this.#sessionNonce,
        );
        const ticket = prepared.plan.authorizationDigest;
        await this.#dependencies.publish({
          projectRoot: this.#layout.projectRoot,
          plan: prepared.plan,
          admitIntended: (plan) => plan.authorizationDigest === ticket,
        });
        const recorded = readPublishedMarker(this.#layout);
        this.#publishedManifestDigest = recorded.manifestDigest;
        this.#publishedMarkerState = recorded.state;
        this.#publishedSupplementalFiles = recorded.supplementalFiles;
        this.#acceptExisting(prepared.accepted);
        return prepared.accepted;
      } finally {
        rmSync(
          path.join(
            this.#layout.projectRoot,
            ...stageRelativePath.split("/"),
          ),
          { recursive: true, force: true },
        );
      }
    }

    if (live === null || live.manifestDigest !== published.manifestDigest) {
      throw new Error("the accepted existing Genes output changed");
    }
    if (published.accepted === null) {
      throw new Error("the accepted-generation marker has no generation facts");
    }
    assertImportMatchesPublished(
      this.#existingGeneration.import,
      published.supplementalFiles,
    );
    const extraFiles = published.supplementalFiles.map((file) =>
      readLiveSupplementalFile(this.#layout, file),
    );
    const admission = await this.#options.validate(
      this.#validationTree(
        "recovered-live",
        null,
        live,
        extraFiles,
      ),
      { signal: this.#startupAbort.signal, recovery: true },
    );
    if (!admission.ok) {
      throw new Error("the host validator rejected the accepted generation");
    }
    if (
      !recoveredArtifactsMatchPublishedFiles(
        admission.artifacts ?? [],
        published.supplementalFiles,
        published.format,
      )
    ) {
      throw new Error(
        "the host validator did not reproduce the accepted supplemental files",
      );
    }
    const accepted: AcceptedGeneration = Object.freeze({
      ...published.accepted,
      manifestDigest: published.manifestDigest,
      compilerMode: "external",
      files: Object.freeze({
        created: Object.freeze([]),
        updated: Object.freeze([]),
        deleted: Object.freeze([]),
      }),
      entryChanged: false,
    });
    this.#acceptExisting(accepted);
    return accepted;
  }

  #acceptExisting(accepted: AcceptedGeneration): void {
    this.#accepted = accepted;
    this.#setState(Object.freeze({ kind: "ready", accepted }), accepted.acceptedAt);
    this.#emit({ kind: "generation-accepted", accepted });
    if (!this.#firstAcceptedSettled) {
      this.#firstAcceptedSettled = true;
      this.#resolveFirstAccepted(accepted);
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

  async #recover(
    initialPlan: EffectiveHaxeInvocationPlan,
  ): Promise<EffectiveHaxeInvocationPlan> {
    // Audit every visible entry authority before legacy recovery can change
    // public files. The same audit runs again during migration to close drift.
    auditSessionAuthority(this.#layout);
    let currentPlan = initialPlan;
    const admitPlan = async (plan: PublicationPlan): Promise<boolean> => {
      // Recovery may have been waiting since an older process stopped. Install
      // the reconciled input watch around the refreshed HXML facts, then require
      // one last filesystem comparison before allowing public-file changes.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        currentPlan = await this.#replanGapSafe(
          this.#startupAbort.signal,
          currentPlan,
        );
        this.#assertSupplementalPaths(
          currentPlan.inventory,
          plan.artifacts.map((transition) => transition.path),
        );
        if (!this.#requireReconciliation()) {
          return true;
        }
        currentPlan = await this.#resolveEffectivePlan(
          this.#startupAbort.signal,
        );
      }
      throw new Error(
        "HXML input identity kept changing around recovery",
      );
    };
    // Releases before root ownership stored recovery beside one entry. Read
    // that location first while both the old and new locks are held.
    await this.#dependencies.recover({
      projectRoot: this.#layout.projectRoot,
      transactionRoot: this.#layout.legacyTransactionRelative,
      projectIdentity: legacySessionProjectDigest(this.#layout),
      admitPlan,
      admitIntended: async (plan) =>
        (await this.#admitLegacyRecovered(plan)) && (await admitPlan(plan)),
    });
    await this.#dependencies.establishAuthority(this.#layout);
    await this.#dependencies.recover({
      projectRoot: this.#layout.projectRoot,
      transactionRoot: this.#layout.transactionRelative,
      projectIdentity: sessionProjectDigest(this.#layout),
      admitPlan,
      admitIntended: async (plan) =>
        (await this.#admitRecovered(plan)) && (await admitPlan(plan)),
    });
    return currentPlan;
  }

  async #admitLegacyRecovered(plan: PublicationPlan): Promise<boolean> {
    return await this.#admitRecoveredWith(
      plan,
      (manifestDigest) =>
        plan.authorizationDigest ===
          legacyAdmissionDigest(
            this.#layout,
            manifestDigest,
            this.#options.validatorPolicyFacts,
          )
          ? "replayable"
          : null,
    );
  }

  #closeWatch(): void {
    this.#watch?.close();
    this.#watch = null;
  }

  #requireReconciliation(): boolean {
    const result = this.reconcile();
    if (!result.ok) {
      throw new Error(
        `authoritative input reconciliation failed: ${result.error.message}`,
      );
    }
    return result.changed;
  }

  async #admitRecovered(plan: PublicationPlan): Promise<boolean> {
    return await this.#admitRecoveredWith(
      plan,
      (manifestDigest, _supplementalFiles, marker) =>
        recoveredAdmissionMode(
          this.#layout,
          manifestDigest,
          this.#options.validatorPolicyFacts,
          marker,
          plan.authorizationDigest,
        ),
    );
  }

  async #admitRecoveredWith(
    plan: PublicationPlan,
    admissionMode: (
      manifestDigest: string,
      supplementalFiles: readonly PublishedSupplementalFile[],
      marker: ReturnType<typeof readPublishedMarker>,
    ) => AdmissionRecoveryMode | null,
  ): Promise<boolean> {
    const live = readGenesOutput(
      this.#layout.publicOutputRoot,
      this.#layout.outputIdentity,
      true,
    )!;
    const published = readPublishedMarker(this.#layout);
    if (
      admissionMode(
        live.manifestDigest,
        published.supplementalFiles,
        published,
      ) !== "replayable"
    ) {
      return false;
    }
    const extraFiles = published.supplementalFiles.map((file) =>
      readLiveSupplementalFile(this.#layout, file),
    );
    const tree = this.#validationTree(
      "recovered-live",
      null,
      live,
      extraFiles,
    );
    const abort = new AbortController();
    this.#activeAbort = abort;
    try {
      const result = await this.#options.validate(tree, {
        signal: abort.signal,
        recovery: true,
      });
      if (!result.ok) return false;
      try {
        return recoveredArtifactsMatchPublishedFiles(
          result.artifacts ?? [],
          published.supplementalFiles,
          published.format,
        );
      } catch {
        return false;
      }
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
    const inventory = this.#inventory;
    if (
      inventory === null ||
      !inventory.allowedRoots.some((root) => containedBy(root, absolutePath))
    ) {
      this.#fail(
        "watch",
        this.#newestRevision || null,
        false,
        diagnostic(
          "WATCH_PATH_ESCAPED_ALLOWED_ROOTS",
          "watch input escaped the declared HXML roots",
        ),
      );
      return;
    }
    this.#newestRevision += 1;
    if (impact.rebuild) {
      this.#newestRebuildRevision = this.#newestRevision;
    }
    const relative = this.#logicalInputPath(inventory, absolutePath);
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

  /**
   * Keeps external machine paths private while giving each watched root a
   * stable, readable name for this session. Project files keep their familiar
   * project-relative paths. Another declared root uses
   * `@external/<root-index>`. A file below it adds its path after that name.
   */
  #logicalInputPath(inventory: HxmlInventory, absolutePath: string): string {
    if (containedBy(this.#layout.projectRoot, absolutePath)) {
      if (
        usesExternalLogicalNamespace(this.#layout.projectRoot, absolutePath)
      ) {
        throw new Error(
          "project input must not use @external, which is reserved for private external-input names",
        );
      }
      return path
        .relative(this.#layout.projectRoot, absolutePath)
        .split(path.sep)
        .join("/");
    }
    const candidates = inventory.allowedRoots
      .map((root, index) => ({ root, index }))
      .filter(({ root }) => containedBy(root, absolutePath))
      .sort((left, right) => right.root.length - left.root.length);
    const owner = candidates[0];
    if (owner === undefined) {
      throw new Error("watch input escaped the declared HXML roots");
    }
    const relative = path.relative(owner.root, absolutePath)
      .split(path.sep)
      .join("/");
    return relative.length === 0
      ? `@external/${owner.index}`
      : `@external/${owner.index}/${relative}`;
  }

  async #build(cause: BuildCause): Promise<void> {
    if (this.#closing !== null || !cause.rebuild) return;
    const abort = new AbortController();
    this.#activeAbort = abort;
    let candidateStageRelative: string | null = null;
    let stagedPrepared: StagedPreparedRevision | null = null;
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
        this.#assertSupplementalPaths(
          this.#inventory,
          this.#publishedSupplementalFiles.map((file) => file.path),
        );
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
      const stagedCompilerData = stageCompilerData(
        candidateStageRoot,
        this.#compilerDataDeclarations,
      );
      if (this.#options.prepareRevision !== undefined) {
        const preparation = await this.#options.prepareRevision({
          revision: cause.revision,
          signal: abort.signal,
        });
        if (this.#closing !== null || abort.signal.aborted) return;
        if (!preparation.ok) {
          this.#fail(
            "compile",
            cause.revision,
            true,
            diagnostic(
              "PREPARATION_REJECTED",
              "The host preparation step could not prepare the compiler inputs",
              this.#sanitizePublicJson(preparation.diagnostic),
            ),
          );
          return;
        }
        stagedPrepared = stagePreparedRevision(
          this.#layout,
          candidateStageRelative,
          preparation.prepared,
        );
        this.#assertSupplementalPaths(
          executionPlan.inventory,
          stagedPrepared.publicFiles.map((file) => file.path),
        );
      }
      mkdirSync(path.join(candidateStageRoot, "haxe-target"), {
        recursive: true,
        mode: 0o700,
      });
      const boundInvocation = bindHaxeInvocation(
        executionPlan,
        candidateStageRoot,
        candidateOutputFile,
        stagedCompilerData?.descriptorPath,
      );
      for (const input of boundInvocation.privateArgumentFiles) {
        mkdirSync(path.dirname(input.path), { recursive: true, mode: 0o700 });
        writeFileSync(input.path, input.contents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }
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
        stagedPrepared === null
          ? undefined
          : Object.freeze({
              classPaths: stagedPrepared.classPaths,
              digest: stagedPrepared.digest,
            }),
      );
      if (this.#closing !== null || abort.signal.aborted) return;
      const candidate = readGenesOutput(
        outputRoot,
        this.#layout.outputIdentity,
        true,
      )!;
      assertCandidateContainsOnlyOwnedFiles(candidate);
      const capturedCompilerData = captureCompilerData(stagedCompilerData);
      rmSync(path.join(candidateStageRoot, "haxe-input"), {
        recursive: true,
        force: true,
      });
      this.#emit({
        kind: "candidate-generated",
        revision: cause.revision,
        manifestDigest: candidate.manifestDigest,
      });
      if (this.#closing !== null || abort.signal.aborted) {
        capturedCompilerData.dispose();
        return;
      }
      failurePhase = "validate";
      let admission: AdmissionResult<Diagnostic>;
      try {
        admission = await this.#options.validate(
          this.#validationTree(
            "candidate",
            cause.revision,
            candidate,
            supplementalCandidateFiles(stagedPrepared?.publicFiles ?? []),
            capturedCompilerData.files,
          ),
          { signal: abort.signal, recovery: false },
        );
      } finally {
        capturedCompilerData.dispose();
      }
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
      const admittedFiles = stageAdmittedArtifacts(
        this.#layout,
        candidateStageRelative,
        admission.artifacts ?? [],
      );
      this.#assertSupplementalPaths(
        executionPlan.inventory,
        admittedFiles.map((file) => file.path),
      );
      const supplementalFiles: readonly SupplementalFile[] = Object.freeze([
        ...(stagedPrepared?.publicFiles ?? []),
        ...admittedFiles,
      ]);
      removePrivatePreparedFiles(stagedPrepared?.privateFiles ?? []);
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
          !sameFileState(recordedMarker.state, this.#publishedMarkerState) ||
          supplementalIdentity(recordedMarker.supplementalFiles) !==
            supplementalIdentity(this.#publishedSupplementalFiles)
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
          supplementalFiles,
          this.#publishedSupplementalFiles,
          // A stopped process cannot reproduce macro-created private bytes.
          // Recovery must roll back this update and compile the source again.
          this.#compilerDataDeclarations.length === 0
            ? "replayable"
            : "rebuild-required",
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
        this.#publishedSupplementalFiles = Object.freeze(
          supplementalFiles
            .map((file) =>
              Object.freeze({
                source: file.source,
                path: file.path,
                sha256: file.digest,
                sizeBytes: file.sizeBytes,
                mode: file.mode,
              }),
            )
            .sort((left, right) =>
              Buffer.from(left.path).compare(Buffer.from(right.path)),
            ),
        );
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
    extraFiles: ValidationTree["extraFiles"] = Object.freeze([]),
    compilerData: ValidationTree["compilerData"] = Object.freeze([]),
  ): ValidationTree {
    return Object.freeze({
      kind,
      revision,
      logicalOutputRoot: this.#layout.publicOutputRootRelative ?? ".",
      physicalRoot: inventory.root,
      entryLogicalPath: this.#layout.publicOutputRelative,
      manifestDigest: inventory.manifestDigest,
      files: validationFiles(this.#layout, inventory),
      extraFiles: Object.freeze([...extraFiles]),
      compilerData: Object.freeze([...compilerData]),
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
    initialCandidate?: EffectiveHaxeInvocationPlan,
  ): Promise<EffectiveHaxeInvocationPlan> {
    let candidate =
      initialCandidate ?? await this.#resolveEffectivePlan(signal);
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
      if (!inventory.allowedRoots.some((root) => containedBy(root, candidate))) {
        throw new Error(
          `development-session input must be inside a declared HXML root: ${candidate}`,
        );
      }
      if (usesExternalLogicalNamespace(this.#layout.projectRoot, candidate)) {
        throw new Error(
          "project input must not use @external, which is reserved for private external-input names",
        );
      }
      if (
        inputOverlapsProjectPath(
          this.#layout.projectRoot,
          candidate,
          this.#layout.stateRoot,
        ) ||
        inputOverlapsProjectPath(
          this.#layout.projectRoot,
          candidate,
          this.#layout.publicOutputRoot,
        ) ||
        inputOverlapsProjectPath(
          this.#layout.projectRoot,
          candidate,
          this.#layout.stableControlRoot,
        )
      ) {
        throw new Error(
          `development-session input overlaps state, stable session-control files, or generated output: ${candidate}`,
        );
      }
    }
    for (const classPath of inventory.classPaths) {
      assertClassPathTreeIsReal(classPath);
    }
  }

  /** Prevents generated companions or receipts from claiming authored inputs. */
  #assertSupplementalPaths(
    inventory: HxmlInventory,
    publicPaths: readonly string[],
  ): void {
    const authoredInputs = [
      ...inventory.hxmlFiles,
      ...inventory.libraryProvenanceFiles,
      ...inventory.resourceInputs,
      ...(this.#options.extraInputs ?? []).map((extra) =>
        path.resolve(this.#layout.projectRoot, extra.path),
      ),
      ...inventory.classPaths,
    ];
    for (const publicPath of publicPaths) {
      const absolute = path.resolve(
        this.#layout.projectRoot,
        ...publicPath.split("/"),
      );
      if (!containedBy(this.#layout.projectRoot, absolute)) {
        throw new Error(`prepared public path escapes projectRoot: ${publicPath}`);
      }
      if (usesExternalLogicalNamespace(this.#layout.projectRoot, absolute)) {
        throw new Error(
          "prepared public path must not use @external, which is reserved for private external-input names",
        );
      }
      if (
        authoredInputs.some((input) =>
          inputOverlapsProjectPath(
            this.#layout.projectRoot,
            input,
            absolute,
          ),
        )
      ) {
        throw new Error(
          `prepared public path overlaps an authored compiler input: ${publicPath}`,
        );
      }
      if (
        portableProjectPathsOverlap(
          this.#layout.projectRoot,
          absolute,
          this.#layout.stateRoot,
        ) ||
        portableProjectPathsOverlap(
          this.#layout.projectRoot,
          absolute,
          this.#layout.stableControlRoot,
        )
      ) {
        throw new Error(
          `host-provided public path overlaps private state or stable session-control files: ${publicPath}`,
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

  #sanitizeCoreMessage(message: string): string {
    const candidateRoot = path.join(
      this.#layout.projectRoot,
      ...this.#layout.candidatesRelative.split("/"),
    );
    const declaredExternalRoots = (
      this.#inventory?.allowedRoots ??
      this.#options.hxml.allowedRoots.map((root) => {
        const absolute = path.resolve(root);
        try {
          return realpathSync.native(absolute);
        } catch {
          return absolute;
        }
      })
    )
      .map((root, index) => ({ root, index }))
      .filter(({ root }) => !containedBy(this.#layout.projectRoot, root));
    const replacements = [
      {
        root: candidateRoot,
        replacement: "<private-candidate-root>",
        priority: 0,
      },
      {
        root: this.#layout.stateRoot,
        replacement: "<private-state>",
        priority: 1,
      },
      ...declaredExternalRoots.map(({ root, index }) => ({
        root,
        replacement: `<external-root-${index}>`,
        priority: 2,
      })),
      {
        root: this.#layout.projectRoot,
        replacement: "<project>",
        priority: 3,
      },
    ].sort(
      (left, right) =>
        right.root.length - left.root.length || left.priority - right.priority,
    );
    return replacements
      .reduce(
        (current, { root, replacement }) =>
          replacePathSpellings(current, root, replacement),
        message,
      )
      .replace(
        /<private-candidate-root>[\\/][^\\/\s:]+/gu,
        "<private-candidate>",
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
