package genes.react;

/**
 * Haxe view of the anchor element carried by React mouse events.
 *
 * Why: React's `MouseEvent<T>` keeps its element type in generated TypeScript,
 * so HXX must not erase an anchor handler to the generic `HTMLElement` shape.
 *
 * What: existing annotations may keep using this focused compatibility facade.
 * Inline HXX callbacks are contextually projected to Haxe's complete
 * `js.html.AnchorElement`; the checker recognizes both as the same generated
 * browser identity without making unrelated extern classes interchangeable.
 *
 * How: this is a type-only extern. `@:ts.type` prints the browser's canonical
 * `HTMLAnchorElement` name; it creates no runtime class or conversion.
 */
@:ts.type("HTMLAnchorElement")
extern class AnchorElement extends DomElement {
  public var download: String;
  public var href: String;
  public var rel: String;
  public var target: String;
}
