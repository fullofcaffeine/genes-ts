package genes.react;

/**
 * Common browser element type for built-in HXX event properties.
 *
 * Why: most intrinsic tags only need the shared `HTMLElement` identity, while
 * a few tags such as `<a>` and `<input>` use more precise element contracts.
 *
 * How: this extern exists only for Haxe typing. `@:ts.type` emits the browser's
 * canonical `HTMLElement` name and does not create a runtime class.
 */
@:ts.type("HTMLElement")
extern class DomElement {}
