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
 */
extern class Jsx {
  public static function __jsx(tag: Dynamic, props: Array<Dynamic>,
    children: Array<Dynamic>): Element;

  public static function __frag(children: Array<Dynamic>): Element;
}
