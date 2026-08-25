package genes;

import haxe.macro.Type.MetaAccess;
import haxe.macro.Type.Type;
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

typedef DynamicBindingDeclarationMarkerCall = {
  final token: String;
  final value: TypedExpr;
}

typedef UndefinablePresentMarkerCall = {
  final value: TypedExpr;
  final resultType: Type;
}

typedef NativeAsyncMarkerCall = {
  final value: TypedExpr;
}

#if genes.lexical_binding_inventory
typedef LexicalBindingQueryMarkerCall = {
  final group: String;
  final role: String;
  final candidates: Array<String>;
}
#end

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
 * expression emission after the current runtime suffix is known; and the
 * `Undefinable` presence carrier preserves one exact assertion result type for
 * TypeScript dependency planning and emission. Native-async carriers preserve
 * one exact anonymous function or return payload for `NativeAsyncPlan`.
 * Marker recognition uses the compiler's typed owner/member identity, never a
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
  public static inline final DYNAMIC_IMPORT_MARKER_MODULE = 'genes.internal.DynamicImportMarker';
  public static inline final DYNAMIC_BINDING_DECLARATION_MARKER_MODULE = 'genes.internal.DynamicBindingDeclarationMarker';
  public static inline final UNDEFINABLE_PRESENT_MARKER_MODULE = 'genes.internal.UndefinablePresentMarker';
  public static inline final NATIVE_ASYNC_MARKER_MODULE = 'genes.internal.NativeAsyncMarker';
  #if genes.lexical_binding_inventory
  public static inline final LEXICAL_BINDING_QUERY_MARKER_MODULE = 'genes.internal.LexicalBindingQueryMarker';
  #end

  /** Returns whether one typed field is semantic-only compiler evidence. */
  public static function isField(meta: Null<MetaAccess>): Bool {
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
  public static function isType(meta: Null<MetaAccess>): Bool {
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
  public static function isSemanticOnlyType(meta: Null<MetaAccess>): Bool {
    return meta != null && meta.has(SEMANTIC_ONLY_METADATA);
  }

  /**
   * Recognizes the exact hidden calls reserved for ordered module requests.
   *
   * The marker is effectful from Haxe's perspective so full DCE retains it.
   * Genes consumes it after typing; returning true here authorizes expression
   * erasure but does not itself decide request identity, order, or reachability.
   */
  public static function isSideEffectImportMarkerCall(expression: TypedExpr): Bool {
    return sideEffectImportMarkerCall(expression) != null;
  }

  /** Returns the exact marker member and typed arguments, or null. */
  public static function sideEffectImportMarkerCall(expression: TypedExpr): Null<SideEffectImportMarkerCall> {
    if (expression == null)
      return null;
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        sideEffectImportMarkerCall(inner);
      case TCall({
        expr: TField(_, FStatic(_.get() => owner, _.get() => field))
      },
        arguments)
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
  public static function dynamicImportMarkerCall(callee: TypedExpr,
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

  static function dynamicImportMarkerReceiver(expression: TypedExpr): Null<DynamicImportMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        dynamicImportMarkerReceiver(inner);
      case TCall(callee, arguments):
        final direct = dynamicImportMarkerCall(callee, arguments);
        if (direct != null) direct; else switch arguments {
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
  public static function dynamicImportExpansionMarker(expression: TypedExpr): Null<DynamicImportMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        dynamicImportExpansionMarker(inner);
      case TCall(callee, arguments):
        final direct = dynamicImportMarkerCall(callee, arguments);
        if (direct != null) direct; else switch callee.expr {
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

  #if genes.lexical_binding_inventory
  /** Decodes one test-only query marker retained through Haxe DCE. */
  public static function lexicalBindingQueryMarkerCall(expression: TypedExpr): Null<LexicalBindingQueryMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        lexicalBindingQueryMarkerCall(inner);
      case TCall({
        expr: TField(_, FStatic(_.get() => owner, _.get() => {name: 'mark'}))
      }, arguments) if (owner.module == LEXICAL_BINDING_QUERY_MARKER_MODULE):
        switch arguments {
          case [
            {expr: TConst(TString(group))},
            {expr: TConst(TString(role))},
            {expr: TArrayDecl(values)}
          ]:
            final candidates: Array<String> = [];
            for (value in values)
              switch value.expr {
                case TConst(TString(candidate)):
                  candidates.push(candidate);
                default:
                  return
                    CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: query marker candidates must be string literals',
                    value.pos);
              }
            {group: group, role: role, candidates: candidates};
          default:
            CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: query marker needs literal group, role, and candidate array',
              expression.pos);
        }
      default:
        null;
    }
  }
  #end

  /** Returns one exact token-backed lazy callback declaration carrier. */
  public static function dynamicBindingDeclarationMarkerCall(expression: TypedExpr): Null<DynamicBindingDeclarationMarkerCall> {
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        dynamicBindingDeclarationMarkerCall(inner);
      case TCall({
        expr: TField(_, FStatic(_.get() => owner, _.get() => {name: 'declare'}))
      },
        [{expr: TConst(TString(token))}, value])
        if (owner.module == DYNAMIC_BINDING_DECLARATION_MARKER_MODULE):
        {token: token, value: value};
      default:
        null;
    }
  }

  /**
   * Returns one exact `Undefinable.assumePresent()` carrier.
   *
   * Why: the TypeScript emitter must remove only outer `undefined`, not a
   * nested Haxe `null`. The instantiated marker return type is the exact `T`
   * that Haxe already checked, so printers do not reconstruct it from text.
   *
   * What/How: one exact static marker field with one value is admitted. The
   * function return from the typed callee supplies the assertion target.
   * Malformed marker calls remain recognizable through
   * `isUndefinablePresentMarkerCallee()` so emitters can fail closed.
   */
  public static function undefinablePresentMarkerCall(callee: TypedExpr,
      arguments: Array<TypedExpr>): Null<UndefinablePresentMarkerCall> {
    return switch [callee.expr, arguments, Context.follow(callee.t)] {
      case [
        TField(_,
          FStatic(_.get() => owner, _.get() => {name: 'assumePresent'})),
        [value],
        TFun(_, resultType)
      ] if (owner.module == UNDEFINABLE_PRESENT_MARKER_MODULE):
        {value: value, resultType: resultType};
      default:
        null;
    }
  }

  /** Returns whether a callee is the exact presence-proof marker field. */
  public static function isUndefinablePresentMarkerCallee(callee: TypedExpr): Bool {
    return switch callee.expr {
      case TField(_,
        FStatic(_.get() => owner, _.get() => {name: 'assumePresent'})):
        owner.module == UNDEFINABLE_PRESENT_MARKER_MODULE;
      default:
        false;
    }
  }

  static function nativeAsyncMarkerCall(expression: TypedExpr,
      method: String): Null<NativeAsyncMarkerCall> {
    if (expression == null)
      return null;
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        nativeAsyncMarkerCall(inner, method);
      case TCall(callee = {
        expr: TField(_, FStatic(_.get() => owner, _.get() => field))
      },
        arguments)
        if (owner.module == NATIVE_ASYNC_MARKER_MODULE && field.name == method):
        final value = switch [method, arguments] {
          case ['functionValue', [carried]]: carried;
          case ['returnValue', [expected, carried]]
            if (isInertNativeAsyncReturnWitness(expected)):
            carried;
          default: null;
        }
        value == null ? null : {value: value};
      default:
        null;
    }
  }

  /** Whether one return witness has the macro's runtime-inert typed-null shape. */
  static function isInertNativeAsyncReturnWitness(expression: TypedExpr): Bool {
    final isPromise = switch Context.followWithAbstracts(expression.t) {
      case TInst(_.get() => owner, _): owner.module == 'js.lib.Promise' && owner.name == 'Promise';
      default:
        false;
    }
    if (!isPromise)
      return false;
    return isInertNativeAsyncReturnWitnessValue(expression);
  }

  /** Whether a promise-typed witness contains only an erased null value. */
  static function isInertNativeAsyncReturnWitnessValue(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TConst(TNull):
        true;
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        isInertNativeAsyncReturnWitnessValue(inner);
      default:
        false;
    }
  }

  /** Returns one exact anonymous-native-async carrier, or null. */
  public static function nativeAsyncFunctionValueCall(expression: TypedExpr): Null<NativeAsyncMarkerCall> {
    return nativeAsyncMarkerCall(expression, 'functionValue');
  }

  /** Returns one exact native-async return bridge, or null. */
  public static function nativeAsyncReturnValueCall(expression: TypedExpr): Null<NativeAsyncMarkerCall> {
    return nativeAsyncMarkerCall(expression, 'returnValue');
  }

  /** Whether an expression calls either exact native-async marker member. */
  public static function isNativeAsyncMarkerCall(expression: TypedExpr): Bool {
    if (expression == null)
      return false;
    return switch expression.expr {
      case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
        isNativeAsyncMarkerCall(inner);
      case TCall({
        expr: TField(_, FStatic(_.get() => owner, _.get() => field))
      }, _): owner.module == NATIVE_ASYNC_MARKER_MODULE && (field.name == 'functionValue'
        || field.name == 'returnValue');
      default:
        false;
    }
  }
}
