package genes;

import haxe.macro.Type.MetaAccess;
import haxe.macro.Type.TypedExpr;

typedef SideEffectImportMarkerCall = {
  final method: String;
  final arguments: Array<TypedExpr>;
}

/**
 * Defines the narrow typed-AST boundary used by compiler-owned carrier values.
 *
 * Why: some source constructs must remain visible until Haxe has completed
 * typing and DCE, but are semantic evidence for Genes rather than JavaScript or
 * TypeScript API members. Printing those carriers would expose fake values and
 * could execute a retention read at the wrong time.
 *
 * What: `@:genes.compilerInternal` removes an already-typed field from every
 * implementation/declaration printer, while the side-effect marker predicate
 * identifies calls that are consumed by dependency planning and must not reach
 * expression output.
 *
 * How: `Module` deliberately keeps internal fields in its semantic member
 * inventory so dependency planning can traverse their expressions. Emitters
 * filter only at their output boundary. Marker recognition uses the compiler's
 * typed owner/member identity, never a generated name or source string. A
 * producer must still prove its DCE and placement contract before using this
 * boundary; the metadata alone does not create a dependency edge.
 */
class CompilerInternal {
  public static inline final FIELD_METADATA = ':genes.compilerInternal';
  public static inline final SIDE_EFFECT_MARKER_MODULE = 'genes.internal.SideEffectImportMarker';

  /** Returns whether one typed field is semantic-only compiler evidence. */
  public static function isField(meta:Null<MetaAccess>):Bool {
    return meta != null && meta.has(FIELD_METADATA);
  }

  /**
   * Recognizes the exact hidden calls reserved for ordered module requests.
   *
   * The marker is effectful from Haxe's perspective so full DCE retains it.
   * Genes consumes it after typing; returning true here authorizes expression
   * erasure but does not itself decide request identity, order, or reachability.
   */
  public static function isSideEffectImportMarkerCall(expression:TypedExpr):Bool {
    return sideEffectImportMarkerCall(expression) != null;
  }

  /** Returns the exact marker member and typed arguments, or null. */
  public static function sideEffectImportMarkerCall(
      expression: TypedExpr): Null<SideEffectImportMarkerCall> {
    if (expression == null)
      return null;
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        sideEffectImportMarkerCall(inner);
      case TCall({
        expr: TField(_, FStatic(_.get() => owner, _.get() => field))
      }, arguments)
        if (owner.module == SIDE_EFFECT_MARKER_MODULE
          && (field.name == 'external' || field.name == 'internal')):
        {method: field.name, arguments: arguments};
      default:
        null;
    }
  }
}
