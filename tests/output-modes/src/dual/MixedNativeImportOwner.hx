package dual;

/**
 * Models an explicitly global constructor beside an unrelated package import.
 *
 * Why: Haxe permits secondary externs to share a module with the module's
 * primary type. A bare `@:native` identity is still a host global; it must not
 * inherit the primary type's `@:jsRequire` merely because the declarations
 * share one `.hx` file.
 *
 * What: generated TypeScript and classic JavaScript must construct the global
 * `RegExp` value directly, with no import binding that shadows it.
 *
 * How: `@:native("RegExp")` changes the emitted identifier while this extern
 * contributes no module edge of its own. The paired primary extern below
 * independently proves that its real package import remains intact.
 */
@:native("RegExp")
extern class NativeGlobalPattern {
  function new(pattern:String):Void;
  function test(value:String):Bool;
}

/**
 * Provides the unrelated primary `@:jsRequire` binding for this Haxe module.
 *
 * Why: the regression only occurs when dependency discovery mistakes physical
 * Haxe-module co-location for shared JavaScript-module identity.
 * What: this type binds to Node's path namespace and retains that import in
 * both Genes output profiles.
 * How: the secondary global above and this package value are exercised in one
 * expression so DCE cannot erase either side of the ownership contract.
 */
@:jsRequire("node:path")
extern class MixedNativeImportOwner {
  static function basename(path:String):String;
}
