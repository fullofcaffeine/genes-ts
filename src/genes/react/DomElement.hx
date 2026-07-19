package genes.react;

/**
 * Compatibility view of a common browser element used by React handlers.
 *
 * Why: most intrinsic tags only need the shared `HTMLElement` identity, while
 * a few tags such as `<a>` and `<input>` use more precise element contracts.
 *
 * What: built-in intrinsic callbacks use this focused facade for the shared
 * element operations that HXX checks today. More specific tags extend it.
 *
 * How: this extern exists only for Haxe typing. `@:ts.type` emits the browser's
 * canonical `HTMLElement` name and does not create a runtime class.
 */
@:ts.type("HTMLElement")
extern class DomElement {
  public function focus(): Void;
}
