package genes.incremental;

#if macro
import genes.incremental.GenerationChangeSet.KeepDecision;
import genes.incremental.GenerationChangeSet.KeepReject;
import genes.incremental.GenerationChangeSet.StampedDeclaration;
import haxe.macro.Context;

/**
 * What one pass keeps for one declaration between requests: plain text and
 * one number. It says "this pass finished its work for the declaration that
 * carried `stamp` and had the member list `members`".
 */
typedef KeptRecord = {
  /** The stamp of the declaration when the record was written, as `nonce:N`. */
  final stamp: String;

  /** The member list of a class when the record was written; `null` for other kinds. */
  final members: Null<String>;

  /** The request that wrote the record. */
  final writtenIn: Int;
}

/** One rejected record of the report, without the common first-request reasons. */
typedef KeepRejectExample = {
  final key: String;
  final reason: String;
}

/** The counts of each reject reason in one request. */
typedef KeepRejectCounts = {
  final noRecord: Int;
  final typedAgain: Int;
  final stampNamesOtherDeclaration: Int;
  final stampDiffers: Int;
  final otherObject: Int;
  final membersChanged: Int;
}

/** What one pass did with its records in one request. */
typedef KeptRecordsReport = {
  final pass: String;

  /** Records in the store at the time of the report. */
  final records: Int;

  /** Declarations whose record passed the keep rule. */
  final kept: Int;

  final rejected: Int;
  final rejectedByReason: KeepRejectCounts;

  /** At most 50 rejects for a reason other than "no record" and "typed again". */
  final rejectExamples: Array<KeepRejectExample>;

  /** Declarations for which the pass skipped its work because the record was kept. */
  final skipped: Int;

  /** Declarations for which the pass did its full work. */
  final worked: Int;

  /** Records written in this request. */
  final written: Int;

  /**
   * Compare mode: what a kept record or bucket answers wrongly, at most 50
   * entries. For the React audit: a class with a kept record whose full
   * work failed. For a pass with buckets: a query whose kept answer differs
   * from the answer of a new capture, without a known cause. Each entry is a
   * defect of the keep rule.
   */
  final compareFailures: Array<String>;

  /** The number of compare failures, without the limit of the list. */
  final compareFailureCount: Int;

  /** Compare mode: queries of the generator that were compared. */
  final compareQueries: Int;

  /**
   * Compare mode: differences with a known cause (see the pass). They are
   * counted, not judged as defects.
   */
  final compareExplained: Int;

  /** At most 50 of the explained differences. */
  final compareExplainedExamples: Array<String>;

  /**
   * Same-object tests that ran (condition 5 in `GenerationChangeSet`).
   * Always 0 for a pass with plain records: a record holds no reference to a
   * declaration.
   */
  final sameObjectTested: Int;

  /** Time of the same-object tests. It is a part of `decisionMs`. */
  final sameObjectMs: Float;

  /** Buckets of absent declarations that the age limit removed in this request. */
  final agedOut: Int;

  /**
   * Records that the start of this request dropped because the request that
   * wrote them did not reach the end of generation (see the commit step of
   * `KeptRecords`). A bucket of `KeptBuckets` goes with its record.
   */
  final uncommitted: Int;

  /** Time to put the values of the kept buckets back into the pass. */
  final replayMs: Float;

  /**
   * Why the pass did its full work for every declaration in a request with
   * reuse on, else `null`.
   */
  final fullWork: Null<String>;

  /** Time of the keep decisions, without the read of the member lists. */
  final decisionMs: Float;

  /** Time of the full work of the pass. */
  final workMs: Float;
}

/**
 * The records that one pass keeps between the requests of a compilation
 * server, with the counts of what the pass did in the current request.
 *
 * Why: a pass after typing can skip a class only when it knows that it
 * finished its work for exactly that class object in an earlier request. This
 * owner keeps that fact for each pass and asks the keep rule of
 * `GenerationChangeSet` before it answers "kept".
 *
 * What it holds: for each declaration key one `KeptRecord`: two texts and one
 * number. It holds no `Type`, no typed expression and no reference to a
 * declaration. A pass that keeps typed values puts them in `KeptBuckets`,
 * which keeps one record here for each bucket and adds the same-object
 * test.
 *
 * Example: the React audit asks `decide` for `class:app.View`. The record
 * says stamp `ab12:3`; the class arrived with stamp `ab12:3` and the same
 * member list, so the answer is `Keep` and the audit can skip the class. After
 * an edit of `app/View.hx` the class arrives without a stamp, the answer is
 * `Reject(TypedAgain)`, the audit runs, and `write` replaces the record.
 *
 * Common mistake that it prevents: writing a record before the work is
 * known to be complete. `write` is a separate call; a pass calls it only
 * after its work for the class returned an explicit clean result.
 *
 * Dropped when: the session key changes (every record of every pass, see
 * `GenerationChangeSet`). A record is replaced when its pass writes a new one
 * for the same key. A record of a class that left the program stays; it can
 * be kept again only when the same class object returns with the same stamp.
 * The store grows with the number of declaration keys, not with the number of
 * requests.
 *
 * Commit step: a record counts only when the request that wrote it reached
 * the end of generation (`onAfterGenerate`). A request that fails can still
 * run the passes after typing and write records, also for a declaration
 * that it did not type. Example (case F2 of
 * `docs/INCREMENTAL_AFTER_TYPING.md`): the first use of a `@:generic`
 * method adds a member to a kept class in a request with a type error
 * elsewhere. The pass writes a new record and bucket for that class with the
 * new member. Haxe keeps no module of the failed request, so the repaired
 * request makes the member again, with other local variable ids, while the
 * class keeps its stamp and its member list. `beginRequest` therefore drops
 * every record of a request that did not commit, and the pass does its work
 * again.
 *
 * Lifetime: `stores` is `@:persistent`. The counters belong to one request;
 * `beginRequest` sets them back.
 */
class KeptRecords {
  static inline final EXAMPLE_LIMIT = 50;

  @:persistent static var stores: Map<String, KeptRecords> = new Map();

  final pass: String;
  var records: Map<String, KeptRecord> = new Map();

  /**
   * The keys of the records that this request wrote. `commit` empties the
   * list at the end of generation; keys that are still in it at the start
   * of the next request belong to a request that failed.
   */
  var pending: Array<String> = [];

  var uncommitted = 0;
  var used = false;
  var kept = 0;
  var noRecord = 0;
  var typedAgain = 0;
  var stampNamesOtherDeclaration = 0;
  var stampDiffers = 0;
  var otherObject = 0;
  var membersChanged = 0;
  var rejectExamples: Array<KeepRejectExample> = [];
  var skipped = 0;
  var worked = 0;
  var written = 0;
  var compareFailures: Array<String> = [];
  var compareFailureCount = 0;
  var compareQueries = 0;
  var compareExplained = 0;
  var compareExplainedExamples: Array<String> = [];
  var sameObjectTested = 0;
  var sameObjectSeconds = 0.0;
  var agedOut = 0;
  var replaySeconds = 0.0;
  var fullWork: Null<String> = null;
  var decisionSeconds = 0.0;
  var workSeconds = 0.0;

  /**
   * How often a changed session key dropped the records of this store.
   * `KeptBuckets` compares it with its own number and drops its buckets when
   * they belong to an earlier session key.
   */
  public var drops(default, null) = 0;

  function new(pass: String) {
    this.pass = pass;
  }

  /** Returns the store of the pass with this name; makes it at the first call. */
  public static function of(pass: String): KeptRecords {
    final known = stores.get(pass);
    if (known != null)
      return known;
    final created = new KeptRecords(pass);
    stores.set(pass, created);
    return created;
  }

  /**
   * Starts the counts of a request for every pass. It first removes each
   * record that an earlier request wrote without reaching the end of
   * generation (see the commit step in the class comment). When `drop` is
   * true (the session key changed), it removes every record and returns how
   * many it removed. It registers `commit` for the end of this request. Only
   * `GenerationChangeSet` calls it, once for each request on the incremental
   * path.
   */
  public static function beginRequest(request: Int, drop: Bool): Int {
    var dropped = 0;
    for (store in stores) {
      var stale = 0;
      for (key in store.pending)
        if (store.records.remove(key))
          stale++;
      store.pending = [];
      store.uncommitted = stale;
      if (drop) {
        for (_ in store.records)
          dropped++;
        store.records = new Map();
        store.drops++;
      }
      store.used = false;
      store.kept = 0;
      store.noRecord = 0;
      store.typedAgain = 0;
      store.stampNamesOtherDeclaration = 0;
      store.stampDiffers = 0;
      store.otherObject = 0;
      store.membersChanged = 0;
      store.rejectExamples = [];
      store.skipped = 0;
      store.worked = 0;
      store.written = 0;
      store.compareFailures = [];
      store.compareFailureCount = 0;
      store.compareQueries = 0;
      store.compareExplained = 0;
      store.compareExplainedExamples = [];
      store.sameObjectTested = 0;
      store.sameObjectSeconds = 0.0;
      store.agedOut = 0;
      store.replaySeconds = 0.0;
      store.fullWork = null;
      store.decisionSeconds = 0.0;
      store.workSeconds = 0.0;
    }
    Context.onAfterGenerate(commit);
    return dropped;
  }

  /**
   * The commit step: the request reached the end of generation, so the
   * records that it wrote count from now on.
   */
  static function commit(): Void {
    for (store in stores)
      store.pending = [];
  }

  /** Returns the report of each pass that used its store in this request, by name. */
  public static function reports(): Array<KeptRecordsReport> {
    final names = [for (name => store in stores) if (store.used) name];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    final result: Array<KeptRecordsReport> = [];
    for (name in names) {
      final store = stores.get(name);
      if (store != null)
        result.push(store.report());
    }
    return result;
  }

  /**
   * Asks the keep rule whether the record of `declaration` is still valid,
   * and counts the answer. `members` returns the member list of the class
   * now, or `null` for a declaration that is not a class. `sameObject` is
   * the same-object test of a bucket with typed values (`KeptBuckets` gives
   * it); a pass with plain records gives none.
   */
  public function decide(declaration: StampedDeclaration,
      members: Void->Null<String>, ?sameObject: Void->Bool): KeepDecision {
    final started = haxe.Timer.stamp();
    used = true;
    final record = records.get(declaration.key);
    final timedSameObject = sameObject == null ? null : () -> {
      final testStarted = haxe.Timer.stamp();
      final same = sameObject();
      sameObjectSeconds += haxe.Timer.stamp() - testStarted;
      sameObjectTested++;
      same;
    };
    final decision = record == null ? GenerationChangeSet.keep(declaration,
      null, null,
      members) : GenerationChangeSet.keep(declaration, record.stamp,
        record.members, members, timedSameObject);
    switch decision {
      case Keep:
        kept++;
      case Reject(reason):
        switch reason {
          case NoRecord:
            noRecord++;
          case TypedAgain:
            typedAgain++;
          case StampNamesOtherDeclaration:
            stampNamesOtherDeclaration++;
            example(declaration.key, 'stampNamesOtherDeclaration');
          case StampDiffers:
            stampDiffers++;
            example(declaration.key, 'stampDiffers');
          case OtherObject:
            otherObject++;
            example(declaration.key, 'otherObject');
          case MembersChanged:
            membersChanged++;
            example(declaration.key, 'membersChanged');
        }
    }
    decisionSeconds += haxe.Timer.stamp() - started;
    return decision;
  }

  /**
   * Writes the record of `declaration`. Call it only after the work of the
   * pass for this declaration returned an explicit clean result in this
   * request.
   *
   * The record waits for the commit step when it differs from the record
   * that it replaces, or when `holdsTypedValues` is true (`KeptBuckets`
   * passes true: its bucket holds values of this request, so even an equal
   * record must wait). Example: the React audit in `measure` writes the same
   * record again for each kept class; such a record needs no commit, so a
   * failed request does not make the next request audit every class.
   */
  public function write(declaration: StampedDeclaration,
      members: Null<String>, holdsTypedValues = false): Void {
    used = true;
    written++;
    final earlier = records.get(declaration.key);
    if (holdsTypedValues
      || earlier == null
      || earlier.stamp != declaration.stamp
      || earlier.members != members)
      pending.push(declaration.key);
    records.set(declaration.key, {
      stamp: declaration.stamp,
      members: members,
      writtenIn: GenerationChangeSet.request()
    });
  }

  /**
   * Removes the record of one declaration key. `KeptBuckets` calls it when
   * it removes the bucket of that key, so that no record stays without its
   * bucket.
   */
  public function remove(key: String): Void {
    records.remove(key);
  }

  /** Counts one declaration whose work the pass skipped because its record was kept. */
  public function countSkipped(): Void {
    skipped++;
  }

  /** Counts one declaration for which the pass did its full work in `seconds`. */
  public function countWorked(seconds: Float): Void {
    worked++;
    workSeconds += seconds;
  }

  /**
   * Compare mode: notes one wrong answer of a kept record or bucket. For the
   * React audit `text` is the key of a class whose full work failed. For a
   * pass with buckets it names the query and both answers.
   */
  public function countCompareFailure(text: String): Void {
    compareFailureCount++;
    if (compareFailures.length < EXAMPLE_LIMIT)
      compareFailures.push(text);
  }

  /** Returns the number of compare failures of this request. */
  public function compareFailureTotal(): Int {
    return compareFailureCount;
  }

  /** Compare mode: counts one query of the generator that was compared. */
  public function countCompareQuery(): Void {
    used = true;
    compareQueries++;
  }

  /**
   * Compare mode: notes one difference between a kept answer and a new
   * capture that has a known cause. `text` names the query and both answers.
   */
  public function countCompareExplained(text: String): Void {
    compareExplained++;
    if (compareExplainedExamples.length < EXAMPLE_LIMIT)
      compareExplainedExamples.push(text);
  }

  /** Counts buckets of absent declarations that the age limit removed. */
  public function countAgedOut(count: Int): Void {
    agedOut += count;
  }

  /** Adds the time that the pass used to put kept values back. */
  public function countReplay(seconds: Float): Void {
    replaySeconds += seconds;
  }

  /**
   * Notes why the pass did its full work for every declaration although
   * reuse was on. Example: "a type is nested deeper than 64 levels".
   */
  public function noteFullWork(reason: String): Void {
    used = true;
    fullWork = reason;
  }

  function example(key: String, reason: String): Void {
    if (rejectExamples.length < EXAMPLE_LIMIT)
      rejectExamples.push({key: key, reason: reason});
  }

  function report(): KeptRecordsReport {
    var count = 0;
    for (_ in records)
      count++;
    return {
      pass: pass,
      records: count,
      kept: kept,
      rejected: noRecord + typedAgain + stampNamesOtherDeclaration +
      stampDiffers + otherObject + membersChanged,
      rejectedByReason: {
        noRecord: noRecord,
        typedAgain: typedAgain,
        stampNamesOtherDeclaration: stampNamesOtherDeclaration,
        stampDiffers: stampDiffers,
        otherObject: otherObject,
        membersChanged: membersChanged
      },
      rejectExamples: rejectExamples,
      skipped: skipped,
      worked: worked,
      written: written,
      compareFailures: compareFailures,
      compareFailureCount: compareFailureCount,
      compareQueries: compareQueries,
      compareExplained: compareExplained,
      compareExplainedExamples: compareExplainedExamples,
      sameObjectTested: sameObjectTested,
      sameObjectMs: GenerationChangeSet.milliseconds(sameObjectSeconds),
      agedOut: agedOut,
      uncommitted: uncommitted,
      replayMs: GenerationChangeSet.milliseconds(replaySeconds),
      fullWork: fullWork,
      decisionMs: GenerationChangeSet.milliseconds(decisionSeconds),
      workMs: GenerationChangeSet.milliseconds(workSeconds)
    };
  }
}
#end
