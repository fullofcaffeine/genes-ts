package package_shapes.native_dotted;

/**
 * A package class described by the older dotted name `NativeRoot.Component`.
 *
 * Why: some Haxe JavaScript libraries combine `@:native("Root.Member")` with
 * `@:jsRequire(...)`. Genes preserves that authoring style by importing the
 * package root and then selecting `.Component`. A local Haxe class named
 * `NativeRoot` deliberately forces the imported root to be renamed.
 *
 * What: every generated use must follow that renamed package import before it
 * appends `.Component`. Writing the metadata text directly would instead read
 * the unrelated local Haxe class.
 *
 * How: the canonical import plan owns the root binding and member path. Both
 * TypeScript and classic JavaScript resolve the root first, then append the
 * member for constructor and public type positions.
 */
@:native("NativeRoot.Component")
@:jsRequire("genes-binding-identity-fixture", "Component")
extern class NativeComponent {
  public function new();
  public function marker(): String;
}
