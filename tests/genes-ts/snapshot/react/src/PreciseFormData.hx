/**
 * Focused extern view of the browser's existing `FormData` global.
 *
 * Why: host libraries often expose a narrower, current facade instead of the
 * Haxe standard library's older declaration. `@:native("FormData")` explicitly
 * says both facades refer to the same runtime constructor, which lets HXX
 * compare their host identity without structurally equating unrelated externs.
 *
 * What: `@:ts.type("globalThis.FormData")` keeps the generated annotation on
 * TypeScript's canonical DOM type rather than publishing this Haxe-only class.
 *
 * How: the class has no constructor or emitted runtime declaration. Its method
 * is checked by Haxe, while the generated action parameter remains ordinary
 * `globalThis.FormData` in TSX and typed `createElement` output.
 */
@:native("FormData")
@:ts.type("globalThis.FormData")
extern class PreciseFormData {
  function has(name: String): Bool;
}
