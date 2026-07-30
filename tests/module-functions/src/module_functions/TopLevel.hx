package module_functions;

import genes.js.Async.await;
import genes.js.ArrayCallbacks;
import js.lib.Promise;

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

/**
 * Proves Genes' own async/await authoring composes with direct module output.
 *
 * `@:async` records a native async function and the exact `await` carrier;
 * `@:genes.moduleFunction` then preserves that already-typed body as one direct
 * ESM function. Neither annotation adds a scheduler or Promise runtime.
 */
@:async
@:genes.moduleFunction("topLevelAsync")
function topLevelAsync(value: Int): Promise<Int> {
  final resolved = await(Promise.resolve(value));
  return resolved + 1;
}

/**
 * Proves the typed native Array helper remains legal in a direct function.
 *
 * The inline helper lowers to the exact JavaScript `findIndex` call; the
 * module-function validator admits that reviewed template without accepting
 * arbitrary target-language syntax.
 */
@:genes.moduleFunction("firstMatchIndex")
function firstMatchIndex(values: Array<String>): Int {
  return ArrayCallbacks.findIndex(values, value -> value == "match");
}

/** Metadata alone must not retain an otherwise unreachable module value. */
@:genes.moduleValue("deadMetadata")
final deadMetadata = {
  title: "must not reach output"
};
