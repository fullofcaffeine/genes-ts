package inc;

/**
 * A module that Haxe does not type again when a macro of another module
 * (`inc.MetaMacro`, `inc.MarkMacro`) adds `@:ts.returnType` to `value`. The
 * metadata changes the printed return type, so the fingerprint holds field
 * metadata with its arguments.
 */
class MetaTarget {
  public static function value(): String {
    return "meta-target";
  }
}
