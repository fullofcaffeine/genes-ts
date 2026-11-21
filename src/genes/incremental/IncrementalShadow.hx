package genes.incremental;

#if macro
import haxe.Json;
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.Type;
import sys.FileSystem;
import sys.io.File;
import genes.incremental.GenerationCache;
import genes.incremental.IncrementalRequest;
import genes.util.PathUtil;
import genes.util.TypeUtil;

using Lambda;

/**
 * The stage of the generator in which a clock measures one module. The first
 * three are the "plan" time of the module in the report.
 */
enum IncrementalPhase {
  /** The inventory stage: the `Module` value of the module is made. */
  Inventory;

  /** The reachability visit: the dependency plan of the module. */
  Reachability;

  /** JSX and direct-binding validation of the module. */
  Validation;

  /** Printing of the module's files. */
  Emit;

  /** Staging of the stored files of a replayed module (`generation: "reuse"`). */
  Replay;
}

/**
 * The module clocks of one generator stage, by the state of the module.
 *
 * Why: the time of a stage that is outside these clocks is fixed cost, which
 * a replay of clean modules does not remove. Every clock of this report,
 * `generationMs` included, reads `haxe.Timer.stamp()`, which is `Sys.time()`
 * in the macro interpreter: wall-clock seconds. `generationMs` minus the
 * module clocks is that fixed cost.
 *
 * Do not subtract these sums from the stage rows of `haxe --times` (for
 * example `genes.plan.reachability`) without scaling them first: on macOS,
 * Haxe 4.3.7 prints raw Mach clock units there, 41.67 times too small on
 * Apple Silicon (see "`--times` shows a few seconds" in
 * `docs/TROUBLESHOOTING.md`). The rows remain good shares of one run.
 */
typedef ShadowStageReport = {
  /** `inventory`, `reachability`, `validation`, `emit` or `replay`. */
  final stage: String;

  /** Modules that the clean rules call clean. */
  final cleanMs: Float;

  /** Emitted modules that are not clean. */
  final dirtyMs: Float;

  /** Modules that got no output file, for example a module of types only. */
  final notEmittedMs: Float;
}

/** One difference between the stored and the staged files of a clean module. */
typedef ShadowMismatch = {
  final module: String;
  final path: String;
  final kind: String;
  final line: Int;
  final stored: String;
  final staged: String;
}

/**
 * What the generator knows about one module after the walk of reachability,
 * for the checks before emission (`IncrementalShadow.planReplay`).
 */
typedef ReplayModuleFacts = {
  /** True when the module gets an implementation file in this request. */
  final emits: Bool;

  /** `ModuleFingerprint.members` of the module's final member list. */
  final members: String;

  /** `IncrementalShadow.rootFlags` of the module. */
  final rootFlags: String;
}

/**
 * How a request answers each kind of recorded question now, for the checks
 * before emission (`IncrementalShadow.planReplay`). A `null` function means
 * that the kind is not checked at that moment (see `changedAnswer`).
 */
typedef ReplayAnswers = {
  /** `api.hasFeature`. */
  final feature: String->Bool;

  /** Whether a module is in the final module map. */
  final moduleExists: Null<String->Bool>;

  /** `Module.isCyclic` of the asking module (first argument) for a module. */
  final cycle: Null<(asker: String, test: String) -> Bool>;

  /** The text of a position-keyed `SignatureCache` fact now (kind, key). */
  final anonField: Null<(kind: String, key: String) -> String>;

  /**
   * `ReactRefreshModulePlan.answerText` of a module's React Fast Refresh
   * split now (`Module.reactRefreshSplitOf`), given the module and the
   * recorded answer. `planReplay` returns the recorded answer for a clean
   * module without asking.
   */
  final reactRefreshSplit: Null<(module: String, recorded: String) -> String>;
}

/** One stored public entry of a replayed module, with its position made again. */
typedef ReplayPublicEntry = {
  final name: String;
  final pos: haxe.macro.Expr.Position;
}

/** Time and state of one emitted module in the report. */
typedef ShadowModuleReport = {
  final module: String;

  /**
   * `replayed` (reuse: the stored files were staged), `clean` (the checks
   * before emission accept it; it was printed because the mode is
   * `measure` or `compare`, or because the replay fell back), or `dirty`.
   */
  final state: String;

  final planMs: Float;
  final emitMs: Float;
  final usedHaxePrinter: Bool;
}

/**
 * What the reachability walk of one request did with the stored steps of
 * clean modules (Stage 3, slice S2).
 *
 * Why: the walk with stored edges is worth its code only when it rarely
 * leaves the recorded path; `measure` counts how often it would, without
 * using any stored step.
 */
typedef ShadowWalkReport = {
  /**
   * `live` (every module built its plan), `stored` (the clean modules took
   * stored steps and the request kept that walk), or `stored, then live`
   * (the request left the walk with stored edges and walked again live).
   */
  final pass: String;

  /**
   * `none` (no clean module was visited), `on-path` (each visit of a clean
   * module found its member list in the record with the same steps, and the
   * checks before emission passed), `left` (a visit, a stored step or the
   * checks before emission left the recorded path: a fallback that the
   * request sees), or `drift` (a recorded member list had other steps than
   * the live plan: the stored walk would differ without seeing it, which
   * must never happen).
   */
  final verdict: String;

  /** Why the walk left, or would leave (`measure`), the recorded path. */
  final left: Null<String>;

  /** Visits of clean modules that took stored steps. */
  final storedVisits: Int;

  /** Visits that built a dependency plan. */
  final liveVisits: Int;

  /** Live visits of clean modules that were checked against the record. */
  final checkedVisits: Int;

  /** Checked visits whose member list the record does not have. */
  final missing: Int;

  /** Checked visits whose recorded steps differ from the live ones. */
  final differs: Int;

  /**
   * Steps of checked visits that added a declaration whose stamp differs
   * from the recorded one, that name a declaration whose metadata differs
   * from the recorded one, or that the inventory cannot find by its key.
   */
  final stale: Int;

  /** "compare": the first difference between the two walks, or `null`. */
  final walksDiffer: Null<String>;

  /** Time of the walk with stored edges, and of the live walk. */
  final storedMs: Float;

  final liveMs: Float;
}

/**
 * Thrown inside the walk with stored edges when a stored step cannot be
 * taken exactly as recorded. `Generator` catches it (and any other error of
 * that pass) and generates again with live edges only.
 */
class LeftRecordedPath extends haxe.Exception {}

/** Time spent by the shadow itself, in milliseconds. */
typedef ShadowOverhead = {
  /** Stamps and session key of `GenerationChangeSet`, shared with the passes. */
  final changeSetMs: Float;

  final fingerprintMs: Float;
  final decideMs: Float;
  final planMs: Float;
  final recordMs: Float;
  final compareMs: Float;
  final cacheWriteMs: Float;
  final totalMs: Float;
}

/**
 * The session report of one request. It is written beside the request
 * descriptor, never inside the output tree.
 */
typedef ShadowReport = {
  final format: Int;
  final request: Int;

  /**
   * The `generation` value that this request served: `measure`, `compare`
   * or `reuse`; `none` when the shadow did not run (`result` is `off`). With
   * `measure` and `reuse`, `mismatches` is always empty because nothing was
   * compared.
   */
  final mode: String;

  final result: String;
  final reason: Null<String>;

  /**
   * The stable code of a `GenerationRefusal`, for example
   * `compare-needs-after-typing-reuse`, or `null`. A refused request has the
   * result `off` and neither reads nor writes the generation cache.
   */
  final refusal: Null<String>;

  final committed: Bool;
  final typedAgain: Int;
  final typedAgainModules: Array<String>;
  final emitted: Int;

  /** Emitted modules that the clean rules accept. */
  final clean: Int;

  /** Emitted modules that are not clean. */
  final dirty: Int;

  /**
   * Clean modules that also pass the checks before emission (member list,
   * root flags, answers): the modules that `reuse` replays. 0 when those
   * checks fell back (`planFallback`).
   */
  final replayable: Int;

  /** Modules whose stored files this request staged instead of printing them. */
  final replayed: Int;

  /** Files that this request staged from the cache. */
  final replayedFiles: Int;

  /** Why the checks before emission made the request generate in full, or `null`. */
  final planFallback: Null<String>;

  /** Declarations whose same-object test failed in this request. */
  final sameObjectFailures: Int;

  final dirtyReasons: Array<String>;
  final mismatches: Array<ShadowMismatch>;
  final fallbackLookups: Int;
  final fallbackLookupModules: Array<String>;
  final unattributedReads: Array<String>;
  final reservedNamesChanged: Bool;

  /** Warnings that Genes reported while it printed the modules of this request. */
  final printWarnings: Int;

  final haxePrinterModules: Int;
  final haxePrinterModuleNames: Array<String>;
  final generationMs: Float;
  final cleanPlanMs: Float;
  final cleanEmitMs: Float;

  /** Time to stage the stored files of the replayed modules. */
  final replayMs: Float;

  final projectedGenerationMs: Float;
  final cacheBytes: Int;

  /** The part of `cacheBytes` that the stored answers use. */
  final cacheAnswerBytes: Int;

  final cacheEntries: Int;
  final cacheStored: Bool;
  final stages: Array<ShadowStageReport>;
  final overhead: ShadowOverhead;

  /** The reachability walk with stored edges (slice S2). */
  final walk: ShadowWalkReport;

  final modules: Array<ShadowModuleReport>;
}

/**
 * Runs incremental generation of Stage 3 around one generation: the
 * byte-stability shadow of slice 1 (`"measure"`, `"compare"`) and the
 * replay of stored bytes of slice S1 (`"reuse"`).
 *
 * Why: a warm compiler server keeps typed modules, but Genes planned and
 * printed every module again on each request. In `"reuse"`, a module that
 * the clean rules and the checks before emission accept is not validated or
 * printed again: its stored files, maps and print warnings are staged as
 * they were. Every hole in those checks would publish stale TypeScript, so a
 * check either proves a module clean, or the request generates in full.
 * `"compare"` runs the same checks, prints every module anyway, and reports
 * each difference between the stored and the new result of a module that
 * `"reuse"` would replay.
 *
 * What: `start` returns at once unless the request descriptor has a
 * `generation` value (see `IncrementalRequest`). Then the generator calls
 * the hooks below. They record, for each module:
 *
 * - the staged text of its files (through `OutputTransaction.onRegister`);
 * - the modules that it read by name (witnesses of `TypedModuleInventory`)
 *   and the lookups that the inventory could not answer;
 * - whether it used Haxe's own printer (`genes.HaxePrinterUse`);
 * - the warnings that the printer reported for it (today only
 *   "__js__ is deprecated");
 * - the global questions that its planning and emission asked, with the
 *   answers (`recordFeature`, `recordModuleExists`), and the features that
 *   its emission added (`recordAddition`);
 * - its final member list and root flags after the walk (`planReplay`), and
 *   its public entries (`publicEntry`);
 * - the sources that its source maps name by a relative path (`mapSource`);
 * - plan, emit and replay time.
 *
 * Request order with `"reuse"` (each fallback is decided before the first
 * `api.addFeature`, because feature flags cannot be removed):
 *
 * 1. `inventory`: the clean rules of `GenerationCache.decide`.
 * 2. The walk of reachability (slice S2). A dirty module builds its plan
 *    and its steps are recorded (`recordVisit`). A clean module takes the
 *    steps recorded for its member list at that visit (`storedSteps`); a
 *    stored step that adds a declaration finds it again by its key, with
 *    an equal stamp (`resolveStoredStep`). The queue and `Module.addTypes`
 *    are the code of the live walk. Clean modules then answer import-cycle
 *    questions from their stored runtime requests. A member list that the
 *    record does not have, a changed stamp, a member that is still missing,
 *    or any error leaves this pass (`LeftRecordedPath`): `Generator` builds
 *    new `Module` values and runs again from the inventory, live, with no
 *    clean module.
 * 3. `planReplay`: for each clean module that is emitted now, its final
 *    member list and root flags must equal the stored ones, and each stored
 *    answer must equal the answer now. Any difference: the request generates
 *    in full (`planFallback`). No answer can change later in the request:
 *    rule 10 of `GenerationCache` keeps every module that asked for a
 *    feature that emission adds out of the clean set.
 * 4. Both validation loops skip the replayed modules; the second loop adds
 *    their stored public entries (`storedPublicEntries`).
 * 5. The emission loop calls `replay` for a replayed module, in the sorted
 *    module order: it checks the stored answers once more, stages the stored
 *    files, reports the stored warnings, and adds the stored features in
 *    sorted order, so that later modules see the flags of a full generation.
 *
 * A fallback of step 3 after a walk with stored edges also runs the request
 * again live (`walkAgain`). `"compare"` always runs both walks: first with
 * stored edges, then live, and any difference of the walk results, of the
 * modules that the checks accept, or of the recorded and the live steps
 * for one member list is a compare failure. `"measure"` walks live only and
 * counts how often a walk with stored edges would leave the recorded path
 * (`ShadowWalkReport`).
 *
 * After the commit, `committed` compares (only for `"compare"`), stores the
 * new plain-data cache and writes the report. A replayed module keeps its
 * stored entry. A failed request writes a report and keeps the cache.
 *
 * `"compare"` and `"reuse"` need `"afterTyping": "reuse"`. Otherwise `start`
 * refuses the request with a typed reason
 * (`IncrementalRequest.generationRefusal`): the result is `off`, the report
 * names the refusal, and the cache is neither read nor written. The request
 * still generates and publishes in full.
 *
 * One owner for the request facts: the shadow decides no eligibility, adds
 * no stamp and builds no key. It reads the mode from `IncrementalRequest`,
 * and the epochs, the same-object proofs and the session key from
 * `GenerationChangeSet`, which computed them once after typing.
 *
 * Results in the report: `off` (outside the supported scope), `full` (no
 * usable cache, a fallback, or a lookup by name during generation),
 * `restart-required` (only a new compiler process gives cold output), and
 * `incremental` (the clean rules applied).
 *
 * The report is evidence, not output. It is written only for a request
 * whose descriptor has a `generation` value, beside the descriptor. When the
 * file cannot be written, the request gets one warning and goes on.
 *
 * Lifetime: one instance for one request, kept in an ordinary static that
 * Haxe replaces at the start of each compilation. It holds compiler-owned
 * values only until the request ends; the cache that outlives it is plain
 * data.
 */
class IncrementalShadow {
  /**
   * The report format. Format 2 added `mode` and `refusal`; format 3 added
   * the replay counts, `planFallback` and `sameObjectFailures`; format 4
   * added `walk`.
   */
  static inline final REPORT_FORMAT = 4;

  static inline final LINE_LIMIT = 240;
  static inline final MISMATCH_LIMIT = 200;

  /**
   * Defines that print messages while Genes prints a module. A replayed
   * module is not printed, so `"reuse"` cannot serve a request with one of
   * them.
   */
  static final EMISSION_MESSAGE_DEFINES = [
    'genes.ts.indexed_access_inventory',
    'genes.ts.narrowing_inventory',
    'genes.lexical_binding_inventory',
    'genes.direct_binding_inventory',
    'genes.writer_position_inventory'
  ];

  static var current: Null<IncrementalShadow> = null;

  final reportFile: String;
  final started: Float;
  final mode: GenerationReuse;

  /**
   * True in a module request (G3, `ModuleRequest`): the shadow only records
   * the answers, files and warnings of the printed module. It applies no
   * clean rule, stores no cache and writes no report of its own.
   */
  final preview: Bool;

  final refusal: Null<GenerationRefusal>;
  final underReuse: Bool;
  var active: Bool;
  var reason: Null<String> = null;
  var rootModule = '';
  var sessionKey = '';
  var outputFolder = '';
  var decision: CacheDecision = NoCache('not decided');
  final fingerprints = new Map<String, String>();

  /**
   * The key (`listedKey`) of each declaration in the generator's list of
   * this request: plain text, read by `listed` and by the unlisted part of
   * the fingerprints.
   */
  final listedDeclarations = new Map<String, Bool>();

  final files = new Map<String, Array<CachedFile>>();
  final warnings = new Map<String, Array<CachedWarning>>();
  var warningCount = 0;
  final planSeconds = new Map<String, Float>();
  final emitSeconds = new Map<String, Float>();

  /** Answer lines of each module (`feature <name> <0|1>`, `module <name> <0|1>`). */
  var answers = new Map<String, Map<String, Bool>>();

  /** Recorded visits of the walk of this request (slice S2), by module. */
  var visits = new Map<String, Array<CachedVisit>>();

  /** Internal runtime requests of each module printed in this request. */
  final runtimeRequestLists = new Map<String, Array<String>>();

  /** `GenerationChangeSet.stampOf` answers of this request, by declaration key. */
  final stamps = new Map<String, String>();

  /**
   * The target facts (`WalkTarget.inputsText`) of each declaration of the
   * modules that stored steps name, by module and declaration key, read once in this
   * request (`TypedModuleInventory.textsByKey`).
   */
  final targetFactTexts = new Map<String, Map<String, String>>();

  /** True in the pass that walks clean modules with stored steps. */
  var storedPass = false;

  /** True in the live pass after a pass with stored edges. */
  var rerun = false;

  /** Why the walk left (or, in `measure`, would leave) the recorded path. */
  var walkLeft: Null<String> = null;

  /** The first visit at which the live walk differs from the record. */
  var walkDivergence: Null<String> = null;

  var walkDivergenceKind = '';

  /** "compare": the walk result of the pass with stored edges, if it was usable. */
  var storedWalkResult: Null<String> = null;

  /** "compare": the modules that the pass with stored edges would replay. */
  var storedReplayable: Null<Map<String, Bool>> = null;

  var walksDiffer: Null<String> = null;
  var storedVisits = 0;
  var liveVisits = 0;
  var checkedVisits = 0;
  var missingVisits = 0;
  var differingVisits = 0;
  var staleSteps = 0;
  var storedWalkSeconds = 0.0;
  var liveWalkSeconds = 0.0;

  /** Features that emission of each module added. */
  final additions = new Map<String, Map<String, Bool>>();

  /** Absolute sources that the maps of each module name by a relative path. */
  final mapSources = new Map<String, Map<String, Bool>>();

  /** Final member list of each module after the walk. */
  var memberLists = new Map<String, String>();

  /** Root flags of each module after the walk. */
  var rootFlagTexts = new Map<String, String>();

  /** Public entries that the second validation loop found for each module. */
  final publicEntries = new Map<String, Array<CachedPublicEntry>>();

  /** Modules that pass the checks before emission (all modes). */
  var replayable = new Map<String, Bool>();

  /** Modules whose stored files were staged in this request (`"reuse"` only). */
  final replayed = new Map<String, Bool>();

  var replayedFiles = 0;
  var planFallback: Null<String> = null;

  /** Module clocks of each stage; the first key is `stageName`. */
  final stageSeconds = new Map<String, Map<String, Float>>();

  var owner: Null<String> = null;
  var clockModule: Null<String> = null;
  var clockPhase: IncrementalPhase = Inventory;
  var clockStart = 0.0;
  var fingerprintSeconds = 0.0;
  var decideSeconds = 0.0;
  var planCheckSeconds = 0.0;
  var recordSeconds = 0.0;

  function new(reportFile: String, mode: GenerationReuse, active: Bool,
      reason: Null<String>, underReuse: Bool, ?refusal: GenerationRefusal) {
    this.reportFile = reportFile;
    this.mode = mode;
    this.active = active;
    this.reason = reason;
    this.underReuse = underReuse;
    this.refusal = refusal;
    this.started = haxe.Timer.stamp();
    final descriptor = IncrementalRequest.requestedDescriptor();
    this.preview = descriptor != null && !descriptor.kind.match(Full);
  }

  /**
   * Starts the shadow for one generation. Without the define, or when the
   * descriptor has no `generation` value, this sets nothing and returns, so
   * the request runs exactly as before.
   *
   * A `generation` value that `IncrementalRequest.generationRefusal`
   * refuses (`"compare"` or `"reuse"` without `afterTyping: "reuse"`) gives a
   * report with the result `off`, the refusal code and its reason; nothing
   * else runs.
   *
   * A request that selected the shadow and then left the incremental path
   * (an `@:rtti` class), or that the shadow cannot serve, still gets a report
   * with the result `off` and the reason. The second case does not turn the
   * request mode off: the passes after typing have already used it. The
   * shadow cannot serve an output file that is not `.ts` or `.tsx`, a request
   * in which a macro changed the embedded resources after typing, and a
   * `"reuse"` request with a define that prints messages during emission:
   * such a request neither reads nor writes the generation cache.
   */
  public static function start(outputFile: String,
      transaction: OutputTransaction): Void {
    current = null;
    final descriptor = IncrementalRequest.requestedDescriptor();
    if (descriptor == null || descriptor.generation == Regenerate)
      return;
    final reportFile = IncrementalRequest.generationReportPath(descriptor.path);
    final underReuse = descriptor.afterTyping == Reuse;
    final unsupported = switch IncrementalRequest.mode() {
      case Absent:
        return;
      case Off(_, why):
        why;
      case On(_):
        unsupportedReason(outputFile, descriptor.generation);
    }
    if (unsupported != null) {
      current = new IncrementalShadow(reportFile, descriptor.generation,
        false, unsupported, underReuse);
      return;
    }
    final refused = IncrementalRequest.generationRefusal(descriptor);
    if (refused != null) {
      current = new IncrementalShadow(reportFile, descriptor.generation,
        false, IncrementalRequest.refusalText(refused), underReuse, refused);
      return;
    }
    final shadow = new IncrementalShadow(reportFile, descriptor.generation,
      true, null, underReuse);
    current = shadow;
    final key = GenerationChangeSet.sessionKey();
    shadow.sessionKey = key == null ? '' : key;
    shadow.outputFolder = absoluteFolder(outputFile);
    TypedModuleInventory.startRecording();
    HaxePrinterUse.record();
    transaction.onRegister = (relative,
      content) -> shadow.record(relative, content);
  }

  /**
   * Returns why the shadow cannot serve an eligible request, or `null` when
   * it can. These reasons belong to the shadow only, so they do not turn the
   * request mode off.
   */
  static function unsupportedReason(outputFile: String,
      generation: GenerationReuse): Null<String> {
    final extension = Path.extension(outputFile);
    if (extension != 'ts' && extension != 'tsx')
      return 'only .ts and .tsx output is supported';
    if (GenerationChangeSet.sessionKey() == null)
      return 'no declaration was stamped after typing';
    // The session key holds the resources as they were after typing.
    // `haxe.Resource` prints the resources of this moment.
    if (GenerationChangeSet.resourceDigest() != GenerationChangeSet.sessionResources())
      return 'a macro changed the embedded resources after typing, so the '
        + 'session key does not describe them';
    if (GenerationChangeSet.definesChangedAfterTyping())
      return 'a macro changed the defines after typing, so the session key '
        + 'does not describe them';
    if (generation == ReuseClean)
      for (define in EMISSION_MESSAGE_DEFINES)
        if (Context.defined(define))
          return '-D $define prints messages while Genes prints a module, '
            + 'and a replayed module is not printed';
    return null;
  }

  /**
   * Returns why this request has no active shadow, or `null` when it has
   * one. A module request (`ModuleRequest`) refuses its preview with this
   * reason.
   */
  public static function inactiveReason(): Null<String> {
    final shadow = current;
    if (shadow == null)
      return 'the request has no "generation" value';
    if (!shadow.active) {
      final why = shadow.reason;
      return why == null ? 'the generation shadow is off' : why;
    }
    return null;
  }

  /**
   * Returns what this request recorded for `module` so far: its answer
   * lines and added features (sorted), the sources that its maps name by a
   * relative path, and the relative paths of its staged files. A module
   * request compares them with the stored entry before it publishes.
   */
  public static function recordedModule(module: String): {
    answers: Array<String>,
    additions: Array<String>,
    mapSources: Array<String>,
    files: Array<String>
  } {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return {
        answers: [],
        additions: [],
        mapSources: [],
        files: []
      };
    final staged = shadow.files.get(module);
    return {
      answers: sortedLines(shadow.answers.get(module)),
      additions: sortedLines(shadow.additions.get(module)),
      mapSources: sortedLines(shadow.mapSources.get(module)),
      files: staged == null ? [] : [for (file in staged) file.path]
    };
  }

  /**
   * Returns true while an active shadow records the questions of emission.
   * `Module.createContext` reads it to wrap the feature functions only then.
   */
  public static function recording(): Bool {
    final shadow = current;
    return shadow != null && shadow.active;
  }

  /**
   * Records one feature question that planning or emission of `module`
   * asked, with its answer. Without an active shadow this does nothing.
   *
   * Example: `TsModuleEmitter` asks `js.Lib.global` for each module with
   * runtime code. When a later edit makes the answer true, the stored output
   * of every such module is stale; `planReplay` sees the changed answer and
   * the request generates in full.
   */
  public static function recordFeature(module: String, feature: String,
      answer: Bool): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    addLine(shadow.answers, module,
      GenerationCache.answerLine('feature', feature,
        GenerationCache.flag(answer)));
  }

  /**
   * Records whether the owner module of a module function was in the module
   * map when `asker` asked (`Module.resolveModuleFunction` takes another
   * branch when it is not).
   */
  public static function recordModuleExists(asker: String, module: String,
      exists: Bool): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    addLine(shadow.answers, asker,
      GenerationCache.answerLine('module', module,
        GenerationCache.flag(exists)));
  }

  /**
   * Records whether `test` reaches `asker` through internal runtime imports
   * (`Module.isCyclic`), the question that decides, for example, whether
   * `asker` prints `Register.inherits(() => Base, true)` (lazy) or
   * `Register.inherits(Base)` for a superclass in `test`.
   *
   * Why (review of #244, M1): the answer depends on the import graph of
   * other modules. A module that is dirty but not typed again can gain a
   * member during the walk and close a cycle, so a clean module's stored
   * output can be stale although nothing about it changed.
   */
  public static function recordCycle(asker: String, test: String,
      cyclic: Bool): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    addLine(shadow.answers, asker,
      GenerationCache.answerLine('cycle', test, GenerationCache.flag(cyclic)));
  }

  /**
   * Records one answer of `SignatureCache.getAnonFieldTsType` (`anonTs`) or
   * `getAnonFieldSourceType` (`anonSource`): `key` is the source position of
   * an anonymous-structure field, and `answer` the text of the fact, or `-`
   * when there is none. The answer belongs to the module whose clock runs
   * (its planning or printing reads it); outside any clock it belongs to the
   * request (`GenerationCache.globalAnswers`).
   *
   * Why (review of #244, M2): the capture of one declaration writes such a
   * fact for every field position that its type reaches, also for a field
   * of another module. Example: a typedef `{ > inc.Env.Envelope<inc.Color>,
   * ... }` in `inc.Leaf2` writes the fact of the field `value` of
   * `inc.Env.Envelope`, and the print of `inc.Env` reads it. `inc.Env` is
   * not typed again, so no other clean rule sees the change.
   */
  public static function recordAnonField(kind: String, key: String,
      answer: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    final module = shadow.clockModule;
    addLine(shadow.answers, module == null ? '' : module,
      GenerationCache.answerLine(kind, key, answer));
  }

  /**
   * Records how `asker` saw the React Fast Refresh split of the module
   * `target` (`Module.reactRefreshSplitOf`): `answer` is
   * `ReactRefreshModulePlan.answerText` of its component names.
   *
   * Why: with `-D genes.react_refresh_modules`, an importer of a split module
   * imports the components from `X` and every other binding from
   * `X.fields`. The split depends on the bodies of `X` (for example a static
   * initializer that starts to call a component keeps `X` one file), so an
   * importer that Haxe did not type again can still need new import lines.
   */
  public static function recordReactRefreshSplit(asker: String,
      target: String, answer: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    addLine(shadow.answers, asker,
      GenerationCache.answerLine('refreshSplit', target, answer));
  }

  /** Records one feature that emission of `module` added (`api.addFeature`). */
  public static function recordAddition(module: String, feature: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    addLine(shadow.additions, module, feature);
  }

  /**
   * Records one source that the source map of the module printed now names
   * by a relative path (see `GenerationCache.partingFolders`).
   */
  public static function mapSource(source: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    final module = shadow.owner;
    if (module == null)
      return;
    addLine(shadow.mapSources, module,
      PathUtil.normalize(FileSystem.absolutePath(source)));
  }

  /**
   * Records one public entry that the second validation loop added to the
   * root module's exports for `module`, in loop order.
   */
  public static function publicEntry(module: String, name: String,
      pos: haxe.macro.Expr.Position): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    final place = Context.getPosInfos(pos);
    final entry: CachedPublicEntry = {
      name: name,
      file: place.file,
      min: place.min,
      max: place.max
    };
    final list = shadow.publicEntries.get(module);
    if (list == null)
      shadow.publicEntries.set(module, [entry]);
    else
      list.push(entry);
  }

  /**
   * Returns true when the walk of this pass uses stored steps for clean
   * modules (Stage 3, slice S2): the mode is `"compare"` or `"reuse"`, the
   * clean rules gave a clean set that is not empty, and the request did not
   * leave such a pass already. `Generator` calls it once in each pass,
   * before the walk.
   *
   * `"measure"` never takes stored steps: it walks live and counts how often
   * the stored walk would leave the recorded path (`recordVisit`).
   */
  public static function storedWalk(): Bool {
    final shadow = current;
    if (shadow == null || !shadow.active || shadow.rerun)
      return false;
    if (shadow.mode != CompareClean && shadow.mode != ReuseClean)
      return false;
    final clean = switch shadow.decision {
      case Rules(clean, _): clean;
      default: null;
    }
    shadow.storedPass = clean != null && clean.keys().hasNext();
    return shadow.storedPass;
  }

  /**
   * Returns the member list of a module as the key of a recorded visit:
   * `ModuleFingerprint.members`, the text of the final member-list check.
   */
  public static function memberState(members: Array<genes.Module.Member>): Null<String> {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return null;
    return ModuleFingerprint.members(members, listed);
  }

  /**
   * Returns the stored visit of a clean module for the member list `state`
   * in a pass with stored edges, or `null` when the module walks live (the
   * pass is live, or the module is not clean). Throws `LeftRecordedPath`
   * when the record has no visit with that member list: the walk with
   * stored edges then cannot know the steps.
   */
  public static function storedSteps(module: String,
      state: String): Null<CachedVisit> {
    final shadow = current;
    if (shadow == null || !shadow.active || !shadow.storedPass)
      return null;
    final clean = switch shadow.decision {
      case Rules(clean, _): clean;
      default: null;
    }
    if (clean == null || !clean.exists(module))
      return null;
    final stored = GenerationCache.entry(module);
    if (stored == null)
      return null;
    for (visit in stored.visits)
      if (visit.members == state) {
        shadow.storedVisits++;
        return visit;
      }
    throw new LeftRecordedPath('the walk visited $module with a member list '
      + 'that the record does not have');
  }

  /**
   * Returns the typed declaration that a stored step adds, found by its key
   * in this request's inventory. Throws `LeftRecordedPath` when the
   * declaration's stamp differs from the recorded `stamp` (Haxe gave a new
   * object, so the typed ref of a live edge could hold another one) or when
   * the inventory does not have it.
   */
  public static function resolveStoredStep(step: genes.WalkStep,
      stamp: String): Type {
    final shadow = current;
    if (shadow == null)
      throw new LeftRecordedPath('no incremental generator for a stored step');
    final now = shadow.stampOf(step.module, step.key);
    if (stamp.length == 0 || now != stamp)
      throw new LeftRecordedPath('the stored step to ${step.key} names a '
        + 'declaration whose stamp changed or is missing');
    final type = TypedModuleInventory.declarationByKey(step.module, step.key);
    if (type == null)
      throw new LeftRecordedPath('the inventory has no declaration ${step.key}');
    return type;
  }

  /**
   * Checks, before the walk with stored edges takes a stored step of
   * `module`, that the declaration it names has the target facts that the
   * recording request saw (`facts`): the text of `WalkTarget.inputsOf`,
   * which holds every fact of the target that the live walk reads before it
   * takes a step (kind, extern flag, module, name) and its metadata, which
   * the plan reads. Throws `LeftRecordedPath` when they differ or the
   * inventory lacks the declaration. It runs for every stored step, also
   * when the declaration is already a member, because no stamp check runs
   * then.
   *
   * Why: an after-typing macro can change these facts without a new stamp,
   * and the live walk reads them. Examples: `@:ts.type("string")` on the
   * class `inc.LateEnum.LateBox` removes the edge from `inc.LateUser`,
   * which names the class only in a typedef field; `exclude()` on the enum
   * `inc.ExclOwner.ExclEarly` makes it extern, so the live walk takes no
   * step to it from `inc.ExclHintUser`. In both cases the stored step would add a member that
   * the live walk does not add.
   */
  public static function checkStoredTarget(module: String,
      step: genes.WalkStep, facts: Null<String>): Void {
    final shadow = current;
    if (shadow == null)
      throw new LeftRecordedPath('no incremental generator for a stored step');
    if (facts == null || shadow.targetFactsOf(step.module, step.key) != facts)
      throw new LeftRecordedPath(changedTargetReason(module, step.key));
  }

  static function changedTargetReason(module: String, key: String): String {
    return 'the stored step of $module to $key names a declaration whose '
      + 'target facts (kind, extern flag, module, name or metadata) '
      + 'changed or that the inventory lacks';
  }

  /** Stops the walk with stored edges: a stored step failed a check of the walk. */
  public static function leaveRecordedPath(message: String): Void {
    throw new LeftRecordedPath(message);
  }

  /**
   * Records the steps of one live visit: `state` is the module's member list
   * when the visit started, `steps` the steps in edge order, `resolved` the
   * keys of the steps that added a declaration or a module, and `named` the
   * keys of the steps for which no member had the plain name, so that the
   * walk read the second name (`WalkStep.typeName`).
   *
   * In a live pass with a usable cache, the visit of a clean module is also
   * checked against the record, as the walk with stored edges would take it:
   * a member list that the record does not have, a recorded step whose
   * declaration has other target facts now, recorded steps that differ from
   * the live ones, or an added declaration whose stamp changed. The first
   * such visit gives the walk's verdict (`ShadowWalkReport`). `targets`
   * holds the target facts (`WalkTarget.inputsText`) of each step's
   * declaration, in the order of `steps`.
   */
  public static function recordVisit(module: String, state: String,
      steps: Array<genes.WalkStep>, targets: Array<String>,
      resolved: Array<String>, named: Array<String>): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    shadow.liveVisits++;
    final seen = new Map<String, Bool>();
    final unique: Array<genes.WalkStep> = [];
    final uniqueTargets: Array<String> = [];
    for (index => step in steps)
      if (!seen.exists(step.key)) {
        seen.set(step.key, true);
        unique.push(step);
        uniqueTargets.push(targets[index]);
      }
    var list = shadow.visits.get(module);
    if (list == null) {
      list = [];
      shadow.visits.set(module, list);
    }
    if (!list.exists(visit -> visit.members == state))
      list.push({
        members: state,
        steps: unique,
        stamps: [for (step in unique) shadow.stampOf(step.module, step.key)],
        targets: uniqueTargets
      });
    // Checked in a live pass: `measure`, and the live pass of `compare`.
    if (shadow.storedPass || (shadow.rerun && shadow.mode != CompareClean))
      return;
    final clean = switch shadow.decision {
      case Rules(clean, _): clean;
      default: null;
    }
    if (clean == null || !clean.exists(module))
      return;
    final stored = GenerationCache.entry(module);
    if (stored == null)
      return;
    shadow.checkedVisits++;
    final visit = stored.visits.find(visit -> visit.members == state);
    if (visit == null) {
      shadow.missingVisits++;
      shadow.diverge('left',
        'the walk visited $module with a member list ' +
        'that the record does not have');
      return;
    }
    // The walk with stored edges checks the target facts of each stored
    // step's declaration before it takes the step (`checkStoredTarget`), so
    // a changed one leaves the path before different steps could matter.
    for (index => step in visit.steps) {
      final recorded = visit.targets == null ? null : visit.targets[index];
      if (recorded == null
        || shadow.targetFactsOf(step.module, step.key) != recorded) {
        shadow.staleSteps++;
        shadow.diverge('left', changedTargetReason(module, step.key));
        return;
      }
    }
    if (stepText(visit.steps) != stepText(unique)) {
      shadow.differingVisits++;
      shadow.diverge('drift',
        'the recorded steps of $module differ from its ' +
        'plan for the same member list');
      return;
    }
    // The walk with stored edges finds a declaration by its key when a step
    // adds it, and also when it needs the second name but the record does
    // not hold it (`Generator.expandReachability`). Both leave the path
    // when the stamp changed or is empty, or the inventory lacks the key.
    final needed = resolved.copy();
    for (key in named) {
      final index = visit.steps.findIndex(step -> step.key == key);
      if (index >= 0 && visit.steps[index].typeName.length == 0
        && needed.indexOf(key) < 0)
        needed.push(key);
    }
    for (key in needed) {
      final index = visit.steps.findIndex(step -> step.key == key);
      final step = visit.steps[index];
      if (visit.stamps[index].length == 0
        || shadow.stampOf(step.module, key) != visit.stamps[index]
        || TypedModuleInventory.declarationByKey(step.module, key) == null) {
        shadow.staleSteps++;
        shadow.diverge('left',
          'the stored step of $module to $key needs a ' +
          'declaration whose stamp changed or that the inventory lacks');
      }
    }
  }

  /**
   * Leaves the pass with stored edges (a stored step could not be taken, or
   * that pass stopped with an error): the generator generates again with
   * live edges and no clean module.
   */
  public static function leaveStoredPass(reason: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    shadow.walkLeft = reason;
    shadow.walkDivergenceKind = 'left';
    shadow.storedWalkResult = null;
    shadow.startRerun();
  }

  /**
   * Decides, after the checks before emission of a pass with stored edges,
   * whether the generator must generate again with live edges. `"reuse"`
   * keeps the pass when every check passed. Otherwise, and always for
   * `"compare"` (which compares the two walks), it returns true and resets
   * what the pass recorded.
   */
  public static function walkAgain(): Bool {
    final shadow = current;
    if (shadow == null || !shadow.active || !shadow.storedPass)
      return false;
    final fallback = shadow.planFallback;
    if (fallback != null) {
      shadow.walkLeft = 'checks before emission: $fallback';
      shadow.walkDivergenceKind = 'left';
      shadow.storedWalkResult = null;
    }
    if (shadow.mode == ReuseClean && fallback == null)
      return false;
    if (shadow.mode == CompareClean && fallback == null)
      shadow.storedReplayable = shadow.replayable.copy();
    shadow.startRerun();
    return true;
  }

  /**
   * Returns true when this request compares the walk with stored edges with
   * the live walk: `"compare"` with a clean set.
   */
  public static function comparesWalks(): Bool {
    final shadow = current;
    return shadow != null
      && shadow.active
      && shadow.mode == CompareClean
      && (shadow.storedPass || shadow.rerun);
  }

  /**
   * Gives the result of one walk: the sorted reachable modules and the final
   * member list of every module of the map. In the pass with stored edges it
   * is kept; in the live pass after it, any difference is a compare failure.
   */
  public static function walkResult(names: Array<String>,
      modules: Map<String, genes.Module>): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    final all = [for (name in modules.keys()) name];
    all.sort(compareStrings);
    final lines = ['reachable ${names.join(' ')}'];
    for (name in all)
      lines.push('$name: '
        + ModuleFingerprint.members(modules.get(name).members, listed)
          .split('\n')
          .join(' | '));
    if (shadow.storedPass) {
      shadow.storedWalkResult = lines.join('\n');
      return;
    }
    final stored = shadow.storedWalkResult;
    if (stored == null)
      return;
    final storedLines = stored.split('\n');
    for (index in 0...Std.int(Math.max(storedLines.length, lines.length))) {
      final left = index < storedLines.length ? storedLines[index] : '<none>';
      final right = index < lines.length ? lines[index] : '<none>';
      if (left != right) {
        shadow.walksDiffer = 'stored walk: $left; live walk: $right';
        return;
      }
    }
  }

  /**
   * Returns the stored internal runtime requests of a clean module in a pass
   * with stored edges, or `null` (see `Module.replayRuntimeRequests`).
   */
  public static function storedRuntimeRequests(module: String): Null<Array<String>> {
    final shadow = current;
    if (shadow == null || !shadow.active || !shadow.storedPass)
      return null;
    final clean = switch shadow.decision {
      case Rules(clean, _): clean;
      default: null;
    }
    if (clean == null || !clean.exists(module))
      return null;
    final stored = GenerationCache.entry(module);
    return stored == null ? null : stored.runtimeRequests;
  }

  /** Records the internal runtime requests of a module that this request printed. */
  public static function recordRuntimeRequests(module: String,
      requests: Array<String>): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    shadow.runtimeRequestLists.set(module, requests.copy());
  }

  /**
   * Gives the shadow of a module request (G3, `ModuleRequest`) the
   * generator's declaration list of that request, so that `listed` answers
   * as in a full request. It applies no clean rule and computes no
   * fingerprint.
   *
   * Why: `ModuleFingerprint.members` gives a member that is not listed its
   * full text (` late ...`). The stored member list of the full request was
   * made with that request's list; without this call every member of a
   * preview would count as not listed, and the member lists would always
   * differ. Example: the class `mr.Leaf.Leaf` is in the list, so its line
   * stays `class mr.Leaf.Leaf 0 s:label` in both requests.
   */
  public static function listPreview(types: Array<Type>): Void {
    final shadow = current;
    if (shadow == null || !shadow.active || !shadow.preview)
      return;
    for (type in types) {
      final base = declarationOf(type);
      if (base != null)
        shadow.listedDeclarations.set(listedKey(base), true);
    }
  }

  /**
   * Returns the fingerprint of a module of extern classes in a module
   * request (G3), made as `inventory` makes the stored one: the text of
   * `ModuleFingerprint.ofExtern` for its listed classes, then the
   * `ModuleFingerprint.unlisted` part for every other declaration of the
   * module that Haxe typed. Call it after `listPreview`.
   *
   * Why: a macro can define such a module again while Haxe types the
   * requested module (a `genes.ts.imports` holder). `ModuleRequest` accepts
   * it only when this text equals the stored fingerprint. With only the
   * `ofExtern` part, a stored fingerprint with an unlisted part never
   * matches, and a printer could read metadata that the comparison left
   * out.
   */
  public static function previewExternFingerprint(module: String,
      classes: Array<ClassType>): String {
    final text = ModuleFingerprint.ofExtern(classes);
    final all = TypedModuleInventory.allModules();
    final typed = all == null ? null : all.get(module);
    return typed == null ? text : text
      + ModuleFingerprint.unlisted(typed, listed);
  }

  /**
   * Gives the shadow the generator's declaration list after the inventory
   * step, and applies the clean rules before planning starts.
   */
  public static function inventory(types: Array<Type>,
      exposed: Map<String, Array<String>>, root: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    // The live pass after a pass with stored edges keeps the decision of
    // the first pass: the facts that it reads did not change.
    if (shadow.rerun)
      return;
    shadow.rootModule = root;
    final fingerprintStart = haxe.Timer.stamp();
    final grouped = new Map<String, Array<Type>>();
    final order = [];
    for (type in types) {
      final base = declarationOf(type);
      if (base == null)
        continue;
      final module = base.module;
      shadow.listedDeclarations.set(listedKey(base), true);
      final list = grouped.get(module);
      if (list == null) {
        grouped.set(module, [type]);
        order.push(module);
      } else {
        list.push(type);
      }
    }
    for (module in order) {
      final list = grouped.get(module);
      if (list == null)
        continue;
      // A module of extern classes only (most of the `js.*` standard
      // library) never gets an output file. Other modules print what its
      // class and field metadata says, so rule 6 reads it
      // (`ModuleFingerprint.ofExtern`: a shorter text than `of`).
      final externs = externClasses(list);
      if (externs != null) {
        shadow.fingerprints.set(module, ModuleFingerprint.ofExtern(externs));
        continue;
      }
      shadow.fingerprints.set(module, fingerprintOf(module, list, exposed));
    }
    // Every other declaration that Haxe typed (genes-f8vc.9.27): a printer
    // can read the metadata of a declaration that dead-code elimination
    // removed (`ModuleFingerprint.unlisted`). A module whose declarations
    // were all removed gets a fingerprint of this part only, so rule 6 sees
    // it too.
    final all = TypedModuleInventory.allModules();
    if (all != null) {
      final isListed = (base: BaseType) ->
        shadow.listedDeclarations.exists(listedKey(base));
      for (module => list in all) {
        final text = ModuleFingerprint.unlisted(list, isListed);
        if (text.length == 0)
          continue;
        final known = shadow.fingerprints.get(module);
        shadow.fingerprints.set(module, known == null ? text : known + text);
      }
    }
    shadow.fingerprintSeconds = haxe.Timer.stamp() - fingerprintStart;
    final decideStart = haxe.Timer.stamp();
    shadow.decision = GenerationCache.decide({
      sessionKey: shadow.sessionKey,
      reservedNameDigest: GenerationChangeSet.reservedNameDigest(),
      rootModule: root,
      fingerprint: module -> shadow.fingerprint(module, exposed),
      epochs: GenerationChangeSet.epochs,
      present: module -> grouped.exists(module),
      proofs: GenerationChangeSet.declarationProofs,
      sameObjectFailures: GenerationChangeSet.sameObjectFailures(),
      outputFolder: shadow.outputFolder,
      needsReuseCache: shadow.mode == CompareClean || shadow.mode == ReuseClean});
    // Name the modules when a metadata change made the session key differ
    // (`GenerationChangeSet.compareMetadata`).
    final changed = GenerationChangeSet.metadataChanged();
    if (changed.length > 0)
      switch shadow.decision {
        case NoCache(why):
          shadow.decision = NoCache('$why: the metadata of a module that '
            + 'Haxe did not type again changed: '
            + changed.slice(0, 5).join(', '));
        default:
      }
    shadow.decideSeconds = haxe.Timer.stamp() - decideStart;
  }

  /**
   * Runs the checks before emission, after the walk of reachability, and
   * returns the modules that this request replays: empty unless the mode is
   * `"reuse"` and every check passed.
   *
   * `names` is the sorted list of reachable modules, `facts` gives the
   * live facts of one of them, and `now` answers each kind of recorded
   * question as the request would answer it now.
   *
   * The checks: every stored module that Haxe did not type again must have
   * its stored final member list (review of #244, M1: a module that is dirty
   * only because of a clean rule can still gain a member during the walk and
   * change what other modules import). Every answer that the stored request
   * asked outside any module must be the same now. For each clean module
   * that is emitted now: the root flags must equal the stored ones, and each
   * stored answer (features, module map, import cycles, position-keyed
   * signature facts) must equal the answer now. Any difference makes the
   * request generate in full; there is no partial fallback, because the
   * difference may come from a module that the clean rules did not see.
   * Nothing has added a feature yet, so the full generation is exact. A
   * difference never becomes a replay.
   *
   * In `"measure"` and `"compare"` the same checks run, and their result
   * selects the modules that `"compare"` checks after the commit, but
   * nothing is replayed.
   *
   * After a walk with stored edges (slice S2) the checks also decide
   * whether that walk is kept: any fallback makes `walkAgain` run the
   * request again live, and in that live pass of `"reuse"` this function
   * replays nothing and reports why. In the live pass of `"compare"` the
   * modules that the checks accept must be the ones that they accepted
   * after the walk with stored edges.
   */
  public static function planReplay(names: Array<String>,
      facts: String->ReplayModuleFacts, now: ReplayAnswers): Map<String, Bool> {
    final none = new Map<String, Bool>();
    final shadow = current;
    if (shadow == null || !shadow.active)
      return none;
    final started = haxe.Timer.stamp();
    final emitted = new Map<String, Bool>();
    for (name in names) {
      final known = facts(name);
      shadow.memberLists.set(name, known.members);
      shadow.rootFlagTexts.set(name, known.rootFlags);
      if (known.emits)
        emitted.set(name, true);
    }
    final clean = switch shadow.decision {
      case Rules(clean, _): clean;
      default: null;
    }
    if (clean != null && shadow.rerun && shadow.mode == ReuseClean) {
      // The live pass after a pass with stored edges replays nothing.
      shadow.planFallback = 'the walk with stored edges left the recorded '
        + 'path (${shadow.walkLeft})';
    } else if (clean != null) {
      final plan = new Map<String, Bool>();
      final fallback = planFallbackReason(shadow, names, emitted, clean, now,
        plan);
      if (fallback == null)
        shadow.replayable = plan;
      else
        shadow.planFallback = fallback;
      final storedPlan = shadow.storedReplayable;
      if (shadow.rerun
        && storedPlan != null
        && shadow.walksDiffer == null
        && sortedKeys(storedPlan).join(' ') != sortedKeys(shadow.replayable)
          .join(' '))
        shadow.walksDiffer = 'after the stored walk the checks before '
          + 'emission accept ${sortedKeys(storedPlan).join(' ')}; after the '
          + 'live walk ${sortedKeys(shadow.replayable).join(' ')}';
    }
    shadow.planCheckSeconds = haxe.Timer.stamp() - started;
    return shadow.mode == ReuseClean ? shadow.replayable.copy() : none;
  }

  /**
   * Fills `plan` with the clean modules that pass the checks before
   * emission, or returns why the request must generate in full.
   */
  static function planFallbackReason(shadow: IncrementalShadow,
      names: Array<String>, emitted: Map<String, Bool>,
      clean: Map<String, Bool>, live: ReplayAnswers,
      plan: Map<String, Bool>): Null<String> {
    // A clean module has the same members, metadata and typed bodies as in
    // the stored request, so its React Fast Refresh split is the recorded
    // one. Only a module that is not clean is asked again; that spares the
    // module function plans of the clean modules.
    final split = live.reactRefreshSplit;
    final now: ReplayAnswers = {
      feature: live.feature,
      moduleExists: live.moduleExists,
      cycle: live.cycle,
      anonField: live.anonField,
      reactRefreshSplit: split == null ? null : (module,
        recorded) -> clean.exists(module) ? recorded : split(module, recorded)
    };
    for (name in names) {
      final stored = GenerationCache.entry(name);
      if (stored == null)
        continue;
      final epochs = GenerationChangeSet.epochs(name);
      final keptByHaxe = epochs.length > 0 && epochs == stored.epochs;
      if ((keptByHaxe || clean.exists(name))
        && stored.members != shadow.memberLists.get(name))
        return 'the final member list of $name, which Haxe did not type '
          + 'again, differs from the record';
    }
    final global = changedAnswer('', GenerationCache.globalAnswers(), now);
    if (global != null)
      return 'the answer "${GenerationCache.answerText(global)}" asked '
        + 'outside any module differs now';
    for (name in names) {
      if (!clean.exists(name) || !emitted.exists(name))
        continue;
      final stored = GenerationCache.entry(name);
      if (stored == null)
        continue;
      if (stored.rootFlags != shadow.rootFlagTexts.get(name))
        return 'the root flags of $name differ from the record';
      final changed = changedAnswer(name, stored.answers, now);
      if (changed != null)
        return 'the answer "${GenerationCache.answerText(changed)}" that '
          + '$name recorded differs now';
      plan.set(name, true);
    }
    return null;
  }

  /**
   * Returns the first of `answers`, asked by `asker`, that differs now, or
   * `null` when every answer is the same. A kind without a function in
   * `now` is not checked: `replay` passes only the feature function, because
   * the module map, the import graph, the signature facts and the React Fast
   * Refresh splits do not change during emission, so `planReplay` already
   * checked them. An unknown kind
   * always counts as changed.
   */
  static function changedAnswer(asker: String, answers: Array<String>,
      now: ReplayAnswers): Null<String> {
    for (line in answers) {
      final answer = GenerationCache.parseAnswer(line);
      final current: Null<String> = switch answer.kind {
        case 'feature':
          GenerationCache.flag(now.feature(answer.name));
        case 'module':
          final exists = now.moduleExists;
          exists == null ? answer.answer : GenerationCache.flag(exists(answer.name));
        case 'cycle':
          final cyclic = now.cycle;
          cyclic == null ? answer.answer : GenerationCache.flag(cyclic(asker,
            answer.name));
        case 'anonTs' | 'anonSource':
          final fact = now.anonField;
          fact == null ? answer.answer : fact(answer.kind, answer.name);
        case 'refreshSplit':
          final split = now.reactRefreshSplit;
          split == null ? answer.answer : split(answer.name, answer.answer);
        default:
          null;
      }
      if (current != answer.answer)
        return line;
    }
    return null;
  }

  /**
   * Returns the stored public entries of a replayed module, with their
   * positions made again, in the order of the stored validation loop.
   */
  public static function storedPublicEntries(module: String): Array<ReplayPublicEntry> {
    final stored = GenerationCache.entry(module);
    if (stored == null)
      return [];
    return [
      for (entry in stored.publicEntries)
        {
          name: entry.name,
          pos: Context.makePosition({
            file: entry.file,
            min: entry.min,
            max: entry.max
          })
        }
    ];
  }

  /**
   * Stages the stored output of one replayed module in place of printing
   * it: checks each stored answer once more, registers each stored file with
   * `transaction`, reports each stored print warning, and adds the stored
   * features in sorted order.
   *
   * Why the second answer check: `planReplay` proved every answer before the
   * first module was printed, and no answer that a clean module asked can
   * change later. If one still differs here, an assumption of that proof is
   * wrong. The request then stops with `GENES-INCREMENTAL-REPLAY-001` before
   * it publishes anything, and the cache is dropped, so the next request
   * generates in full. A replay never publishes a module whose check failed.
   */
  public static function replay(module: String, outputDirectory: String,
      transaction: OutputTransaction, hasFeature: String->Bool,
      addFeature: String->Void): Void {
    final shadow = current;
    final stored = GenerationCache.entry(module);
    if (shadow == null || !shadow.active || stored == null) {
      GenerationCache.drop();
      CompilerDiagnostic.fail('[GENES-INCREMENTAL-REPLAY-002] Genes was asked '
        + 'to replay $module without a stored entry. Nothing was published, '
        + 'and the generation cache was dropped; the next request generates '
        + 'in full. This is a Genes defect.',
        Context.currentPos());
    }
    final changed = changedAnswer(module, stored.answers, {
      feature: hasFeature,
      moduleExists: null,
      cycle: null,
      anonField: null,
      reactRefreshSplit: null
    });
    if (changed != null) {
      GenerationCache.drop();
      CompilerDiagnostic.fail('[GENES-INCREMENTAL-REPLAY-001] The stored '
        + 'output of $module cannot be replayed: the answer '
        + '"${GenerationCache.answerText(changed)}" '
        + 'differs at its place in the emission order. Nothing was '
        + 'published, and the generation cache was dropped; the next request '
        + 'generates in full. Please report this Genes defect.',
        Context.currentPos());
    }
    enter(module, Replay);
    shadow.owner = module;
    for (file in stored.files) {
      transaction.writeContent(Path.join([outputDirectory, file.path]),
        file.text);
      shadow.replayedFiles++;
    }
    for (warning in stored.warnings) {
      final list = shadow.warnings.get(module);
      if (list == null)
        shadow.warnings.set(module, [warning]);
      else
        list.push(warning);
      shadow.warningCount++;
      Context.warning(warning.message, Context.makePosition({
        file: warning.file,
        min: warning.min,
        max: warning.max
      }));
    }
    for (feature in stored.additions)
      addFeature(feature);
    shadow.replayed.set(module, true);
    enter(null, Replay);
  }

  /**
   * Starts the clock of one module and names it as the asker of the
   * inventory queries that follow. Pass `null` to stop the clock.
   */
  public static function enter(module: Null<String>,
      phase: IncrementalPhase): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    shadow.stopClock();
    TypedModuleInventory.setAsker(module);
    if (module != null) {
      shadow.clockModule = module;
      shadow.clockPhase = phase;
      shadow.clockStart = haxe.Timer.stamp();
    }
    shadow.owner = phase == Emit ? module : null;
  }

  /**
   * Records one warning that the printer is about to report for the module
   * that it prints now. The caller still reports the warning itself; without
   * an active shadow this does nothing.
   *
   * Example: `ExprEmitter.warnLegacyJs` calls it for each `__js__` call. The
   * record lets the shadow check that a clean module gets the same warnings,
   * and lets a replay report them for a module that it does not print.
   */
  public static function printWarning(message: String,
      position: haxe.macro.Expr.Position): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    final module = shadow.owner;
    if (module == null)
      return;
    final place = Context.getPosInfos(position);
    final warning: CachedWarning = {
      message: message,
      file: place.file,
      min: place.min,
      max: place.max
    };
    final list = shadow.warnings.get(module);
    if (list == null)
      shadow.warnings.set(module, [warning]);
    else
      list.push(warning);
    shadow.warningCount++;
  }

  /**
   * Compares, stores the cache and writes the report after a successful
   * commit of the output transaction.
   */
  public static function committed(): Void {
    final shadow = current;
    current = null;
    if (shadow == null)
      return;
    TypedModuleInventory.stopRecording();
    shadow.finish(true, null);
  }

  /** Writes the report of a failed request. The cache stays as it was. */
  public static function failed(message: String): Void {
    final shadow = current;
    current = null;
    if (shadow == null)
      return;
    TypedModuleInventory.stopRecording();
    shadow.finish(false, message);
  }

  /** `GenerationChangeSet.stampOf`, read once for each declaration key. */
  function stampOf(module: String, key: String): String {
    final known = stamps.get(key);
    if (known != null)
      return known;
    final stamp = GenerationChangeSet.stampOf(module, key);
    stamps.set(key, stamp);
    return stamp;
  }

  /**
   * Returns the target facts (`WalkTarget.inputsText`) of the declaration `key` of
   * `module` in this request, or `null` when the inventory lacks it. Each
   * module is read once.
   */
  function targetFactsOf(module: String, key: String): Null<String> {
    var ofModule = targetFactTexts.get(module);
    if (ofModule == null) {
      final read = TypedModuleInventory.textsByKey(module,
        type -> genes.WalkTarget.inputsText(genes.WalkTarget.inputsOf(type)));
      ofModule = read == null ? new Map() : read;
      targetFactTexts.set(module, ofModule);
    }
    return ofModule.get(key);
  }

  /** Keeps the first divergence of the live walk from the record. */
  function diverge(kind: String, reason: String): Void {
    if (walkDivergence != null)
      return;
    walkDivergence = reason;
    walkDivergenceKind = kind;
  }

  /**
   * Starts the live pass after a pass with stored edges: forgets what that
   * pass recorded for modules, because the live pass makes new `Module`
   * values and records again. The witnesses and the failed lookups by name
   * of the first pass stay. They can only add reads: a witness that only the
   * first pass recorded makes its module dirty for more edits, and a failed
   * lookup keeps the old cache.
   *
   * The live pass must also record every read of its own, so `Generator`
   * starts the name memo of `TypeUtil.baseTypeName` again for it. Example:
   * in the first pass, the dirty module `inc.A` is the first to ask for a
   * name of `inc.Pair`, because the clean module `inc.B` builds no plan.
   * With the memo of that pass, the live pass would not search again when
   * `inc.B` asks, and `inc.B` would miss the witness of `inc.Pair` that a
   * generation without the first pass gives it.
   *
   * A stored pass that is kept has the same shift: a dirty module can record
   * a witness that a live generation gives to a clean module. The clean
   * module keeps its stored witnesses, so this also only adds reads.
   */
  function startRerun(): Void {
    stopClock();
    owner = null;
    TypedModuleInventory.setAsker(null);
    storedPass = false;
    rerun = true;
    answers = new Map();
    visits = new Map();
    memberLists = new Map();
    rootFlagTexts = new Map();
    replayable = new Map();
    planFallback = null;
  }

  /**
   * Returns steps as one text, for comparing recorded and live steps. The
   * second name is left out: a walk stores it only when it read it, and it
   * follows from the key.
   */
  static function stepText(steps: Array<genes.WalkStep>): String {
    return [
      for (step in steps)
        '${step.key} ${step.module} ${step.name}'
    ].join('\n');
  }

  function record(relative: String, content: String): Void {
    final start = haxe.Timer.stamp();
    final module = owner;
    if (module != null) {
      final list = files.get(module);
      final file: CachedFile = {path: relative, text: content};
      if (list == null)
        files.set(module, [file]);
      else
        list.push(file);
    }
    recordSeconds += haxe.Timer.stamp() - start;
  }

  function stopClock(): Void {
    final module = clockModule;
    if (module == null)
      return;
    final elapsed = haxe.Timer.stamp() - clockStart;
    if (clockPhase == Reachability) {
      if (storedPass)
        storedWalkSeconds += elapsed;
      else
        liveWalkSeconds += elapsed;
    }
    final target = clockPhase == Emit
      || clockPhase == Replay ? emitSeconds : planSeconds;
    final before = target.get(module);
    target.set(module, (before == null ? 0.0 : before) + elapsed);
    final stage = stageName(clockPhase);
    var inStage = stageSeconds.get(stage);
    if (inStage == null) {
      inStage = new Map();
      stageSeconds.set(stage, inStage);
    }
    final earlier = inStage.get(module);
    inStage.set(module, (earlier == null ? 0.0 : earlier) + elapsed);
    clockModule = null;
  }

  function fingerprint(module: String,
      exposed: Map<String, Array<String>>): String {
    final known = fingerprints.get(module);
    return known != null ? known : fingerprintOf(module, [], exposed);
  }

  function finish(success: Bool, failure: Null<String>): Void {
    stopClock();
    owner = null;
    // A module request keeps the cache of the last full request as it is;
    // `ModuleRequest` writes its report.
    if (preview)
      return;
    final generationSeconds = haxe.Timer.stamp() - started;
    final emittedNames = [for (name in files.keys()) name];
    emittedNames.sort(compareStrings);
    final lookups = TypedModuleInventory.fallbackLookups();
    // Read before `storeCache` replaces the stored digest.
    final reservedNamesChanged = active
      && GenerationCache.reservedNamesChanged(GenerationChangeSet.reservedNameDigest());
    var result = 'off';
    var cleanSet = new Map<String, Bool>();
    final dirtyReasons = new Map<String, Int>();
    final mismatches: Array<ShadowMismatch> = [];
    var compareSeconds = 0.0;
    var cacheWriteSeconds = 0.0;
    var stored = false;
    if (active && success && lookups.length > 0) {
      result = 'full';
      reason = 'the generator looked up ${lookups.length} module(s) by name; '
        + 'this request does not write the generation cache';
      // A replay of this request was checked module by module, but a lookup
      // by name means that a witness is missing: the old cache stays, and
      // its epochs still mark every change since it was written.
    } else if (active && success) {
      switch decision {
        case NoCache(why):
          result = 'full';
          reason = why;
        case Fallback(why):
          result = 'full';
          reason = why;
        case RestartRequired(why):
          result = 'restart-required';
          reason = why;
        case Rules(clean, dirty):
          final fallback = planFallback;
          result = fallback == null ? 'incremental' : 'full';
          if (fallback != null)
            reason = fallback;
          cleanSet = clean;
          for (why in dirty)
            dirtyReasons.set(why,
              (dirtyReasons.exists(why) ? dirtyReasons.get(why) : 0) + 1);
          if (mode == CompareClean) {
            final compareStart = haxe.Timer.stamp();
            final differ = walksDiffer;
            if (differ != null)
              add(mismatches, {
                module: '',
                path: '',
                kind: 'walks differ',
                line: 0,
                stored: clip(differ),
                staged: ''
              });
            final divergence = walkDivergence;
            if (walkDivergenceKind == 'drift' && divergence != null)
              add(mismatches, {
                module: '',
                path: '',
                kind: 'stored steps differ',
                line: 0,
                stored: clip(divergence),
                staged: ''
              });
            for (module in sortedKeys(replayable))
              compare(module, mismatches);
            compareSeconds = haxe.Timer.stamp() - compareStart;
          }
      }
      final writeStart = haxe.Timer.stamp();
      stored = storeCache();
      cacheWriteSeconds = haxe.Timer.stamp() - writeStart;
      if (!stored)
        reason = (reason == null ? '' : reason + '; ')
          + 'the cache is larger than the budget and was dropped';
    } else if (active) {
      result = 'failed';
      reason = failure;
    }
    final changeSetSeconds = GenerationChangeSet.overheadSeconds();
    var cleanPlan = 0.0;
    var cleanEmit = 0.0;
    var cleanEmitted = 0;
    var replaySeconds = 0.0;
    final moduleReports: Array<ShadowModuleReport> = [];
    for (module in emittedNames) {
      final plan = planSeconds.get(module);
      final emit = emitSeconds.get(module);
      final isClean = cleanSet.exists(module);
      final wasReplayed = replayed.exists(module);
      if (isClean) {
        cleanEmitted++;
        if (!wasReplayed) {
          cleanPlan += plan == null ? 0.0 : plan;
          cleanEmit += emit == null ? 0.0 : emit;
        }
      }
      if (wasReplayed)
        replaySeconds += emit == null ? 0.0 : emit;
      moduleReports.push({
        module: module,
        state: wasReplayed ? 'replayed' : replayable.exists(module) ? 'clean' : 'dirty',
        planMs: milliseconds(plan == null ? 0.0 : plan),
        emitMs: milliseconds(emit == null ? 0.0 : emit),
        usedHaxePrinter: HaxePrinterUse.used(module)
      });
    }
    final stageReports: Array<ShadowStageReport> = [];
    for (stage in [Inventory, Reachability, Validation, Emit, Replay]) {
      final name = stageName(stage);
      final inStage = stageSeconds.get(name);
      var clean = 0.0;
      var dirty = 0.0;
      var notEmitted = 0.0;
      if (inStage != null)
        for (module => seconds in inStage) {
          if (cleanSet.exists(module))
            clean += seconds;
          else if (files.exists(module))
            dirty += seconds;
          else
            notEmitted += seconds;
        }
      stageReports.push({
        stage: name,
        cleanMs: milliseconds(clean),
        dirtyMs: milliseconds(dirty),
        notEmittedMs: milliseconds(notEmitted)
      });
    }
    final overheadSeconds = changeSetSeconds
      + fingerprintSeconds
      + decideSeconds
      + planCheckSeconds
      + recordSeconds
      + compareSeconds
      + cacheWriteSeconds;
    final printerNames = HaxePrinterUse.usedModules();
    final retyped = GenerationChangeSet.retypedModules();
    final refused = refusal;
    final report: ShadowReport = {
      format: REPORT_FORMAT,
      request: GenerationChangeSet.request(),
      mode: !active ? 'none' : switch mode {
        case Regenerate: 'none';
        case MeasureClean: 'measure';
        case CompareClean: 'compare';
        case ReuseClean: 'reuse';
      },
      result: result,
      reason: reason,
      refusal: refused == null ? null : IncrementalRequest.refusalCode(refused),
      committed: success,
      typedAgain: retyped.length,
      typedAgainModules: retyped,
      emitted: emittedNames.length,
      clean: cleanEmitted,
      dirty: emittedNames.length - cleanEmitted,
      replayable: [for (module in replayable.keys()) if (files.exists(module)) module].length,
      replayed: [for (_ in replayed.keys()) 1].length,
      replayedFiles: replayedFiles,
      planFallback: planFallback,
      sameObjectFailures: active ? GenerationChangeSet.sameObjectFailures()
        .length : 0,
      dirtyReasons: [
        for (why in sortedKeys(dirtyReasons))
          '$why: ${dirtyReasons.get(why)}'
      ],
      mismatches: mismatches,
      fallbackLookups: lookups.length,
      fallbackLookupModules: lookups,
      unattributedReads: TypedModuleInventory.witnessesOf(''),
      reservedNamesChanged: reservedNamesChanged,
      printWarnings: warningCount,
      haxePrinterModules: printerNames.length,
      haxePrinterModuleNames: printerNames,
      generationMs: milliseconds(generationSeconds),
      cleanPlanMs: milliseconds(cleanPlan),
      cleanEmitMs: milliseconds(cleanEmit),
      replayMs: milliseconds(replaySeconds),
      projectedGenerationMs: milliseconds(generationSeconds
        - cleanPlan
        - cleanEmit),
      cacheBytes: GenerationCache.bytes(),
      cacheAnswerBytes: GenerationCache.answerBytes(),
      cacheEntries: GenerationCache.storedModules().length,
      cacheStored: stored,
      stages: stageReports,
      overhead: {
        changeSetMs: milliseconds(changeSetSeconds),
        fingerprintMs: milliseconds(fingerprintSeconds),
        decideMs: milliseconds(decideSeconds),
        planMs: milliseconds(planCheckSeconds),
        recordMs: milliseconds(recordSeconds),
        compareMs: milliseconds(compareSeconds),
        cacheWriteMs: milliseconds(cacheWriteSeconds),
        totalMs: milliseconds(overheadSeconds)
      },
      walk: walkReport(),
      modules: moduleReports
    };
    try {
      File.saveContent(reportFile, Json.stringify(report, null, '  ') + '\n');
    } catch (error:haxe.Exception) {
      Context.warning('[GENES-INCREMENTAL-REPORT-002] Genes cannot write the '
        + 'generation report $reportFile (${error.message}). The build '
        + 'continues without it.',
        Context.currentPos());
    }
  }

  /** Returns the walk part of the report (`ShadowWalkReport`). */
  function walkReport(): ShadowWalkReport {
    final pass = rerun ? 'stored, then live' : storedVisits > 0 ? 'stored' : 'live';
    final measured = walkDivergence;
    final left = walkLeft != null ? walkLeft : measured != null ? measured : planFallback != null ? 'checks before emission: $planFallback' : null;
    final clean = switch decision {
      case Rules(clean, _): clean;
      default: null;
    }
    final visitedClean = storedVisits + checkedVisits > 0;
    final verdict = if (walkDivergenceKind == 'drift' || walksDiffer != null)
      'drift' else if (left != null
      && clean != null) 'left' else if (clean == null || !visitedClean)
      'none' else 'on-path';
    return {
      pass: pass,
      verdict: verdict,
      left: left,
      storedVisits: storedVisits,
      liveVisits: liveVisits,
      checkedVisits: checkedVisits,
      missing: missingVisits,
      differs: differingVisits,
      stale: staleSteps,
      walksDiffer: walksDiffer,
      storedMs: milliseconds(storedWalkSeconds),
      liveMs: milliseconds(liveWalkSeconds)
    };
  }

  /**
   * Compares the stored result of one module that `"reuse"` would replay
   * with what this request printed and recorded, and adds each difference
   * to `mismatches`: files and their text, print warnings, the final member
   * list, the root flags, the answers, the added features and the public
   * entries. Any difference is a failure; there is no explained class.
   */
  function compare(module: String, mismatches: Array<ShadowMismatch>): Void {
    final stored = GenerationCache.entry(module);
    if (stored == null)
      return;
    final staged = files.get(module);
    if (staged == null) {
      add(mismatches, {
        module: module,
        path: '',
        kind: 'not emitted now',
        line: 0,
        stored: '',
        staged: ''
      });
      return;
    }
    final stagedByPath = new Map<String, String>();
    for (file in staged)
      stagedByPath.set(file.path, file.text);
    final storedPaths = new Map<String, Bool>();
    for (file in stored.files) {
      storedPaths.set(file.path, true);
      final text = stagedByPath.get(file.path);
      if (text == null) {
        add(mismatches, {
          module: module,
          path: file.path,
          kind: 'file not staged now',
          line: 0,
          stored: '',
          staged: ''
        });
      } else if (text != file.text) {
        final storedLines = file.text.split('\n');
        final stagedLines = text.split('\n');
        var index = 0;
        while (index < storedLines.length && index < stagedLines.length
          && storedLines[index] == stagedLines[index])
          index++;
        add(mismatches, {
          module: module,
          path: file.path,
          kind: 'text differs',
          line: index + 1,
          stored: clip(index < storedLines.length ? storedLines[index] : '<end of file>'),
          staged: clip(index < stagedLines.length ? stagedLines[index] : '<end of file>')
        });
      }
    }
    for (file in staged)
      if (!storedPaths.exists(file.path))
        add(mismatches, {
          module: module,
          path: file.path,
          kind: 'file new now',
          line: 0,
          stored: '',
          staged: ''
        });
    compareText(mismatches, module, 'print warnings differ',
      warningText(stored.warnings), warningText(warnings.get(module)));
    compareText(mismatches, module, 'member list differs', stored.members,
      memberLists.get(module));
    compareText(mismatches, module, 'root flags differ', stored.rootFlags,
      rootFlagTexts.get(module));
    // `answerText`: a stored line holds the separator U+0001, which the
    // report must not carry raw (Haxe's JSON printer leaves it unescaped).
    compareText(mismatches, module, 'answers differ',
      stored.answers.map(GenerationCache.answerText).join('\n'),
      sortedLines(answers.get(module)).map(GenerationCache.answerText)
        .join('\n'));
    compareText(mismatches, module, 'added features differ',
      stored.additions.join('\n'),
      sortedLines(additions.get(module)).join('\n'));
    compareText(mismatches, module, 'public entries differ',
      publicEntryText(stored.publicEntries),
      publicEntryText(publicEntries.get(module)));
    final storedRequests = stored.runtimeRequests;
    final printedRequests = runtimeRequestLists.get(module);
    compareText(mismatches, module, 'runtime requests differ',
      storedRequests == null ? '<none>' : storedRequests.join(' '),
      printedRequests == null ? '<none>' : printedRequests.join(' '));
  }

  static function compareText(mismatches: Array<ShadowMismatch>,
      module: String, kind: String, stored: Null<String>,
      staged: Null<String>): Void {
    final left = stored == null ? '' : stored;
    final right = staged == null ? '' : staged;
    if (left != right)
      add(mismatches, {
        module: module,
        path: '',
        kind: kind,
        line: 0,
        stored: clip(left),
        staged: clip(right)
      });
  }

  static function stageName(phase: IncrementalPhase): String {
    return switch phase {
      case Inventory: 'inventory';
      case Reachability: 'reachability';
      case Validation: 'validation';
      case Emit: 'emit';
      case Replay: 'replay';
    }
  }

  /** Returns a warning list as one text, one warning with its position on each line. */
  static function warningText(list: Null<Array<CachedWarning>>): String {
    if (list == null)
      return '';
    return [
      for (warning in list)
        '${warning.file}:${warning.min}-${warning.max} ${warning.message}'
    ].join('\n');
  }

  /** Returns a public entry list as one text, one entry with its position on each line. */
  static function publicEntryText(list: Null<Array<CachedPublicEntry>>): String {
    if (list == null)
      return '';
    return [
      for (entry in list)
        '${entry.name} ${entry.file}:${entry.min}-${entry.max}'
    ].join('\n');
  }

  /**
   * Returns the root flags of one module as one text: whether it is an
   * implementation root, whether an `@:expose` names it, the length of its
   * export list, and whether it gets an implementation file.
   */
  public static function rootFlags(root: Bool, exposed: Bool, exports: Int,
      implementation: Bool): String {
    return 'root=${root ? 1 : 0} exposed=${exposed ? 1 : 0} exports=$exports '
      + 'implementation=${implementation ? 1 : 0}';
  }

  /**
   * Stores this request's result as the new cache. A replayed module keeps
   * its stored entry, with this request's epochs, fingerprint, proofs and
   * witnesses; it equals what a new print would record.
   */
  function storeCache(): Bool {
    final modules = new Map<String, CachedModule>();
    for (module => list in files) {
      final sortedFiles = list.copy();
      sortedFiles.sort((left, right) -> compareStrings(left.path, right.path));
      final fingerprint = fingerprints.exists(module) ? fingerprints.get(module) : fingerprintOf(module,
        [], new Map());
      final earlier = replayed.exists(module) ? GenerationCache.entry(module) : null;
      final witnesses = witnessesOf(module);
      if (earlier != null) {
        final known = new Map<String, Bool>();
        for (witness in witnesses)
          known.set(witness.module, true);
        for (witness in earlier.witnesses)
          if (!known.exists(witness.module))
            witnesses.push({
              module: witness.module,
              epochs: GenerationChangeSet.epochs(witness.module)
            });
      }
      modules.set(module, {
        epochs: GenerationChangeSet.epochs(module),
        fingerprint: fingerprint,
        witnesses: witnesses,
        usedHaxePrinter: HaxePrinterUse.used(module),
        files: sortedFiles,
        warnings: earlier != null ? earlier.warnings : {
          final list = warnings.get(module);
          list == null ? [] : list;
        },
        proofs: GenerationChangeSet.declarationProofs(module),
        members: {
          final known = memberLists.get(module);
          known == null ? '' : known;
        },
        rootFlags: {
          final known = rootFlagTexts.get(module);
          known == null ? '' : known;
        },
        answers: earlier != null ? earlier.answers : sortedLines(answers.get(module)),
        additions: earlier != null ? earlier.additions : sortedLines(additions.get(module)),
        publicEntries: earlier != null ? earlier.publicEntries : {
          final list = publicEntries.get(module);
          list == null ? [] : list;
        },
        mapSources: earlier != null ? earlier.mapSources : sortedLines(mapSources.get(module)),
        visits: earlier != null ? earlier.visits : {
          final list = visits.get(module);
          list == null ? [] : list;
        },
        runtimeRequests: earlier != null ? earlier.runtimeRequests : runtimeRequestLists.get(module)
      });
    }
    final others = new Map<String, CachedInventoryModule>();
    for (module => fingerprint in fingerprints)
      if (!files.exists(module))
        others.set(module, {
          epochs: GenerationChangeSet.epochs(module),
          fingerprint: fingerprint
        });
    return GenerationCache.commit(sessionKey,
      GenerationChangeSet.reservedNameDigest(), witnessesOf(''), modules,
      others, outputFolder, underReuse, sortedLines(answers.get('')));
  }

  static function witnessesOf(module: String): Array<CachedWitness> {
    return [
      for (read in TypedModuleInventory.witnessesOf(module))
        if (read != module) {
          module: read,
          epochs: GenerationChangeSet.epochs(read)
        }
    ];
  }

  static function add(mismatches: Array<ShadowMismatch>,
      mismatch: ShadowMismatch): Void {
    if (mismatches.length < MISMATCH_LIMIT)
      mismatches.push(mismatch);
  }

  static function addLine(target: Map<String, Map<String, Bool>>,
      module: String, line: String): Void {
    final set = target.get(module);
    if (set == null)
      target.set(module, [line => true]);
    else
      set.set(line, true);
  }

  static function sortedLines(set: Null<Map<String, Bool>>): Array<String> {
    return set == null ? [] : sortedKeys(set);
  }

  /** Returns the absolute, normalized folder of an output file. */
  static function absoluteFolder(outputFile: String): String {
    final folder = Path.directory(outputFile);
    return
      PathUtil.normalize(FileSystem.absolutePath(folder.length == 0 ? '.' : folder));
  }

  static function fingerprintOf(module: String, types: Array<Type>,
      exposed: Map<String, Array<String>>): String {
    final directives = [
      for (directive in ModuleDirectivePlan.forModule(module).directives)
        directive.value
    ];
    final names = exposed.get(module);
    final sortedNames = names == null ? [] : names.copy();
    sortedNames.sort(compareStrings);
    return ModuleFingerprint.of(types, directives, sortedNames);
  }

  /**
   * Returns the classes of `types` when every declaration is an extern
   * class, or `null` otherwise. Each class is read once, and
   * `ModuleFingerprint.ofExtern` gets the classes that were read here.
   */
  static function externClasses(types: Array<Type>): Null<Array<ClassType>> {
    final classes = [];
    for (type in types)
      switch type {
        case TInst(ref, _):
          final cls = ref.get();
          if (!cls.isExtern)
            return null;
          classes.push(cls);
        default:
          return null;
      }
    return classes;
  }

  /**
   * Returns whether `declaration` is in the generator's list of this
   * request, so that its module's fingerprint holds it.
   * `ModuleFingerprint.members` gives every other member its full text (L6
   * of the review of genes-ts #245). Without an active shadow it returns
   * false, which only makes that text longer.
   */
  public static function listed(declaration: BaseType): Bool {
    final shadow = current;
    return shadow != null
      && shadow.listedDeclarations.exists(listedKey(declaration));
  }

  /**
   * Returns the key of a declaration in `listedDeclarations`: its full name
   * and the place of its declaration. The name alone is not unique: Haxe
   * renames a class with `@:native("Lib")` to `Lib` before generation, so a
   * listed class could hide a removed class `Lib` of the same module.
   */
  static function listedKey(declaration: BaseType): String {
    final place = Context.getPosInfos(declaration.pos);
    return
      '${TypeUtil.baseTypeFullName(declaration)}@${place.min}-${place.max}';
  }

  /** Returns the declaration of a named type, or `null` for any other type. */
  static function declarationOf(type: Type): Null<BaseType> {
    return switch type {
      case TInst(ref, _): ref.get();
      case TEnum(ref, _): ref.get();
      case TType(ref, _): ref.get();
      case TAbstract(ref, _): ref.get();
      default: null;
    }
  }

  static function clip(line: String): String {
    return line.length <= LINE_LIMIT ? line : line.substr(0, LINE_LIMIT)
      + '...';
  }

  static function milliseconds(seconds: Float): Float {
    return Math.round(seconds * 100000) / 100;
  }

  static function sortedKeys<T>(map: Map<String, T>): Array<String> {
    final names = [for (name in map.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
#end
