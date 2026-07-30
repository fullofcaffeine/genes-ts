package module_functions;

/**
 * Proves a non-null Haxe destination can expose a TypeScript-only helper use.
 *
 * Haxe accepts literal `null` as a `String` when source null safety is not
 * enabled for the caller. Classic JavaScript returns `null`; strict TypeScript
 * emits an identity assertion around the non-null target. This module has no
 * class registration, so dependency planning must retain `genes.Register` for
 * that exact expression.
 */
@:genes.moduleFunction("nullString")
function nullString(): String {
  return null;
}
