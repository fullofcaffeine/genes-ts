package genes;

import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import haxe.macro.TypeTools;

private typedef ExplicitTypeArgumentField = {
  final owner: ClassType;
  final field: ClassField;
  final isStatic: Bool;
}

/**
 * One occurrence-local TypeScript argument selected by checked Haxe typing.
 *
 * `type` is the compiler-owned Haxe identity used by the ordinary type printer.
 * `tsType` is present only when Haxe would erase a source distinction such as
 * a closed enum-abstract literal union before generation.
 */
typedef ExplicitTypeArgument = {
  final type: Type;
  final tsType: Null<String>;
}

/** The original value and occurrence-local type facts carried through typing. */
typedef ExplicitTypeArgumentCallSite = {
  final value: TypedExpr;
  final arguments: Array<ExplicitTypeArgument>;
}

/**
 * Preserves a Haxe-selected generic callable instantiation in TypeScript calls.
 *
 * Why: Haxe and TypeScript infer generic calls independently. Haxe may use the
 * destination type to select a narrow result, while the generated TypeScript
 * call has only a weak argument such as `null`--or no arguments at all--and
 * therefore chooses a different type. The generated assignment then fails
 * even though Haxe already proved the original program.
 *
 * What: `@:ts.explicitTypeArguments` opts one directly called generic callable into
 * emitting the exact method type arguments established by Haxe. For example,
 * a typed `channel(null)` call can become `channel<string | null>(null)`.
 * This is declaration-owned and framework-neutral; ordinary calls retain
 * TypeScript inference.
 *
 * How: the typed callee contains its instantiated function signature, while
 * the owning `ClassField` retains the declaration's method parameters. This
 * helper structurally matches those two checked types, binds every declared
 * method parameter, and returns the bindings in declaration order. It rejects
 * malformed metadata, non-generic fields, unresolved monomorphs,
 * and broad dynamic arguments before the TypeScript emitter writes output.
 * The classic JavaScript emitter never calls this helper, so the annotation
 * has no runtime representation and cannot change evaluation behavior.
 *
 * The callable may be an extern supplied by a JavaScript package or an
 * ordinary Haxe function that genes emits. Calls through a runtime
 * function-valued local intentionally do not inherit
 * the annotation: that local has lost declaration identity. Haxe import aliases
 * still resolve to the same typed field and therefore retain the contract.
 */
class ExplicitTypeArguments {
  public static inline final METADATA = ':ts.explicitTypeArguments';
  static inline final DIAGNOSTIC = 'GENES-TS-EXPLICIT-TYPE-ARGS-001';
  static inline final MAX_TYPE_DEPTH = 64;

  /**
   * Returns the exact type arguments for an opted-in direct generic call.
   *
   * When `carriedArguments` is present, the call came from
   * `TypeArguments.call`. The carrier belongs to this exact typed occurrence,
   * so a warm compilation can reuse the typed tree without consulting macro
   * process state. The declaration is still revalidated before the facts are
   * used; a cached or malformed carrier cannot authorize another callable.
   */
  public static function forCall(callee: TypedExpr,
      carriedArguments: Null<Array<ExplicitTypeArgument>> = null): Null<Array<ExplicitTypeArgument>> {
    final resolved = resolveField(callee);
    if (resolved == null) {
      if (carriedArguments != null) {
        fail('TypeArguments.call(...) requires a direct generic callable',
          callee.pos);
      }
      return null;
    }

    final declaration = metadataDeclaration(resolved.owner, resolved.field,
      resolved.isStatic);
    if (declaration == null) {
      if (carriedArguments != null) {
        fail('TypeArguments.call(...) requires a generic callable '
          + 'annotated with @:ts.explicitTypeArguments',
          callee.pos);
      }
      return null;
    }

    final entries = declaration.meta.extract(METADATA);
    switch entries {
      case [{params: []}]:
      case [entry]:
        fail('@:ts.explicitTypeArguments does not take arguments', entry.pos);
      default:
        fail('@:ts.explicitTypeArguments must be declared exactly once',
          declaration.pos);
    }

    if (declaration.params.length == 0) {
      fail('@:ts.explicitTypeArguments requires a generic callable',
        declaration.pos);
    }

    if (carriedArguments != null) {
      if (carriedArguments.length != declaration.params.length) {
        fail('TypeArguments.call(...) requires exactly '
          + '${declaration.params.length} type witness'
          + (declaration.params.length == 1 ? '' : 'es')
          + ', received ${carriedArguments.length}',
          callee.pos);
      }
      for (index in 0...carriedArguments.length) {
        if (containsUnsafeType(carriedArguments[index].type)) {
          fail('TypeArguments.call(...) witness ${index + 1} is unresolved or broad; '
            + 'explicit TypeScript type arguments must remain precise',
            callee.pos);
        }
      }
      return carriedArguments;
    }

    final parameterKeys: Map<String, Bool> = [];
    for (parameter in declaration.params)
      parameterKeys.set(typeParameterKey(parameter.t), true);

    final bindings: Map<String, Type> = [];
    bindTypeParameters(declaration.type, callee.t, parameterKeys, bindings, 0);

    final arguments = new Array<ExplicitTypeArgument>();
    for (parameter in declaration.params) {
      final key = typeParameterKey(parameter.t);
      final argument = bindings.get(key);
      if (argument == null) {
        fail('cannot recover the Haxe-selected type argument for method '
          + 'parameter ${parameter.name}',
          callee.pos);
      }
      if (containsUnsafeType(argument)) {
        fail('the Haxe-selected argument for method parameter '
          + '${parameter.name} is unresolved or broad; explicit TypeScript '
          + 'type arguments must remain precise',
          callee.pos);
      }
      arguments.push({type: argument, tsType: null});
    }
    return arguments;
  }

  /**
   * Registers pre-erasure Haxe types for one direct generic call.
   *
   * Why: Haxe intentionally erases primitive-backed abstracts in some generic
   * applications. Once that happens, neither the callee nor destination type
   * retains enough information to emit a narrower TypeScript type argument. A
   * compile-time witness lets a library macro preserve that already checked
   * type without adding a target assertion or changing the call.
   *
   * What: `genes.ts.TypeArguments.call(genericCall, witness...)` emits only the
   * original call, but TypeScript receives each witness type as the explicit
   * generic argument in declaration order. Witness expressions are typed and
   * discarded; they are never evaluated.
   *
   * How: the public macro wraps the original call in a compiler-internal typed
   * identity carrier. Each witness becomes an inert typed-null fact; a closed
   * enum abstract also carries its pre-erasure TypeScript union spelling.
   * Haxe can relocate source positions and discard arbitrary metadata, but the
   * typed call occurrence survives both transformations and compiler-server
   * caching. Both emitters remove the carrier and every fact. The TypeScript
   * emitter additionally scopes the facts while it prints the original value
   * and revalidates the exact extern declaration before applying them.
   */
  public static function registerCall(expression: Expr,
      witnesses: Array<Expr>): Expr {
    final call = switch expression.expr {
      case ECall(callee, parameters): {callee: callee, parameters: parameters};
      default:
        fail('TypeArguments.call(...) expects a direct call expression',
          expression.pos);
    }
    final callee = call.callee;
    final resolved = resolveField(Context.typeExpr(callee));
    if (resolved == null)
      fail('TypeArguments.call(...) requires a direct generic callable',
        expression.pos);
    final arguments = new Array<ExplicitTypeArgument>();
    for (index in 0...witnesses.length) {
      final argument = Context.typeof(witnesses[index]);
      if (containsUnsafeType(argument)) {
        fail('TypeArguments.call(...) witness ${index + 1} is unresolved or broad; '
          + 'explicit TypeScript type arguments must remain precise',
          witnesses[index].pos);
      }
      arguments.push({
        type: argument,
        tsType: genes.ts.SignatureCache.enumAbstractLiteralUnionTsType(argument)
      });
    }
    return markCall(expression, callee, call.parameters, arguments);
  }

  /**
   * Whether a final initializer can retain the registered TypeScript inference.
   *
   * A direct opted-in call is the common case. A macro may also append ordinary
   * fluent fields/calls to that value; following only the callee receiver finds
   * the reviewed inner call without treating unrelated argument expressions as
   * authority to remove the Haxe local annotation.
   */
  public static function infersPreciseLocalType(expression: TypedExpr): Bool {
    final marker = callSiteMarker(expression);
    if (marker != null)
      return true;
    return switch expression.expr {
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        infersPreciseLocalType(inner);
      case TCall(callee, _):
        infersPreciseLocalType(callee);
      case TField(receiver, _):
        infersPreciseLocalType(receiver);
      default:
        false;
    }
  }

  /** Recognizes the compiler-only identity call around a reviewed expression. */
  public static function callSiteMarker(expression: TypedExpr): Null<ExplicitTypeArgumentCallSite> {
    return switch expression.expr {
      case TCall(callee, carrierArguments) if (carrierArguments.length >= 1):
        final resolved = resolveField(callee);
        if (resolved != null
          && resolved.owner.pack.join('.') == 'genes.ts'
          && resolved.owner.name == 'ExplicitTypeArgumentCallSite'
          && resolved.field.name == 'preserve') {
          final value = carrierArguments[0];
          final encoded = carrierArguments.slice(1);
          if (encoded.length % 2 != 0) {
            fail('the compiler-owned call carrier has malformed type facts',
              expression.pos);
          }
          final arguments = new Array<ExplicitTypeArgument>();
          var index = 0;
          while (index < encoded.length) {
            final tsType = typedString(encoded[index + 1]);
            if (tsType == null) {
              fail('the compiler-owned call carrier has a non-literal type spelling',
                encoded[index + 1].pos);
            }
            arguments.push({
              type: encoded[index].t,
              tsType: tsType.length == 0 ? null : tsType
            });
            index += 2;
          }
          {value: value, arguments: arguments};
        } else {
          null;
        }
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        callSiteMarker(inner);
      default:
        null;
    }
  }

  static function typedString(expression: TypedExpr): Null<String> {
    return switch expression.expr {
      case TConst(TString(value)): value;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        typedString(inner);
      default:
        null;
    }
  }

  /**
   * Wraps the reviewed call in a compiler-erased identity intrinsic.
   *
   * Haxe may relocate nested macro source positions and discards arbitrary
   * untyped expression metadata. A real typed direct call survives both steps,
   * so it carries the occurrence-local witness types to emission. Both Genes
   * emitters recognize this compiler-internal field, emit only `expression`,
   * and never evaluate or print the typed-null facts.
   */
  static function markCall(expression: Expr, callee: Expr,
      parameters: Array<Expr>, arguments: Array<ExplicitTypeArgument>): Expr {
    final original: Expr = {
      expr: ECall(callee, parameters),
      pos: expression.pos
    };
    final carrierArguments = [original];
    for (argument in arguments) {
      final complex = TypeTools.toComplexType(argument.type);
      if (complex == null) {
        fail('TypeArguments.call(...) cannot preserve this witness type in '
          + 'the compiler-owned typed carrier',
          expression.pos);
      }
      carrierArguments.push({
        expr: ECheckType({
          expr: EConst(CIdent('null')),
          pos: expression.pos
        }, complex),
        pos: expression.pos
      });
      carrierArguments.push({
        expr: EConst(CString(argument.tsType ?? '')),
        pos: expression.pos
      });
    }
    return {
      expr: ECall(macro @:pos(expression.pos) genes.ts.ExplicitTypeArgumentCallSite.preserve,
        carrierArguments),
      pos: expression.pos
    };
  }

  /**
   * Recovers the declaration behind a direct typed field access.
   *
   * Parentheses, inert metadata, and compiler-inserted casts do not change
   * identity. A `TLocal` is deliberately absent because a runtime function
   * value does not retain the field metadata that justified specialization.
   */
  static function resolveField(expression: TypedExpr): Null<ExplicitTypeArgumentField> {
    return switch expression.expr {
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        resolveField(inner);
      case TField(_, FStatic(owner, field)):
        {owner: owner.get(), field: field.get(), isStatic: true};
      case TField(_, FInstance(owner, _, field)):
        {owner: owner.get(), field: field.get(), isStatic: false};
      case TField(_, FClosure({c: owner}, field)):
        {owner: owner.get(), field: field.get(), isStatic: false};
      default:
        null;
    }
  }

  /**
   * Uses the canonical overload owner when Haxe returns a selected overload.
   *
   * Haxe can expose the selected overload's function type on the callee while
   * keeping annotations and generic parameters on the primary field. Matching
   * by the compiler-owned field name is safe inside the already resolved owner
   * and avoids asking every overload declaration to duplicate the annotation.
   */
  static function metadataDeclaration(owner: ClassType, selected: ClassField,
      isStatic: Bool): Null<ClassField> {
    if (selected.meta.has(METADATA) && selected.params.length > 0)
      return selected;
    final fields = isStatic ? owner.statics.get() : owner.fields.get();
    for (field in fields)
      if (field.name == selected.name && field.meta.has(METADATA)
        && field.params.length > 0)
        return field;
    return selected.meta.has(METADATA) ? selected : null;
  }

  /**
   * Binds declaration method parameters against the instantiated callee type.
   *
   * Typedefs and resolved monomorphs are transparent, but nominal type
   * applications retain their parameter positions. Function results are
   * always compared even when an overload changes the argument count; this is
   * how a generic declaration can preserve an exact zero-argument result.
   */
  static function bindTypeParameters(declared: Type, actual: Type,
      parameterKeys: Map<String, Bool>, bindings: Map<String, Type>,
      depth: Int): Void {
    if (depth > MAX_TYPE_DEPTH)
      return;

    final declaration = resolveAlias(declared);
    final instantiation = resolveAlias(actual);
    switch declaration {
      case TInst(parameter, _)
        if (parameter.get().kind.match(KTypeParameter(_))):
        final key = typeParameterKey(declaration);
        if (!parameterKeys.exists(key))
          return;
        final previous = bindings.get(key);
        if (previous == null) {
          bindings.set(key, instantiation);
        } else if (!sameType(previous, instantiation)) {
          fail('Haxe produced inconsistent instantiations for method type '
            + 'parameter ${parameter.get().name}',
            parameter.get().pos);
        }
      case TFun(declaredArguments, declaredResult):
        switch instantiation {
          case TFun(actualArguments, actualResult):
            final count = declaredArguments.length < actualArguments.length ? declaredArguments.length : actualArguments.length;
            for (index in 0...count)
              bindTypeParameters(declaredArguments[index].t,
                actualArguments[index].t, parameterKeys, bindings, depth + 1);
            bindTypeParameters(declaredResult, actualResult, parameterKeys,
              bindings, depth + 1);
          default:
        }
      case TInst(declaredRef, declaredParameters):
        switch instantiation {
          case TInst(actualRef, actualParameters)
            if (sameBaseType(declaredRef.get(), actualRef.get())):
            bindParameters(declaredParameters, actualParameters,
              parameterKeys, bindings, depth + 1);
          default:
        }
      case TEnum(declaredRef, declaredParameters):
        switch instantiation {
          case TEnum(actualRef, actualParameters)
            if (sameBaseType(declaredRef.get(), actualRef.get())):
            bindParameters(declaredParameters, actualParameters,
              parameterKeys, bindings, depth + 1);
          default:
        }
      case TAbstract(declaredRef, declaredParameters):
        switch instantiation {
          case TAbstract(actualRef, actualParameters)
            if (sameBaseType(declaredRef.get(), actualRef.get())):
            bindParameters(declaredParameters, actualParameters,
              parameterKeys, bindings, depth + 1);
          default:
        }
      case TAnonymous(declaredRef):
        switch instantiation {
          case TAnonymous(actualRef):
            final actualFields = actualRef.get().fields;
            for (declaredField in declaredRef.get().fields) {
              final actualField = Lambda.find(actualFields,
                candidate -> candidate.name == declaredField.name);
              if (actualField != null)
                bindTypeParameters(declaredField.type, actualField.type,
                  parameterKeys, bindings, depth + 1);
            }
          default:
        }
      case TDynamic(declaredInner):
        switch [declaredInner, instantiation] {
          case [null, _]:
          case [inner, TDynamic(actualInner)] if (actualInner != null):
            bindTypeParameters(inner, actualInner, parameterKeys, bindings,
              depth + 1);
          default:
        }
      default:
    }
  }

  static function bindParameters(declared: Array<Type>, actual: Array<Type>,
      parameterKeys: Map<String, Bool>, bindings: Map<String, Type>,
      depth: Int): Void {
    final count = declared.length < actual.length ? declared.length : actual.length;
    for (index in 0...count)
      bindTypeParameters(declared[index], actual[index], parameterKeys,
        bindings, depth);
  }

  static function resolveAlias(type: Type): Type {
    return switch type {
      case TType(_, _) | TLazy(_): resolveAlias(Context.follow(type));
      case TMono(reference) if (reference.get() != null):
        resolveAlias(reference.get());
      default:
        type;
    }
  }

  static function sameType(left: Type, right: Type): Bool {
    return Context.unify(left, right) && Context.unify(right, left);
  }

  static function sameBaseType(left: BaseType, right: BaseType): Bool {
    return left.module == right.module && left.name == right.name;
  }

  static function typeParameterKey(type: Type): String {
    return switch type {
      case TInst(reference, _)
        if (reference.get().kind.match(KTypeParameter(_))):
        final parameter = reference.get();
        final info = Context.getPosInfos(parameter.pos);
        '${parameter.module}:${parameter.name}:${info.file}:${info.min}';
      default:
        TypeTools.toString(type);
    }
  }

  /** Rejects values that would print an unchecked or unresolved TS argument. */
  static function containsUnsafeType(type: Type, depth = 0): Bool {
    if (depth > MAX_TYPE_DEPTH)
      return true;
    return switch type {
      case TDynamic(_):
        true;
      case TMono(reference): final resolved = reference.get(); resolved == null || containsUnsafeType(resolved,
          depth
          + 1);
      case TLazy(resolve):
        containsUnsafeType(resolve(), depth + 1);
      case TAbstract(reference, parameters): final abstraction = reference.get(); (abstraction.pack.length == 0
          && abstraction.name == 'Any') || containsUnsafeParameters(parameters,
          depth
          + 1);
      default:
        var unsafe = false;
        TypeTools.iter(type, child -> {
          if (!unsafe && containsUnsafeType(child, depth + 1))
            unsafe = true;
        });
        unsafe;
    }
  }

  static function containsUnsafeParameters(parameters: Array<Type>,
      depth: Int): Bool {
    for (parameter in parameters)
      if (containsUnsafeType(parameter, depth))
        return true;
    return false;
  }

  static function fail<T>(message: String, position: Position): T {
    return CompilerDiagnostic.fail('$DIAGNOSTIC: $message', position);
  }
}
