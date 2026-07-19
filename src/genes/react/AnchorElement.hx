package genes.react;

/**
 * Haxe view of the anchor element carried by React mouse events.
 *
 * Why: React's `MouseEvent<T>` keeps its element type in generated TypeScript,
 * so HXX must not erase an anchor handler to the generic `HTMLElement` shape.
 *
 * What: callbacks for the built-in `<a>` contract receive this type and can
 * use the stable anchor fields below during Haxe type checking.
 *
 * How: this is a type-only extern. `@:ts.type` prints the browser's canonical
 * `HTMLAnchorElement` name; it creates no runtime class or conversion.
 */
@:ts.type("HTMLAnchorElement")
extern class AnchorElement extends DomElement {
  public var href: String;
  public var target: String;
}
