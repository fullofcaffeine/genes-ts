package genes.internal;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Guards compiler-internal ESM request evidence at the Haxe typing boundary.
 *
 * Why: ts2hx request carriers are valid only when the Genes JS generator will
 * consume their typed markers. If the generated Haxe tree is later compiled
 * with standard Haxe, silently omitting a request would lose module
 * initialization and calling the raw extern marker would leave a runtime call.
 *
 * What: these macros require the JS target and the compilation-local capability
 * installed by `genes.Generator.use()`. A valid call expands to the exact
 * `SideEffectImportMarker` expression already understood by dependency
 * planning; an invalid call stops typing with a stable target diagnostic.
 *
 * How: the input expressions are spliced into the expansion unchanged, so
 * Haxe still types internal retention anchors and keeps them through full DCE.
 * The macros have no runtime implementation, do not inspect generated names,
 * and never use conditional compilation to erase an ESM request.
 */
@:noCompletion
class EsmRequestFact {
  /** Carries one external runtime specifier and optional `type` attribute. */
  public static macro function external(module:ExprOf<String>,
      importAttributeType:ExprOf<Null<String>>):ExprOf<Void> {
    requireGenesEsm(module.pos);
    return macro @:pos(module.pos) genes.internal.SideEffectImportMarker.external(
      $module, $importAttributeType);
  }

  /** Carries one typed reference to a converted internal module request. */
  public static macro function internal<T>(reference:ExprOf<T>):ExprOf<Void> {
    requireGenesEsm(reference.pos);
    return macro @:pos(reference.pos) genes.internal.SideEffectImportMarker.internal(
      $reference);
  }

  #if macro
  static function requireGenesEsm(pos:Position):Void {
    if (!Context.defined('js')
      || !Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE)) {
      Context.error(
        'GENES-ESM-REQUEST-TARGET-001: generated ESM requests require the active Genes JS generator',
        pos);
    }
  }
  #end
}
