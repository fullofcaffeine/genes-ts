package module_functions;

/**
 * Proves that a genuine Haxe module-level function remains a genuine ESM
 * function instead of acquiring a synthetic class owner in JavaScript or
 * TypeScript.
 */
@:genes.moduleFunction("topLevelIdentity")
function topLevelIdentity<T>(value: T): T {
  return value;
}
