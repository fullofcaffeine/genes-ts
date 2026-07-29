package module_functions;

/** Closed data shape used to prove precise TypeScript/declaration output. */
typedef ModuleMetadata = {
  final title: String;
  final tags: Array<String>;
}

/**
 * Emits as one direct, typed ESM value rather than a synthetic class field.
 *
 * The metadata changes only the output shape. It does not retain this value
 * through DCE, make it mutable, or introduce a runtime registry.
 */
@:genes.moduleValue("metadata")
final metadata: ModuleMetadata = {
  title: "direct module value",
  tags: ["typed", "esm"]
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

/** Metadata alone must not retain an otherwise unreachable module value. */
@:genes.moduleValue("deadMetadata")
final deadMetadata = {
  title: "must not reach output"
};
