package package_shapes.named_binding;

/**
 * Describes the named `Foo` export from the binding-identity fixture package.
 *
 * Why: this declaration intentionally has the same simple Haxe name and the
 * same JavaScript package specifier as the default-export extern. Only its
 * import form and full Haxe declaration identity distinguish the two values.
 *
 * What/How: Genes must emit and resolve the named binding independently so
 * constructing this class reaches the value whose marker is `"named"`.
 */
@:jsRequire("genes-binding-identity-fixture", "Foo")
extern class Foo {
  public function new();
  public function marker(): String;
}
