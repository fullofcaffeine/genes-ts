package inc;

/**
 * The first of three modules that move declarations of an unchanged module
 * in Haxe's generator list (genes-zt9w). Its path sorts before
 * `inc.OrderM`. The shadow gate gives it a static initializer that creates
 * `inc.OrderZ` (marker `ORDER_SEED`). Haxe 4.3.7 then puts the interface
 * `inc.OrderM` before the extern class `inc.OrderM.OrderMNative`, because
 * it adds the interfaces of a class before the class. Haxe does not type
 * `inc.OrderM` again.
 */
@:keep
class OrderA {
  /*ORDER_SEED*/
  public static function value(): Int {
    return 1;
  }
}
