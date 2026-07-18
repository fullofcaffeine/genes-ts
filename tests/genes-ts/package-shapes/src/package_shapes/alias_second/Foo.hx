package package_shapes.alias_second;

/** The same named `Foo` export requested through a second explicit local. */
@:genes.importAlias("SecondFoo")
@:jsRequire("genes-binding-identity-fixture", "Foo")
extern class Foo {
  public function new();
  public function marker(): String;
}
