package inc;

/**
 * Not a member of the module's output: Genes prints no extern class. In
 * source order it comes first in Haxe's generator list (genes-zt9w).
 */
extern class OrderMNative {}

/**
 * The only member of the module's output. It moves before
 * `OrderMNative` in Haxe's generator list when a static initializer of
 * `inc.OrderA` reaches `inc.OrderZ`, its implementation (genes-zt9w).
 */
interface OrderM {
  function size(): Int;
}
