/**
 * Deliberately invalid intrinsic provider used by the negative HXX harness.
 *
 * A prefix accepts arbitrarily named properties, so its one declared value
 * type is the only contract Haxe can enforce. `Dynamic` would silently erase
 * that protection and must fail before any markup is emitted.
 */
extern class WeakPrefixElements {
  @:genes.jsxAttributePrefix("weak-")
  public static var weakAttribute: Dynamic;

  @:genes.jsxIntrinsic("x-weak")
  public static var weakTag: {};
}
