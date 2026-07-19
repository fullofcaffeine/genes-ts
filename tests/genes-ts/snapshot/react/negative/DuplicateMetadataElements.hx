import genes.react.Node;

typedef DuplicateMetadataProps = {
  @:optional var children: Node;
}

/** Intentionally invalid provider with one annotation repeated on one field. */
extern class DuplicateMetadataElements {
  @:genes.jsxAttributePrefix("qa-")
  @:genes.jsxAttributePrefix("qa-count-")
  public static var ambiguousPrefix: String;

  @:genes.jsxIntrinsic("x-widget")
  public static var tag: DuplicateMetadataProps;
}
