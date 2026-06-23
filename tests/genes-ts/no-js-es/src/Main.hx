enum SwitchValue {
  Text(value: String);
  Count(value: Int);
  Flag(value: Bool);
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
}
