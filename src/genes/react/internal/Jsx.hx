package genes.react.internal;

import genes.react.Element;

/**
 * Internal marker API for genes-ts JSX/TSX emission.
 *
 * These are intentionally `extern` so they do not generate runtime output or imports.
 * The TypeScript emitter recognizes calls to these and prints either TSX markup
 * (when generating `.tsx`) or low-level `React.createElement(...)` calls (when
 * generating `.ts`).
 */
extern class Jsx {
  public static function __jsx(tag: Dynamic, props: Array<Dynamic>,
    children: Array<Dynamic>): Element;

  public static function __frag(children: Array<Dynamic>): Element;
}
