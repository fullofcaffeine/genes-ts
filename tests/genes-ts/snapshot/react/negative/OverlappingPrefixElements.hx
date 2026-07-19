import genes.react.Node;

typedef OverlappingPrefixProps = {
  @:optional var children: Node;
}

/** Intentionally invalid provider whose two prefixes can match one property. */
extern class OverlappingPrefixElements {
  @:genes.jsxAttributePrefix("qa-")
  public static var broadPrefix: String;

  @:genes.jsxAttributePrefix("qa-count-")
  public static var specificPrefix: Int;

  @:genes.jsxIntrinsic("x-widget")
  public static var tag: OverlappingPrefixProps;
}
