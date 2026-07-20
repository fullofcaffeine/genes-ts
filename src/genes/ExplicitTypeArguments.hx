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

typedef ExplicitTypeArgument = {
  final type: Type;
  final tsType: Null<String>;
}

private typedef ExplicitCallSite = {
  final arguments: Array<ExplicitTypeArgument>;
  final position: Position;
}

/**
 * Preserves a Haxe-selected generic extern instantiation in TypeScript calls.
 *
 * Why: Haxe and TypeScript infer generic calls independently. Haxe may use the
 * destination type to select a narrow result, while the generated TypeScript
 * call has only a weak argument such as `null`--or no arguments at all--and
 * therefore chooses a different type. The generated assignment then fails
 * even though Haxe already proved the original program.
 *
 * What: `@:ts.explicitTypeArguments` opts one generic extern callable into
 * emitting the exact method type arguments established by Haxe. For example,
 * a typed `channel(null)` call can become `channel<string | null>(null)`.
 * This is declaration-owned and framework-neutral; ordinary calls retain
 * TypeScript inference.
 *
 * How: the typed callee contains its instantiated function signature, while
 * the owning `ClassField` retains the declaration's method parameters. This
 * helper structurally matches those two checked types, binds every declared
 * method parameter, and returns the bindings in declaration order. It rejects
 * malformed metadata, non-extern/non-generic fields, unresolved monomorphs,
 * and broad dynamic arguments before the TypeScript emitter writes output.
 * The classic JavaScript emitter never calls this helper, so the annotation
 * has no runtime representation and cannot change evaluation behavior.
 *
 * Calls through a runtime function-valued local intentionally do not inherit
 * the annotation: that local has lost declaration identity. Haxe import aliases
 * still resolve to the same typed field and therefore retain the contract.
 */
class ExplicitTypeArguments {
  public static inline final METADATA = ':ts.explicitTypeArguments';
  static inline final DIAGNOSTIC = 'GENES-TS-EXPLICIT-TYPE-ARGS-001';
  static inline final MAX_TYPE_DEPTH = 64;
  static final explicitCallSites: Map<String, ExplicitCallSite> = [];

  /** Returns the exact type arguments for an opted-in direct extern call. */
  public static function forCall(callee: TypedExpr): Null<Array<ExplicitTypeArgument>> {
    final callSite = explicitCallSites.get(positionKey(callee.pos));
    final resolved = resolveField(callee);
    if (resolved == null) {
      if (callSite != null) {
        fail('TypeArguments.call(...) requires a direct extern callable',
          callSite.position);
      }
      return null;
    }

    final declaration = metadataDeclaration(resolved.owner, resolved.field,
      resolved.isStatic);
    if (declaration == null) {
      if (callSite != null) {
        fail('TypeArguments.call(...) requires a generic extern callable '
          + 'annotated with @:ts.explicitTypeArguments',
          callSite.position);
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

    if (!resolved.owner.isExtern && !declaration.isExtern) {
      fail('@:ts.explicitTypeArguments is only valid on extern callables',
        declaration.pos);
    }
    if (declaration.params.length == 0) {
      fail('@:ts.explicitTypeArguments requires a generic extern callable',
        declaration.pos);
    }

    if (callSite != null) {
      if (callSite.arguments.length != declaration.params.length) {
        fail('TypeArguments.call(...) requires exactly '
          + '${declaration.params.length} type witness'
          + (declaration.params.length == 1 ? '' : 'es')
          + ', received ${callSite.arguments.length}',
          callSite.position);
      }
      return callSite.arguments;
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
   * Registers pre-erasure Haxe types for one direct generic extern call.
   *
   * Why: Haxe intentionally erases primitive-backed abstracts in some generic
   * applications. Once that happens, neither the callee nor destination type
   * retains enough information to emit a narrower TypeScript type argument. A
   * compile-time witness lets a library macro preserve that already checked
   * type without adding a target assertion or changing the call.
   *
   * What: `genes.ts.TypeArguments.call(externCall, witness...)` emits only the
   * original call, but TypeScript receives each witness type as the explicit
   * generic argument in declaration order. Witness expressions are typed and
   * discarded; they are never evaluated.
   *
   * How: the public macro records the types against the direct callee's exact
   * source span and returns the original call expression unchanged. The typed
   * emitter later resolves that same span to a reviewed extern field carrying
   * `@:ts.explicitTypeArguments`, validates arity and precision, and prints the
   * registered arguments. When a library macro duplicates one source call,
   * identical witnesses may safely share the record; conflicting witnesses at
   * one span fail instead of depending on printer order. Classic JavaScript
   * never queries this registry.
   */
  public static function registerCall(expression: Expr,
      witnesses: Array<Expr>): Expr {
    final calleePosition = switch expression.expr {
      case ECall(callee, _): callee.pos;
      default:
        fail('TypeArguments.call(...) expects a direct call expression',
          expression.pos);
    }
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
    final key = positionKey(calleePosition);
    final previous = explicitCallSites.get(key);
    if (previous != null) {
      if (!sameExplicitArguments(previous.arguments, arguments)) {
        fail('TypeArguments.call(...) found different type witnesses for calls '
          + 'that share one generated source span; the generating macro must '
          + 'give those callees distinct source positions', expression.pos);
      }
      return expression;
    }
    explicitCallSites.set(key, {
      arguments: arguments,
      position: expression.pos
    });
    return expression;
  }

  /** Whether one typed initializer is a registered explicit generic call. */
  public static function infersPreciseLocalType(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        infersPreciseLocalType(inner);
      case TCall(callee, _):
        explicitCallSites.exists(positionKey(callee.pos));
      default:
        false;
    }
  }

  static function positionKey(position: Position): String {
    final info = Context.getPosInfos(position);
    return '${info.file}:${info.min}:${info.max}';
  }

  /** True when repeated macro expansion preserved exactly the same type fact. */
  static function sameExplicitArguments(left: Array<ExplicitTypeArgument>,
      right: Array<ExplicitTypeArgument>): Bool {
    if (left.length != right.length)
      return false;
    for (index in 0...left.length) {
      if (left[index].tsType != right[index].tsType
        || !sameType(left[index].type, right[index].type))
        return false;
    }
    return true;
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
