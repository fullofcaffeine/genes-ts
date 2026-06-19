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

  static function mapSetTemps(names: Array<String>): Int {
    final named: haxe.Constraints.IMap<String, NamedItem> =
      new haxe.ds.StringMap<NamedItem>();
    for (name in names)
      named.set(name, {name: name});

    final ranked: haxe.Constraints.IMap<String, RankedItem> =
      new haxe.ds.StringMap<RankedItem>();
    ranked.set("first", {rank: 1});

    return named.get("alpha").name.length + ranked.get("first").rank;
  }
}
