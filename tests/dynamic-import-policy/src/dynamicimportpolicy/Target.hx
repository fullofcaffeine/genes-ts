package dynamicimportpolicy;

/** Runtime module loaded by the focused dynamic-import policy fixture. */
class Target {
  public static function value(): String {
    return "dynamic-import-current";
  }
}
