package package_shapes.collision_default;

/**
 * The default export under the requested local `Dropdown`.
 *
 * This intentionally reserves that local before the named `Dropdown` export.
 * The later named root must receive a suffix, and dotted member access must use
 * that resolved root rather than the original word from metadata.
 */
@:genes.importAlias("Dropdown")
@:jsRequire("genes-binding-identity-fixture", "default")
extern class Foo {
  public function new();
  public function marker(): String;
}
