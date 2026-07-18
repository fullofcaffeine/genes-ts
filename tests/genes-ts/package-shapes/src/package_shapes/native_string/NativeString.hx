package package_shapes.native_string;

/**
 * A package class that deliberately uses JavaScript's built-in name `String`.
 *
 * Why: this is the sharpest non-dotted compatibility case. Haxe and TypeScript
 * normally give `String` special primitive behavior, but this declaration says
 * that the runtime constructor comes from a package instead.
 *
 * What/How: this probe uses the class only as a runtime value and immediately
 * returns its ordinary Haxe `String` marker. Genes must import the package's
 * named constructor and give it a collision-safe local instead of calling the
 * global `String`. Public APIs use the separate `NativeNamedExport` fixture,
 * because Haxe itself gives a native class called `String` core-type behavior.
 */
@:native("String")
@:jsRequire("genes-binding-identity-fixture", "String")
extern class NativeString {
  public function new();
  public function marker(): String;
}
