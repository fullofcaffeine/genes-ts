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

class Main {
  static function main(): Void {
    trace(render(Text("ok")) + ":" + render(Count(2)) + ":" + render(Flag(true)));
    trace(mapSetTemps(["alpha", "beta"]));
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
   * Haxe `Map.set` is an inline abstract method whose parameters are named
   * `key` and `value`. Two value types in one function must not emit duplicate
   * function-scoped TS `var value` declarations.
   */
  static function mapSetTemps(names: Array<String>): Int {
    final holder = buildMapHolder(names);
    return holder.named.get("alpha").name.length + holder.ranked.get("first").rank;
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
}
