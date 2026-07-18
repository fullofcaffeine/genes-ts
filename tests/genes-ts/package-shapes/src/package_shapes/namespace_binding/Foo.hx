package package_shapes.namespace_binding;

/**
 * The whole fixture module requested with the same preferred local `Foo`.
 *
 * The class has no instances, so Genes' established one-argument `@:jsRequire`
 * rule treats it as a namespace import. Its local must not collapse with either
 * the default or named `Foo` binding.
 */
@:jsRequire("genes-binding-identity-fixture")
extern class Foo {
  public static function namespaceMarker(): String;
}
