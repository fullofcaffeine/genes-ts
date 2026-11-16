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
 * 2. The walk of reachability runs live for every module.
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
   * the replay counts, `planFallback` and `sameObjectFailures`.
   */
  static inline final REPORT_FORMAT = 3;

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
  final refusal: Null<GenerationRefusal>;
  final underReuse: Bool;
  var active: Bool;
  var reason: Null<String> = null;
  var rootModule = '';
  var sessionKey = '';
  var outputFolder = '';
  var decision: CacheDecision = NoCache('not decided');
  final fingerprints = new Map<String, String>();
  final files = new Map<String, Array<CachedFile>>();
  final warnings = new Map<String, Array<CachedWarning>>();
  var warningCount = 0;
  final planSeconds = new Map<String, Float>();
  final emitSeconds = new Map<String, Float>();

  /** Answer lines of each module (`feature <name> <0|1>`, `module <name> <0|1>`). */
  final answers = new Map<String, Map<String, Bool>>();

  /** Features that emission of each module added. */
  final additions = new Map<String, Map<String, Bool>>();

  /** Absolute sources that the maps of each module name by a relative path. */
  final mapSources = new Map<String, Map<String, Bool>>();

  /** Final member list of each module after the walk. */
  final memberLists = new Map<String, String>();

  /** Root flags of each module after the walk. */
  final rootFlagTexts = new Map<String, String>();

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
    if (generation == ReuseClean)
      for (define in EMISSION_MESSAGE_DEFINES)
        if (Context.defined(define))
          return '-D $define prints messages while Genes prints a module, '
            + 'and a replayed module is not printed';
    return null;
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
   * Gives the shadow the generator's declaration list after the inventory
   * step, and applies the clean rules before planning starts.
   */
  public static function inventory(types: Array<Type>,
      exposed: Map<String, Array<String>>, root: String): Void {
    final shadow = current;
    if (shadow == null || !shadow.active)
      return;
    shadow.rootModule = root;
    final fingerprintStart = haxe.Timer.stamp();
    final grouped = new Map<String, Array<Type>>();
    final order = [];
    for (type in types) {
      final module = moduleOf(type);
      if (module == null)
        continue;
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
      if (list.foreach(isExternClass)) {
        shadow.fingerprints.set(module, ModuleFingerprint.ofExtern(list));
        continue;
      }
      shadow.fingerprints.set(module, fingerprintOf(module, list, exposed));
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
    if (clean != null) {
      final plan = new Map<String, Bool>();
      final fallback = planFallbackReason(shadow, names, emitted, clean, now,
        plan);
      if (fallback == null)
        shadow.replayable = plan;
      else
        shadow.planFallback = fallback;
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
      clean: Map<String, Bool>, now: ReplayAnswers,
      plan: Map<String, Bool>): Null<String> {
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
   * the module map, the import graph and the signature facts do not change
   * during emission, so `planReplay` already checked them. An unknown kind
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
      anonField: null
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
        mapSources: earlier != null ? earlier.mapSources : sortedLines(mapSources.get(module))
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

  static function isExternClass(type: Type): Bool {
    return switch type {
      case TInst(ref, _): ref.get().isExtern;
      default: false;
    }
  }

  static function moduleOf(type: Type): Null<String> {
    return switch type {
      case TInst(ref, _): ref.get().module;
      case TEnum(ref, _): ref.get().module;
      case TType(ref, _): ref.get().module;
      case TAbstract(ref, _): ref.get().module;
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
