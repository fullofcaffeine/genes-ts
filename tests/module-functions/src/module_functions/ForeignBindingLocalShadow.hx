package module_functions;

/**
 * Reads a foreign direct module value beside an unrelated same-named parameter.
 *
 * Haxe keeps these identities separate:
 *
 * ```haxe
 * metadata                         // this String parameter
 * module_functions.TopLevel.metadata // the imported metadata object
 * ```
 *
 * Both would naturally be called `metadata` in JavaScript. Import planning
 * owns the foreign binding, so NamePlan gives the parameter a deterministic
 * suffix before emission:
 *
 * ```js
 * import {metadata} from "./TopLevel.js";
 * export function readForeignWithShadow(metadata_1) {
 *   return metadata_1 + ":" + metadata.title;
 * }
 * ```
 */
@:genes.moduleFunction("readForeignWithShadow")
function readForeignWithShadow(metadata: String): String {
  return metadata + ":" + module_functions.TopLevel.metadata.title;
}
