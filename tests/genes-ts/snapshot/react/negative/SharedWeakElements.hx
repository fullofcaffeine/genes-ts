typedef SharedWeakProps = {
  final value: Dynamic;
}

/**
 * Deliberately invalid provider whose two tags name one weak typedef.
 *
 * `Dynamic` is intentional only in this negative fixture. No markup uses
 * either tag, so the checker must still reject the declaration when it loads
 * the provider, and it must report the first tag that names the typedef.
 */
extern class SharedWeakElements {
  @:genes.jsxIntrinsic("x-weak-first")
  public static var first: SharedWeakProps;

  @:genes.jsxIntrinsic("x-weak-second")
  public static var second: SharedWeakProps;
}
