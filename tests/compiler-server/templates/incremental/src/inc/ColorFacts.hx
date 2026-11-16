package inc;

/**
 * Extends the generic structure `inc.Env.Bag` with an argument that names
 * the enum abstract `inc.Color`. Its capture writes the signature fact of
 * the field `items` of `Bag`, and the print of `inc.Env` turns that fact
 * into the values of `inc.Color`: `inc.Env` reads `inc.Color` by name. See
 * "an enum abstract value changes; a fact of another module names it" in
 * the shadow gate.
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
