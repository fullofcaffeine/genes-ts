package genes.incremental;

#if macro
import genes.incremental.GenerationChangeSet.KeepDecision;
import genes.incremental.GenerationChangeSet.KeepReject;
import genes.incremental.GenerationChangeSet.StampedDeclaration;

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
   * Compare mode: declarations with a kept record whose full work failed.
   * Each entry is a defect of the keep rule.
   */
  final compareFailures: Array<String>;

  /**
   * Records that passed the same-object test. Always 0 here: a record holds
   * no reference to a declaration (condition 5 in `GenerationChangeSet`).
   */
  final sameObjectTested: Int;

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
 * declaration. The rule of `src/genes/AGENTS.md`, "never persist typed
 * compiler objects", therefore needs no change for it. A pass that wants to
 * keep typed values needs its own reviewed owner and the same-object test.
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
 * No commit step: a pass may write a record in a request that fails later.
 * Haxe keeps no module of a failed request, so the class is typed again in
 * the next request and arrives without the stamp of the record.
 *
 * Lifetime: `stores` is `@:persistent`. The counters belong to one request;
 * `beginRequest` sets them back.
 */
class KeptRecords {
  static inline final EXAMPLE_LIMIT = 50;

  @:persistent static var stores: Map<String, KeptRecords> = new Map();

  final pass: String;
  var records: Map<String, KeptRecord> = new Map();
  var used = false;
  var kept = 0;
  var noRecord = 0;
  var typedAgain = 0;
  var stampNamesOtherDeclaration = 0;
  var stampDiffers = 0;
  var membersChanged = 0;
  var rejectExamples: Array<KeepRejectExample> = [];
  var skipped = 0;
  var worked = 0;
  var written = 0;
  var compareFailures: Array<String> = [];
  var decisionSeconds = 0.0;
  var workSeconds = 0.0;

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
   * Starts the counts of a request for every pass. When `drop` is true (the
   * session key changed), it removes every record first and returns how many
   * it removed. Only `GenerationChangeSet` calls it.
   */
  public static function beginRequest(request: Int, drop: Bool): Int {
    var dropped = 0;
    for (store in stores) {
      if (drop) {
        for (_ in store.records)
          dropped++;
        store.records = new Map();
      }
      store.used = false;
      store.kept = 0;
      store.noRecord = 0;
      store.typedAgain = 0;
      store.stampNamesOtherDeclaration = 0;
      store.stampDiffers = 0;
      store.membersChanged = 0;
      store.rejectExamples = [];
      store.skipped = 0;
      store.worked = 0;
      store.written = 0;
      store.compareFailures = [];
      store.decisionSeconds = 0.0;
      store.workSeconds = 0.0;
    }
    return dropped;
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
   * now, or `null` for a declaration that is not a class.
   */
  public function decide(declaration: StampedDeclaration,
      members: Void->Null<String>): KeepDecision {
    final started = haxe.Timer.stamp();
    used = true;
    final record = records.get(declaration.key);
    final decision = record == null ? GenerationChangeSet.keep(declaration,
      null, null,
      members) : GenerationChangeSet.keep(declaration, record.stamp,
        record.members, members);
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
   */
  public function write(declaration: StampedDeclaration,
      members: Null<String>): Void {
    used = true;
    written++;
    records.set(declaration.key, {
      stamp: declaration.stamp,
      members: members,
      writtenIn: GenerationChangeSet.request()
    });
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
   * Compare mode: notes that the full work failed for a declaration whose
   * record the keep rule had kept.
   */
  public function countCompareFailure(key: String): Void {
    compareFailures.push(key);
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
      stampDiffers + membersChanged,
      rejectedByReason: {
        noRecord: noRecord,
        typedAgain: typedAgain,
        stampNamesOtherDeclaration: stampNamesOtherDeclaration,
        stampDiffers: stampDiffers,
        membersChanged: membersChanged
      },
      rejectExamples: rejectExamples,
      skipped: skipped,
      worked: worked,
      written: written,
      compareFailures: compareFailures,
      sameObjectTested: 0,
      decisionMs: GenerationChangeSet.milliseconds(decisionSeconds),
      workMs: GenerationChangeSet.milliseconds(workSeconds)
    };
  }
}
#end
