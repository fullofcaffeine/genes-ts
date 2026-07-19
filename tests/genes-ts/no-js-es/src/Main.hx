import haxe.DynamicAccess;

enum SwitchValue {
  Text(value: String);
  Count(value: Int);
  Flag(value: Bool);
}

abstract RecordID(String) from String to String {
  public inline function new(value:String) {
    this = value;
  }

  public static inline function make(value:String):RecordID {
    return new RecordID(value);
  }
}

typedef NamedItem = {
  final name: String;
}

typedef RankedItem = {
  final rank: Int;
}

typedef MapHolder = {
  final named: Map<String, NamedItem>;
  final ranked: Map<String, RankedItem>;
}

typedef NamedSummary = {
  final id: String;
  final name: String;
}

typedef NamedCallback = {
  final read: () -> String;
}

/** A callback whose map lookup may be missing when the callback runs later. */
typedef NullableNamedCallback = {
  final read: () -> Null<NamedItem>;
}

/**
 * A small record whose `name` field may be missing at runtime.
 *
 * Why: the receiver-reassignment fixture needs an ordinary Haxe property that
 * can be absent without using a weak runtime type.
 *
 * What/How: `@:optional` lets Haxe object literals omit `name`, and genes-ts
 * emits the public property as `name?: string`. An ordinary read converts the
 * resulting JavaScript `undefined` to Haxe `null`. The fixture checks that an
 * earlier null guard does not keep describing a different record after the
 * local variable is assigned again.
 */
typedef OptionalNamedItem = {
  @:optional final name: String;
}

/** A mutable outer record used to prove nested receiver invalidation. */
typedef NestedOptionalNamedItem = {
  var item: OptionalNamedItem;
}

typedef MessageBatch = {
  final messages: Array<String>;
}

typedef RecordApi = {
  final id: String;
  final url: String;
  final npm: String;
}

typedef RecordFlags = {
  final enabled: Bool;
  final cached: Bool;
  final label: String;
}

typedef LargeRecord = {
  final id: RecordID;
  final name: String;
  final family: String;
  final api: RecordApi;
  final status: String;
  final flags: RecordFlags;
  final options: DynamicAccess<Dynamic>;
  final headers: DynamicAccess<String>;
  final tags: Array<String>;
}

typedef RecordApiConfig = {
  @:optional final api: String;
  @:optional final npm: String;
}

typedef RecordConfig = {
  @:optional final id: String;
  @:optional final name: String;
  @:optional final family: String;
  @:optional final provider: RecordApiConfig;
  @:optional final status: String;
  @:optional final enabled: Bool;
  @:optional final cached: Bool;
  @:optional final label: String;
  @:optional final options: DynamicAccess<Dynamic>;
  @:optional final headers: DynamicAccess<String>;
}

class Main {
  static function main(): Void {
    trace(render(Text("ok")) + ":" + render(Count(2)) + ":" + render(Flag(true)));
    trace(mapSetTemps(["alpha", "beta"]));
    trace(mapGetAfterContinue(["alpha", "missing"]).join(","));
    trace(mapGetAfterExists("alpha"));
    trace(mapGetAfterKeyIteration().join(","));
    trace(mapGetDirectAfterExists("alpha").name);
    trace(mapGetDirectAfterKeyIteration().join(","));
    final callback = closureAfterOuterGuard("alpha");
    trace(callback == null ? "missing" : callback.read());
    final reassignedOptional = optionalAfterReceiverReassignment();
    trace('receiver-reassignment:${reassignedOptional == null}:${genes.ts.Undefinable.isAbsent(reassignedOptional)}');
    trace('map-remove:${mapGetAfterRemove("alpha") == null}');
    trace('map-clear:${mapGetAfterClear("alpha") == null}');
    final branchReassigned = optionalInsideNarrowedBranch();
    trace('branch-reassignment:${branchReassigned == null}:${genes.ts.Undefinable.isAbsent(branchReassigned)}');
    final nestedReassigned = optionalAfterNestedReceiverReassignment();
    trace('nested-reassignment:${nestedReassigned == null}:${genes.ts.Undefinable.isAbsent(nestedReassigned)}');
    trace('map-receiver-reassignment:${mapGetAfterReceiverReassignment("alpha") == null}');
    trace('map-key-reassignment:${mapGetAfterKeyReassignment("alpha") == null}');
    trace('delayed-map-key:${mapKeyCallbackAfterClear() == null}');
    trace('nested-return-throw:${nestedReturnOrThrow("alpha", false)}');
    trace('nested-break-continue:${nestedBreakOrContinue(["missing", "alpha", "stop", "alpha"]).join(",")}');
    trace('nullable-map-value:${nullableMapValueAfterExists("alpha") == null}');
    final loopReassigned = optionalAfterLoopReassignment();
    trace('loop-reassignment:${loopReassigned == null}:${genes.ts.Undefinable.isAbsent(loopReassigned)}');
    final doWhileFirstRead = optionalBeforeDoWhileCondition();
    trace('do-while-first-read:${doWhileFirstRead == null}:${genes.ts.Undefinable.isAbsent(doWhileFirstRead)}');
    final doWhileBreak = optionalAfterDoWhileEarlyBreak(true, false);
    trace('do-while-break:${doWhileBreak == null}:${genes.ts.Undefinable.isAbsent(doWhileBreak)}');
    final doWhileContinue = optionalAfterDoWhileEarlyContinue(true, false);
    trace('do-while-continue:${doWhileContinue == null}:${genes.ts.Undefinable.isAbsent(doWhileContinue)}');
    trace('do-while-stable:${optionalAfterDoWhileStableBreak(true, false)}');
    final conditionReassigned = optionalAfterConditionReassignment();
    trace('condition-reassignment:${conditionReassigned == null}:${genes.ts.Undefinable.isAbsent(conditionReassigned)}');
    trace(inlineValueTemps());
    trace(mapAfterResultParameter({messages: ["one", "three"]}).join(","));
    trace(recordConstructionTemps("alpha", {name: "Alpha"}, null));
    trace(loweredRecordConstructionTemps("beta"));
  }

  static function render(input: SwitchValue): String {
    return switch input {
      case Text(value):
        value;
      case Count(value):
        Std.string(value);
      case Flag(value):
        Std.string(value);
    }
  }

  /**
   * Map facade calls should remain visible in generated user modules instead
   * of expanding to the backing native `Map` field.
   */
  static function mapSetTemps(names: Array<String>): Int {
    final holder = buildMapHolder(names);
    return holder.named.get("alpha").name.length + holder.ranked.get("first").rank;
  }

  /**
   * Generic inline helpers can introduce same-named locals with different
   * concrete types into one emitted TS function. Keep this as the temp-local
   * regression now that Map facade methods intentionally do not inline.
   */
  static function inlineValueTemps(): String {
    final first = inlineLocalValue(7);
    final second = inlineLocalValue(true);
    return '$first:$second';
  }

  static inline function inlineLocalValue<T>(input: T): T {
    final value = input;
    return value;
  }

  static function buildMapHolder(names: Array<String>): MapHolder {
    final named = new Map<String, NamedItem>();
    for (name in names)
      named.set(name, namedItem(name));

    final ranked = new Map<String, RankedItem>();
    ranked.set("first", rankedItem(1));

    return {
      named: named,
      ranked: ranked
    };
  }

  /**
   * A null guard whose then branch exits by `continue` proves the local
   * non-null for the rest of that loop iteration. Generated TS should trust
   * that flow fact instead of inserting identity casts at call/object boundaries.
   */
  static function mapGetAfterContinue(ids: Array<String>): Array<String> {
    final holder = buildMapHolder(["alpha"]);
    final out: Array<String> = [];
    for (id in ids) {
      final item = holder.named.get(id);
      if (item == null)
        continue;
      final summary: NamedSummary = {
        id: id,
        name: item.name
      };
      out.push(formatNamedSummary(summary));
    }
    return out;
  }

  static function formatNamedSummary(summary: NamedSummary): String {
    return summary.id + ":" + summary.name;
  }

  /**
   * `Map.exists(key)` proves a following `Map.get(key)` is non-null when the
   * map value type itself is non-null. Generated TS should not need an identity
   * cast at the call boundary.
   */
  static function mapGetAfterExists(id: String): String {
    final holder = buildMapHolder(["alpha"]);
    if (!holder.named.exists(id))
      return "missing";
    return formatNamedSummary({
      id: id,
      name: holder.named.get(id).name
    });
  }

  /**
   * Keys yielded from `map.keys()` are known-present for that same stable map.
   * This guards the common `for (key in map.keys()) consume(map.get(key))`
   * pattern without changing general absent-key `Map.get` behavior.
   */
  static function mapGetAfterKeyIteration(): Array<String> {
    final holder = buildMapHolder(["alpha", "beta"]);
    final out: Array<String> = [];
    for (id in holder.named.keys()) {
      out.push(formatNamedSummary({
        id: id,
        name: holder.named.get(id).name
      }));
    }
    return out;
  }

  /**
   * The same `Map.exists` fact must work when the `Map.get` result itself flows
   * into a non-null value position, not only when a field is read from it.
   */
  static function mapGetDirectAfterExists(id: String): NamedItem {
    final holder = buildMapHolder(["alpha"]);
    if (!holder.named.exists(id))
      return namedItem("missing");
    return holder.named.get(id);
  }

  /**
   * Iterating `map.keys()` proves direct `map.get(key)` call arguments non-null
   * for the same stable map/key pair.
   */
  static function mapGetDirectAfterKeyIteration(): Array<String> {
    final holder = buildMapHolder(["alpha", "beta"]);
    final out: Array<String> = [];
    for (id in holder.named.keys())
      out.push(formatNamedItem(holder.named.get(id)));
    return out;
  }

  static function formatNamedItem(item: NamedItem): String {
    return item.name;
  }

  /**
   * Outer non-null facts must not leak into returned closures. The callback may
   * execute later, so generated TS needs its own receiver assertion even though
   * the surrounding block is narrowed.
   */
  static function closureAfterOuterGuard(id: String): Null<NamedCallback> {
    final holder = buildMapHolder(["alpha"]);
    final item = holder.named.get(id);
    if (item == null)
      return null;
    return {
      read: () -> item.name
    };
  }

  /**
   * Reassigning a receiver must end facts learned about its old optional field.
   *
   * The first null guard describes the record containing `"before"`. After the
   * assignment, `item` refers to a new empty record, so the final read must use
   * the normal optional-field path and produce Haxe `null`, not raw JavaScript
   * `undefined`.
   */
  static function optionalAfterReceiverReassignment(): Null<String> {
    var item: OptionalNamedItem = {name: "before"};
    if (item.name == null)
      return null;
    item = {};
    return item.name;
  }

  /**
   * Removing a key ends the presence fact established by `Map.exists`.
   *
   * A later `Map.get` is nullable again even though the same stable map and key
   * appear in both calls. The generated TypeScript must not retain a non-null
   * assertion from the earlier check.
   */
  static function mapGetAfterRemove(id: String): Null<NamedItem> {
    final holder = buildMapHolder(["alpha"]);
    if (!holder.named.exists(id))
      return null;
    holder.named.remove(id);
    return holder.named.get(id);
  }

  /**
   * Clearing a map ends every presence fact learned for that map.
   *
   * Unlike `remove`, `clear` does not name one key. The narrowing plan
   * therefore invalidates all facts whose receiver is this map while
   * leaving facts for unrelated maps intact.
   */
  static function mapGetAfterClear(id: String): Null<NamedItem> {
    final holder = buildMapHolder(["alpha"]);
    if (!holder.named.exists(id))
      return null;
    holder.named.clear();
    return holder.named.get(id);
  }

  /**
   * Reassigning a receiver inside the guarded branch ends that branch's proof.
   *
   * This differs from `optionalAfterReceiverReassignment`: the assignment
   * happens while the `item.name != null` branch is still active. A printer
   * stack that simply keeps the branch fact until the closing brace will use
   * the old record's proof for the new empty record.
   */
  static function optionalInsideNarrowedBranch(): Null<String> {
    var item: OptionalNamedItem = {name: "before"};
    if (item.name != null) {
      item = {};
      return item.name;
    }
    return null;
  }

  /**
   * Assigning a nested receiver ends proofs about fields below that receiver.
   *
   * The guard describes `holder.item.name`. Replacing `holder.item` does not
   * assign `name` directly, but the old `name` proof is still invalid because
   * the path now reaches a different record.
   */
  static function optionalAfterNestedReceiverReassignment(): Null<String> {
    final holder: NestedOptionalNamedItem = {
      item: {name: "before"}
    };
    if (holder.item.name == null)
      return null;
    holder.item = {};
    return holder.item.name;
  }

  /** Reassigning the map local ends every presence proof for the old map. */
  static function mapGetAfterReceiverReassignment(id: String): Null<NamedItem> {
    var named = buildMapHolder(["alpha"]).named;
    if (!named.exists(id))
      return null;
    named = new Map<String, NamedItem>();
    return named.get(id);
  }

  /** Reassigning the checked key ends the proof for the earlier key value. */
  static function mapGetAfterKeyReassignment(id: String): Null<NamedItem> {
    final named = buildMapHolder(["alpha"]).named;
    var key = id;
    if (!named.exists(key))
      return null;
    key = "missing";
    return named.get(key);
  }

  /**
   * A callback created during key iteration runs in a new function scope.
   *
   * `map.keys()` proves that the key exists only while the loop body is
   * executing. The callback is invoked after `clear`, so it must perform an
   * ordinary nullable lookup rather than inherit the loop's temporary proof.
   */
  static function mapKeyCallbackAfterClear(): Null<NamedItem> {
    final named = buildMapHolder(["alpha"]).named;
    final callbacks: Array<NullableNamedCallback> = [];
    for (id in named.keys()) {
      callbacks.push({
        read: () -> named.get(id)
      });
    }
    named.clear();
    return callbacks[0].read();
  }

  /**
   * A nested branch whose alternatives both exit proves the following value.
   *
   * One missing-value path throws and the other returns. Neither can reach the
   * final field read, so the successful path still has a valid non-null proof.
   */
  static function nestedReturnOrThrow(id: String, throwMissing: Bool): String {
    final item = buildMapHolder(["alpha"]).named.get(id);
    if (item == null) {
      if (throwMissing)
        throw "missing";
      return "missing";
    }
    return item.name;
  }

  /**
   * Nested `break` and `continue` exits preserve the proof on the fall-through
   * path in the same loop iteration.
   */
  static function nestedBreakOrContinue(ids: Array<String>): Array<String> {
    final named = buildMapHolder(["alpha"]).named;
    final out: Array<String> = [];
    for (id in ids) {
      final item = named.get(id);
      if (item == null) {
        if (id == "stop")
          break;
        continue;
      }
      out.push(item.name);
    }
    return out;
  }

  /**
   * Key presence does not prove a nullable map value is non-null.
   *
   * The key exists and deliberately stores `null`. Generated TypeScript must
   * keep the nullable read even though an `exists` guard precedes it.
   */
  static function nullableMapValueAfterExists(id: String): Null<NamedItem> {
    final named = new Map<String, Null<NamedItem>>();
    named.set(id, null);
    if (!named.exists(id))
      return namedItem("missing");
    return named.get(id);
  }

  /**
   * A loop assignment invalidates an earlier field proof on every later path.
   *
   * The loop may execute and replace `item`, so neither the loop back-edge nor
   * the statement after the loop may reuse the guard's proof about the old
   * record.
   */
  static function optionalAfterLoopReassignment(): Null<String> {
    var item: OptionalNamedItem = {name: "before"};
    if (item.name == null)
      return null;
    var remaining = 1;
    while (remaining > 0) {
      item = {};
      remaining--;
    }
    return item.name;
  }

  /**
   * A `do...while` body runs once before its condition is checked.
   *
   * The condition could prove `item.name` present for a later iteration, but
   * it cannot prove anything about this first read. A function-local plan has
   * one shared program point for the body, so it must keep that point safe for
   * the first iteration instead of borrowing the later condition's proof.
   */
  static function optionalBeforeDoWhileCondition(): Null<String> {
    final item: OptionalNamedItem = {};
    var observed: Null<String> = null;
    var firstIteration = true;
    do {
      observed = item.name;
      firstIteration = false;
    } while (firstIteration && item.name != null);
    return observed;
  }

  /**
   * An early `break` can leave a `do...while` before a later null guard runs.
   *
   * Why: the loop body has one typed source location even though it may follow
   * different paths. A proof learned on the path that reaches the second `if`
   * cannot describe the path that exits at `break`.
   *
   * What/How: `visits++` prevents Haxe from rewriting this into a pre-test
   * loop, so the fixture exercises the real post-test order. When `skipGuard`
   * is true, the result must use ordinary optional-field normalization and be
   * literal Haxe `null`, not JavaScript `undefined` hidden by `!`.
   */
  static function optionalAfterDoWhileEarlyBreak(skipGuard: Bool,
      repeat: Bool): Null<String> {
    final item: OptionalNamedItem = {};
    var visits = 0;
    do {
      visits++;
      if (skipGuard)
        break;
      if (item.name == null)
        return null;
    } while (repeat);
    if (visits == 0)
      return "impossible";
    return item.name;
  }

  /**
   * `continue` reaches a post-test loop's condition before the later guard.
   *
   * With `repeat == false`, that condition immediately exits the loop. The
   * skipped guard therefore cannot justify a non-null assertion after it.
   */
  static function optionalAfterDoWhileEarlyContinue(skipGuard: Bool,
      repeat: Bool): Null<String> {
    final item: OptionalNamedItem = {};
    var visits = 0;
    do {
      visits++;
      if (skipGuard)
        continue;
      if (item.name == null)
        return null;
    } while (repeat);
    if (visits == 0)
      return "impossible";
    return item.name;
  }

  /** Incoming facts remain valid when neither the body nor condition ends them. */
  static function optionalAfterDoWhileStableBreak(skipBody: Bool,
      repeat: Bool): String {
    final item: OptionalNamedItem = {name: "stable"};
    if (item.name == null)
      return "missing";
    var visits = 0;
    do {
      visits++;
      if (skipBody)
        break;
    } while (repeat);
    return item.name;
  }

  /**
   * A later part of one condition can end a fact learned by an earlier part.
   *
   * The left side proves the old record's `name` exists. The right side then
   * replaces that record before the branch begins, so the branch must not use
   * the proof that belonged to the old value.
   */
  static function optionalAfterConditionReassignment(): Null<String> {
    var item: OptionalNamedItem = {name: "before"};
    if (item.name != null && (item = {}) != null)
      return item.name;
    return null;
  }

  static function namedItem(name: String): NamedItem {
    return {name: name};
  }

  static function rankedItem(rank: Int): RankedItem {
    return {rank: rank};
  }

  static function mapAfterResultParameter(result: MessageBatch): Array<Int> {
    return result.messages.map(messageLength);
  }

  static function messageLength(message: String): Int {
    return message.length;
  }

  /**
   * A large typed record assigned to a local and immediately passed to helper
   * calls should stay readable. Haxe lowers some of these records through
   * compiler-generated field locals such as `parsed`, `parsed1`, etc.; TS output
   * should name those single-use generated temps by field when preserving the
   * separate declarations is necessary for evaluation order.
   */
  static function recordConstructionTemps(id: String, data: RecordConfig, existing: Null<LargeRecord>): String {
    final apiConfig = data.provider;
    final parsed: LargeRecord = {
      id: RecordID.make(fallback(data.id, id)),
      name: fallback(data.name, existing == null ? id : existing.name),
      family: fallback(data.family, existing == null ? "standard" : existing.family),
      api: {
        id: fallback(data.id, existing == null ? id : existing.api.id),
        url: fallback(apiConfig == null ? null : apiConfig.api, existing == null ? "https://example.invalid" : existing.api.url),
        npm: fallback(apiConfig == null ? null : apiConfig.npm, existing == null ? "@example/sdk" : existing.api.npm)
      },
      status: fallback(data.status, existing == null ? "active" : existing.status),
      flags: {
        enabled: boolOr(data.enabled, existing == null ? true : existing.flags.enabled),
        cached: boolOr(data.cached, existing == null ? false : existing.flags.cached),
        label: fallback(data.label, existing == null ? "flag" : existing.flags.label)
      },
      options: cast mergeOpen(existing == null ? openRecord() : existing.options, data.options),
      headers: cast mergeOpen(existing == null ? openStringRecord() : existing.headers, data.headers),
      tags: emptyTags()
    };
    return summarizeRecord(copyRecord(parsed, parsed.tags), parsed);
  }

  /**
   * Explicitly mirrors Haxe's lowered shape for large typed records: numbered
   * same-prefix locals feed direct fields of the final object local. Generated
   * TS should give the field temps meaningful names while preserving these
   * separate declarations and their evaluation order.
   */
  static function loweredRecordConstructionTemps(id: String): String {
    final parsed = fallback(id, "name");
    final parsed1 = fallback(null, "standard");
    final parsed2: RecordFlags = {
      enabled: boolOr(null, true),
      cached: boolOr(false, true),
      label: fallback(id, "flag")
    };
    final parsed3 = emptyTags();
    final parsed4: LargeRecord = {
      id: RecordID.make(id),
      name: parsed,
      family: parsed1,
      api: {
        id: id,
        url: fallback(null, "https://example.invalid"),
        npm: fallback(null, "@example/sdk")
      },
      status: fallback(null, "active"),
      flags: parsed2,
      options: openRecord(),
      headers: openStringRecord(),
      tags: parsed3
    };
    return summarizeRecord(parsed4, parsed4);
  }

  static function fallback(value: Null<String>, fallbackValue: String): String {
    return value == null ? fallbackValue : value;
  }

  static function boolOr(value: Null<Bool>, fallbackValue: Bool): Bool {
    return value == null ? fallbackValue : value;
  }

  static function emptyTags(): Array<String> {
    return [];
  }

  static function openRecord(): DynamicAccess<Dynamic> {
    return new DynamicAccess<Dynamic>();
  }

  static function openStringRecord(): DynamicAccess<String> {
    return new DynamicAccess<String>();
  }

  static function mergeOpen(current: Dynamic, next: Dynamic): Dynamic {
    return current;
  }

  static function copyRecord(record: LargeRecord, tags: Array<String>): LargeRecord {
    return {
      id: record.id,
      name: record.name,
      family: record.family,
      api: record.api,
      status: record.status,
      flags: record.flags,
      options: record.options,
      headers: record.headers,
      tags: tags
    };
  }

  static function summarizeRecord(left: LargeRecord, right: LargeRecord): String {
    return left.id + ":" + right.api.npm + ":" + Std.string(left.flags.enabled);
  }
}
