package package_shapes.default_binding;

/**
 * Describes the default export from the binding-identity fixture package.
 *
 * Why: JavaScript packages may expose a default value and a named value with
 * the same visible name. This extern deliberately shares its simple Haxe name
 * (`Foo`) with the named-export extern in another Haxe package.
 *
 * What/How: Haxe keeps the two declarations separate through their full Haxe
 * paths. Genes must likewise retain the `default` import form so this class
 * constructs the value whose marker is `"default"`.
 */
@:jsRequire("genes-binding-identity-fixture", "default")
extern class Foo {
  public function new();
  public function marker(): String;
}
