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
 * implementation/declaration printer. On a top-level type it instead requests
 * a local-only implementation with no export, declaration, runtime registry,
 * or source position. A compiler-owned typedef may additionally use
 * `@:genes.semanticOnly` when it exists only as input to a semantic checker and
 * no emitted expression or annotation can name it. The side-effect marker
 * predicate identifies calls that are consumed by dependency planning and
 * must not reach expression output.
 *
 * How: `Module` deliberately keeps internal fields in its semantic member
 * inventory so dependency planning can traverse their expressions. Emitters
 * filter only at their output boundary. `Module.memberProjection` owns the
 * independent type-level visibility facts. Marker recognition uses the
 * compiler's typed owner/member identity, never a generated name or source
 * string. A producer must still prove its DCE and placement contract before
 * using this boundary; the metadata alone does not create a dependency edge.
 */
class CompilerInternal {
  /**
   * Compilation-local proof that the Genes JS generator is installed.
   *
   * Why: target-polymorphic helpers must not silently erase required runtime
   * semantics when callers compile with standard Haxe, `genes.disable`, or a
   * non-JS target. Checking only public mode defines cannot establish that the
   * custom generator which consumes their typed markers is actually active.
   *
   * What/How: `Generator.use()` defines this compiler-private capability only
   * inside its JS and non-disabled installation branch. Haxe compiler defines
   * belong to one compilation, so compile-server reuse cannot leak an active
   * state into the next build. Helpers may read it, but programs must not use
   * it as a configurable feature flag.
   */
  public static inline final GENERATOR_ACTIVE_DEFINE = 'genes.generator.active';

  public static inline final FIELD_METADATA = ':genes.compilerInternal';
  public static inline final SEMANTIC_ONLY_METADATA = ':genes.semanticOnly';
  public static inline final SIDE_EFFECT_MARKER_MODULE = 'genes.internal.SideEffectImportMarker';

  /** Returns whether one typed field is semantic-only compiler evidence. */
  public static function isField(meta:Null<MetaAccess>):Bool {
    return meta != null && meta.has(FIELD_METADATA);
  }

  /**
   * Returns whether a typed top-level type is compiler-owned implementation.
   *
   * Why/What/How: the metadata spelling is shared with fields, but type members
   * need a different final projection rather than erasure. `Module` calls this
   * after typing to keep the implementation local while suppressing public,
   * reflection, and provenance surfaces in both Genes output profiles.
   */
  public static function isType(meta:Null<MetaAccess>):Bool {
    return meta != null && meta.has(FIELD_METADATA);
  }

  /**
   * Returns whether a compiler-internal typedef is analysis input only.
   *
   * Why: HXX intrinsic schemas must survive Haxe typing so the compiler can
   * check markup, but no generated program refers to their typedef names.
   * Ordinary compiler-internal typedefs are different: local generated TypeScript
   * may still use their aliases and therefore needs them emitted.
   *
   * What/How: `Module.memberProjection` erases a typedef only when both this
   * metadata and `@:genes.compilerInternal` are present. Classes, enums, and
   * fields never acquire erasure from this flag. Keeping the two annotations
   * separate prevents a schema implementation detail from changing the
   * established local-only contract of `@:genes.compilerInternal`.
   */
  public static function isSemanticOnlyType(meta:Null<MetaAccess>):Bool {
    return meta != null && meta.has(SEMANTIC_ONLY_METADATA);
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
