package genes.react;

/**
 * Haxe view of the common element type shared by React SVG intrinsics.
 *
 * Why: `HTMLElement` and `SVGElement` are separate browser type families. If
 * an SVG ref were described as an HTML ref, Haxe could approve a callback whose
 * generated TypeScript annotation promises the wrong runtime object.
 *
 * What: this focused facade exposes only operations that are valid on every
 * SVG element. More specific SVG tags may gain narrower facades when a concrete
 * authoring need justifies them.
 *
 * How: `@:ts.type` emits the browser's canonical `SVGElement` name. HXX maps
 * the facade to Haxe's complete `js.html.svg.Element` extern for contextual
 * callbacks, while this extern itself creates no JavaScript class or wrapper.
 */
@:ts.type("SVGElement")
extern class SvgElement {
  public function focus(): Void;
  public function blur(): Void;
}
