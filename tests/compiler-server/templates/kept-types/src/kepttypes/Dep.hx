package kepttypes;

/**
 * The "dependency edited" case changes the return value of `make` from `Int`
 * to `String`. `Dependent` reads it without a written type.
 */
class Dep {
  public static function make() {
    return 1; // dep-value
  }
}
