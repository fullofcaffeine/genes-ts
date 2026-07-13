package genes.js;

/**
 * Typed host-capability checks used by generated migration code.
 *
 * Why: TypeScript commonly narrows optional callbacks with
 * `typeof value === "function"`; Haxe has no source-level `typeof` operator.
 *
 * What: `isFunction` reports the exact JavaScript callable-category check.
 *
 * How: raw target syntax is contained in this generic compiler/runtime boundary
 * and the caller retains its concrete type. genes-ts and classic Genes inline
 * the operation without introducing a dynamic field or cast in user modules.
 */
class TypeChecks {
  public static inline function isFunction<T>(value: T): Bool {
    return js.Syntax.typeof(value) == "function";
  }
}
