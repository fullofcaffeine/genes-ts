package inc;

/**
 * Extends the generic structure `inc.Env.Bag` with an argument that names
 * the enum abstract `inc.Color`. Its capture writes the signature fact of
 * its copy of the field `items` of `Bag`, so `ColorsBag` prints the values
 * of `inc.Color`. Since genes-f8vc.14.31 that fact names the copy, and the
 * generic `Bag` of `inc.Env` prints `items: T`. See "an enum abstract value
 * changes; a fact of another module names it" in the shadow gate.
 */
typedef ColorsBag = {
  > inc.Env.Bag<Array<inc.Color>>,
  final extra: Int;
}

@:keep
class ColorFacts {
  public static function value(): String {
    final hint: Null<ColorsBag> = null;
    return "color-facts";
  }
}
