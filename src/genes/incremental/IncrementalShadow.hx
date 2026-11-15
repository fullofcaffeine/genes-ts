package genes.incremental;

#if macro
import haxe.Json;
import haxe.crypto.Sha256;
import haxe.io.Path;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Type;
import sys.FileSystem;
import sys.io.File;
import genes.incremental.GenerationCache;
import genes.incremental.IncrementalRequest;

using Lambda;

/** The phase of one module that a clock measures. */
enum IncrementalPhase {
  /** Dependency plan, reachability visit and validation of the module. */
  Plan;

  /** Printing of the module's files. */
  Emit;
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
  final changeSetMs: Float;
  final sessionKeyMs: Float;
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
  final haxePrinterModules: Int;
  final haxePrinterModuleNames: Array<String>;
  final generationMs: Float;
  final cleanPlanMs: Float;
  final cleanEmitMs: Float;
  final projectedGenerationMs: Float;
  final cacheBytes: Int;
  final cacheEntries: Int;
  final cacheStored: Bool;
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
 * What: `start` returns at once without `-D genes.dev_incremental`. With the
 * define, the generator calls the hooks below. They record:
 *
 * - the staged text of each module's files (through
 *   `OutputTransaction.onRegister`);
 * - the modules that each module read by name (witnesses of
 *   `TypedModuleInventory`) and the lookups that the inventory could not
 *   answer;
 * - whether a module used Haxe's own printer (the record of
 *   `genes.HaxePrinterUse`, which the opt-in printer report also reads);
 * - plan and emit time of each module, so that the saving of a later replay
 *   is a sum, not a guess.
 *
 * After the commit, `committed` compares, stores the new plain-data cache and
 * writes the report. A failed request writes a report and keeps the cache.
 *
 * Results in the report: `off` (outside the supported scope), `full` (no
 * usable cache, a fallback, or a lookup by name during generation),
 * `restart-required` (only a new compiler process gives cold output), and
 * `incremental` (the clean rules applied; slice 1 still generated in full).
 *
 * Lifetime: one instance for one request, kept in an ordinary static. It
 * holds compiler-owned values only until the request ends; the cache that
 * outlives it is plain data.
 */
class IncrementalShadow {
  static inline final REPORT_FORMAT = 1;
  static inline final LINE_LIMIT = 240;
  static inline final MISMATCH_LIMIT = 200;

  @:persistent static var current: Null<IncrementalShadow> = null;

  final reportFile: String;
  final started: Float;
  var active: Bool;
  var reason: Null<String> = null;
  var rootModule = '';
  var sessionKey = '';
  var decision: CacheDecision = NoCache('not decided');
  final fingerprints = new Map<String, String>();
  final files = new Map<String, Array<CachedFile>>();
  final planSeconds = new Map<String, Float>();
  final emitSeconds = new Map<String, Float>();
  var owner: Null<String> = null;
  var clockModule: Null<String> = null;
  var clockPhase: IncrementalPhase = Plan;
  var clockStart = 0.0;
  var sessionKeySeconds = 0.0;
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
   * Starts the shadow for one generation. Without the define this sets
   * nothing and returns, so the request runs exactly as before.
   */
  public static function start(outputFile: String,
      transaction: OutputTransaction): Void {
    current = null;
    switch IncrementalRequest.mode() {
      case Absent:
        return;
      case Off(path, why):
        if (path.length > 0)
          current = new IncrementalShadow(IncrementalRequest.reportPath(path),
            false, why);
        return;
      case Shadow(descriptor):
        final extension = Path.extension(outputFile);
        if (extension != 'ts' && extension != 'tsx') {
          IncrementalRequest.turnOff('only .ts and .tsx output is supported');
          current = new IncrementalShadow(IncrementalRequest.reportPath(descriptor.path),
            false,
            'only .ts and .tsx output is supported');
          return;
        }
        final shadow = new IncrementalShadow(IncrementalRequest.reportPath(descriptor.path),
          true, null);
        current = shadow;
        final keyStart = haxe.Timer.stamp();
        shadow.sessionKey = sessionKeyOf(descriptor, outputFile);
        shadow.sessionKeySeconds = haxe.Timer.stamp() - keyStart;
        TypedModuleInventory.startRecording();
        HaxePrinterUse.record();
        transaction.onRegister = (relative,
          content) -> shadow.record(relative, content);
    }
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
    final overheadSeconds = changeSetSeconds
      + sessionKeySeconds
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
      overhead: {
        changeSetMs: milliseconds(changeSetSeconds),
        sessionKeyMs: milliseconds(sessionKeySeconds),
        fingerprintMs: milliseconds(fingerprintSeconds),
        decideMs: milliseconds(decideSeconds),
        recordMs: milliseconds(recordSeconds),
        compareMs: milliseconds(compareSeconds),
        cacheWriteMs: milliseconds(cacheWriteSeconds),
        totalMs: milliseconds(overheadSeconds)
      },
      modules: moduleReports
    };
    File.saveContent(reportFile, Json.stringify(report, null, '  ') + '\n');
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
        files: sortedFiles
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

  /**
   * Builds the session key: every input of a module's output that is the same
   * for all modules. A different key drops the cache.
   */
  static function sessionKeyOf(descriptor: IncrementalDescriptor,
      outputFile: String): String {
    final buffer = new StringBuf();
    buffer.add('format ${GenerationCache.FORMAT}\n');
    buffer.add('program ${descriptor.programDigest}\n');
    buffer.add('output ${Path.normalize(FileSystem.absolutePath(outputFile))}\n');
    buffer.add('cwd ${Path.normalize(Sys.getCwd())}\n');
    final defines = Context.getDefines();
    final names = [for (name in defines.keys()) name];
    names.sort(compareStrings);
    for (name in names)
      buffer.add('define $name=${defines.get(name)}\n');
    for (classPath in Context.getClassPath())
      buffer.add('classpath $classPath\n');
    // Haxe may keep the macro interpreter, and the persistent cache, when a
    // Genes source file changes in place. The status of each file under the
    // Genes class path makes such an edit change the key.
    final generator = try Context.resolvePath('genes/Generator.hx')
    catch (_:haxe.Exception) null;
    if (generator != null) {
      final root = Path.directory(Path.directory(FileSystem.absolutePath(generator)));
      addSourceStatus(buffer, root, '');
    }
    return Sha256.encode(buffer.toString());
  }

  static function addSourceStatus(buffer: StringBuf, root: String,
      relative: String): Void {
    final directory = relative.length == 0 ? root : Path.join([root, relative]);
    final entries = FileSystem.readDirectory(directory);
    entries.sort(compareStrings);
    for (entry in entries) {
      final child = relative.length == 0 ? entry : relative + '/' + entry;
      final path = Path.join([root, child]);
      if (FileSystem.isDirectory(path)) {
        addSourceStatus(buffer, root, child);
      } else if (entry.length > 3 && entry.substr(entry.length - 3) == '.hx') {
        final status = FileSystem.stat(path);
        buffer.add('source $child ${status.size} ${status.mtime.getTime()}\n');
      }
    }
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
