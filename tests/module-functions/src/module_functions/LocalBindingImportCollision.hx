package module_functions;

/**
 * Owns a local direct binding with the same public name as an imported value.
 *
 * The local `metadata` export must keep its requested ESM name. A reference to
 * `TopLevel.metadata` is a distinct typed identity, so import planning aliases
 * that foreign binding before either output profile writes source.
 */
@:genes.moduleValue("metadata")
final metadata = {
  title: "local"
};

/** Reads the foreign metadata through its collision-safe imported identity. */
@:genes.moduleFunction("foreignTitle")
function foreignTitle(): String {
  return metadata.title + ":" + module_functions.TopLevel.metadata.title;
}

/**
 * Proves that a Haxe local cannot hide the allocated foreign import alias.
 *
 * Import planning has already renamed `TopLevel.metadata` to `metadata__1`
 * because this module owns the public `metadata` binding above. The source is
 * still allowed to use that spelling for an unrelated parameter; NamePlan
 * moves the parameter to a fresh JavaScript name while the imported value keeps
 * its exact planned identity.
 */
@:genes.moduleFunction("foreignTitleWithLocal")
function foreignTitleWithLocal(metadata__1: String): String {
  return metadata__1 + ":" + module_functions.TopLevel.metadata.title;
}

/**
 * Owns a direct function with the same public name as an imported function.
 *
 * This is the function-shaped counterpart to `metadata`: the exact local
 * export keeps its spelling while the foreign binding receives an import
 * alias.
 */
@:genes.moduleFunction("topLevelIdentity")
function topLevelIdentity(value: String): String {
  return "local-" + value;
}

/** Calls both same-named function identities without relying on source text. */
@:genes.moduleFunction("identityPair")
function identityPair(): String {
  return topLevelIdentity("own")
    + ":"
    + module_functions.TopLevel.topLevelIdentity("foreign");
}
