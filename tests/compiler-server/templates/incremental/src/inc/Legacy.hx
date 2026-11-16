package inc;

/**
 * Holds one legacy `__js__` call. No module imports this one; the command
 * line names it.
 *
 * Genes reports "__js__ is deprecated" when it prints the call, not when Haxe
 * types the module. The shadow gate requires the warning in every request,
 * also when this module was not typed again.
 */
@:keep
class Legacy {
  public static function one(): Int {
    return untyped __js__("1");
  }
}
