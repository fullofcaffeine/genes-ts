import genes.react.Node;
import genes.react.OneOf2;

typedef CardProps = {
  final tone: String;
  @:optional var children: Node;
}

/**
 * Small alternate intrinsic provider used by the focused HXX gate.
 *
 * Why: the compiler must not hard-code React's built-in tag list as the only
 * valid JSX vocabulary.
 *
 * How: `@:genes.jsxIntrinsic` binds `<x-card>` to `CardProps`, while
 * `@:genes.jsxAttributePrefix` admits `qa-*` values through a closed union.
 * Both annotations affect compile-time HXX validation only.
 */
extern class CustomIntrinsicElements {
  @:genes.jsxAttributePrefix("qa-")
  public static var qaAttribute: OneOf2<String, Int>;

  @:genes.jsxIntrinsic("x-card")
  public static var card: CardProps;
}
