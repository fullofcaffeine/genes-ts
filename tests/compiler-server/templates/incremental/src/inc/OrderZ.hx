package inc;

/**
 * Implements `inc.OrderM`. Its path sorts after `inc.OrderM`, so without
 * the static initializer of `inc.OrderA` Haxe visits `inc.OrderM` in source
 * order (genes-zt9w).
 */
@:keep
class OrderZ implements OrderM {
  public function new() {}

  public function size(): Int {
    return 2;
  }
}
