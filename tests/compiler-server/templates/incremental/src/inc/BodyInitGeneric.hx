package inc;

/**
 * A local generic function in a class initializer (review of genes-ts #258).
 *
 * Without a kept holder for its type parameters, the module recorded an
 * answer that no later request could ask again, and every request with a
 * cache generated in full. `inc.BodyMetaMacro` can write
 * `@:ts.type("string")` on the field `iv` of the structure in the constraint
 * of `I`.
 */
class BodyInitGeneric {
  public static var total = 0;

  static function __init__(): Void {
    function ident<I: {iv: Int}>(i: I): I
      return i;
    total = ident({iv: 3}).iv;
  }

  public static function value(): String {
    return Std.string(total);
  }
}
