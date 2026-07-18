package package_shapes.abstract_namespace;

/**
 * Reads enum-abstract values from a whole JavaScript module namespace.
 *
 * This is the one-argument `@:jsRequire` form used by hxnodejs for module-owned
 * constants. `NamespaceAlpha` must remain a property read on the imported
 * namespace in both Genes output profiles and both tested Haxe versions.
 */
@:jsRequire("genes-binding-identity-fixture")
@:enum extern abstract NamespaceCode(String) to String {
  var NamespaceAlpha;
}
