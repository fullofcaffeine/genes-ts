package genes.react;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Expr.ExprOf;
import haxe.macro.Type;
import haxe.macro.Type.ClassKind;

using Lambda;
using haxe.macro.TypeTools;
#end

/**
 * Compile-time implementation of the semantic React Hook surface.
 *
 * Why: React overloads callable state values with updater functions and accepts
 * arbitrary arrays for Hook dependencies. Those host shapes are faithful but
 * unnecessarily ambiguous in Haxe source.
 *
 * What: the macro separates eager and lazy state, keeps replacement and update
 * intent distinct, and requires dependencies to be authored inline.
 *
 * How: it validates the Haxe types and rewrites directly to precise extern
 * calls. Both genes output profiles therefore retain native React imports and
 * identical runtime evaluation order.
 *
 * This compiler-only implementation is a module rather than an all-static
 * class because it owns functions and immutable policy, not runtime identity.
 */
#if macro
  private inline final STATE_DIAGNOSTIC = "GTS-REACT-STATE-001";
  private inline final DEPS_DIAGNOSTIC = "GTS-REACT-DEPS-001";
  private inline final SNAPSHOT_DIAGNOSTIC = "GTS-REACT-DEPS-002";

  private function fail<T>(code: String, message: String,
      position: Position): T {
    return Context.fatalError('[$code] $message', position);
  }

  private function applied(type: Type, parameters: Array<TypeParameter>,
      arguments: Array<Type>): Type {
    return type.applyTypeParameters(parameters, arguments);
  }

  /** Conservatively reports whether React may interpret a value as callable. */
  private function mayBeCallable(type: Type, depth: Int = 0): Bool {
    if (depth > 32) return true;
    return switch type {
      case TMono(reference):
        final resolved = reference.get();
        resolved == null || mayBeCallable(resolved, depth + 1);
      case TLazy(resolve):
        mayBeCallable(resolve(), depth + 1);
      case TType(reference, arguments):
        final value = reference.get();
        mayBeCallable(applied(value.type, value.params, arguments), depth + 1);
      case TFun(_, _):
        true;
      case TDynamic(_):
        true;
      case TInst(reference, _):
        switch reference.get().kind {
          case KTypeParameter(_): true;
          case _: reference.get().meta.has(":callable");
        }
      case TAbstract(reference, arguments):
        final value = reference.get();
        if (value.module == "haxe.extern.EitherType"
            && value.name == "EitherType") {
          arguments.exists(argument -> mayBeCallable(argument, depth + 1));
        } else if (value.module == "StdTypes" && value.name == "Null"
            && arguments.length == 1) {
          mayBeCallable(arguments[0], depth + 1);
        } else if (value.meta.has(":callable")) {
          true;
        } else if (value.module == "StdTypes" || value.module == "String") {
          false;
        } else {
          mayBeCallable(applied(value.type, value.params, arguments), depth + 1);
        }
      case TAnonymous(_) | TEnum(_, _):
        false;
    }
  }

  private function hasUnresolvedBoundary(type: Type, depth: Int = 0): Bool {
    if (depth > 32) return true;
    return switch type {
      case TMono(reference):
        final resolved = reference.get();
        resolved == null || hasUnresolvedBoundary(resolved, depth + 1);
      case TLazy(resolve):
        hasUnresolvedBoundary(resolve(), depth + 1);
      case TDynamic(_):
        true;
      case TType(reference, arguments):
        final value = reference.get();
        hasUnresolvedBoundary(applied(value.type, value.params, arguments),
          depth + 1);
      case TFun(arguments, result):
        arguments.exists(argument ->
          hasUnresolvedBoundary(argument.t, depth + 1))
          || hasUnresolvedBoundary(result, depth + 1);
      case TInst(reference, arguments):
        switch reference.get().kind {
          case KTypeParameter(_): true;
          case _:
            arguments.exists(argument ->
              hasUnresolvedBoundary(argument, depth + 1));
        }
      case TEnum(_, arguments) | TAbstract(_, arguments):
        arguments.exists(argument ->
          hasUnresolvedBoundary(argument, depth + 1));
      case TAnonymous(reference):
        reference.get().fields.exists(field ->
          hasUnresolvedBoundary(field.type, depth + 1));
    }
  }

  /**
   * Resolves the imported `deps` function from the compiler's import table.
   *
   * The outer `useMemo`/`useCallback` macro receives its dependency expression
   * before the nested `deps` macro is typed, so typed-expression lookup would
   * execute the nested macro too early. Exact import provenance still avoids a
   * name heuristic and rejects a shadowing local.
   */
  private function isDependencyCallee(expression: Expr): Bool {
    final localName = switch expression.expr {
      case EConst(CIdent(value)): value;
      case _: return false;
    };
    if (Context.getLocalVars().exists(localName)) {
      return false;
    }
    final memberPath = ["genes", "react", "React", "deps"];
    final modulePath = ["genes", "react", "React"];
    for (entry in Context.getLocalImports()) {
      final path = entry.path.map(part -> part.name);
      switch entry.mode {
        case INormal if (path.join(".") == memberPath.join(".")
            && localName == "deps"):
          return true;
        case IAsName(alias) if (path.join(".") == memberPath.join(".")
            && localName == alias):
          return true;
        case IAll if (path.join(".") == modulePath.join(".")
            && localName == "deps"):
          return true;
        case _:
      }
    }
    return false;
  }

  private function dependencyArguments(expression: Expr,
      consumer: String): Array<Expr> {
    return switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner):
        dependencyArguments(inner, consumer);
      case ECall(callee, arguments) if (isDependencyCallee(callee)):
        arguments;
      case _:
        fail(DEPS_DIAGNOSTIC,
          'Semantic $consumer requires a direct deps(...) expression imported '
          + 'from genes.react.React '
          + 'so the emitted dependency list remains inline and constant-length.',
          expression.pos);
    }
  }

  private function identifier(name: String, position: Position): Expr {
    return {expr: EConst(CIdent(name)), pos: position};
  }

  private function directIdentifier(expression: Expr): Null<String> {
    return switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner):
        directIdentifier(inner);
      case EConst(CIdent(name)):
        name;
      case _:
        null;
    }
  }

  private function abstractIdentity(type: Type, moduleName: String,
      typeName: String, depth: Int = 0): Bool {
    if (depth > 32) return false;
    return switch type {
      case TMono(reference):
        final resolved = reference.get();
        resolved != null
          && abstractIdentity(resolved, moduleName, typeName, depth + 1);
      case TLazy(resolve):
        abstractIdentity(resolve(), moduleName, typeName, depth + 1);
      case TType(reference, arguments):
        final value = reference.get();
        abstractIdentity(
          applied(value.type, value.params, arguments),
          moduleName,
          typeName,
          depth + 1
        );
      case TAbstract(reference, _):
        final value = reference.get();
        value.module == moduleName && value.name == typeName;
      case _:
        false;
    }
  }

  private function isTupleProjection(expression: Expr): Bool {
    final owner = switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner):
        return isTupleProjection(inner);
      case EField(target, "value"):
        target;
      case _:
        return false;
    }
    final type = try Context.typeof(owner) catch (_: haxe.Exception) return true;
    return abstractIdentity(type, "genes.react.State", "State")
      || abstractIdentity(type, "genes.react.Optimistic", "Optimistic");
  }

  /**
   * Whether React's analyzer can compare the authored expression directly.
   *
   * Plain local and member chains remain recognizable after emission. Calls,
   * operators, array access, and zero-runtime tuple projections need one named
   * scalar shared by the calculation and dependency list.
   */
  private function isLintVisibleDependency(expression: Expr): Bool {
    return switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner):
        isLintVisibleDependency(inner);
      case EConst(CIdent(_)):
        true;
      case EField(owner, _) if (!isTupleProjection(expression)):
        isLintVisibleDependency(owner);
      case _:
        false;
    }
  }

  private function memoFunction(expression: Expr): Null<{
    kind: FunctionKind,
    value: Function
  }> {
    return switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner):
        memoFunction(inner);
      case EFunction(kind, value):
        {kind: kind, value: value};
      case _:
        null;
    }
  }

  private function snapshotDeclaration(argument: FunctionArg,
      dependency: Expr): Expr {
    return {
      expr: EVars([{
        name: argument.name,
        namePos: dependency.pos,
        type: argument.type,
        expr: dependency,
        isFinal: true,
        meta: null
      }]),
      pos: dependency.pos
    };
  }

  /**
   * Gives computed dependencies one exactly-once render-local identity.
   *
   * React lint needs the calculation body and dependency array to refer to the
   * same scalar. A calculation parameter names that scalar in Haxe source; the
   * macro moves the dependency expression into a final local and rewrites the
   * calculation to React's required zero-argument function.
   */
  private function snapshotMemo(calculate: Expr, dependencies: Array<Expr>,
      position: Position): {
        declarations: Array<Expr>,
        calculate: Expr,
        dependencies: Array<Expr>
      } {
    final callback = memoFunction(calculate);
    if (callback == null || callback.value.args.length == 0) {
      final complex = dependencies.find(dependency ->
        !isLintVisibleDependency(dependency));
      if (complex != null) {
        fail(SNAPSHOT_DIAGNOSTIC,
          "Computed memo dependencies need a named scalar shared by the "
          + "calculation and dependency list. Add one calculation parameter "
          + "for each dependency, for example "
          + "useMemo((current) -> current * 2, deps(state.value)).",
          complex.pos);
      }
      return {
        declarations: [],
        calculate: calculate,
        dependencies: dependencies
      };
    }
    if (callback.value.params.length != 0) {
      fail(SNAPSHOT_DIAGNOSTIC,
        "Dependency-parameter memo calculations cannot declare local type "
        + "parameters.",
        calculate.pos);
    }
    switch callback.kind {
      case FNamed(_, _):
        fail(SNAPSHOT_DIAGNOSTIC,
          "Dependency-parameter memo calculations cannot be named functions "
          + "because relocating their parameters would change recursive "
          + "calls. Use an anonymous function or arrow calculation.",
          calculate.pos);
      case FAnonymous | FArrow:
    }
    if (callback.value.args.length != dependencies.length) {
      fail(SNAPSHOT_DIAGNOSTIC,
        'Memo calculation declares ${callback.value.args.length} dependency '
        + 'parameter(s), but deps(...) supplies ${dependencies.length}. '
        + "Declare exactly one parameter for each dependency in the same "
        + "order.",
        calculate.pos);
    }

    final declarations: Array<Expr> = [];
    final snapshots: Array<Expr> = [];
    for (index in 0...dependencies.length) {
      final argument = callback.value.args[index];
      if (argument.opt || argument.value != null) {
        fail(SNAPSHOT_DIAGNOSTIC,
          'Memo dependency parameter `${argument.name}` cannot be optional '
          + "or have a default value.",
          calculate.pos);
      }
      final metadata = argument.meta;
      if (metadata != null && metadata.length != 0) {
        fail(SNAPSHOT_DIAGNOSTIC,
          'Memo dependency parameter `${argument.name}` cannot carry '
          + "parameter metadata or rest semantics because it becomes one "
          + "render-local scalar.",
          calculate.pos);
      }
      final dependency = dependencies[index];
      if (argument.type != null) {
        final actual = Context.typeof(dependency);
        final expected = Context.resolveType(argument.type, calculate.pos);
        if (abstractIdentity(expected, "haxe.Rest", "Rest")) {
          fail(SNAPSHOT_DIAGNOSTIC,
            'Memo dependency parameter `${argument.name}` cannot use rest '
            + "semantics because it represents exactly one dependency scalar.",
            calculate.pos);
        }
        if (!Context.unify(actual, expected)
            || !Context.unify(expected, actual)) {
          fail(SNAPSHOT_DIAGNOSTIC,
            'Memo dependency parameter `${argument.name}` expects exactly '
            + '${expected.toString()}, but its dependency has '
            + '${actual.toString()}.',
            dependency.pos);
        }
      }
      final sameBinding = argument.type == null
        && directIdentifier(dependency) == argument.name;
      if (!sameBinding) {
        declarations.push(snapshotDeclaration(argument, dependency));
      }
      snapshots.push(identifier(argument.name, dependency.pos));
    }

    final rewritten: Expr = {
      expr: EFunction(callback.kind, {
        args: [],
        ret: callback.value.ret,
        expr: callback.value.expr,
        params: []
      }),
      pos: calculate.pos
    };
    return {
      declarations: declarations,
      calculate: rewritten,
      dependencies: snapshots
    };
  }

  private function isNullLiteral(expression: Expr): Bool {
    return switch expression.expr {
      case EParenthesis(inner) | EMeta(_, inner) | ECheckType(inner, _)
          | ECast(inner, _):
        isNullLiteral(inner);
      case EConst(CIdent("null")):
        true;
      case _:
        false;
    }
  }

  /** Whether TypeScript would widen a closed Haxe enum abstract literal. */
  private function needsExplicitStateType(type: Type, depth: Int = 0): Bool {
    if (depth > 32) return false;
    return switch type {
      case TMono(reference):
        final resolved = reference.get();
        resolved != null && needsExplicitStateType(resolved, depth + 1);
      case TLazy(resolve):
        needsExplicitStateType(resolve(), depth + 1);
      case TType(reference, arguments):
        final value = reference.get();
        needsExplicitStateType(applied(value.type, value.params, arguments),
          depth + 1);
      case TAbstract(reference, _):
        reference.get().meta.has(":enum");
      case _:
        false;
    }
  }

  private function dependencyType(arguments: Array<Expr>,
      position: Position): ComplexType {
    if (arguments.length == 0) {
      return TPath({pack: ["genes", "react"], name: "NoDependency"});
    }
    final values: Array<ComplexType> = [];
    for (argument in arguments) {
      final type = Context.typeof(argument);
      if (hasUnresolvedBoundary(type)) {
        fail(DEPS_DIAGNOSTIC,
          "React.deps(...) requires every dependency to have a resolved, "
          + "closed Haxe type.",
          argument.pos);
      }
      final complex = type.toComplexType();
      if (complex == null) {
        fail(DEPS_DIAGNOSTIC,
          "React.deps(...) could not preserve a dependency's Haxe type.",
          argument.pos);
      }
      values.push(complex);
    }
    var result = values[values.length - 1];
    var index = values.length - 1;
    while (index > 0) {
      index--;
      result = TPath({
        pack: ["haxe", "extern"],
        name: "EitherType",
        params: [TPType(values[index]), TPType(result)]
      });
    }
    return result;
  }

  function useState(initial: Expr): Expr {
    final type = Context.typeof(initial);
    if (mayBeCallable(type)) {
      return fail(STATE_DIAGNOSTIC,
        "useState(value) received a value whose static type may be callable. "
        + "React would treat it as a lazy initializer; use "
        + "useStateLazy(() -> value) to store function-valued state.",
        initial.pos);
    }
    final position = Context.currentPos();
    return if (isNullLiteral(initial) || needsExplicitStateType(type)) {
      macro @:pos(position) genes.ts.TypeArguments.call(
        genes.react.ReactHookBindings.useStateContextual($initial), $initial);
    } else {
      macro @:pos(position)
        genes.react.ReactHookBindings.useStateValue($initial);
    }
  }

  function useStateLazy(initializer: Expr): Expr {
    final position = Context.currentPos();
    return macro @:pos(position)
      genes.react.ReactHookBindings.useStateLazy($initializer);
  }

  function useMemo(calculate: Expr, dependencies: Expr): Expr {
    final arguments = dependencyArguments(dependencies, "useMemo");
    final elementType = dependencyType(arguments, dependencies.pos);
    final snapshot = snapshotMemo(calculate, arguments, dependencies.pos);
    final dependencyList: ComplexType = TPath({
      pack: ["genes", "react"],
      name: "DependencyList",
      params: [TPType(elementType)]
    });
    final literal: Expr = {
      expr: EArrayDecl(snapshot.dependencies),
      pos: dependencies.pos
    };
    final checked: Expr = {
      expr: ECheckType(literal, dependencyList),
      pos: dependencies.pos
    };
    final position = Context.currentPos();
    final call = macro @:pos(position)
      genes.react.ReactHookBindings.useMemo(${snapshot.calculate}, $checked);
    if (snapshot.declarations.length == 0) return call;
    return {
      expr: EBlock(snapshot.declarations.concat([call])),
      pos: position
    };
  }

  function useCallback(callback: Expr,
      dependencies: Expr): Expr {
    final arguments = dependencyArguments(dependencies, "useCallback");
    final elementType = dependencyType(arguments, dependencies.pos);
    final dependencyList: ComplexType = TPath({
      pack: ["genes", "react"],
      name: "DependencyList",
      params: [TPType(elementType)]
    });
    final literal: Expr = {
      expr: EArrayDecl(arguments),
      pos: dependencies.pos
    };
    final checked: Expr = {
      expr: ECheckType(literal, dependencyList),
      pos: dependencies.pos
    };
    final position = Context.currentPos();
    return macro @:pos(position)
      genes.react.ReactHookBindings.useCallback($callback, $checked);
  }

  function useOptimistic(passthrough: Expr,
      reducer: Expr): Expr {
    final position = Context.currentPos();
    return macro @:pos(position)
      genes.react.ReactHookBindings.useOptimistic($passthrough, $reducer);
  }

  function deps(arguments: Array<Expr>): Expr {
    final position = arguments.length == 0
      ? Context.currentPos()
      : arguments[0].pos;
    return fail(DEPS_DIAGNOSTIC,
      "deps(...) is compile-time packaging and must appear directly inside "
      + "useMemo(...) or useCallback(...).",
      position);
  }

  function setState<Value>(state: ExprOf<State<Value>>,
      next: ExprOf<Value>): ExprOf<Void> {
    return if (mayBeCallable(Context.typeof(next))) {
      macro @:privateAccess $state.__setPossiblyCallable($next);
    } else {
      macro @:privateAccess $state.__setDirect($next);
    }
  }
#end
