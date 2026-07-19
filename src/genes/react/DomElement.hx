package genes.react;

/**
 * Compatibility view of a common browser element used by React handlers.
 *
 * Why: most intrinsic tags only need the shared `HTMLElement` identity, while
 * a few tags such as `<a>` and `<input>` use more precise element contracts.
 *
 * What: existing annotations may use this focused facade. Contextual intrinsic
 * callbacks prefer complete element-specific `js.html` externs where the
 * bundled contract can identify one.
 *
 * How: this extern exists only for Haxe typing. `@:ts.type` emits the browser's
 * canonical `HTMLElement` name and does not create a runtime class.
 */
@:ts.type("HTMLElement")
extern class DomElement {
  public function focus(): Void;
}
