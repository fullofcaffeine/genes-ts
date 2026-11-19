package inc;

/**
 * Holds the typedef `TintAlias` of `inc.Tint`. The generator adds the
 * typedef to this module only when `Tint` is concrete (`Module.addTypes`),
 * so the member list of this clean module changes when another module
 * starts or stops using `Tint` at run time.
 */
class Tinted {
  public static function value(): String {
    return "tinted";
  }
}

typedef TintAlias = Tint;
