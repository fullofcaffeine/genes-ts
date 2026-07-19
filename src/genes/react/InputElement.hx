package genes.react;

/**
 * Haxe view of the input element carried by React change events.
 *
 * Why: input handlers commonly read `event.target.value` or `checked`, and
 * those accesses should be checked by Haxe before TypeScript is generated.
 *
 * What: the built-in `<input>` property contract uses this event target.
 *
 * How: `@:ts.type` preserves the canonical `HTMLInputElement` spelling in
 * TypeScript while this extern remains a compile-time-only Haxe contract.
 */
@:ts.type("HTMLInputElement")
extern class InputElement extends DomElement {
  public var checked: Bool;
  public var value: String;
}
