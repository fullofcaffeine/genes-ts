package package_shapes.alias_first;

/** The named `Foo` export requested through the explicit local `FirstFoo`. */
@:genes.importAlias("FirstFoo")
@:jsRequire("genes-binding-identity-fixture", "Foo")
extern class Foo {
  public function new();
  public function marker(): String;
}
