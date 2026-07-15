package genes.internal;

/**
 * Typed, compiler-owned marker for binding-free ESM module requests.
 *
 * Why: Haxe has no ESM import-statement expression, while raw target syntax
 * would bypass dependency planning, source maps, extension policy, and the
 * shared TS/classic architecture. An extern call is conservatively effectful,
 * so Haxe retains it through full DCE until the Genes custom generator runs.
 *
 * What: `external` carries a literal runtime specifier and optional import
 * attribute. `internal` carries a typed reference used to retain a converted
 * Haxe module. Neither method is a runtime API or an imported value.
 *
 * How: only compiler-owned macros/generators may produce these calls.
 * `DependencyPlanBuilder` must consume their typed owner/member identity before
 * ordinary reference traversal, and both implementation printers erase them.
 * The public helper adds placement and target validation separately.
 */
@:noCompletion
extern class SideEffectImportMarker {
  @:genes.sideEffectImport
  public static function external(module:String,
    importAttributeType:Null<String>):Void;

  @:genes.sideEffectImportInternal
  public static function internal<T>(reference:T):Void;
}
