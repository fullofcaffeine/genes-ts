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

typedef MessageBatch = {
  final messages: Array<String>;
}

class Main {
  static function main(): Void {
    trace(render(Text("ok")) + ":" + render(Count(2)) + ":" + render(Flag(true)));
    trace(mapSetTemps(["alpha", "beta"]));
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
