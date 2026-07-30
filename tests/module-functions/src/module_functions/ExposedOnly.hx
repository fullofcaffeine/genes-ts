package module_functions;

/**
 * Proves `@:expose` independently retains a class-owned module function.
 *
 * No Haxe runtime expression references this class. The build explicitly loads
 * the package so `@:expose` is the only reason its owner module and root-barrel
 * re-export survive full DCE. This catches a root planner that discovers the
 * public binding but forgets to make the owning implementation module
 * reachable.
 */
class ExposedOnly {
  @:expose("exposedOnly")
  @:genes.moduleFunction("exposedOnly")
  public static function selected(value: Int): Int {
    return value + 1;
  }
}
