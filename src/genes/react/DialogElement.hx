package genes.react;

/**
 * Haxe view of the native dialog element carried by React lifecycle events.
 *
 * Why: an application's classpath may contain generated `js.html` modules
 * that shadow Haxe's standard DOM module names. The intrinsic schema therefore
 * needs one stable library-owned identity instead of naming the standard
 * `js.html.DialogElement` module directly.
 *
 * What: existing annotations may use this focused compatibility facade.
 * Inline HXX callbacks are contextually projected to Haxe's complete
 * `js.html.DialogElement`; the checker recognizes both as the same generated
 * browser identity without making unrelated element classes interchangeable.
 *
 * How: this is a type-only extern. `@:ts.type` prints the browser's canonical
 * `HTMLDialogElement` name and creates no runtime class or conversion.
 */
@:ts.type("HTMLDialogElement")
extern class DialogElement extends DomElement {
  public var open: Bool;
  public var returnValue: String;
  public function close(?returnValue: String): Void;
  public function show(): Void;
  public function showModal(): Void;
}
