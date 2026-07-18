package package_shapes.abstract_binding;

/**
 * A package-owned group of string codes exposed through a Haxe abstract.
 *
 * hxnodejs uses this same Haxe shape for Node constants. The generated program
 * must read `Alpha` from the JavaScript package; it is not a Haxe string
 * literal that the compiler can safely invent or inline.
 */
@:jsRequire("genes-binding-identity-fixture", "AbstractCodes")
@:enum extern abstract ImportedCode(String) to String {
  var Alpha;
}
