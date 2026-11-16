package inc;

/**
 * The first use of `js.Lib.global` changes the feature answer
 * `js.Lib.global` of every module with runtime code, although Haxe types no
 * other module again. The edit adds the use at the marker.
 */
class GlobalUse {
  public static function value(): String {
    return "global" /*GLOBAL_USE*/;
  }
}
