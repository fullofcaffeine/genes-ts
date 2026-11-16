package genes.incremental;

#if macro
import genes.incremental.GenerationChangeSet.StampedDeclaration;
import haxe.macro.Type;

/**
 * What one pass keeps for one declaration between requests, when the kept
 * values are compiler-owned typed values.
 */
private typedef KeptBucket<T> = {
  /**
   * The declaration reference that Haxe gave in the request that made the
   * bucket. The same-object test writes through it.
   */
  final declaration: ModuleType;

  /** The values that the pass read from the declaration. */
  final value: T;

  /** True when the declaration arrived without a stamp in that request. */
  final firstRead: Bool;

  /** The last request in which the declaration was in the program. */
  var seenIn: Int;
}

/** A kept bucket that passed the keep rule in this request. */
typedef KeptValue<T> = {
  final value: T;

  /**
   * True when the bucket was made in the request in which Haxe typed the
   * declaration. Its values are then a read before Haxe changed the typed
   * bodies, the same read as in a build from a new compiler process. False
   * for a bucket that was made later from the declaration that Haxe had
   * already saved, for example after a changed session key.
   */
  final firstRead: Bool;
}

/**
 * The only place where Genes keeps compiler-owned typed values (`Type`
 * values, typed bodies, declaration references) from one request of a
 * compilation server to the next.
 *
 * Why: a pass after typing reads every declaration on every request, also
 * the declarations that Haxe did not type again. To skip that work, the pass
 * must keep what it read. For `genes.ts.SignatureCache` that is `Type`
 * values, which are valid only while Haxe keeps the declaration object that
 * they came from. One owner holds such values, so that one rule decides when
 * they are valid and one place drops them.
 *
 * What: one store for each pass. For each declaration key it holds one
 * bucket: the values of the pass (type `T`), and the declaration reference
 * of the request that made the bucket. Beside each bucket, `KeptRecords`
 * holds the plain record (stamp and member list) and all counts.
 *
 * `kept` returns the values only when the whole keep rule of
 * `GenerationChangeSet` holds: the request is eligible, the session key is
 * the same, the declaration arrived with one stamp that names it, the stamp
 * equals the stamp of the bucket, the bucket's reference addresses the
 * declaration object of this request (the same-object test), and for a class
 * the member list is the same.
 *
 * Example: `app.Leaf` is edited. Haxe types `app.Leaf` again; it arrives
 * without a stamp, `kept` returns `null`, the pass reads the class and calls
 * `write`. Every other declaration arrives with its stamp; `kept` returns
 * the values of the first request, and the pass does not read those
 * declarations.
 *
 * Common mistakes that it prevents:
 *
 * - A typed value in a `@:persistent` map of a pass. Such a map has no rule
 *   that says when an entry is stale. A pass gives its values to `write`
 *   and reads them back only through `kept`.
 * - A write through a kept value. The values are read-only: metadata that
 *   is written through a kept declaration record replaces the current
 *   metadata with an old copy. Only the same-object test writes, and it
 *   reads a new copy first and removes its entry again.
 *
 * Dropped when: the session key changes (every bucket of every pass); the
 * keep rule rejects the bucket and the pass writes a new one or calls
 * `forget`; or the declaration was absent from the program for more than
 * `ABSENT_REQUEST_LIMIT` requests (`endRequest`). A bucket of an absent
 * declaration is never returned: `kept` is asked only for a declaration of
 * the current request. The store grows with the number of declaration keys,
 * not with the number of requests.
 *
 * Commit step: a bucket counts only when the request that wrote it reached
 * the end of generation. A request that fails can still run the passes
 * after typing and write buckets, also for a declaration that it did not
 * type: the first use of a `@:generic` method adds a member to a kept class
 * (case F2 of `docs/INCREMENTAL_AFTER_TYPING.md`). Haxe keeps no module of
 * the failed request, so the repaired request makes that member again with
 * other local variable ids, and the class keeps its stamp and member list. A
 * bucket of the failed request would then pass the keep rule and miss the
 * facts of the new locals. `KeptRecords` drops the record of each such
 * write at the start of the next request; without its record `kept`
 * rejects the bucket (`noRecord`) and removes it.
 *
 * Lifetime: a pass keeps its store in one `@:persistent` field. Only an
 * eligible request with `-D genes.dev_incremental` reads or writes it;
 * without the define no store exists.
 */
class KeptBuckets<T> {
  /**
   * The number of requests for which a bucket stays while its declaration
   * is not in the program. Example: a test module that is built in every
   * other request keeps its bucket; a deleted module loses it after eight
   * requests.
   */
  public static inline final ABSENT_REQUEST_LIMIT = 8;

  final records: KeptRecords;
  var buckets: Map<String, KeptBucket<T>> = new Map();
  var drops: Int;

  /**
   * Makes the store of the pass with this name. A pass calls it once for
   * each life of the macro interpreter and keeps the result.
   */
  public function new(pass: String) {
    records = KeptRecords.of(pass);
    drops = records.drops;
  }

  /**
   * Returns the kept values of `declaration` when every condition of the
   * keep rule holds, else `null`. The answer is counted in the report of
   * the pass.
   *
   * `current` is the reference that Haxe gave for the declaration in this
   * request. `members` returns the member list of a class now, or `null`
   * for another kind of declaration.
   */
  public function kept(declaration: StampedDeclaration, current: ModuleType,
      members: Void->Null<String>): Null<KeptValue<T>> {
    sync();
    final bucket = buckets.get(declaration.key);
    if (bucket == null) {
      // No bucket means no record: the two are written and removed together.
      records.remove(declaration.key);
      records.decide(declaration, members);
      return null;
    }
    return switch records.decide(declaration, members,
      () -> GenerationChangeSet.sameObject(bucket.declaration, current)) {
      case Keep:
        bucket.seenIn = GenerationChangeSet.request();
        {value: bucket.value, firstRead: bucket.firstRead};
      case Reject(NoRecord):
        // The record was dropped (for example by the commit step of
        // `KeptRecords`): the bucket goes with it.
        buckets.remove(declaration.key);
        null;
      case Reject(_):
        null;
    }
  }

  /**
   * Keeps `value` as the bucket of `declaration` and replaces an earlier
   * bucket. Call it only after the pass read the complete declaration in
   * this request. `members` is the member list of a class, or `null`.
   */
  public function write(declaration: StampedDeclaration, current: ModuleType,
      members: Null<String>, value: T): Void {
    sync();
    final request = GenerationChangeSet.request();
    buckets.set(declaration.key, {
      declaration: current,
      value: value,
      firstRead: declaration.arrival == TypedAgain,
      seenIn: request
    });
    records.write(declaration, members, true);
  }

  /**
   * Removes the bucket and the record of `declaration`. A pass calls it
   * when the work of this request must not be kept and an older bucket must
   * not stay either.
   */
  public function forget(declaration: StampedDeclaration): Void {
    sync();
    buckets.remove(declaration.key);
    records.remove(declaration.key);
  }

  /**
   * Ends the request for this store: removes each bucket whose declaration
   * was absent for more than `ABSENT_REQUEST_LIMIT` requests. A pass calls
   * it after its last declaration.
   */
  public function endRequest(): Void {
    sync();
    final request = GenerationChangeSet.request();
    final old = [
      for (key => bucket in buckets)
        if (request - bucket.seenIn > ABSENT_REQUEST_LIMIT) key
    ];
    for (key in old) {
      buckets.remove(key);
      records.remove(key);
    }
    if (old.length > 0)
      records.countAgedOut(old.length);
  }

  /** Returns the plain records and the counts of this pass. */
  public function counts(): KeptRecords {
    return records;
  }

  /**
   * Drops every bucket when a changed session key dropped the records of
   * this pass since the last call. `GenerationChangeSet` drops the records
   * at the start of the request; the buckets follow at their first use.
   */
  function sync(): Void {
    if (drops != records.drops) {
      drops = records.drops;
      buckets = new Map();
    }
  }
}
#end
