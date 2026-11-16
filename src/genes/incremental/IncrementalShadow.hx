package genes.incremental;

#if macro
import haxe.Json;
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.Type;
import sys.io.File;
import genes.incremental.GenerationCache;
import genes.incremental.IncrementalRequest;

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
}

/**
 * The module clocks of one generator stage, by the state of the module.
 *
 * Why: the time of a stage that is outside these clocks is fixed cost, which
 * a replay of clean modules does not remove. The stage timers of
 * `haxe --times` (for example `genes.plan.reachability`) give the stage
 * total; the total minus the three sums here is that fixed cost.
 */
typedef ShadowStageReport = {
  /** `inventory`, `reachability`, `validation` or `emit`. */
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

/** Time and state of one emitted module in the report. */
typedef ShadowModuleReport = {
  final module: String;
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
  final result: String;
  final reason: Null<String>;
  final committed: Bool;
  final typedAgain: Int;
  final typedAgainModules: Array<String>;
  final emitted: Int;
  final clean: Int;
  final dirty: Int;
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
  final projectedGenerationMs: Float;
  final cacheBytes: Int;
  final cacheEntries: Int;
  final cacheStored: Bool;
  final stages: Array<ShadowStageReport>;
  final overhead: ShadowOverhead;
  final modules: Array<ShadowModuleReport>;
}

/**
 * Runs the byte-stability shadow of Stage 3, slice 1, around one full
 * generation.
 *
 * Why: before Genes skips any work for a module that it calls clean, it must
 * show that such a module would get the same bytes. The shadow answers that
 * question on real edits while it cannot publish a wrong tree: the request
 * still plans, emits and publishes every module as before. Only after the
 * commit does it compare the stored files of the clean modules with the files
 * that it just staged.
 *
 * What: `start` returns at once unless the request descriptor selects the
 * shadow (`"generation": "shadow"`, see `IncrementalRequest`). Then the
 * generator calls the hooks below. They record:
 *
 * - the staged text of each module's files (through
 *   `OutputTransaction.onRegister`);
 * - the modules that each module read by name (witnesses of
 *   `TypedModuleInventory`) and the lookups that the inventory could not
 *   answer;
 * - whether a module used Haxe's own printer (the record of
 *   `genes.HaxePrinterUse`, which the opt-in printer report also reads);
 * - the warnings that the printer reported for each module (today only
 *   "__js__ is deprecated"), because a later replay must report them without
 *   printing the module;
 * - plan and emit time of each module, so that the saving of a later replay
 *   is a sum, not a guess.
 *
 * After the commit, `committed` compares, stores the new plain-data cache and
 * writes the report. A failed request writes a report and keeps the cache.
 *
 * One owner for the request facts: the shadow decides no eligibility, adds
 * no stamp and builds no key. It reads the mode from `IncrementalRequest`,
 * and the epochs, the modules typed again and the session key from
 * `GenerationChangeSet`, which computed them once after typing. The passes
 * after typing read the same values.
 *
 * Results in the report: `off` (outside the supported scope), `full` (no
 * usable cache, a fallback, or a lookup by name during generation),
 * `restart-required` (only a new compiler process gives cold output), and
 * `incremental` (the clean rules applied; slice 1 still generated in full).
 *
 * The report is evidence, not output. It is written only for a request
 * whose descriptor selects the shadow. A request that left the incremental
 * path before its descriptor was read writes only the after-typing report,
 * which names the reason. When the file cannot be written, the request gets
 * one warning and goes on.
 *
 * Lifetime: one instance for one request, kept in an ordinary static that
 * Haxe replaces at the start of each compilation. It holds compiler-owned
 * values only until the request ends; the cache that outlives it is plain
 * data.
 */
class IncrementalShadow {
  static inline final REPORT_FORMAT = 1;
  static inline final LINE_LIMIT = 240;
  static inline final MISMATCH_LIMIT = 200;

  static var current: Null<IncrementalShadow> = null;

  final reportFile: String;
  final started: Float;
  var active: Bool;
  var reason: Null<String> = null;
  var rootModule = '';
  var sessionKey = '';
  var decision: CacheDecision = NoCache('not decided');
  final fingerprints = new Map<String, String>();
  final files = new Map<String, Array<CachedFile>>();
  final warnings = new Map<String, Array<CachedWarning>>();
  var warningCount = 0;
  final planSeconds = new Map<String, Float>();
  final emitSeconds = new Map<String, Float>();

  /** Module clocks of each stage; the first key is `stageName`. */
  final stageSeconds = new Map<String, Map<String, Float>>();

  var owner: Null<String> = null;
  var clockModule: Null<String> = null;
  var clockPhase: IncrementalPhase = Inventory;
  var clockStart = 0.0;
  var fingerprintSeconds = 0.0;
  var decideSeconds = 0.0;
  var recordSeconds = 0.0;

  function new(reportFile: String, active: Bool, reason: Null<String>) {
    this.reportFile = reportFile;
    this.active = active;
    this.reason = reason;
    this.started = haxe.Timer.stamp();
  }

  /**
   * Starts the shadow for one generation. Without the define, or when the
   * descriptor does not select the shadow, this sets nothing and returns, so
   * the request runs exactly as before.
   *
   * A request that selected the shadow and then left the incremental path
   * (an `@:rtti` class), or that the shadow cannot serve, still gets a report
   * with the result `off` and the reason. The second case does not turn the
   * request mode off: the passes after typing have already used it. The
   * shadow cannot serve an output file that is not `.ts` or `.tsx`, and a
   * request in which a macro changed the embedded resources after typing:
   * such a request neither reads nor writes the generation cache.
   */
  public static function start(outputFile: String,
      transaction: OutputTransaction): Void {
    current = null;
    final descriptor = IncrementalRequest.requestedDescriptor();
    if (descriptor == null || descriptor.generation != Shadow)
      return;
    final reportFile = IncrementalRequest.generationReportPath(descriptor.path);
    final unsupported = switch IncrementalRequest.mode() {
      case Absent:
        return;
      case Off(_, why):
        why;
      case On(_):
        unsupportedReason(outputFile);
    }
    if (unsupported != null) {
      current = new IncrementalShadow(reportFile, false, unsupported);
      return;
    }
    final shadow = new IncrementalShadow(reportFile, true, null);
    current = shadow;
    final key = GenerationChangeSet.sessionKey();
    shadow.sessionKey = key == null ? '' : key;
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
  static function unsupportedReason(outputFile: String): Null<String> {
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
    return null;
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
      // A module of extern classes only (most of the `js.*` standard
      // library) never gets an output file, so no clean rule reads its
      // fingerprint. Reading their field lists was most of the cost.
      if (list == null || list.foreach(isExternClass))
        continue;
      shadow.fingerprints.set(module, fingerprintOf(module, list, exposed));
    }
    shadow.fingerprintSeconds = haxe.Timer.stamp() - fingerprintStart;
    final decideStart = haxe.Timer.stamp();
    shadow.decision = GenerationCache.decide({
      sessionKey: shadow.sessionKey,
      reservedNameDigest: GenerationChangeSet.reservedNameDigest(),
      rootModule: root,
      fingerprint: module -> shadow.fingerprint(module, exposed),
      epochs: GenerationChangeSet.epochs
    });
    shadow.decideSeconds = haxe.Timer.stamp() - decideStart;
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
   * and lets a later replay report them for a module that it does not print.
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
    final target = clockPhase == Emit ? emitSeconds : planSeconds;
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
        + 'this request does not read or write the generation cache';
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
          result = 'incremental';
          cleanSet = clean;
          for (why in dirty)
            dirtyReasons.set(why,
              (dirtyReasons.exists(why) ? dirtyReasons.get(why) : 0) + 1);
          final compareStart = haxe.Timer.stamp();
          for (module in sortedKeys(clean))
            compare(module, mismatches);
          compareSeconds = haxe.Timer.stamp() - compareStart;
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
    final moduleReports: Array<ShadowModuleReport> = [];
    for (module in emittedNames) {
      final plan = planSeconds.get(module);
      final emit = emitSeconds.get(module);
      final isClean = cleanSet.exists(module);
      if (isClean) {
        cleanEmitted++;
        cleanPlan += plan == null ? 0.0 : plan;
        cleanEmit += emit == null ? 0.0 : emit;
      }
      moduleReports.push({
        module: module,
        state: isClean ? 'clean' : 'dirty',
        planMs: milliseconds(plan == null ? 0.0 : plan),
        emitMs: milliseconds(emit == null ? 0.0 : emit),
        usedHaxePrinter: HaxePrinterUse.used(module)
      });
    }
    final stageReports: Array<ShadowStageReport> = [];
    for (stage in [Inventory, Reachability, Validation, Emit]) {
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
      + recordSeconds
      + compareSeconds
      + cacheWriteSeconds;
    final printerNames = HaxePrinterUse.usedModules();
    final retyped = GenerationChangeSet.retypedModules();
    final report: ShadowReport = {
      format: REPORT_FORMAT,
      request: GenerationChangeSet.request(),
      result: result,
      reason: reason,
      committed: success,
      typedAgain: retyped.length,
      typedAgainModules: retyped,
      emitted: emittedNames.length,
      clean: cleanEmitted,
      dirty: emittedNames.length - cleanEmitted,
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
      projectedGenerationMs: milliseconds(generationSeconds
        - cleanPlan
        - cleanEmit),
      cacheBytes: GenerationCache.bytes(),
      cacheEntries: GenerationCache.storedModules().length,
      cacheStored: stored,
      stages: stageReports,
      overhead: {
        changeSetMs: milliseconds(changeSetSeconds),
        fingerprintMs: milliseconds(fingerprintSeconds),
        decideMs: milliseconds(decideSeconds),
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
   * Compares the stored files of one clean module with the files that this
   * request staged, and adds each difference to `mismatches`.
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
    final storedWarnings = warningText(stored.warnings);
    final newWarnings = warningText(warnings.get(module));
    if (storedWarnings != newWarnings)
      add(mismatches, {
        module: module,
        path: '',
        kind: 'print warnings differ',
        line: 0,
        stored: clip(storedWarnings),
        staged: clip(newWarnings)
      });
  }

  static function stageName(phase: IncrementalPhase): String {
    return switch phase {
      case Inventory: 'inventory';
      case Reachability: 'reachability';
      case Validation: 'validation';
      case Emit: 'emit';
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

  /** Stores this request's result as the new cache. */
  function storeCache(): Bool {
    final modules = new Map<String, CachedModule>();
    for (module => list in files) {
      final sortedFiles = list.copy();
      sortedFiles.sort((left, right) -> compareStrings(left.path, right.path));
      modules.set(module, {
        epochs: GenerationChangeSet.epochs(module),
        fingerprint: fingerprints.exists(module) ? fingerprints.get(module) : fingerprintOf(module,
          [], new Map()),
        witnesses: witnessesOf(module),
        usedHaxePrinter: HaxePrinterUse.used(module),
        files: sortedFiles,
        warnings: {
          final list = warnings.get(module);
          list == null ? [] : list;
        }
      });
    }
    return GenerationCache.commit(sessionKey,
      GenerationChangeSet.reservedNameDigest(), witnessesOf(''), modules);
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
