package package_shapes.native_named;

/**
 * A package class whose older JavaScript name is `NativeNamed`.
 *
 * Why: the probe also contains an unrelated local Haxe class with that name.
 * This makes the collision visible instead of relying on a special built-in
 * such as `String`, whose Haxe and TypeScript meanings differ in other ways.
 *
 * What: `@:jsRequire` says the value comes from the fixture package.
 * `@:native` keeps the spelling expected by older Haxe JavaScript bindings.
 * When both annotations are present, the package import remains the source of
 * the value; `@:native` must not redirect calls to the unrelated local class.
 *
 * How: Genes allocates a safe local name for the package export and uses that
 * name in constructors and type annotations in both output profiles.
 */
@:native("NativeNamed")
@:jsRequire("genes-binding-identity-fixture", "NativeNamed")
extern class NativeNamedExport {
  public function new();
  public function marker(): String;
}
