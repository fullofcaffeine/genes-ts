package genes;

import haxe.macro.Type.MetaAccess;
import haxe.macro.Type.TypedExpr;
import haxe.macro.Context;

typedef SideEffectImportMarkerCall = {
  final method: String;
  final arguments: Array<TypedExpr>;
}

typedef DynamicImportMarkerCall = {
  final path: String;
  final pos: haxe.macro.Expr.Position;
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
 * independent type-level visibility facts. The side-effect-import carrier is
 * consumed by dependency planning; the dynamic-import carrier is consumed by
 * expression emission after the current runtime suffix is known. Marker
 * recognition uses the compiler's typed owner/member identity, never a
 * generated name or source string. A producer must still prove its DCE and
 * placement contract before using this boundary; the metadata alone does not
 * create a dependency edge.
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
  public static inline final DYNAMIC_IMPORT_MARKER_MODULE =
    'genes.internal.DynamicImportMarker';

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

  /**
   * Returns the extension-free request carried by the dynamic-import marker.
   *
   * Why: the marker must survive Haxe's typed-tree cache, but it must never
   * become a runtime helper call. Exact typed owner/member recognition prevents
   * an unrelated function named `load` from acquiring compiler behavior.
   *
   * What/How: the producer admits one literal path plus the authored file/range
   * that Haxe macro reification would otherwise replace with the macro
   * implementation position. A malformed call is left recognizable with a
   * null result so the expression emitter can report a stable compiler-planning
   * diagnostic instead of printing the fake extern.
   */
  public static function dynamicImportMarkerCall(
      callee: TypedExpr,
      arguments: Array<TypedExpr>): Null<DynamicImportMarkerCall> {
    return switch [callee.expr, arguments] {
      case [
        TField(_, FStatic(_.get() => owner, _.get() => {name: 'load'})),
        [
          {expr: TConst(TString(path))},
          {expr: TConst(TString(file))},
          {expr: TConst(TInt(min))},
          {expr: TConst(TInt(max))}
        ]
      ] if (owner.module == DYNAMIC_IMPORT_MARKER_MODULE):
        {
          path: path,
          pos: Context.makePosition({file: file, min: min, max: max})
        };
      default:
        null;
    }
  }

  static function dynamicImportMarkerReceiver(
      expression: TypedExpr): Null<DynamicImportMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        dynamicImportMarkerReceiver(inner);
      case TCall(callee, arguments):
        final direct = dynamicImportMarkerCall(callee, arguments);
        if (direct != null)
          direct;
        else
          switch arguments {
            // Multiple dynamic modules use `Promise.all([marker, ...])`.
            case [{expr: TArrayDecl(values)}]:
              var marker = null;
              for (value in values) {
                marker = dynamicImportMarkerReceiver(value);
                if (marker != null)
                  break;
              }
              marker;
            default:
              null;
          }
      default:
        null;
    }
  }

  /**
   * Finds the marker that owns one generated dynamic-import expansion.
   *
   * Why: Haxe assigns the outer `.then(...)` expression to the macro
   * implementation file even when its hidden marker retains the authored call
   * range. If the emitter records that outer position first, ordinary
   * source-map consumers choose it over the authored mapping at the same
   * generated column.
   *
   * What/How: this recognizes only the closed expansion roots produced by
   * `Genes.dynamicImport()`: a direct marker, or `.then(...)` whose receiver is
   * a marker or `Promise.all([marker, ...])`. It does not search arbitrary
   * callbacks or user expressions.
   */
  public static function dynamicImportExpansionMarker(
      expression: TypedExpr): Null<DynamicImportMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        dynamicImportExpansionMarker(inner);
      case TCall(callee, arguments):
        final direct = dynamicImportMarkerCall(callee, arguments);
        if (direct != null)
          direct;
        else
          switch callee.expr {
            case TField(receiver, _):
              dynamicImportMarkerReceiver(receiver);
            default:
              null;
          }
      default:
        null;
    }
  }

  /** Returns whether a callee is the exact compiler-owned marker field. */
  public static function isDynamicImportMarkerCallee(callee: TypedExpr): Bool {
    return switch callee.expr {
      case TField(_, FStatic(_.get() => owner, _.get() => {name: 'load'})):
        owner.module == DYNAMIC_IMPORT_MARKER_MODULE;
      default:
        false;
    }
  }
}
