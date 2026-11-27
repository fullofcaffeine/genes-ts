import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalDigest,
  publishArtifacts,
  sha256Bytes,
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
import { assertRealInputTrees } from "../watch/reconciled-watch.js";
import type { HaxeWaitServerEvent } from "../haxe-server/index.js";
import { FIRST_BYTES_RAW_LIMIT } from "./haxe-stdio-channel.js";
import {
  HaxeSessionCompiler,
  type HaxeSessionCompilerOptions,
  snapshotHaxeInvocation,
  type CompilerResult,
  type ModuleCompileOutcome,
  type SessionCompiler,
} from "./haxe-driver.js";
import {
  bindHaxeInvocation,
  buildEffectiveHaxeInvocationPlan,
  COMPILER_DATA_DESCRIPTOR_FILE,
  GENERATION_REPORT_FILE,
  planInputFilesUnchanged,
  type EffectiveHaxeInvocationPlan,
  type IncrementalBinding,
} from "./effective-invocation.js";
import {
  captureCompilerData,
  replaceRequestFile,
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
  checkExistingGenesFiles,
  snapshotExistingGenerationPolicy,
} from "./existing-generation.js";
import {
  legacyAdmissionDigest,
  legacySessionProjectDigest,
  prepareExistingGenerationImport,
  preparePublication,
  readPublishedMarker,
  recoveredAdmissionMode,
  replacementRequestDigest,
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
  type ChangeImpact,
  type DevelopmentEvent,
  type DevelopmentEventBody,
  type DevelopmentSession,
  type DevelopmentSessionDiagnostic,
  type DevelopmentSnapshot,
  type DevelopmentState,
  type ExternalChange,
  type FailurePhase,
  type GenerationReuseOptions,
  type GenesDevelopmentOptions,
  type HaxeInvocation,
  type JsonValue,
  type ColdBuildCheck,
  type CompilerServerQueryMethod,
  type ModulePreviewOptions,
  type OutputCheck,
  type PreviewFileContent,
  type SessionPreviewRefusalCode,
  type SessionFailure,
  type ValidationTree,
} from "./types.js";

const DEFAULT_DEBOUNCE_MS = 100;
/**
 * `GenesDevelopmentOptions.startDelayMs` when the host gives none: a save
 * after an idle period starts its build 10 ms after the file event.
 */
const DEFAULT_START_DELAY_MS = 10;
/** The most bytes of `firstBytes` that a `transport-failed` event reports. */
const REPORTED_FIRST_BYTES = 64;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
/** `GenerationReuseOptions.auditModules` when the host gives none. */
const DEFAULT_AUDIT_MODULES = 2;
/** `GenerationReuseOptions.coldCheckEvery` when the host gives none. */
const DEFAULT_COLD_CHECK_EVERY = 20;
/** `GenerationReuseOptions.coldCheckIdleMs` when the host gives none. */
const DEFAULT_COLD_CHECK_IDLE_MS = 5_000;
/**
 * The largest `auditModules`. Genes decodes the descriptor value as a Haxe
 * `Int`; a larger JSON number arrives as a float, and Genes then refuses the
 * whole descriptor, which would turn incremental work off without an error.
 */
const MAX_AUDIT_MODULES = 1_000_000;
/** The largest `coldCheckIdleMs` (ten minutes). */
const MAX_COLD_CHECK_IDLE_MS = 600_000;
/** The most paths or modules that one `output-check` event lists. */
const OUTPUT_CHECK_PATH_LIMIT = 50;
/** The longest cold-build output that one `output-check` event carries. */
const OUTPUT_CHECK_MESSAGE_LIMIT = 2_000;
/** The largest `modulePreview.quietMs`: 10 minutes. */
const MAX_PREVIEW_QUIET_MS = 600_000;
/**
 * Preview differences whose files one session keeps as evidence. A defect
 * that repeats on every edit must not fill the disk; the count in the
 * snapshot goes on.
 */
const PREVIEW_EVIDENCE_LIMIT = 20;

/** The checked `GenerationReuseOptions` of one session. */
interface GenerationReuseSettings {
  readonly auditModules: number;
  readonly coldCheckEvery: number;
  readonly coldCheckIdleMs: number;
}

/** What the Genes rolling replay audit of one build reported. */
interface ReplayAuditReport {
  /** The replayed modules that Genes printed again. */
  readonly audited: readonly string[];
  /** The audited modules whose new print differs (sorted, at most 50). */
  readonly differing: readonly string[];
}

const NO_REPLAY_AUDIT: ReplayAuditReport = Object.freeze({
  audited: Object.freeze([]),
  differing: Object.freeze([]),
});

/**
 * Copies and checks the host's `generationReuse` option once, at session
 * construction, so a later change of the host object has no effect. Returns
 * `null` when the option is absent: every build is then a full generation.
 */
function snapshotGenerationReuse(
  options: GenerationReuseOptions | undefined,
): GenerationReuseSettings | null {
  if (options === undefined) return null;
  const auditModules = options.auditModules ?? DEFAULT_AUDIT_MODULES;
  const coldCheckEvery = options.coldCheckEvery ?? DEFAULT_COLD_CHECK_EVERY;
  const coldCheckIdleMs = options.coldCheckIdleMs ?? DEFAULT_COLD_CHECK_IDLE_MS;
  for (const [name, value, max] of [
    ["auditModules", auditModules, MAX_AUDIT_MODULES],
    ["coldCheckEvery", coldCheckEvery, Number.MAX_SAFE_INTEGER],
    ["coldCheckIdleMs", coldCheckIdleMs, MAX_COLD_CHECK_IDLE_MS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > max) {
      throw new Error(
        max === Number.MAX_SAFE_INTEGER
          ? `generationReuse.${name} must be a whole number of 0 or more`
          : `generationReuse.${name} must be a whole number from 0 to ${max}`,
      );
    }
  }
  return Object.freeze({ auditModules, coldCheckEvery, coldCheckIdleMs });
}

/** The checked `ModulePreviewOptions` of one session. */
interface ModulePreviewSettings {
  /** Milliseconds without a save before the program request after a preview. */
  readonly quietMs: number;
}

/**
 * Copies and checks the host's `modulePreview` option once, at session
 * construction. Returns `null` when the option is absent. A module request
 * needs the records that generation reuse keeps, so the option without
 * `generationReuse` is an error.
 */
function snapshotModulePreview(
  options: ModulePreviewOptions | undefined,
  generationReuse: GenerationReuseSettings | null,
  debounceMs: number,
): ModulePreviewSettings | null {
  if (options === undefined) return null;
  if (generationReuse === null) {
    throw new Error(
      "modulePreview needs generationReuse: a module request compares the edit with the records that a program request with generation reuse keeps",
    );
  }
  const quietMs = options.quietMs ?? debounceMs;
  if (!Number.isSafeInteger(quietMs) || quietMs < 0 || quietMs > MAX_PREVIEW_QUIET_MS) {
    throw new Error(
      `modulePreview.quietMs must be a whole number from 0 to ${MAX_PREVIEW_QUIET_MS}`,
    );
  }
  return Object.freeze({ quietMs });
}

/**
 * Returns the Haxe module path of a `.hx` file, for example `ui.Button` for
 * `<src>/ui/Button.hx`, or `null` when the file names no single module: it
 * lies below no declared class path or below two nested ones, or a part of
 * its path is no valid Haxe package or module name (for example
 * `import.hx`).
 */
function moduleNameOf(
  file: string,
  classPaths: readonly string[],
): string | null {
  const owners = classPaths.filter(
    (classPath) => classPath !== file && containedBy(classPath, file),
  );
  if (owners.length !== 1) return null;
  const parts = path.relative(owners[0]!, file).split(path.sep);
  const last = parts.pop();
  if (last === undefined || !last.endsWith(".hx")) return null;
  const name = last.slice(0, -".hx".length);
  if (!/^[A-Z][A-Za-z0-9_]*$/u.test(name)) return null;
  if (!parts.every((part) => /^[a-z_][A-Za-z0-9_]*$/u.test(part))) return null;
  return [...parts, name].join(".");
}

/** The parts of a Genes module report that the session reads. */
interface ModuleReport {
  /** `preview`, `refused` or `off`. */
  readonly result: string;
  readonly refusal: string | null;
  /** Published paths relative to the output folder; empty unless `preview`. */
  readonly files: readonly string[];
}

/**
 * Reads the report of one module request (`ModuleRequest.ModuleRequestReport`)
 * and returns `null` when it is missing, unreadable, or names another kind
 * or module.
 *
 * BOUNDARY_DYNAMIC: the report is JSON that Genes writes; only `kind`,
 * `module`, `result`, `refusal` and `files[]` are read, each checked.
 */
function readModuleReport(reportPath: string, module: string): ModuleReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const report = parsed as {
    readonly kind?: unknown;
    readonly module?: unknown;
    readonly result?: unknown;
    readonly refusal?: unknown;
    readonly files?: unknown;
  };
  if (
    report.kind !== "module" ||
    report.module !== module ||
    typeof report.result !== "string" ||
    report.result.length === 0 ||
    (report.refusal !== null &&
      report.refusal !== undefined &&
      typeof report.refusal !== "string") ||
    !Array.isArray(report.files) ||
    !report.files.every((file) => typeof file === "string")
  ) {
    return null;
  }
  return Object.freeze({
    result: report.result,
    refusal:
      typeof report.refusal === "string" && report.refusal.length > 0
        ? report.refusal
        : null,
    files: Object.freeze([...(report.files as string[])]),
  });
}

/**
 * Returns true when `relative` is a plain path below an output folder: not
 * empty, not absolute, no `.` or `..` part, no backslash, no control byte,
 * and not a Genes manifest.
 */
function plainOutputPath(relative: string): boolean {
  return (
    relative.length > 0 &&
    !/[\\\0\r\n]/u.test(relative) &&
    !path.posix.isAbsolute(relative) &&
    path.posix.normalize(relative) === relative &&
    relative
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !part.startsWith(".genes-output-"),
      )
  );
}

/** One file of a pending preview, in the memory of the session. */
interface PreviewEntry {
  /** The project-relative public path, for example `src-gen/ui/Button.ts`. */
  readonly logicalPath: string;
  readonly sha256: string;
  readonly bytes: Buffer;
}

/** The comparison of a pending preview with one program candidate. */
interface PreviewComparison {
  /** The input revision of the candidate. */
  readonly candidateRevision: number;
  /** Output-relative paths whose candidate bytes differ or are missing, sorted. */
  readonly differing: readonly string[];
  /** The candidate bytes of each differing path (`null`: no such file). */
  readonly programBytes: ReadonlyMap<string, Buffer | null>;
  /**
   * The public paths of every Genes file that the candidate changes,
   * creates or removes in the published Genes tree, or `null` when the
   * session does not know the published digests.
   */
  readonly changed: ReadonlySet<string> | null;
}

/**
 * One preview shown to the host and not yet settled by an accepted
 * generation. Keyed by its module: a newer preview of the module replaces it.
 */
interface PendingPreview {
  readonly revision: number;
  readonly module: string;
  /** By output-relative path. */
  readonly files: ReadonlyMap<string, PreviewEntry>;
  /** Set when a program candidate exists; cleared when that build is not accepted. */
  comparison: PreviewComparison | null;
  /**
   * True while every source change after this preview was proven by an
   * admitted preview of another module. A build of a later change that
   * shows no preview (a refusal, a change that is no module edit, or a
   * build that a newer change cancelled before it decided) sets it false
   * (`#markPreviewsUncovered`); so does a change of this module's own file,
   * which always reaches such a build or a newer preview of the module. A
   * difference of a clean preview is a Genes defect (`differs`); of another
   * preview, the effect of a later edit (`newer-revision`).
   */
  clean: boolean;
  /**
   * True when the published tree was the result of the last program request
   * when this preview was made. Genes proved the preview against the records
   * of that request, so then the accepted generation of the same sources
   * may change no other Genes file than the files of the settled previews.
   */
  extraCheck: boolean;
}

/**
 * What the session knew about one changed source file just before a program
 * request read it: the digest of its bytes, its status, and its change count
 * (`#sourceChanges`). See `#readSources`.
 */
interface SourceRead {
  readonly digest: string;
  readonly status: string;
  readonly changes: number;
}

/**
 * Returns a text of the status fields of a file that change with any write
 * (size, modification and change time, inode), or `null` when the path is no
 * regular file. Equal texts before and after a read prove that no write
 * happened in between; the change time cannot be set by a tool.
 */
function sourceStatus(file: string): string | null {
  try {
    const stats = lstatSync(file, { bigint: true });
    if (!stats.isFile()) return null;
    return `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.ino}`;
  } catch {
    return null;
  }
}

/**
 * Returns what the rolling replay audit of one build reported, from the Genes
 * generation report at `reportPath`: the modules it printed again and those
 * whose new print differs. An absent or unreadable report gives neither: the
 * report is evidence of Genes, not an input that the session trusts for
 * anything else.
 *
 * BOUNDARY_DYNAMIC: the report is JSON that Genes writes
 * (`IncrementalShadow.ShadowAuditReport`); only `audit.audited[]` and
 * `audit.mismatches[].module` are read, each checked as a string.
 */
function readReplayAudit(reportPath: string): ReplayAuditReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return NO_REPLAY_AUDIT;
  }
  const audit =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { readonly audit?: unknown }).audit
      : undefined;
  if (typeof audit !== "object" || audit === null) return NO_REPLAY_AUDIT;
  const { audited, mismatches } = audit as {
    readonly audited?: unknown;
    readonly mismatches?: unknown;
  };
  const names = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  const differing = new Set<string>(
    (Array.isArray(mismatches) ? mismatches : []).flatMap((mismatch) =>
      typeof mismatch === "object" && mismatch !== null
        ? names([(mismatch as { readonly module?: unknown }).module])
        : [],
    ),
  );
  return Object.freeze({
    audited: Object.freeze(names(audited)),
    differing: Object.freeze(bytewise(differing).slice(0, OUTPUT_CHECK_PATH_LIMIT)),
  });
}

/**
 * Returns `message` for an `output-check` event: private paths already
 * removed by the caller, cut to `OUTPUT_CHECK_MESSAGE_LIMIT` characters.
 */
function boundedMessage(message: string): string {
  return message.length <= OUTPUT_CHECK_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, OUTPUT_CHECK_MESSAGE_LIMIT - 1)}…`;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Returns the project-relative paths whose bytes differ between a cold Genes
 * tree and the published one: a file in only one tree, or with another
 * SHA-256 digest. Sorted, at most `OUTPUT_CHECK_PATH_LIMIT`. File modes are
 * not compared: publication owns them.
 */
function differingOutputPaths(
  layout: SessionLayout,
  cold: GenesOutputInventory,
  live: GenesOutputInventory | null,
): readonly string[] {
  const liveDigests = new Map(
    (live?.files ?? []).map((file) => [file.relativePath, file.digest]),
  );
  const coldPaths = new Set(cold.files.map((file) => file.relativePath));
  const differing = [
    ...cold.files
      .filter((file) => liveDigests.get(file.relativePath) !== file.digest)
      .map((file) => file.relativePath),
    ...[...liveDigests.keys()].filter((relative) => !coldPaths.has(relative)),
  ];
  return Object.freeze(
    bytewise(differing.map((relative) => logicalOutputPath(layout, relative)))
      .slice(0, OUTPUT_CHECK_PATH_LIMIT),
  );
}
const ABSENT_FILE_STATE: ExpectedFileState = Object.freeze({ kind: "absent" });
interface BuildCause {
  readonly revision: number;
  readonly paths: readonly string[];
  readonly reinventory: boolean;
  readonly restartCompiler: boolean;
  readonly rebuild: boolean;
  /**
   * The next request needs an empty Haxe cache: a source file was created or
   * removed, or another watched path changed that `keepCache` does not
   * cover. See `#observe` and `keepCacheCovers`.
   */
  readonly freshCache: boolean;
  /**
   * The absolute path of each `.hx` module on a declared class path whose
   * content changed (the watcher reported `modified`), sorted. Only these
   * edits can get a module request (`GenesDevelopmentOptions.modulePreview`).
   */
  readonly editedModules: readonly string[];
  /**
   * False when a change of this cause that needs a build is not such an
   * edit: a created or removed file, an HXML file, an extra input, a host
   * invalidation, the first build or a repair build.
   */
  readonly onlyModuleEdits: boolean;
}

/**
 * What one watched input or host invalidation asks of the next build: the
 * public `ChangeImpact` with every flag resolved to a boolean.
 */
interface ObservedImpact {
  readonly reinventory: boolean;
  readonly restartCompiler: boolean;
  readonly rebuild: boolean;
  /** The host declared that Haxe and its macros never read this input. */
  readonly keepCache: boolean;
}

/**
 * Resolves a host-declared impact to the flags that the session uses.
 *
 * Every input rebuilds unless it says `rebuild: false` and asks for nothing
 * else. `keepCache` only removes the reason "a macro may read this file", so
 * it cannot be combined with `restartCompiler`, which asks for a new server.
 *
 * Example: `{ rebuild: true, keepCache: true }` for a stylesheet that the
 * host turns into a Haxe companion in `prepareRevision`.
 */
function observedImpact(impact: ChangeImpact, subject: string): ObservedImpact {
  const keepCache = impact.keepCache === true;
  const restartCompiler = impact.restartCompiler === true;
  if (keepCache && restartCompiler) {
    throw new Error(`${subject} cannot declare both keepCache and restartCompiler`);
  }
  return Object.freeze({
    reinventory: impact.reinventory === true,
    restartCompiler,
    rebuild:
      impact.rebuild !== false ||
      impact.revalidate === true ||
      impact.reinventory === true ||
      restartCompiler,
    keepCache,
  });
}

/**
 * Returns true when a host's `keepCache` declaration may keep the warm Haxe
 * cache for this changed path.
 *
 * `keepCache` says that no macro reads the input. It cannot say that the
 * path holds no Haxe module, so the cache is never kept for:
 *
 * - a `.hx` file. Haxe 4.3.7 always searches its working directory as a
 *   class path, even without `-cp .`, so a `.hx` file in a declared tree can
 *   be a module that the session's list of `-cp` entries does not show. A
 *   new `servercase/TopThing.hx` there changes which `TopThing` an unchanged
 *   module uses;
 * - anything that is not a regular file: a directory, or a link (which may
 *   point to a directory). A host invalidation or an exact input reports
 *   only that path, not a module created or removed below it (a tree input
 *   reports each file below it separately);
 * - a path that a host invalidation names and that no longer exists: it may
 *   have been such a directory.
 *
 * Example: an edit of `styles/card.module.css` is covered; a host
 * invalidation of `src` is not.
 */
function keepCacheCovers(
  absolutePath: string,
  existence: "created" | "deleted" | "modified" | "unknown",
): boolean {
  if (absolutePath.endsWith(".hx")) return false;
  try {
    return lstatSync(absolutePath).isFile();
  } catch {
    return existence !== "unknown";
  }
}

/** An HXML or library provenance file: the plan and the server are renewed. */
const PLAN_INPUT_IMPACT: ObservedImpact = Object.freeze({
  reinventory: true,
  restartCompiler: true,
  rebuild: true,
  keepCache: false,
});

/** A class-path module or a resource file that Haxe reads itself. */
const COMPILER_INPUT_IMPACT: ObservedImpact = Object.freeze({
  reinventory: false,
  restartCompiler: false,
  rebuild: true,
  keepCache: false,
});

/**
 * Combines two impacts reported for the same path. A flag that asks for more
 * work wins; the cache is kept only when both inputs declared `keepCache`.
 */
function mergeObservedImpact(
  left: ObservedImpact,
  right: ObservedImpact,
): ObservedImpact {
  return Object.freeze({
    reinventory: left.reinventory || right.reinventory,
    restartCompiler: left.restartCompiler || right.restartCompiler,
    rebuild: left.rebuild || right.rebuild,
    keepCache: left.keepCache && right.keepCache,
  });
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
    compilerOptions: HaxeSessionCompilerOptions,
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
  createCompiler: (layout, onEvent, shutdownTimeoutMs, compilerOptions) =>
    new HaxeSessionCompiler(layout, onEvent, shutdownTimeoutMs, compilerOptions),
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

class ExistingGenerationStartupError extends Error {
  readonly phase: "validate" | "publish";
  readonly details?: JsonValue;

  constructor(
    phase: "validate" | "publish",
    cause: unknown,
    details?: JsonValue,
  ) {
    const error = asError(cause);
    super(error.message);
    this.name = "ExistingGenerationStartupError";
    this.phase = phase;
    this.details = details;
  }
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

/**
 * Returns a text that changes whenever the process environment changes.
 *
 * The Haxe invocation inherits `process.env` (see `snapshotHaxeInvocation`),
 * so the environment is an input of the invocation plan. A build compares
 * this text with the one taken at the last plan resolution, and resolves the
 * plan again only when it differs.
 */
function ambientEnvironmentKey(): string {
  return JSON.stringify(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

/**
 * Returns the whole-second file time of a changed source file, the precision
 * at which Haxe 4.3.7 compares file times.
 *
 * Haxe reads a file again only when this second differs from the one it
 * recorded. It recorded a time no later than the end of the request that read
 * the file, so a file whose second is after that end needs no
 * `server/invalidate` (each costs about 60 ms). A file that cannot be read
 * answers -1, so it is always invalidated.
 */
function fileSeconds(file: string): number {
  try {
    return Math.floor(statSync(file).mtimeMs / 1000);
  } catch {
    return -1;
  }
}

function mergeCause(left: BuildCause, right: BuildCause): BuildCause {
  return Object.freeze({
    revision: Math.max(left.revision, right.revision),
    paths: Object.freeze(bytewise(new Set([...left.paths, ...right.paths]))),
    reinventory: left.reinventory || right.reinventory,
    restartCompiler: left.restartCompiler || right.restartCompiler,
    rebuild: left.rebuild || right.rebuild,
    freshCache: left.freshCache || right.freshCache,
    editedModules: Object.freeze(
      bytewise(new Set([...left.editedModules, ...right.editedModules])),
    ),
    onlyModuleEdits: left.onlyModuleEdits && right.onlyModuleEdits,
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
  /** The checked `generationReuse` option, or `null` without reuse. */
  readonly #generationReuse: GenerationReuseSettings | null;
  /**
   * False after `AUDIT_REPEATED`: the session then asks Genes for measure
   * only, as without `generationReuse`, and runs no cold build.
   */
  #reuseActive = true;
  /** The modules of the last replay-audit difference not yet audited clean. */
  #auditSuspects = new Set<string>();
  /** A cold-build difference was repaired; the next accepted generation checks again. */
  #coldVerifyPending = false;
  /** A cold difference survived a repair: later ones are reported, not repaired. */
  #coldRepairStopped = false;
  /** Accepted warm generations since the last cold build (output check). */
  #generationsSinceColdCheck = 0;
  /** The scheduled or running cold build, until it ends. */
  #coldCheck: Promise<void> | null = null;
  /** Aborts the running cold build; an edit or `close` calls it. */
  #coldCheckAbort: AbortController | null = null;
  /** The prepared-file digest of the accepted generation, or `null`. */
  #acceptedPreparedDigest: string | null = null;
  /** The checked `modulePreview` option, or `null` without module requests. */
  readonly #modulePreview: ModulePreviewSettings | null;
  /** Previews shown and not yet settled by an accepted generation, by module. */
  readonly #pendingPreviews = new Map<string, PendingPreview>();
  /** Modules whose preview differed from the program result: no more previews. */
  readonly #stoppedPreviewModules = new Set<string>();
  /** Clean previews that differed from the accepted result (`#settlePreviews`). */
  #previewDifferences = 0;
  /** Differences whose files were kept (at most `PREVIEW_EVIDENCE_LIMIT`). */
  #previewEvidenceKept = 0;
  /** `Date.now()` of the last input change that needs a build. */
  #lastRebuildChangeAt = 0;
  /** Ends the quiet time before a program request; a new change aborts it. */
  #quietWake: AbortController | null = null;
  /**
   * The SHA-256 digest of each Genes file of the published tree, by
   * output-relative path, as the last accepted candidate in this session
   * wrote it; `null` before that.
   */
  #acceptedGenesDigests: ReadonlyMap<string, string> | null = null;
  /**
   * True while the published tree is the result of the last program request
   * that ran and no source change since then lacks a preview. See
   * `PendingPreview.extraCheck`.
   */
  #publishedIsLastProgram = false;
  /**
   * The content digest of each source file as the last accepted program
   * request read it, for the rule "no build when each changed file has equal
   * content" (with `modulePreview`). Only files that changed during the
   * session are here.
   */
  readonly #builtSources = new Map<string, string>();
  /** Source files that changed since an accepted program request read them. */
  readonly #dirtySources = new Set<string>();
  /** How often each source file changed; a commit needs the count it read. */
  readonly #sourceChanges = new Map<string, number>();
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
  /**
   * The process environment (`ambientEnvironmentKey`) that each resolved plan
   * was made from. A plan that failed is never in use, so its key is unused.
   */
  readonly #planEnvironments = new WeakMap<EffectiveHaxeInvocationPlan, string>();
  /**
   * The highest whole-second file time that the Haxe server may have recorded
   * for a source file: the second in which the last request ended, or a later
   * file time that it read. See `#needsInvalidation`.
   */
  #lastRequestStampSeconds = 0;
  /**
   * The whole-second file time of each changed source file at the last
   * request that could read it. A later edit with the same or an earlier
   * second must be invalidated, even when that second is ahead of the clock.
   */
  readonly #seenSourceSeconds = new Map<string, number>();
  /** Changed source files (created or edited) whose time the next request records. */
  readonly #pendingSourceTimes = new Set<string>();
  /** Changed `.hx` files that the next Haxe request must invalidate. */
  readonly #pendingInvalidations = new Set<string>();
  #publishedManifestDigest: string | null = null;
  #publishedMarkerState: ExpectedFileState = ABSENT_FILE_STATE;
  #publishedSupplementalFiles: readonly PublishedSupplementalFile[] = Object.freeze([]);
  #mayCleanCandidates = false;
  #acceptWatchChanges = false;
  #startupInputChanged = false;

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
    this.#generationReuse = snapshotGenerationReuse(options.generationReuse);
    this.#modulePreview = snapshotModulePreview(
      options.modulePreview,
      this.#generationReuse,
      options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
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
    const idleCollection = options.compilerServerIdleCollection;
    const idleDelay =
      typeof idleCollection === "object" && idleCollection !== null
        ? idleCollection.delayMs
        : undefined;
    if (
      idleCollection !== undefined &&
      idleCollection !== false &&
      (typeof idleCollection !== "object" ||
        idleCollection === null ||
        (idleDelay !== undefined &&
          (!Number.isInteger(idleDelay) || idleDelay < 0 || idleDelay > 600_000)))
    ) {
      throw new Error(
        "compilerServerIdleCollection must be false or { delayMs } with a whole number from 0 to 600000",
      );
    }
    this.#compiler = dependencies.createCompiler(
      this.#layout,
      (event) => {
        // Bytes that broke the pipe can name private folders.
        const reported: HaxeWaitServerEvent =
          event.kind === "transport-failed"
            ? Object.freeze({
                kind: "transport-failed",
                reason: this.#sanitizeCoreMessage(event.reason),
                firstBytes: this.#reportedFirstBytes(event.firstBytes),
              })
            : event;
        this.#lastCompilerEvent = reported;
        this.#emit({ kind: "compiler-lifecycle", event: reported });
      },
      shutdownTimeoutMs,
      Object.freeze({
        idleCollection: idleCollection !== false,
        ...(idleDelay === undefined ? {} : { idleCollectionDelayMs: idleDelay }),
      }),
    );
    this.#firstAcceptedPromise = new Promise((resolve, reject) => {
      this.#resolveFirstAccepted = resolve;
      this.#rejectFirstAccepted = reject;
    });
    // A host may attach after start. Keep Node from classifying the deliberate
    // fatal/close rejection as unhandled before that attachment.
    void this.#firstAcceptedPromise.catch(() => undefined);
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const startDelayMs = Math.min(
      options.startDelayMs ?? DEFAULT_START_DELAY_MS,
      debounceMs,
    );
    this.#loop = new SerializedDirtyLoop<BuildCause>({
      debounceMs,
      startDelayMs,
      // A follow-up whose first step is a module request starts after the
      // short start delay; its program request keeps the quiet time.
      followUpDelayMs: (cause) =>
        this.#modulePreview !== null &&
        cause.onlyModuleEdits &&
        cause.editedModules.length > 0
          ? startDelayMs
          : debounceMs,
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
      ...(this.#modulePreview === null
        ? {}
        : {
            modulePreview: Object.freeze({
              differences: this.#previewDifferences,
              stoppedModules: Object.freeze(bytewise(this.#stoppedPreviewModules)),
            }),
          }),
    });
  }

  /** See `DevelopmentSession.readPreviewFile`. */
  readPreviewFile(logicalPath: string): PreviewFileContent | null {
    for (const pending of this.#pendingPreviews.values()) {
      for (const entry of pending.files.values()) {
        if (entry.logicalPath !== logicalPath) continue;
        return Object.freeze({
          revision: pending.revision,
          module: pending.module,
          path: entry.logicalPath,
          sha256: entry.sha256,
          bytes: Uint8Array.from(entry.bytes),
        });
      }
    }
    return null;
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
      startupPhase = "recovery";
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
      if (existing !== null) {
        this.#acceptExisting(existing);
      }
      this.#loop.request(
        Object.freeze({
          revision: firstBuildRevision,
          paths: Object.freeze([]),
          reinventory: false,
          restartCompiler: false,
          rebuild: true,
          freshCache: false,
          editedModules: Object.freeze([]),
          onlyModuleEdits: false,
        }),
      );
    } catch (error) {
      const normalized = asError(error);
      const failurePhase =
        error instanceof ExistingGenerationStartupError
          ? error.phase
          : startupPhase;
      if (this.#closing === null) {
        this.#fail(
          failurePhase,
          null,
          false,
          diagnostic(
            failurePhase === "inventory"
              ? "HXML_INVENTORY_FAILED"
              : failurePhase === "validate"
                ? "HOST_VALIDATION_FAILED"
                : failurePhase === "publish"
                  ? "PUBLICATION_FAILED"
                  : "SESSION_RECOVERY_FAILED",
            this.#sanitizeCoreMessage(normalized.message),
            error instanceof ExistingGenerationStartupError &&
                error.details !== undefined
              ? this.#sanitizePublicJson(error.details)
              : undefined,
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
    const replacement = this.#existingGeneration.replace;
    const repeatsCommittedReplacement = replacement !== undefined &&
      published.manifestDigest !== null &&
      published.replacementDigest === replacementRequestDigest(
        this.#layout,
        replacement,
        published.manifestDigest,
        this.#options.validatorPolicyFacts,
        published.supplementalFiles,
      );
    if (
      replacement !== undefined && !repeatsCommittedReplacement && (
        published.state.kind !== "file" ||
        published.state.sha256 !== replacement.previousMarkerSha256
      )
    ) {
      throw new Error("existing generation replacement has a stale or missing prior marker");
    }
    if (replacement !== undefined && published.format === "v3") {
      throw new Error("existing generation replacement needs supplemental ownership recorded by a normal generation first");
    }
    const live = readGenesOutput(
      this.#layout.publicOutputRoot,
      this.#layout.outputIdentity,
      false,
    );
    if (
      published.manifestDigest === null ||
      (replacement !== undefined && !repeatsCommittedReplacement)
    ) {
      const imported = replacement?.files ?? this.#existingGeneration.import;
      if (live === null) {
        if (imported === undefined) return null;
        throw new Error("existing generation import has no live Genes output");
      }
      if (imported === undefined) {
        throw new Error(
          "existing Genes output has no session marker; provide an exact import claim",
        );
      }
      checkExistingGenesFiles(this.#layout, imported, live);
      const checked = checkExistingGenerationFiles(this.#layout, imported);
      // Replacement cannot silently abandon a previously owned companion file.
      // Keep its preparation/validation authority when carrying it forward.
      const previousByPath = new Map(
        published.supplementalFiles.map((file) => [file.path, file]),
      );
      if (replacement !== undefined) {
        const claimedPaths = new Set(checked.published.map((file) => file.path));
        for (const previous of published.supplementalFiles) {
          if (!claimedPaths.has(previous.path)) {
            throw new Error(
              "existing generation replacement omits an owned supplemental file: " + previous.path,
            );
          }
        }
      }
      const supplementalFiles = checked.published.map((file) => ({
        ...file,
        source: previousByPath.get(file.path)?.source ?? file.source,
      }));
      const inventory = this.#inventory;
      if (inventory === null) {
        throw new Error("existing generation import has no HXML inventory");
      }
      this.#assertSupplementalPaths(
        inventory,
        checked.published.map((file) => file.path),
      );
      let admission: AdmissionResult<Diagnostic>;
      try {
        admission = await this.#options.validate(
          this.#validationTree(
            "recovered-live",
            null,
            live,
            checked.candidates,
          ),
          { signal: this.#startupAbort.signal, recovery: true },
        );
      } catch (error) {
        throw new ExistingGenerationStartupError("validate", error);
      }
      if (this.#closing !== null || this.#startupAbort.signal.aborted) {
        return null;
      }
      if (!admission.ok) {
        throw new ExistingGenerationStartupError(
          "validate",
          "the host validator rejected the existing generation",
          admission.diagnostic,
        );
      }
      if (
        !recoveredArtifactsMatchPublishedFiles(
          admission.artifacts ?? [],
          supplementalFiles,
          // A new admission records a v5 marker even when its prior marker
          // was v2. Legacy recovery allowances must not bless unclaimed files.
          "v5",
        )
      ) {
        throw new ExistingGenerationStartupError(
          "validate",
          "the host validator did not reproduce the exact existing supplemental files",
        );
      }
      const reconciliationChanged = this.#requireReconciliation();
      const changedDuringValidation =
        this.#startupInputChanged || reconciliationChanged;
      this.#assertSupplementalPaths(
        inventory,
        checked.published.map((file) => file.path),
      );
      if (changedDuringValidation) {
        throw new ExistingGenerationStartupError(
          "validate",
          "authored inputs changed while the existing generation was checked",
        );
      }
      if (this.#closing !== null || this.#startupAbort.signal.aborted) {
        return null;
      }
      const stageRelativePath =
        `${this.#layout.candidatesRelative}/existing-${this.#dependencies.nonce()}`;
      try {
        try {
          const prepared = prepareExistingGenerationImport(
            this.#layout,
            stageRelativePath,
            live,
            supplementalFiles,
            this.#dependencies.now(),
            this.#options.validatorPolicyFacts,
            this.#sessionNonce,
            published.state,
            published.accepted,
            replacement === undefined ? null : replacementRequestDigest(
              this.#layout,
              replacement,
              live.manifestDigest,
              this.#options.validatorPolicyFacts,
              supplementalFiles,
            ),
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
          return prepared.accepted;
        } catch (error) {
          throw new ExistingGenerationStartupError("publish", error);
        }
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
    if (replacement !== undefined) {
      checkExistingGenesFiles(this.#layout, replacement.files, live);
    }
    assertImportMatchesPublished(
      replacement?.files ?? this.#existingGeneration.import,
      published.supplementalFiles,
    );
    const extraFiles = published.supplementalFiles.map((file) =>
      readLiveSupplementalFile(this.#layout, file),
    );
    let admission: AdmissionResult<Diagnostic>;
    try {
      admission = await this.#options.validate(
        this.#validationTree(
          "recovered-live",
          null,
          live,
          extraFiles,
        ),
        { signal: this.#startupAbort.signal, recovery: true },
      );
    } catch (error) {
      throw new ExistingGenerationStartupError("validate", error);
    }
    if (this.#closing !== null || this.#startupAbort.signal.aborted) {
      return null;
    }
    if (!admission.ok) {
      throw new ExistingGenerationStartupError(
        "validate",
        "the host validator rejected the accepted generation",
        admission.diagnostic,
      );
    }
    if (
      !recoveredArtifactsMatchPublishedFiles(
        admission.artifacts ?? [],
        published.supplementalFiles,
        published.format,
      )
    ) {
      throw new ExistingGenerationStartupError(
        "validate",
        "the host validator did not reproduce the accepted supplemental files",
      );
    }
    const inventory = this.#inventory;
    if (inventory === null) {
      throw new Error("accepted generation has no HXML inventory");
    }
    const reconciliationChanged = this.#requireReconciliation();
    const changedDuringValidation =
      this.#startupInputChanged || reconciliationChanged;
    this.#assertSupplementalPaths(
      inventory,
      published.supplementalFiles.map((file) => file.path),
    );
    if (changedDuringValidation) {
      throw new ExistingGenerationStartupError(
        "validate",
        "authored inputs changed while the accepted generation was checked",
      );
    }
    const currentLive = readGenesOutput(
      this.#layout.publicOutputRoot,
      this.#layout.outputIdentity,
      true,
    )!;
    if (currentLive.manifestDigest !== published.manifestDigest) {
      throw new ExistingGenerationStartupError(
        "validate",
        "the accepted Genes output changed while the host checked it",
      );
    }
    for (const file of published.supplementalFiles) {
      readLiveSupplementalFile(this.#layout, file);
    }
    if (replacement !== undefined) {
      checkExistingGenesFiles(this.#layout, replacement.files, currentLive);
      if (!sameFileState(readPublishedMarker(this.#layout).state, published.state)) {
        throw new ExistingGenerationStartupError(
          "validate",
          "the accepted replacement marker changed while the host checked it",
        );
      }
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
    return accepted;
  }

  #acceptExisting(accepted: AcceptedGeneration): void {
    this.#accepted = accepted;
    this.#setState(Object.freeze({ kind: "ready", accepted }), accepted.acceptedAt);
    if (this.#closing !== null) return;
    this.#emit({ kind: "generation-accepted", accepted });
    if (this.#closing !== null) return;
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
    this.#observe(
      absolute,
      observedImpact(change.impact, "external invalidation"),
    );
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

  async queryCompilerServer(
    method: CompilerServerQueryMethod,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.#closing !== null || this.#compiler.query === undefined) {
      return null;
    }
    return await this.#compiler.query(method, signal);
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
    this.#coldCheckAbort?.abort();
    this.#gate.close();
    if (this.#startPromise !== null) {
      await this.#startPromise;
      this.#closeWatch();
    }
    await this.#loop.close();
    // A scheduled cold build may still wait for the loop or stop its Haxe
    // process; it removes its own private folder.
    this.#coldCheckAbort?.abort();
    await this.#coldCheck?.catch(() => undefined);
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
    let next: ReconciledWatchSession;
    try {
      next = this.#dependencies.watch<ObservedImpact>({
        inputs: this.#watchInputs(inventory),
        merge: mergeObservedImpact,
        onChange: (change) => {
          if (this.#acceptWatchChanges) {
            this.#observe(change.path, change.cause, change.existence);
          } else {
            this.#startupInputChanged = true;
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
                this.#sanitizeCoreMessage(
                  error.message,
                  inventory.allowedRoots,
                ),
              ),
            );
          }
        },
        pollIntervalMs: this.#options.pollIntervalMs,
      });
    } catch (error) {
      throw new Error(
        this.#sanitizeCoreMessage(
          asError(error).message,
          inventory.allowedRoots,
        ),
      );
    }
    const previous = this.#watch;
    this.#watch = next;
    previous?.close();
  }

  #watchInputs(
    inventory: HxmlInventory,
  ): readonly WatchInput<ObservedImpact>[] {
    const inputs: WatchInput<ObservedImpact>[] = [];
    for (const hxml of inventory.hxmlFiles) {
      inputs.push({
        kind: "exact",
        path: hxml,
        cause: PLAN_INPUT_IMPACT,
      });
    }
    for (const provenance of inventory.libraryProvenanceFiles) {
      inputs.push({
        kind: "exact",
        path: provenance,
        cause: PLAN_INPUT_IMPACT,
      });
    }
    for (const classPath of inventory.classPaths) {
      inputs.push({
        kind: "tree",
        path: classPath,
        include: (relative) => relative.endsWith(".hx"),
        rejectSymlinks: true,
        cause: COMPILER_INPUT_IMPACT,
      });
    }
    for (const resource of inventory.resourceInputs) {
      inputs.push({
        kind: "exact",
        path: resource,
        cause: COMPILER_INPUT_IMPACT,
      });
    }
    for (const extra of this.#options.extraInputs ?? []) {
      const absolute = path.resolve(this.#layout.projectRoot, extra.path);
      const kind = extra.kind ?? "exact";
      if (kind !== "exact" && kind !== "tree") {
        throw new Error(`development-session extra input has an invalid kind: ${String(kind)}`);
      }
      const cause = observedImpact(
        extra.impact,
        `development-session extra input ${extra.path}`,
      );
      if (kind === "tree") {
        inputs.push({
          kind: "tree",
          path: absolute,
          cause,
          include: (_relative: string) => true,
          rejectSymlinks: true,
        });
      } else {
        inputs.push({ kind: "exact", path: absolute, cause });
      }
    }
    return Object.freeze(inputs);
  }

  /**
   * Records one changed input and requests a build.
   *
   * `existence` says how the path changed (`unknown` when a host reported it
   * through `invalidate`). Two kinds of change keep the warm Haxe cache:
   *
   * - a content edit of an existing `.hx` module on a class path. The
   *   session sends `server/invalidate` for it when Haxe could miss it;
   * - a change to a file that is not a `.hx` file and whose input the host
   *   declared with `keepCache` (Haxe and its macros never read it). For
   *   example a stylesheet that reaches Haxe only as a `prepareRevision`
   *   companion: the digest of the prepared files is a define, so a new
   *   companion already selects a separate Haxe cache. `keepCacheCovers`
   *   lists the paths that `keepCache` never covers.
   *
   * Every other change asks for an empty cache (`freshCache`):
   *
   * - a created or removed `.hx` module can change a name lookup in a file
   *   that did not change. Haxe 4.3.7 remembers a failed lookup, for example
   *   a missing `import.hx` or a top-level `TopThing` that a new
   *   `servercase/TopThing.hx` now shadows, without a dependency edge, so
   *   the unchanged module would keep its old meaning. `keepCache` does not
   *   change this, also not for a `.hx` file outside the declared class
   *   paths: Haxe always searches its working directory too;
   * - a macro may read any other file without telling Haxe, and a warm cache
   *   would keep the macro's old result.
   */
  #observe(
    absolutePath: string,
    impact: ObservedImpact,
    existence: "created" | "deleted" | "modified" | "unknown" = "unknown",
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
    // Only a content edit of a module file on a declared class path is sent
    // as `server/invalidate`. Any other `.hx` file (for example
    // `data/snippet.hx` that a macro reads, or a file that Haxe finds
    // through its working directory) asks for an empty cache.
    const sourceFile =
      absolutePath.endsWith(".hx") &&
      inventory.classPaths.some((classPath) => containedBy(classPath, absolutePath));
    const contentEdit = sourceFile && existence === "modified";
    const equalContent = sourceFile && this.#sourceUnchanged(absolutePath, contentEdit);
    // A save that leaves the bytes of the last accepted build needs no
    // build: like a `rebuild: false` change, it only advances the revision.
    const rebuild = impact.rebuild && !equalContent;
    if (rebuild) {
      this.#newestRebuildRevision = this.#newestRevision;
      // The cold build checks the tree of the accepted revision; an edit
      // makes it out of date and needs the machine for the new build.
      this.#coldCheckAbort?.abort();
      // A save in the quiet time after a preview cancels that program
      // request: the build of this save starts with its own module request.
      this.#lastRebuildChangeAt = Date.now();
      this.#quietWake?.abort();
    }
    if (contentEdit) {
      this.#pendingInvalidations.add(absolutePath);
    }
    if (sourceFile) {
      this.#pendingSourceTimes.add(absolutePath);
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
        reinventory: impact.reinventory,
        restartCompiler: impact.restartCompiler,
        rebuild,
        freshCache:
          rebuild &&
          !contentEdit &&
          !(impact.keepCache && keepCacheCovers(absolutePath, existence)),
        editedModules: Object.freeze(rebuild && contentEdit ? [absolutePath] : []),
        // A change that needs no build cannot stop a preview.
        onlyModuleEdits: !rebuild || contentEdit,
      }),
    );
  }

  /**
   * Records a change of a source file for the rule "no build when each
   * changed file has equal content", and returns true when this change
   * leaves the file with the bytes that the last accepted program request
   * read.
   *
   * Why: the watcher compares sizes and times only. An editor that saves
   * without a change, a formatter that writes the same text, or a `touch`
   * would otherwise cost a module request and a program request.
   *
   * When the rule holds: only for a content edit, only with `modulePreview`
   * while generation reuse is active (so every program request keeps module
   * records), and only while the newest revision that needs a build is
   * accepted, so a save after a failed or a running build still builds
   * (a save is a common way to retry). The skip leaves the file with a new
   * file time that no request has read. That is safe because of Genes'
   * digest check: a later module request reads every stored source file
   * whose status changed and compares its digest with the content that the
   * program request typed (`ModuleRequest`, `source-changed`), so it never
   * trusts the file time. Without module records the session keeps the
   * ordinary rule: every save builds.
   *
   * Every other change forgets the recorded digest, so the file counts as
   * changed until an accepted program request reads it again
   * (`#readSources`, `#commitSources`). A file that no accepted program
   * request has read in this session always builds.
   */
  #sourceUnchanged(absolutePath: string, contentEdit: boolean): boolean {
    this.#sourceChanges.set(
      absolutePath,
      (this.#sourceChanges.get(absolutePath) ?? 0) + 1,
    );
    if (this.#modulePreview === null) return false;
    const built = this.#builtSources.get(absolutePath);
    const accepted = this.#accepted;
    if (
      contentEdit &&
      built !== undefined &&
      this.#generationReuse !== null &&
      this.#reuseActive &&
      accepted !== null &&
      accepted.revision >= this.#newestRebuildRevision
    ) {
      try {
        if (sha256Bytes(readFileSync(absolutePath)) === built) return true;
      } catch {
        // An unreadable file counts as changed.
      }
    }
    this.#builtSources.delete(absolutePath);
    this.#dirtySources.add(absolutePath);
    return false;
  }

  /**
   * Reads the digest of each changed source file just before a program
   * request, for `#commitSources`. A file that changes while it is read is
   * left out, and so is a removed file (it leaves the changed set: a new
   * file at that path is a created file, which always builds).
   */
  #readSources(): Map<string, SourceRead> {
    const reads = new Map<string, SourceRead>();
    if (this.#modulePreview === null) return reads;
    for (const file of [...this.#dirtySources]) {
      const before = sourceStatus(file);
      if (before === null) {
        if (!existsSync(file)) this.#dirtySources.delete(file);
        continue;
      }
      let digest: string;
      try {
        digest = sha256Bytes(readFileSync(file));
      } catch {
        continue;
      }
      if (sourceStatus(file) !== before) continue;
      reads.set(file, {
        digest,
        status: before,
        changes: this.#sourceChanges.get(file) ?? 0,
      });
    }
    return reads;
  }

  /**
   * Keeps only the reads whose file was not written while the program
   * request ran, so the digest is the content that Haxe read.
   */
  #keepUnwrittenSources(reads: Map<string, SourceRead>): void {
    for (const [file, read] of reads) {
      if (sourceStatus(file) !== read.status) reads.delete(file);
    }
  }

  /**
   * Records the digests that an accepted program request read. A file that
   * changed again after the read (another change count) stays changed.
   */
  #commitSources(reads: ReadonlyMap<string, SourceRead>): void {
    for (const [file, read] of reads) {
      if ((this.#sourceChanges.get(file) ?? 0) !== read.changes) continue;
      this.#builtSources.set(file, read.digest);
      this.#dirtySources.delete(file);
    }
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
    /** True once the module-first step decided this build's preview. */
    let previewDecided = false;
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
      // A new compiler epoch changes the compatibility digest, so the owned
      // server is stopped and a new one starts with an empty cache. That
      // costs the same full typing as a new cache in the old server, and it
      // frees the old cache instead of keeping it until the session ends.
      if (cause.restartCompiler || cause.freshCache) this.#compilerEpoch += 1;
      const retainedPlan = this.#effectivePlan;
      if (retainedPlan === null) {
        throw new Error("effective Haxe invocation is unavailable");
      }
      // Resolve the invocation plan only when one of its inputs changed.
      // Resolution runs the host callback (which may hash the compiler
      // binary) and the HXML and library inventory (which may start Lix), so
      // doing it twice for each source edit cost seconds. A plan input has
      // changed when the cause says so (HXML, library provenance, or an
      // extra input with `reinventory` or `restartCompiler`), when the
      // process environment differs, or when an HXML or provenance file has
      // other bytes. The last two checks take about a millisecond and run
      // again just before Haxe starts. A reinventory has just confirmed the
      // plan in `#replanGapSafe`.
      const planInputsCurrent = (plan: EffectiveHaxeInvocationPlan): boolean =>
        ambientEnvironmentKey() === this.#planEnvironments.get(plan) &&
        planInputFilesUnchanged(plan);
      const planInputChanged =
        cause.reinventory ||
        cause.restartCompiler ||
        !planInputsCurrent(retainedPlan);
      const executionPlan = planInputChanged && !cause.reinventory
        ? await this.#resolveEffectivePlan(abort.signal)
        : retainedPlan;
      if (this.#closing !== null || abort.signal.aborted) return;
      if (retainedPlan.identity !== executionPlan.identity) {
        this.#observe(
          executionPlan.inventory.entryHxmlFiles[0]!,
          PLAN_INPUT_IMPACT,
        );
        this.#emit({
          kind: "candidate-superseded",
          revision: cause.revision,
          newestRevision: this.#newestRevision,
        });
        return;
      }
      // An equal identity means an equal plan. Keep the newer object, so the
      // environment it was made from is the one compared next time.
      this.#effectivePlan = executionPlan;
      const compatibilityDigest = this.#compatibilityDigest(executionPlan);
      // The module-first path: an input change first gets a module request
      // and, when Genes admits it, a preview. The first build and repair
      // builds have no changed path.
      if (this.#modulePreview !== null && cause.paths.length > 0) {
        const preview = await this.#previewFirst(
          cause,
          executionPlan,
          compatibilityDigest,
          abort.signal,
        );
        previewDecided = true;
        if (
          preview === "superseded" ||
          this.#closing !== null ||
          abort.signal.aborted
        ) {
          return;
        }
      }
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
      const requestRoot = path.join(
        this.#layout.projectRoot,
        ...this.#layout.requestRelative.split("/"),
      );
      const stagedCompilerData = stageCompilerData(
        candidateStageRoot,
        this.#compilerDataDeclarations,
        path.join(requestRoot, COMPILER_DATA_DESCRIPTOR_FILE),
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
      const reuse = this.#reuseActive ? this.#generationReuse : null;
      const incremental: IncrementalBinding = reuse === null
        ? Object.freeze({ kind: "measure" })
        : Object.freeze({
            kind: "reuse",
            auditModules: reuse.auditModules,
            // Module requests compare an edit with these records.
            moduleRecords: this.#modulePreview !== null,
          });
      const generationReport = path.join(requestRoot, GENERATION_REPORT_FILE);
      const boundInvocation = bindHaxeInvocation(
        executionPlan,
        candidateStageRoot,
        candidateOutputFile,
        requestRoot,
        stagedCompilerData?.descriptorPath,
        incremental,
      );
      // A report of an earlier request must not count for this one.
      if (reuse !== null) rmSync(generationReport, { force: true });
      for (const input of boundInvocation.privateArgumentFiles) {
        mkdirSync(path.dirname(input.path), { recursive: true, mode: 0o700 });
        writeFileSync(input.path, input.contents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }
      for (const input of [
        ...boundInvocation.requestFiles,
        ...(stagedCompilerData === null
          ? []
          : [
              {
                path: stagedCompilerData.descriptorPath,
                contents: stagedCompilerData.descriptorContents,
              },
            ]),
      ]) {
        await replaceRequestFile(input.path, input.contents);
      }
      if (this.#closing !== null || abort.signal.aborted) return;
      const { changedFiles, invalidatedFiles, recordedFiles } =
        this.#takeInvalidations();
      // For "no build when each changed file has equal content": the bytes
      // of each changed source file that this request reads.
      const sourceReads = this.#readSources();
      let compiler: CompilerResult;
      // Genes replaces the records of the last program request with the
      // records of this one, whether or not its candidate is published.
      this.#publishedIsLastProgram = false;
      try {
        compiler = await this.#compiler.compile(
          boundInvocation,
          compatibilityDigest,
          abort.signal,
          async () => {
            if (!planInputChanged && planInputsCurrent(executionPlan)) return;
            const finalPlan = await this.#resolveEffectivePlan(abort.signal);
            if (executionPlan.identity !== finalPlan.identity) {
              this.#observe(
                finalPlan.inventory.entryHxmlFiles[0]!,
                PLAN_INPUT_IMPACT,
              );
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
          invalidatedFiles,
        );
      } catch (error) {
        this.#restoreInvalidations(changedFiles);
        throw error;
      } finally {
        this.#recordRequestTimes(recordedFiles);
      }
      this.#keepUnwrittenSources(sourceReads);
      if (this.#closing !== null || abort.signal.aborted) return;
      // The rolling replay audit runs inside the Genes request; what it
      // printed and found is in the generation report beside the descriptor.
      const replayAudit =
        reuse === null ? NO_REPLAY_AUDIT : readReplayAudit(generationReport);
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
      this.#comparePreviews(cause.revision, candidate);
      if (replayAudit.differing.length > 0) {
        // Genes found stale replayed output in this candidate: never publish
        // it. Genes dropped its cache, so the rebuild prints every module.
        capturedCompilerData.dispose();
        this.#onReplayAuditDifference(cause.revision, replayAudit.differing);
        return;
      }
      for (const module of replayAudit.audited) this.#auditSuspects.delete(module);
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
      let published: AcceptedGeneration | null = null;
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
        published = prepared.accepted;
        this.#acceptedPreparedDigest = stagedPrepared?.digest ?? null;
        this.#publishedManifestDigest = candidate.manifestDigest;
        this.#acceptedGenesDigests = new Map(
          candidate.files.map((file) => [file.relativePath, file.digest]),
        );
        this.#publishedIsLastProgram = true;
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
        if (this.#closing !== null || abort.signal.aborted) return;
        this.#commitSources(sourceReads);
        this.#settlePreviews(prepared.accepted);
      }, abort.signal);
      const accepted: AcceptedGeneration | null = published;
      if (
        accepted !== null &&
        this.#closing === null &&
        !abort.signal.aborted
      ) {
        this.#afterReuseGeneration(accepted, compiler.mode);
      }
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
      // A comparison counts only for an accepted candidate; the next
      // program candidate compares the previews that are still pending.
      for (const pending of this.#pendingPreviews.values()) pending.comparison = null;
      // The changes of a build that ended before its module-first step (for
      // example a failed inventory) were proven by no preview.
      if (this.#modulePreview !== null && cause.paths.length > 0 && !previewDecided) {
        this.#markPreviewsUncovered(cause.revision);
      }
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

  /**
   * Takes the changed source files that the next Haxe request must report.
   *
   * Haxe compares file times in whole seconds, so a second save within the
   * same second as the last request looks unchanged to it. The compiler
   * tells the server about such a file directly (`invalidatedFiles`). The
   * list is taken now and given back (`#restoreInvalidations`) when the
   * request fails, so a later request still reports those files. It is sent
   * before the request starts, so it also covers an init macro given before
   * `genes.Generator.use()` that types a project module by name, which runs
   * before Genes can make Haxe read a changed file again (genes-v54c).
   *
   * A module request takes the list too: it types the edited file, so the
   * program request after it must not invalidate that file again (Haxe
   * would type it once more).
   */
  #takeInvalidations(): {
    readonly changedFiles: readonly string[];
    readonly invalidatedFiles: readonly string[];
    readonly recordedFiles: readonly string[];
  } {
    const changedFiles = bytewise(this.#pendingInvalidations);
    this.#pendingInvalidations.clear();
    const changedSeconds = changedFiles.map((file) => fileSeconds(file));
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Haxe reads the file again by itself only when its second is later
    // than every second Haxe can have recorded for it: not at or before the
    // end of the last request, not at or before a second recorded for this
    // file, and not ahead of the clock (a later request may have read it).
    const invalidatedFiles = changedFiles.filter((file, index) => {
      const seconds = changedSeconds[index]!;
      return (
        seconds <= this.#lastRequestStampSeconds ||
        seconds <= (this.#seenSourceSeconds.get(file) ?? -1) ||
        seconds > nowSeconds
      );
    });
    const recordedFiles = bytewise(this.#pendingSourceTimes);
    this.#pendingSourceTimes.clear();
    return Object.freeze({
      changedFiles: Object.freeze(changedFiles),
      invalidatedFiles: Object.freeze(invalidatedFiles),
      recordedFiles: Object.freeze(recordedFiles),
    });
  }

  /** Gives back the changed files of a request that failed (`#takeInvalidations`). */
  #restoreInvalidations(changedFiles: readonly string[]): void {
    for (const file of changedFiles) this.#pendingInvalidations.add(file);
  }

  /**
   * Records, after a Haxe request, the whole-second times that the server
   * may have read: the end of the request, and the time of each changed
   * source file (see `#takeInvalidations`).
   */
  #recordRequestTimes(recordedFiles: readonly string[]): void {
    // File times are wall-clock times, so this is the wall clock too.
    this.#lastRequestStampSeconds = Math.max(
      this.#lastRequestStampSeconds,
      Math.floor(Date.now() / 1000),
    );
    for (const file of recordedFiles) {
      const seconds = fileSeconds(file);
      if (seconds < 0) this.#seenSourceSeconds.delete(file);
      else this.#seenSourceSeconds.set(file, Math.max(seconds, this.#seenSourceSeconds.get(file) ?? -1));
    }
  }

  /** Emits `preview-refused` for this build and returns `refused`. */
  #refusePreview(
    revision: number,
    module: string | null,
    source: "genes" | "session",
    code: string,
  ): "refused" {
    this.#markPreviewsUncovered(revision);
    this.#emit({ kind: "preview-refused", revision, module, source, code });
    return "refused";
  }

  /**
   * Records that the changes up to `revision` reached a build that shows no
   * preview: each older pending preview is no longer known to match its
   * sources (`PendingPreview.clean`), and the published tree is no longer
   * the base that a later preview is proven against.
   */
  #markPreviewsUncovered(revision: number): void {
    this.#publishedIsLastProgram = false;
    for (const pending of this.#pendingPreviews.values()) {
      if (pending.revision < revision) pending.clean = false;
    }
  }

  /**
   * The module-first step of one build (`GenesDevelopmentOptions.modulePreview`).
   *
   * When the build has exactly one edited module, it sends a module request:
   * the program's arguments with the module as the only root, a private
   * output folder beside the program's at the same depth, and a request
   * descriptor with `"kind": "module"` at the same fixed path as the
   * program's descriptor. The queue runs one build at a time, so no request
   * is in flight while the session rewrites that one descriptor.
   *
   * Returns `refused` when no preview was shown (the program request then
   * runs at once), `previewed` after a preview and the quiet time, and
   * `superseded` when a newer change arrived before the quiet time ended:
   * the build then sends no program request, and the next build starts with
   * the module request of that change.
   *
   * A preview never fails the build: any unexpected error is a refusal.
   */
  async #previewFirst(
    cause: BuildCause,
    plan: EffectiveHaxeInvocationPlan,
    compatibilityDigest: string,
    signal: AbortSignal,
  ): Promise<"refused" | "previewed" | "superseded"> {
    const settings = this.#modulePreview!;
    const revision = cause.revision;
    const refuse = (
      code: SessionPreviewRefusalCode,
      module: string | null,
    ): "refused" => this.#refusePreview(revision, module, "session", code);
    if (!cause.onlyModuleEdits || cause.editedModules.length === 0) {
      return refuse("not-module-edit", null);
    }
    if (cause.editedModules.length > 1) return refuse("several-modules", null);
    const module = moduleNameOf(cause.editedModules[0]!, plan.inventory.classPaths);
    if (module === null) return refuse("module-path-unknown", null);
    if (this.#stoppedPreviewModules.has(module)) {
      return refuse("previews-stopped", module);
    }
    if (this.#generationReuse === null || !this.#reuseActive) {
      return refuse("reuse-off", module);
    }
    const compileModule = this.#compiler.compileModule?.bind(this.#compiler);
    if (compileModule === undefined) return refuse("server-unavailable", module);

    const stageRelative = `${this.#layout.candidatesRelative}/preview-${revision}-${this.#dependencies.nonce()}`;
    const stageRoot = path.join(
      this.#layout.projectRoot,
      ...stageRelative.split("/"),
    );
    try {
      // `output/<entry>` as in a program candidate: the same depth below
      // the project, so relative paths in source maps are the same.
      const outputRoot = path.join(stageRoot, "output");
      const requestRoot = path.join(
        this.#layout.projectRoot,
        ...this.#layout.requestRelative.split("/"),
      );
      const stagedCompilerData = stageCompilerData(
        stageRoot,
        this.#compilerDataDeclarations,
        path.join(requestRoot, COMPILER_DATA_DESCRIPTOR_FILE),
      );
      let prepared: StagedPreparedRevision | null = null;
      if (this.#options.prepareRevision !== undefined) {
        const preparation = await this.#options.prepareRevision({ revision, signal });
        if (this.#closing !== null || signal.aborted) return "superseded";
        if (!preparation.ok) return refuse("compile-failed", module);
        prepared = stagePreparedRevision(this.#layout, stageRelative, preparation.prepared);
      }
      mkdirSync(path.join(stageRoot, "haxe-target"), { recursive: true, mode: 0o700 });
      const bound = bindHaxeInvocation(
        plan,
        stageRoot,
        path.join(outputRoot, this.#layout.outputIdentity),
        requestRoot,
        stagedCompilerData?.descriptorPath,
        Object.freeze({ kind: "module", module }),
      );
      const reportPath = path.join(requestRoot, GENERATION_REPORT_FILE);
      rmSync(reportPath, { force: true });
      for (const input of bound.privateArgumentFiles) {
        mkdirSync(path.dirname(input.path), { recursive: true, mode: 0o700 });
        writeFileSync(input.path, input.contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
      for (const input of [
        ...bound.requestFiles,
        ...(stagedCompilerData === null
          ? []
          : [{ path: stagedCompilerData.descriptorPath, contents: stagedCompilerData.descriptorContents }]),
      ]) {
        await replaceRequestFile(input.path, input.contents);
      }
      if (this.#closing !== null || signal.aborted) return "superseded";
      const { changedFiles, invalidatedFiles, recordedFiles } = this.#takeInvalidations();
      let outcome: ModuleCompileOutcome;
      try {
        outcome = await compileModule(
          bound,
          compatibilityDigest,
          signal,
          prepared === null
            ? undefined
            : Object.freeze({ classPaths: prepared.classPaths, digest: prepared.digest }),
          invalidatedFiles,
        );
      } catch (error) {
        this.#restoreInvalidations(changedFiles);
        throw error;
      } finally {
        this.#recordRequestTimes(recordedFiles);
      }
      if (outcome.kind !== "compiled") this.#restoreInvalidations(changedFiles);
      if (this.#closing !== null || signal.aborted) return "superseded";
      // A late preview: a newer change arrived while the module request
      // ran, so these files may show older text than the editor has. Show
      // nothing; the next build starts with the module request of the newer
      // change. This build's own change got no preview.
      if (this.#newestRebuildRevision > revision) {
        this.#markPreviewsUncovered(revision);
        return "superseded";
      }
      if (outcome.kind === "unavailable") return refuse("server-unavailable", module);
      if (outcome.kind === "failed") return refuse("compile-failed", module);
      const report = readModuleReport(reportPath, module);
      if (report === null) return refuse("no-report", module);
      if (report.result !== "preview") {
        return this.#refusePreview(revision, module, "genes", report.refusal ?? report.result);
      }
      const files = new Map<string, PreviewEntry>();
      for (const relative of [...report.files].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)))) {
        const absolute = path.join(outputRoot, ...relative.split("/"));
        if (!plainOutputPath(relative) || !containedBy(outputRoot, absolute)) {
          return refuse("no-report", module);
        }
        const stats = lstatSync(absolute, { throwIfNoEntry: false });
        if (stats === undefined || !stats.isFile()) return refuse("no-report", module);
        const bytes = readFileSync(absolute);
        files.set(relative, Object.freeze({
          logicalPath: logicalOutputPath(this.#layout, relative),
          sha256: sha256Bytes(bytes),
          bytes,
        }));
      }
      if (files.size === 0) return refuse("no-report", module);
      this.#pendingPreviews.set(module, {
        revision,
        module,
        files,
        comparison: null,
        clean: true,
        extraCheck: this.#publishedIsLastProgram,
      });
      this.#emit({
        kind: "preview-generated",
        revision,
        module,
        files: Object.freeze(
          [...files.values()].map((entry) =>
            Object.freeze({
              path: entry.logicalPath,
              sha256: entry.sha256,
              sizeBytes: entry.bytes.byteLength,
            }),
          ),
        ),
      });
    } catch {
      // A preview must never fail the build: the program request follows.
      if (this.#closing !== null || signal.aborted) return "superseded";
      return refuse("no-report", module);
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
    // The quiet time: the program request starts when no change that needs
    // a build came for `quietMs`. A newer change ends this build.
    for (;;) {
      if (this.#closing !== null || signal.aborted) return "superseded";
      if (this.#newestRebuildRevision > revision) return "superseded";
      const remaining = this.#lastRebuildChangeAt + settings.quietMs - Date.now();
      if (remaining <= 0) return "previewed";
      const wake = new AbortController();
      this.#quietWake = wake;
      try {
        await abortableDelay(remaining, AbortSignal.any([signal, wake.signal]));
      } finally {
        if (this.#quietWake === wake) this.#quietWake = null;
      }
    }
  }

  /**
   * The compare step: when the program candidate of `revision` exists,
   * compares the bytes of each pending preview of that revision or an
   * earlier one with the candidate's file at the same path. The result is
   * used only if the candidate is accepted (`#settlePreviews`).
   */
  #comparePreviews(revision: number, candidate: GenesOutputInventory): void {
    if (this.#pendingPreviews.size === 0) return;
    const owned = new Map(candidate.files.map((file) => [file.relativePath, file]));
    // The Genes files that this candidate changes in the published tree.
    const published = this.#acceptedGenesDigests;
    let changed: ReadonlySet<string> | null = null;
    if (published !== null) {
      const paths = new Set<string>();
      for (const file of candidate.files) {
        if (published.get(file.relativePath) !== file.digest) {
          paths.add(logicalOutputPath(this.#layout, file.relativePath));
        }
      }
      for (const relative of published.keys()) {
        if (!owned.has(relative)) paths.add(logicalOutputPath(this.#layout, relative));
      }
      changed = paths;
    }
    for (const pending of this.#pendingPreviews.values()) {
      if (pending.revision > revision) {
        pending.comparison = null;
        continue;
      }
      const differing: string[] = [];
      const programBytes = new Map<string, Buffer | null>();
      for (const [relative, entry] of pending.files) {
        const file = owned.get(relative);
        if (file !== undefined && file.digest === entry.sha256) continue;
        differing.push(relative);
        let bytes: Buffer | null = null;
        try {
          bytes = file === undefined ? null : readFileSync(file.absolutePath);
        } catch {
          bytes = null;
        }
        programBytes.set(relative, bytes);
      }
      pending.comparison = Object.freeze({
        candidateRevision: revision,
        differing: Object.freeze(differing),
        programBytes,
        changed,
      });
    }
  }

  /**
   * Settles each pending preview that the accepted candidate was compared
   * with: `preview-confirmed` when every file has the previewed bytes,
   * else `preview-corrected`.
   *
   * A preview whose sources did not move after it (`PendingPreview.clean`:
   * every later change was proven by an admitted preview of another
   * module) must equal the accepted result; a difference is a Genes defect
   * (`differs`): it is counted, the files are kept as evidence, and the
   * module gets no further preview in this session. When the preview was
   * proven against the published tree (`extraCheck`), the accepted
   * generation may also change no other Genes file than the files of the
   * previews that it settles: Genes proved that a program request changes
   * exactly the previewed files. Any other difference is the effect of a
   * later edit (`newer-revision`).
   *
   * Example: a preview of `ui.Button` at revision 2 with wrong bytes, then
   * an admitted preview of `ui.Card` at revision 3, then the accepted
   * generation of revision 3: Button's sources did not change after
   * revision 2, so its difference is `differs`, not `newer-revision`.
   */
  #settlePreviews(accepted: AcceptedGeneration): void {
    const settled = [...this.#pendingPreviews].filter(
      ([, pending]) => pending.comparison !== null,
    );
    const claimed = new Set(
      settled.flatMap(([, pending]) =>
        [...pending.files.values()].map((entry) => entry.logicalPath),
      ),
    );
    for (const [module, pending] of settled) {
      const comparison = pending.comparison!;
      this.#pendingPreviews.delete(module);
      const logical = (relative: string): string =>
        logicalOutputPath(this.#layout, relative);
      const extra = pending.clean && pending.extraCheck && comparison.changed !== null
        ? bytewise([...comparison.changed].filter((changedPath) => !claimed.has(changedPath)))
        : [];
      if (comparison.differing.length === 0 && extra.length === 0) {
        this.#emit({
          kind: "preview-confirmed",
          revision: pending.revision,
          module,
          generation: accepted.generation,
          paths: Object.freeze([...pending.files.values()].map((entry) => entry.logicalPath)),
        });
        continue;
      }
      const differs = pending.clean;
      if (differs) {
        this.#previewDifferences += 1;
        this.#stoppedPreviewModules.add(module);
        this.#keepPreviewEvidence(pending, comparison, accepted, extra);
      }
      this.#emit({
        kind: "preview-corrected",
        revision: pending.revision,
        module,
        generation: accepted.generation,
        paths: Object.freeze(
          bytewise(new Set([...comparison.differing.map(logical), ...extra])),
        ),
        cause: differs ? "differs" : "newer-revision",
      });
    }
  }

  /**
   * Keeps the files of one preview difference in
   * `<stateDirectory>/preview-evidence/revision-<N>-<module>-<session>/`:
   * `preview/<path>` (the previewed bytes), `program/<path>` (the accepted
   * bytes, absent when the program has no such file) and `evidence.json`
   * (with `otherChangedPaths`: other Genes files that the accepted
   * generation changed although no settled preview named them).
   * At most `PREVIEW_EVIDENCE_LIMIT` differences per session; a failure to
   * write is ignored, because evidence must not fail the build.
   */
  #keepPreviewEvidence(
    pending: PendingPreview,
    comparison: PreviewComparison,
    accepted: AcceptedGeneration,
    extra: readonly string[],
  ): void {
    if (this.#previewEvidenceKept >= PREVIEW_EVIDENCE_LIMIT) return;
    this.#previewEvidenceKept += 1;
    try {
      const folder = path.join(
        this.#layout.stateRoot,
        "preview-evidence",
        `revision-${pending.revision}-${pending.module}-${this.#sessionNonce.slice(0, 12)}`,
      );
      const write = (side: string, relative: string, bytes: Buffer): void => {
        const file = path.join(folder, side, ...relative.split("/"));
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, bytes, { mode: 0o600 });
      };
      for (const relative of comparison.differing) {
        const preview = pending.files.get(relative);
        if (preview !== undefined) write("preview", relative, preview.bytes);
        const program = comparison.programBytes.get(relative);
        if (program !== undefined && program !== null) write("program", relative, program);
      }
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(folder, "evidence.json"),
        `${JSON.stringify({
          format: 1,
          revision: pending.revision,
          module: pending.module,
          generation: accepted.generation,
          paths: comparison.differing.map((relative) => ({
            path: logicalOutputPath(this.#layout, relative),
            previewSha256: pending.files.get(relative)?.sha256 ?? null,
            programSha256: (() => {
              const bytes = comparison.programBytes.get(relative);
              return bytes === undefined || bytes === null ? null : sha256Bytes(bytes);
            })(),
          })),
          // Genes files that the accepted generation also changed, which no
          // settled preview named.
          otherChangedPaths: extra,
        }, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch {
      // Evidence is best effort; the count and the event still report it.
    }
  }

  /**
   * Handles a build whose candidate the Genes rolling replay audit found
   * stale: reports a `replay-audit` event and builds the same revision again
   * at once, on the same server (Genes dropped its generation cache, so the
   * rebuild prints every module). The caller has discarded the candidate.
   *
   * When a module of this difference was also in the last one, with no clean
   * audit of it in between, the defect stays. The session then reports
   * `AUDIT_REPEATED` and turns generation reuse off for the rest of its life,
   * so that the defect cannot make every later build run twice.
   */
  #onReplayAuditDifference(revision: number, modules: readonly string[]): void {
    const repeated = modules.some((module) => this.#auditSuspects.has(module));
    if (repeated) {
      this.#reuseActive = false;
      this.#auditSuspects = new Set();
      this.#coldCheckAbort?.abort();
    } else {
      this.#auditSuspects = new Set(modules);
    }
    this.#emitOutputCheck({
      check: "replay-audit",
      revision,
      result: "differs",
      modules,
      ...(repeated ? { code: "AUDIT_REPEATED" as const } : {}),
    });
    this.#requestRepair(false);
  }

  /**
   * Counts one accepted generation towards the next cold build, and schedules
   * it when it is due: after `coldCheckEvery` warm generations, or at once
   * after a generation that repaired a cold-build difference (to see whether
   * the repair worked). A direct build (no server) is cold already and starts
   * the count again. Does nothing without active generation reuse.
   */
  #afterReuseGeneration(
    accepted: AcceptedGeneration,
    mode: "connected" | "direct",
  ): void {
    const reuse = this.#generationReuse;
    if (reuse === null || !this.#reuseActive || reuse.coldCheckEvery === 0) return;
    if (mode === "direct") {
      this.#generationsSinceColdCheck = 0;
      return;
    }
    this.#generationsSinceColdCheck += 1;
    if (
      !this.#coldVerifyPending &&
      this.#generationsSinceColdCheck < reuse.coldCheckEvery
    ) {
      return;
    }
    // At most one cold build runs: a new one waits for the one before,
    // which ends at once when its generation is no longer public.
    const previous = this.#coldCheck;
    const scheduled = (async () => {
      await previous?.catch(() => undefined);
      await this.#scheduleColdCheck(accepted, reuse.coldCheckIdleMs);
    })();
    this.#coldCheck = scheduled;
    void scheduled
      .catch(() => undefined)
      .finally(() => {
        if (this.#coldCheck === scheduled) this.#coldCheck = null;
      });
  }

  /**
   * Builds the current revision again although no input changed, after an
   * output check found a candidate or a published tree that differs from the
   * reference. `freshCache` also starts a new Haxe server, whose caches are
   * empty (after a cold-build difference, which can come from any cache).
   */
  #requestRepair(freshCache: boolean): void {
    if (this.#closing !== null) return;
    this.#loop.request(
      Object.freeze({
        revision: this.#newestRevision,
        paths: Object.freeze([]),
        reinventory: false,
        restartCompiler: false,
        rebuild: true,
        freshCache,
        editedModules: Object.freeze([]),
        onlyModuleEdits: false,
      }),
    );
  }

  /**
   * Waits until no build is active or waiting, then `idleMs` more, then runs
   * the cold build for `accepted` if it is still the public generation and
   * no edit that needs a build arrived. An edit in the idle time aborts the
   * wait (`#coldCheckAbort`) without an event; the check stays due, and the
   * next accepted generation schedules it again.
   */
  async #scheduleColdCheck(
    accepted: AcceptedGeneration,
    idleMs: number,
  ): Promise<void> {
    await this.#loop.waitForIdle();
    if (this.#closing !== null || !this.#reuseActive) return;
    const abort = new AbortController();
    this.#coldCheckAbort = abort;
    try {
      await abortableDelay(idleMs, abort.signal);
      if (
        abort.signal.aborted ||
        this.#closing !== null ||
        this.#accepted !== accepted ||
        this.#newestRebuildRevision > accepted.revision ||
        this.#loop.state !== "idle"
      ) {
        return;
      }
      await this.#runColdCheck(accepted, abort);
    } finally {
      if (this.#coldCheckAbort === abort) this.#coldCheckAbort = null;
    }
  }

  /**
   * Returns true when the inputs still describe `accepted`: no edit is
   * waiting, also none that only a reconciliation of the watched inputs
   * finds (such an edit is then reported, which aborts `abort`), and
   * `accepted` is still the public generation. Runs under a publication read
   * lease, so no publication can happen while it looks.
   */
  async #coldInputsCurrent(
    accepted: AcceptedGeneration,
    abort: AbortController,
  ): Promise<boolean> {
    const release = await this.#gate.acquireRead();
    try {
      const reconciled = this.reconcile();
      return (
        reconciled.ok &&
        !reconciled.changed &&
        !abort.signal.aborted &&
        this.#accepted === accepted &&
        this.#newestRebuildRevision <= accepted.revision
      );
    } finally {
      release();
    }
  }

  /**
   * The cold build of the output check: builds the revision of `accepted` in
   * a new Haxe process (`SessionCompiler.compileCold`), with no incremental
   * define and so no cache of any kind, into a private folder at the depth
   * of a candidate folder (source maps hold paths relative to the folder
   * that Genes wrote), and compares that Genes tree with the published one.
   *
   * The inputs are reconciled under a read lease before the build starts and
   * again before the result counts (`#coldInputsCurrent`): an edit that the
   * watcher had not reported yet would otherwise make the cold tree, built
   * from the edited source, differ from the older public tree. Any change
   * gives `cancelled`, which keeps the check due. An edit or `close` also
   * aborts the build (`abort`).
   *
   * A difference, or a cold Haxe failure while the warm build passed
   * (`COLD_BUILD_FAILED`), starts a new server and rebuilds the revision; the
   * generation of that rebuild is checked again at once. If the difference
   * survives (`COLD_DIFFERS_AFTER_REPAIR`), it is reported and no cold
   * difference is repaired any more. Every result is one `output-check`
   * event, except during `close`. The private folder is removed in every
   * case.
   */
  async #runColdCheck(
    accepted: AcceptedGeneration,
    abort: AbortController,
  ): Promise<void> {
    const plan = this.#effectivePlan;
    if (plan === null || this.#closing !== null) return;
    const stageRelative = `${this.#layout.candidatesRelative}/cold-${accepted.generation}-${this.#dependencies.nonce()}`;
    const stageRoot = path.join(
      this.#layout.projectRoot,
      ...stageRelative.split("/"),
    );
    let result: ColdBuildCheck["result"] = "failed";
    let code: ColdBuildCheck["code"];
    let message: string | undefined;
    let paths: readonly string[] = Object.freeze([]);
    try {
      const compileCold = this.#compiler.compileCold?.bind(this.#compiler);
      if (compileCold === undefined) {
        code = "COLD_BUILD_UNSUPPORTED";
        return;
      }
      if (!(await this.#coldInputsCurrent(accepted, abort))) {
        result = "cancelled";
        return;
      }
      const outputRoot = path.join(stageRoot, "output");
      const requestRoot = path.join(stageRoot, "request");
      mkdirSync(path.join(stageRoot, "haxe-target"), {
        recursive: true,
        mode: 0o700,
      });
      mkdirSync(requestRoot, { recursive: true, mode: 0o700 });
      const stagedCompilerData = stageCompilerData(
        stageRoot,
        this.#compilerDataDeclarations,
        path.join(requestRoot, COMPILER_DATA_DESCRIPTOR_FILE),
      );
      let prepared: StagedPreparedRevision | null = null;
      if (this.#options.prepareRevision !== undefined) {
        const preparation = await this.#options.prepareRevision({
          revision: accepted.revision,
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          result = "cancelled";
          return;
        }
        if (preparation.ok) {
          prepared = stagePreparedRevision(
            this.#layout,
            stageRelative,
            preparation.prepared,
          );
        }
        if (
          !preparation.ok ||
          prepared === null ||
          prepared.digest !== this.#acceptedPreparedDigest
        ) {
          code = "PREPARED_FILES_CHANGED";
          return;
        }
      } else if (this.#acceptedPreparedDigest !== null) {
        code = "PREPARED_FILES_CHANGED";
        return;
      }
      const bound = bindHaxeInvocation(
        plan,
        stageRoot,
        path.join(outputRoot, this.#layout.outputIdentity),
        requestRoot,
        stagedCompilerData?.descriptorPath,
        Object.freeze({ kind: "none" }),
      );
      for (const input of bound.privateArgumentFiles) {
        mkdirSync(path.dirname(input.path), { recursive: true, mode: 0o700 });
        writeFileSync(input.path, input.contents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }
      for (const input of [
        ...bound.requestFiles,
        ...(stagedCompilerData === null
          ? []
          : [
              {
                path: stagedCompilerData.descriptorPath,
                contents: stagedCompilerData.descriptorContents,
              },
            ]),
      ]) {
        await replaceRequestFile(input.path, input.contents);
      }
      let coldFailure: string | null = null;
      try {
        await compileCold(
          bound,
          abort.signal,
          prepared === null
            ? undefined
            : Object.freeze({
                classPaths: prepared.classPaths,
                digest: prepared.digest,
              }),
        );
      } catch (error) {
        coldFailure = asError(error).message;
      }
      // The cold build read the inputs while it ran: an edit that arrived
      // meanwhile, reported or not, makes its result meaningless.
      if (abort.signal.aborted || !(await this.#coldInputsCurrent(accepted, abort))) {
        result = "cancelled";
        return;
      }
      if (coldFailure !== null) {
        result = "differs";
        code = "COLD_BUILD_FAILED";
        message = boundedMessage(this.#sanitizeCoreMessage(coldFailure));
        return;
      }
      const cold = readGenesOutput(outputRoot, this.#layout.outputIdentity, true)!;
      // Read the public tree under a read lease, so that a publication
      // cannot change it while it is read.
      const release = await this.#gate.acquireRead();
      try {
        if (abort.signal.aborted || this.#accepted !== accepted) {
          result = "cancelled";
          return;
        }
        paths = differingOutputPaths(
          this.#layout,
          cold,
          readGenesOutput(
            this.#layout.publicOutputRoot,
            this.#layout.outputIdentity,
            false,
          ),
        );
      } finally {
        release();
      }
      result = paths.length === 0 ? "equal" : "differs";
    } catch {
      result = abort.signal.aborted ? "cancelled" : "failed";
      if (result === "failed") code = "COLD_CHECK_ERROR";
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
      if (this.#closing === null) this.#finishColdCheck(accepted, result, code, paths, message);
    }
  }

  /**
   * Reports one cold-build result and decides the repair. A cancelled check
   * stays due; every other result starts the count again. A difference is
   * repaired with a new server unless a difference already survived such a
   * repair (`COLD_DIFFERS_AFTER_REPAIR`), so a defect that a new server does
   * not remove cannot make the session restart its server again and again.
   */
  #finishColdCheck(
    accepted: AcceptedGeneration,
    result: ColdBuildCheck["result"],
    failureCode: ColdBuildCheck["code"],
    paths: readonly string[],
    message: string | undefined,
  ): void {
    if (result !== "cancelled") this.#generationsSinceColdCheck = 0;
    let code = failureCode;
    let repair = false;
    if (result === "differs") {
      if (this.#coldRepairStopped || this.#coldVerifyPending) {
        code = "COLD_DIFFERS_AFTER_REPAIR";
        this.#coldRepairStopped = true;
        this.#coldVerifyPending = false;
      } else {
        repair = true;
        this.#coldVerifyPending = true;
      }
    } else if (result !== "cancelled") {
      this.#coldVerifyPending = false;
    }
    this.#emitOutputCheck({
      check: "cold-build",
      revision: accepted.revision,
      generation: accepted.generation,
      result,
      paths: result === "differs" ? paths : Object.freeze([]),
      ...(code === undefined || result === "equal" || result === "cancelled"
        ? {}
        : { code }),
      ...(message === undefined ? {} : { message }),
    });
    if (repair) this.#requestRepair(true);
  }

  /** Emits one `output-check` event (`OutputCheck`). */
  #emitOutputCheck(check: OutputCheck): void {
    if (this.#closing !== null) return;
    this.#emit({
      kind: "output-check",
      outputCheck: Object.freeze(
        check.check === "replay-audit"
          ? { ...check, modules: Object.freeze([...check.modules]) }
          : { ...check, paths: Object.freeze([...check.paths]) },
      ),
    });
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
    const environmentKey = ambientEnvironmentKey();
    const invocation = snapshotHaxeInvocation(
      await this.#options.resolveInvocation({ signal }),
    );
    const plan = await buildEffectiveHaxeInvocationPlan(
      invocation,
      this.#options.hxml,
      signal,
      this.#dependencies.inventory,
    );
    try {
      this.#assertInventoryContained(plan.inventory);
    } catch (error) {
      throw new Error(
        this.#sanitizeCoreMessage(
          asError(error).message,
          plan.inventory.allowedRoots,
        ),
      );
    }
    this.#planEnvironments.set(plan, environmentKey);
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
          "development-session input must be inside a declared HXML root",
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
    const realInputTrees: Array<{
      readonly path: string;
      readonly label: string;
    }> = inventory.classPaths.map((classPath) => ({
      path: classPath,
      label: "development-session class path",
    }));
    for (const extra of this.#options.extraInputs ?? []) {
      if ((extra.kind ?? "exact") === "tree") {
        const absolute = path.resolve(this.#layout.projectRoot, extra.path);
        const allowedRoot = inventory.allowedRoots
          .filter((root) => containedBy(root, absolute))
          .sort((left, right) => right.length - left.length)[0];
        if (allowedRoot === undefined) {
          throw new Error(
            "development-session input must be inside a declared HXML root",
          );
        }
        assertRealPath(
          allowedRoot,
          absolute,
          "development-session extra input tree",
        );
        realInputTrees.push({
          path: absolute,
          label: "development-session extra input tree",
        });
      }
    }
    assertRealInputTrees(realInputTrees);
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

  /**
   * Returns the `firstBytes` of a `transport-failed` event as the session
   * reports it: private paths removed, then at most
   * `REPORTED_FIRST_BYTES` bytes, cut at a character boundary.
   *
   * The compiler passes up to `FIRST_BYTES_RAW_LIMIT` raw bytes. Cutting
   * before the paths are removed could leave the start of a private path
   * that no longer matches, for example `/Users/me/work/proj` cut to
   * `/Users/me/wo`. So the raw text is cut only after the replacement. When
   * the raw text itself was cut at its limit, a tail that is the start of a
   * private root is dropped first.
   */
  #reportedFirstBytes(raw: string): string {
    let text = raw;
    if (Buffer.byteLength(text, "utf8") >= FIRST_BYTES_RAW_LIMIT) {
      for (const root of this.#privateRoots()) {
        for (let length = Math.min(root.length, text.length); length > 0; length -= 1) {
          if (text.endsWith(root.slice(0, length))) {
            text = text.slice(0, text.length - length);
            break;
          }
        }
      }
    }
    let kept = "";
    let bytes = 0;
    for (const character of this.#sanitizeCoreMessage(text)) {
      const size = Buffer.byteLength(character, "utf8");
      if (bytes + size > REPORTED_FIRST_BYTES) break;
      kept += character;
      bytes += size;
    }
    return kept;
  }

  /** The folders that `#sanitizeCoreMessage` replaces, in its spellings. */
  #privateRoots(): readonly string[] {
    const roots = [
      path.join(
        this.#layout.projectRoot,
        ...this.#layout.candidatesRelative.split("/"),
      ),
      this.#layout.stateRoot,
      this.#layout.projectRoot,
      ...(this.#inventory?.allowedRoots ?? this.#options.hxml.allowedRoots),
    ];
    return roots.flatMap((root) => {
      const absolute = path.resolve(root);
      try {
        const real = realpathSync.native(absolute);
        return real === absolute ? [absolute] : [absolute, real];
      } catch {
        return [absolute];
      }
    });
  }

  #sanitizeCoreMessage(
    message: string,
    allowedRoots?: readonly string[],
  ): string {
    const candidateRoot = path.join(
      this.#layout.projectRoot,
      ...this.#layout.candidatesRelative.split("/"),
    );
    const declaredExternalRoots = (
      allowedRoots ??
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
