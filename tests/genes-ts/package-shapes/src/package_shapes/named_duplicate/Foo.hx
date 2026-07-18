package package_shapes.named_duplicate;

/**
 * A second Haxe declaration for the same named JavaScript export.
 *
 * This is intentionally not a new runtime value. Genes should emit one named
 * `Foo` binding and let both declaration origins resolve to that same local.
 */
@:jsRequire("genes-binding-identity-fixture", "Foo")
extern class Foo {
  public function new();
  public function marker(): String;
}
