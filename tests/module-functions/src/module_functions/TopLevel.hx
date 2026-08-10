package module_functions;

/** Closed data shape used to prove precise target types and declarations. */
typedef ModuleMetadata = {
  final title: String;
  final tags: Array<String>;
  final details: {
    final featured: Bool;
  };
}

/**
 * Emits one direct ESM constant from closed literal data.
 *
 * The annotation changes the output shape only. It does not retain dead code,
 * parse framework data, or permit code to run during initialization.
 */
@:genes.moduleValue("metadata")
final metadata: ModuleMetadata = {
  title: "direct module value",
  tags: ["typed", "esm"],
  details: {featured: true}
};

/** An earlier selected value is the only supported non-literal reference. */
@:genes.moduleValue("metadataAlias")
final metadataAlias = metadata;

/** The annotation does not retain an otherwise unused value through DCE. */
@:genes.moduleValue("deadMetadata")
final deadMetadata = {
  title: "must not reach output"
};

/**
 * Proves that a genuine Haxe module-level function remains a genuine ESM
 * function instead of acquiring a synthetic class owner in JavaScript or
 * TypeScript.
 */
@:genes.moduleFunction("topLevelIdentity")
function topLevelIdentity<T>(value: T): T {
  return value;
}
