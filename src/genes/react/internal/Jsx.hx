package genes.react.internal;

import genes.react.Element;

/**
 * Internal target-neutral marker API for Genes JSX/TSX emission.
 *
 * These are intentionally `extern` so they do not generate runtime output or
 * imports. `JsxPlan` recognizes their typed calls before printing and preserves
 * tag, ordered props, and children. TypeScript prints TSX or typed
 * `React.createElement(...)`; classic Genes prints equivalent plain JavaScript
 * runtime calls. The marker itself never leaks into generated source.
 *
 * The `__hxx*` variants classify values created through the HXX path. Root
 * markers carry a forgeable `HxxRootCandidate`: another macro can mint the
 * same value with `@:privateAccess`, so it is not provenance or authority.
 * `JsxPlan` permits the narrow readable props projection only after complete
 * request-local use accounting and exact carrier-shape validation. Child
 * markers retain their separate typed identity for the independently bounded
 * source-inline analysis. All variants behave like the ordinary markers in
 * every output profile; `@:noCompletion` hides protocol names from suggestions.
 */
extern class Jsx {
  public static function __jsx<Tag, Props, Children>(tag: Tag, props: Props,
    children: Children): Element;

  public static function __frag<Children>(children: Children): Element;

  @:noCompletion
  public static function __hxxJsx<Tag, Props, Children>(candidate: Void->
    HxxRootCandidate, tag: Tag, props: Props,
    children: Children): Element;

  @:noCompletion
  public static function __hxxFrag<Children>(candidate: Void->HxxRootCandidate,
    children: Children): Element;

  @:noCompletion
  public static function __hxxChildJsx<Tag, Props, Children>(tag: Tag,
    props: Props, children: Children): Element;

  @:noCompletion
  public static function __hxxChildFrag<Children>(children: Children): Element;
}
