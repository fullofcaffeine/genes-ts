package genes.incremental;

/**
 * Counts of the work that one request did. Each count is exact: the same
 * request on the same warm server gives the same numbers, also on a busy
 * host. See `RequestMeasure`.
 */
typedef RequestWorkCounts = {
  /** Declarations that the Genes after-typing walk visited (`AfterTypingPasses.run`). */
  final afterTypingDeclarations: Int;

  /**
   * Declarations that the generate hook visited: each entry of Haxe's list
   * in the stamp loop of `Generator.use()` and in the generator's inventory
   * (`Generator.typesPerModule`).
   */
  final generateDeclarations: Int;

  /** Typed bodies that Genes copied from Haxe (`ClassField.expr()`). */
  final bodyReads: Int;

  /**
   * Different functions whose body Genes copied. `bodyReads` divided by
   * this number is the number of copies of each body.
   */
  final bodyFunctions: Int;

  /** Typed expressions that a printer printed (`ExprEmitter.emitExpressionPos`). */
  final printerNodes: Int;

  /**
   * Typed expressions whose children a plan walk visited (one for each
   * `iter` over the children of a node in a plan, such as `NamePlan` or
   * `TsNarrowingPlan`).
   */
  final plannerNodes: Int;

  /**
   * Typed expressions whose children a walk of the incremental checks
   * visited (`ModuleRequest.referencesOf`, `ModuleRequest.skeletonOf`,
   * `DceStdUses`).
   */
  final factNodes: Int;

  /** Stored records that the request read: module records and generation cache entries. */
  final recordsRead: Int;

  /** Stored records that the request wrote: module records and generation cache entries. */
  final recordsWritten: Int;
}

/**
 * The cost of one named phase in one request, without the cost of the
 * named phases inside it (self cost).
 */
typedef RequestPhaseMeasure = {
  /** The phase name, for example `haxe.typing` or `genes.emit.implementation`. */
  final name: String;

  /** How often the phase started in this request. */
  final calls: Int;

  /** CPU time of the Haxe process in the phase (`Sys.cpuTime()`), in milliseconds. */
  final cpuMs: Float;

  /**
   * Words that the Haxe process allocated in the phase: minor plus major
   * minus promoted words of `eval.vm.Gc.counters()`, rounded.
   *
   * Not stable between runs: OCaml 5.1 adds the free rest of the minor
   * heap at each minor collection, so a phase in which a collection falls
   * gets up to one minor heap more (example: `genes.generate` of the same
   * module request reported 6,149 words in one run and 235,188 in
   * another). Equal requests in one run give equal words per phase; the
   * sum over all phases (`RequestMeasureReport.words`) is the stable unit.
   */
  final words: Float;

  /** The work counts of the phase. */
  final work: RequestWorkCounts;
}

/**
 * The `measure` field of a request report (`ModuleRequestReport`, the
 * generation report of a program request, `ModuleRecordsReport`).
 */
typedef RequestMeasureReport = {
  /** The format of this object. */
  final format: Int;

  /** CPU time from the start of `Generator.use()` to this report, in milliseconds. */
  final cpuMs: Float;

  /** Words allocated from the start of `Generator.use()` to this report. */
  final words: Float;

  /**
   * Minor collections from the start of `Generator.use()` to this report
   * (`eval.vm.Gc.quick_stat().minor_collections`). Each one can add up to
   * one minor heap of words that were never allocated (see
   * `RequestPhaseMeasure.words`), so two `words` values compare only when
   * this count is close too.
   */
  final minorCollections: Int;

  /**
   * The CPU time of the Haxe process since it started, in milliseconds,
   * when the measure began (`processCpuStartMs`) and at this report
   * (`processCpuEndMs`). A reader that read the process CPU time from
   * outside before and after the request (`readProcessCounters`) gets the
   * two parts outside the measure from them: `haxe.before-genes` (start
   * minus the read before) and `haxe.after-genes` (the read after minus
   * end).
   */
  final processCpuStartMs: Float;

  final processCpuEndMs: Float;

  /**
   * The CPU time of `cpuMs` that no phase names: the self time of the
   * Genes catch-all phases (`genes.after-typing`, `genes.on-generate`,
   * `genes.generate`). A new phase belongs where this grows.
   */
  final unnamedCpuMs: Float;

  /** The work counts of the whole request. */
  final work: RequestWorkCounts;

  /**
   * Each phase once, in the order in which it first started. The measure's
   * own cost (two clock reads and a copy of the counts per start and end)
   * falls on the phases that start most often, so their share is too large
   * (example: `genes.after-typing.pass.signatureCache` starts 69 times in a
   * fixture module request).
   */
  final phases: Array<RequestPhaseMeasure>;
}

/**
 * Measures one Genes request in units that stay valid on a busy host.
 *
 * Why: wall time of a request on a loaded machine varies by 160% or more,
 * so a speed claim that rests on milliseconds is weak. Other units repeat:
 * counts of work (exact), words that the OCaml heap allocated
 * (`eval.vm.Gc.counters()`; equal for equal work, see Limits) and CPU time
 * per phase (only in pairs). The session adds retired instructions of
 * the whole Haxe process from outside (`tooling/src/session/process-counters.ts`).
 *
 * What: integer counters of work (`RequestWorkCounts`), and a table of
 * named phases with their CPU time, words and work. Phases nest: a phase
 * reports its self cost, so the phases add up to the whole request. Example
 * order of a module request: `genes.init`, `haxe.typing`,
 * `genes.after-typing`, `haxe.filters`, `genes.on-generate` (with
 * `genes.module.after-save` inside), `haxe.dce`, `genes.generate` (with
 * `genes.plan.inventory`, `genes.emit.implementation`, `genes.module.check`
 * and others inside).
 *
 * How: `begin` turns the measure on only for a request whose request
 * descriptor asks for it (`"requestMeasure": true`, `IncrementalRequest`),
 * so every other request reads no clock and allocates nothing for it. On,
 * it costs retired instructions: 6.5% of a full request and 4.0% of a
 * module request of the fixture program (medians of 20 paired runs; 95%
 * intervals 5.4% to 7.2% and 3.7% to 4.4%). `mark` switches the top phase at a hook
 * boundary; `open` (also through `genes.util.Timer.timer`) starts a nested
 * phase. `report` gives the object that a request report stores.
 *
 * Limits: the measure starts in `Generator.use()`; what Haxe does for a
 * request before that init macro, and after the last report, is outside
 * it. In the macro interpreter an integer result is itself a small heap
 * value, so a counter step allocates a few words; that cost is the same in
 * each repeat. OCaml 5.1 adds the free rest of the minor heap to the minor
 * words at each minor collection: `begin` empties the minor heap (one minor
 * collection per measured request) so that equal work gives equal words,
 * but a small change of work moves `words` in steps of up to one minor
 * heap. Nothing here changes generated output.
 */
class RequestMeasure {
  /** The format of `RequestMeasureReport`. */
  static inline final FORMAT = 1;

  static inline final AFTER_TYPING_DECLARATIONS = 0;
  static inline final GENERATE_DECLARATIONS = 1;
  static inline final BODY_READS = 2;
  static inline final BODY_FUNCTIONS = 3;
  static inline final PRINTER_NODES = 4;
  static inline final PLANNER_NODES = 5;
  static inline final FACT_NODES = 6;
  static inline final RECORDS_READ = 7;
  static inline final RECORDS_WRITTEN = 8;
  static inline final COUNTERS = 9;

  /** The top phases that hold Genes work which no nested phase names. */
  static final CATCH_ALL = ['genes.after-typing', 'genes.on-generate', 'genes.generate'];

  /** True while a request that asked for the measure runs; every step below does nothing otherwise. */
  public static var active(default, null) = false;

  static final counts: Array<Int> = [for (_ in 0...COUNTERS) 0];
  static var functions = new Map<String, Bool>();
  static var stack: Array<OpenPhase> = [];
  static var totals = new Map<String, PhaseTotal>();
  static var order: Array<PhaseTotal> = [];
  static var beginCpu = 0.0;
  static var beginWords = 0.0;
  static var beginMinorCollections = 0;

  /**
   * Starts the measure of a new request, or turns it off. `Generator.use()`
   * calls it first, with `on` true only when the request descriptor has
   * `"requestMeasure": true`. Every count starts again here, also when a warm server kept
   * the macro state of an earlier request.
   */
  public static function begin(on: Bool): Void {
    active = on;
    for (index in 0...COUNTERS)
      counts[index] = 0;
    functions = new Map();
    stack = [];
    totals = new Map();
    order = [];
    if (!on)
      return;
    #if eval
    // OCaml 5 counts the free rest of the minor heap as allocated at each
    // minor collection, so the words of the same work differ by that rest
    // when the heap is at another point. An empty minor heap at the start
    // makes the collections of the request fall at the same points in each
    // repeat. Probe on Haxe 4.3.7 (OCaml 5.1.1), 256K-word minor heap:
    // without it, one of three equal module requests reported 229,376 more
    // words (1.1%); with it, five gave 20,537,613 to 20,537,621.
    eval.vm.Gc.minor();
    #end
    beginCpu = cpu();
    beginWords = words();
    beginMinorCollections = minorCollections();
    push('genes.init', true);
  }

  /** Counts one declaration of the after-typing walk. */
  public static inline function afterTypingDeclaration(): Void
    if (active)
      counts[AFTER_TYPING_DECLARATIONS]++;

  /** Counts one declaration that the generate hook visited. */
  public static inline function generateDeclaration(): Void
    if (active)
      counts[GENERATE_DECLARATIONS]++;

  /** Counts one typed expression that a printer printed. */
  public static inline function printerNode(): Void
    if (active)
      counts[PRINTER_NODES]++;

  /** Counts one typed expression whose children a plan walk visits. */
  public static inline function plannerNode(): Void
    if (active)
      counts[PLANNER_NODES]++;

  /** Counts one typed expression whose children a walk of the incremental checks visits. */
  public static inline function factNode(): Void
    if (active)
      counts[FACT_NODES]++;

  /** Counts one stored record that the request read. */
  public static inline function recordRead(): Void
    if (active)
      counts[RECORDS_READ]++;

  /** Counts `count` stored records that the request wrote. */
  public static inline function recordsWritten(count = 1): Void
    if (active)
      counts[RECORDS_WRITTEN] += count;

  #if macro
  /**
   * Counts one copy of the typed body of `field` (call it next to
   * `field.expr()`). A function is told from another by the place of its
   * declaration, so an overload signature counts as its own function.
   */
  public static function bodyRead(field: haxe.macro.Type.ClassField): Void {
    if (!active)
      return;
    counts[BODY_READS]++;
    final place = haxe.macro.Context.getPosInfos(field.pos);
    final key = '${place.file}:${place.min}:${field.name}';
    if (!functions.exists(key)) {
      functions.set(key, true);
      counts[BODY_FUNCTIONS]++;
    }
  }
  #end

  /**
   * Ends every open phase and starts the top phase `name`, at a hook
   * boundary. Example: the first Genes after-typing callback calls
   * `mark('genes.after-typing')`, which ends `haxe.typing`.
   */
  public static function mark(name: String): Void {
    if (!active)
      return;
    final now = sample();
    while (stack.length > 0)
      pop(now);
    pushAt(name, true, now);
  }

  /**
   * Starts the nested phase `name` and returns the function that ends it.
   * Ending it also ends the phases that were started inside it and not
   * ended. Example: `final end = RequestMeasure.open('genes.module.check');
   * decide(); end();`.
   */
  public static function open(name: String): Void->Void {
    if (!active)
      return noop;
    final phase = push(name, true);
    return () -> {
      if (!active || stack.indexOf(phase) < 0)
        return;
      final now = sample();
      while (stack.length > 0) {
        final top = stack[stack.length - 1];
        pop(now);
        if (top == phase)
          break;
      }
    };
  }

  /**
   * Returns the measure from the start of the request to now, or `null`
   * when the request has none. The open phases stay open: their cost so far
   * is added to their totals (`settle`), so a later report of the same
   * request includes this one.
   */
  public static function report(): Null<RequestMeasureReport> {
    if (!active)
      return null;
    final now = sample();
    settle(now);
    var unnamed = 0.0;
    final phases = [
      for (total in order) {
        if (CATCH_ALL.indexOf(total.name) >= 0) unnamed += total.cpu;
        ({
          name: total.name,
          calls: total.calls,
          cpuMs: milliseconds(total.cpu),
          words: wholeWords(total.words),
          work: workOf(total.counts)
        } : RequestPhaseMeasure);
      }
    ];
    return {
      format: FORMAT,
      cpuMs: milliseconds(now.cpu - beginCpu),
      words: wholeWords(now.words - beginWords),
      minorCollections: minorCollections() - beginMinorCollections,
      processCpuStartMs: milliseconds(beginCpu),
      processCpuEndMs: milliseconds(now.cpu),
      unnamedCpuMs: milliseconds(unnamed),
      work: workOf(counts),
      phases: phases
    };
  }

  static function noop(): Void {}

  static function push(name: String, counted: Bool): OpenPhase
    return pushAt(name, counted, sample());

  static function pushAt(name: String, counted: Bool, now: Sample): OpenPhase {
    var total = totals.get(name);
    if (total == null) {
      total = {
        name: name,
        calls: 0,
        cpu: 0.0,
        words: 0.0,
        counts: [for (_ in 0...COUNTERS) 0]
      };
      totals.set(name, total);
      order.push(total);
    }
    if (counted)
      total.calls++;
    final phase: OpenPhase = {
      name: name,
      total: total,
      cpu: now.cpu,
      words: now.words,
      counts: now.counts,
      childCpu: 0.0,
      childWords: 0.0,
      childCounts: [for (_ in 0...COUNTERS) 0]
    };
    stack.push(phase);
    return phase;
  }

  /** Ends the top phase at `now` and adds its self cost to its total. */
  static function pop(now: Sample): Void {
    addCost(stack.length - 1, now);
    stack.pop();
  }

  /**
   * Adds the cost of every open phase up to `now` to its total, and starts
   * each of them again at `now`, so that they stay open.
   */
  static function settle(now: Sample): Void {
    var index = stack.length - 1;
    while (index >= 0)
      addCost(index--, now);
    for (phase in stack) {
      phase.cpu = now.cpu;
      phase.words = now.words;
      phase.counts = now.counts;
      phase.childCpu = 0.0;
      phase.childWords = 0.0;
      phase.childCounts = [for (_ in 0...COUNTERS) 0];
    }
  }

  /**
   * Adds the self cost of the open phase at `index` (its cost minus the cost
   * of the phases inside it) to its total, and its whole cost to the phase
   * that holds it.
   */
  static function addCost(index: Int, now: Sample): Void {
    final phase = stack[index];
    final cpuSpent = now.cpu - phase.cpu;
    final wordsSpent = now.words - phase.words;
    phase.total.cpu += cpuSpent - phase.childCpu;
    phase.total.words += wordsSpent - phase.childWords;
    for (counter in 0...COUNTERS)
      phase.total.counts[counter] += now.counts[counter]
        - phase.counts[counter]
        - phase.childCounts[counter];
    if (index > 0) {
      final parent = stack[index - 1];
      parent.childCpu += cpuSpent;
      parent.childWords += wordsSpent;
      for (counter in 0...COUNTERS)
        parent.childCounts[counter] += now.counts[counter]
          - phase.counts[counter];
    }
  }

  static function sample(): Sample
    return {
      cpu: cpu(),
      words: words(),
      counts: counts.copy()
    };

  /** CPU time of the process in seconds. */
  static function cpu(): Float {
    #if sys
    return Sys.cpuTime();
    #else
    return 0.0;
    #end
  }

  /** `value` rounded to a whole number of words, kept as a `Float` (counts pass 2^31). */
  static function wholeWords(value: Float): Float
    return Math.ffloor(value + 0.5);

  /** Minor collections since the process started. */
  static function minorCollections(): Int {
    #if eval
    return Std.int(eval.vm.Gc.quick_stat().minor_collections);
    #else
    return 0;
    #end
  }

  /** Words that the process allocated since it started. */
  static function words(): Float {
    #if eval
    final counters = eval.vm.Gc.counters();
    return counters.minor_words
      + counters.major_words
      - counters.promoted_words;
    #else
    return 0.0;
    #end
  }

  static function workOf(values: Array<Int>): RequestWorkCounts
    return {
      afterTypingDeclarations: values[AFTER_TYPING_DECLARATIONS],
      generateDeclarations: values[GENERATE_DECLARATIONS],
      bodyReads: values[BODY_READS],
      bodyFunctions: values[BODY_FUNCTIONS],
      printerNodes: values[PRINTER_NODES],
      plannerNodes: values[PLANNER_NODES],
      factNodes: values[FACT_NODES],
      recordsRead: values[RECORDS_READ],
      recordsWritten: values[RECORDS_WRITTEN]
    };

  static function milliseconds(seconds: Float): Float
    return Math.round(seconds * 100000) / 100;
}

/** The clocks and counts at one moment. */
private typedef Sample = {
  final cpu: Float;
  final words: Float;
  final counts: Array<Int>;
}

/** The sums of one phase name over a request. */
private typedef PhaseTotal = {
  final name: String;
  var calls: Int;
  var cpu: Float;
  var words: Float;
  final counts: Array<Int>;
}

/** One phase that started and has not ended. */
private typedef OpenPhase = {
  final name: String;
  final total: PhaseTotal;
  var cpu: Float;
  var words: Float;
  var counts: Array<Int>;
  var childCpu: Float;
  var childWords: Float;
  var childCounts: Array<Int>;
}
