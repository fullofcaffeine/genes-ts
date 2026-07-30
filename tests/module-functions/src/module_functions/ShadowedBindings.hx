package module_functions;

/** A direct value deliberately sharing its name with a function parameter. */
@:genes.moduleValue("metadata")
final metadata = {
  title: "module"
};

/**
 * Proves a local cannot capture a same-module direct ESM binding by spelling.
 *
 * Haxe resolves the qualified `ShadowedBindings.metadata` reference by typed
 * field identity. Genes therefore renames the parameter in generated source
 * and keeps the direct binding read unambiguous.
 */
@:genes.moduleFunction("readMetadata")
function readMetadata(metadata: String): String {
  final metadata_1 = "local";
  return module_functions.ShadowedBindings.metadata.title
    + ":"
    + metadata
    + ":"
    + metadata_1;
}
