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
    final callback = closureAfterOuterGuard("alpha");
    trace(callback == null ? "missing" : callback.read());
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
