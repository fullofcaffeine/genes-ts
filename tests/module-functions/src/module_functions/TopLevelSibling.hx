package module_functions;

/**
 * Proves that ESM binding identity is module-local: another source module may
 * export the same conventional name without competing in the root barrel.
 */
@:genes.moduleFunction("topLevelIdentity")
function topLevelIdentity<T>(value:T):T {
  return value;
}
