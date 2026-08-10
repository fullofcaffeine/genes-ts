package module_functions;

/** A second module can use the same module-local export name. */
@:genes.moduleValue("metadata")
final metadata = {
  title: "sibling module value"
};

/**
 * Proves that ESM binding identity is module-local: another source module may
 * export the same conventional name without competing in the root barrel.
 */
@:genes.moduleFunction("topLevelIdentity")
function topLevelIdentity<T>(value: T): T {
  return value;
}
