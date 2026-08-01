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
 * The `__hxx*` variants carry one extra compile-time fact: the HXX parser
 * created this value. Root markers authenticate parser-owned property carriers;
 * child markers authenticate disposable nested-element scaffolding. They
 * behave exactly like the ordinary markers in every output profile. Their
 * distinct typed static-field identity lets `JsxPlan` use that provenance
 * without trusting source text, names, or positions. The HXX-only fields
 * require an exact `HxxParserProof` from a private compiler-internal
 * field. Application code therefore cannot opt into the proof through the
 * ordinary typed API; `@:noCompletion` additionally hides protocol names from
 * suggestions.
 */
extern class Jsx {
  public static function __jsx<Tag, Props, Children>(tag: Tag, props: Props,
    children: Children): Element;

  public static function __frag<Children>(children: Children): Element;

  @:noCompletion
  public static function __hxxJsx<Tag, Props, Children>(proof: Void->
    HxxParserProof, tag: Tag, props: Props,
    children: Children): Element;

  @:noCompletion
  public static function __hxxFrag<Children>(proof: Void->HxxParserProof,
    children: Children): Element;

  @:noCompletion
  public static function __hxxChildJsx<Tag, Props, Children>(tag: Tag,
    props: Props, children: Children): Element;

  @:noCompletion
  public static function __hxxChildFrag<Children>(children: Children): Element;
}
