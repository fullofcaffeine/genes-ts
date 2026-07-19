import genes.react.Node;

typedef DuplicatePrefixProps = {
  @:optional var children: Node;
}

/** Intentionally invalid provider used to prove prefix ambiguity fails closed. */
extern class DuplicatePrefixElements {
  @:genes.jsxAttributePrefix("qa-")
  public static var firstPrefix: String;

  @:genes.jsxAttributePrefix("qa-")
  public static var duplicatePrefix: Int;

  @:genes.jsxIntrinsic("x-duplicate")
  public static var tag: DuplicatePrefixProps;
}
