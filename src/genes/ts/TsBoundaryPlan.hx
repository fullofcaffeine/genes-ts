package genes.ts;

#if macro
import genes.Module;
import genes.NullishContract;
import genes.util.TypeUtil;
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import haxe.macro.TypeTools;

using haxe.macro.TypedExprTools;

/**
 * How two compiler-known Haxe types differ at one value boundary.
 *
 * A boundary is a place where a value enters a declared destination, such as
 * an argument entering a function parameter or an expression entering a
 * return type. This relation is deliberately smaller than either Haxe's or
 * TypeScript's complete assignment rules. `NullabilityOnly` means every
 * corresponding part of both types is identical except for one or more Haxe
 * `Null<...>` wrappers. Any other difference makes the relation incompatible.
 */
enum TsBoundaryRelation {
  Identical;
  NullabilityOnly;
  Incompatible;
}

/**
 * Reviewed value destinations in Haxe's typed abstract syntax tree (AST).
 *
 * The typed AST is the compiler's structured program after Haxe has resolved
 * names and checked types. These site names let the plan identify the exact
 * parent slot without depending on generated TypeScript text.
 */
enum abstract TsBoundarySite(String) to String {
  var ReturnValue = "return-value";
  var VariableInitializer = "variable-initializer";
  var AssignmentRhs = "assignment-rhs";
  var CallArgument = "call-argument";
  var ConstructorArgument = "constructor-argument";
  var EnumConstructorArgument = "enum-constructor-argument";
}

/**
 * One Haxe-accepted value boundary that needs an explicit TypeScript type.
 *
 * The emitted `Register.unsafeCast<T>(value)` is an identity assertion: it
 * returns the same JavaScript value without converting or validating it at
 * runtime. Its only job is to tell TypeScript about the narrow conversion that
 * Haxe already accepted.
 */
class TsValueBridge {
  public final parent: TypedExpr;
  public final site: TsBoundarySite;
  public final source: TypedExpr;
  public final target: Type;
  public final pos: Position;

  public function new(parent: TypedExpr, site: TsBoundarySite,
      source: TypedExpr, target: Type) {
    this.parent = parent;
    this.site = site;
    this.source = source;
    this.target = target;
    this.pos = source.pos;
  }
}

/** One enum-constructor argument that needs the identity assertion above. */
class TsEnumArgumentBridge {
  public final index: Int;
  public final source: TypedExpr;
  public final target: Type;

  public function new(index: Int, source: TypedExpr, target: Type) {
    this.index = index;
    this.source = source;
    this.target = target;
  }
}

/**
 * One argument of an ordinary function call that needs an exact identity
 * assertion. `index` is its zero-based position in the call.
 */
class TsCallArgumentBridge {
  public final index: Int;
  public final source: TypedExpr;
  public final target: Type;

  public function new(index: Int, source: TypedExpr, target: Type) {
    this.index = index;
    this.source = source;
    this.target = target;
  }
}

/**
 * Planned argument types and assertions for one ordinary function call.
 *
 * Haxe has already accepted the call. This decision records only the narrow
 * case where the argument and parameter differ entirely by `Null` wrappers.
 * It is not a second, partial implementation of Haxe type checking.
 */
class TsCallDecision {
  public final call: TypedExpr;
  public final callee: TypedExpr;
  public final argumentTypes: Array<Type>;
  public final bridges: Array<TsCallArgumentBridge>;
  public final pos: Position;

  public function new(call: TypedExpr, callee: TypedExpr,
      argumentTypes: Array<Type>, bridges: Array<TsCallArgumentBridge>) {
    this.call = call;
    this.callee = callee;
    this.argumentTypes = argumentTypes.copy();
    this.bridges = bridges.copy();
    this.pos = call.pos;
  }

  public function bridgeAt(index: Int): Null<TsCallArgumentBridge> {
    for (bridge in bridges)
      if (bridge.index == index)
        return bridge;
    return null;
  }
}

/**
 * Planned argument types and assertions for one class construction.
 */
class TsConstructorDecision {
  public final expression: TypedExpr;
  public final argumentTypes: Array<Type>;
  public final bridges: Array<TsCallArgumentBridge>;
  public final pos: Position;

  public function new(expression: TypedExpr, argumentTypes: Array<Type>,
      bridges: Array<TsCallArgumentBridge>) {
    this.expression = expression;
    this.argumentTypes = argumentTypes.copy();
    this.bridges = bridges.copy();
    this.pos = expression.pos;
  }

  public function bridgeAt(index: Int): Null<TsCallArgumentBridge> {
    for (bridge in bridges)
      if (bridge.index == index)
        return bridge;
    return null;
  }
}

/**
 * One destination-driven enum-constructor application.
 *
 * In Haxe, the variable, return, or argument receiving an enum constructor can
 * determine generic types that do not appear in the constructor payload.
 * `parameters` records those destination-supplied enum types, `argumentTypes`
 * records the resulting constructor parameter types, and `bridges` contains
 * only Haxe-accepted identity conversions that strict TypeScript cannot infer
 * or assign.
 */
class TsEnumCallDecision {
  public final call: TypedExpr;
  public final callee: TypedExpr;
  public final parameters: Array<Type>;
  public final argumentTypes: Array<Type>;
  public final bridges: Array<TsEnumArgumentBridge>;
  public final pos: Position;

  public function new(call: TypedExpr, callee: TypedExpr,
      parameters: Array<Type>, argumentTypes: Array<Type>,
      bridges: Array<TsEnumArgumentBridge>) {
    this.call = call;
    this.callee = callee;
    this.parameters = parameters.copy();
    this.argumentTypes = argumentTypes.copy();
    this.bridges = bridges.copy();
    this.pos = call.pos;
  }

  public function bridgeAt(index: Int): Null<TsEnumArgumentBridge> {
    for (bridge in bridges)
      if (bridge.index == index)
        return bridge;
    return null;
  }

  /** Every type the TypeScript emitter may print for this decision. */
  public function referencedTypes(): Array<Type> {
    final result = parameters.copy();
    for (argument in argumentTypes)
      result.push(argument);
    for (bridge in bridges)
      result.push(bridge.target);
    return result;
  }
}

/** One type dependency introduced solely by a planned TypeScript boundary. */
typedef TsBoundaryReference = {
  final type: Type;
  final pos: Position;
  final rule: String;
}

/**
 * Immutable TypeScript-only decisions built from Haxe's checked program.
 *
 * Why: Haxe and strict TypeScript disagree at a small set of otherwise valid
 * value boundaries, especially when `Null<T>` appears inside a generic type.
 * A generated assertion can mention an imported type, so Genes must know every
 * assertion target before it chooses and freezes import bindings.
 *
 * What: this plan records the exact original expression, destination type, and
 * reviewed proof for each supported boundary. It stores Haxe compiler `Type`
 * values rather than already-printed TypeScript names.
 *
 * How: dependency planning first collects `referencedTypes()`. Expression
 * emission later looks up a decision by the same typed-AST object and only
 * prints that immutable decision. The emitter may not infer a new assertion
 * target or explicit generic argument after imports have been allocated.
 */
class TsBoundaryPlan {
  final enumCalls: ObjectMap<TypedExpr, TsEnumCallDecision>;
  final enumDecisions: Array<TsEnumCallDecision>;
  final calls: ObjectMap<TypedExpr, TsCallDecision>;
  final callDecisions: Array<TsCallDecision>;
  final constructors: ObjectMap<TypedExpr, TsConstructorDecision>;
  final constructorDecisions: Array<TsConstructorDecision>;
  final returnBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final initializerBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final assignmentBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final valueBridges: Array<TsValueBridge>;

  public static function build(module: Module): TsBoundaryPlan {
    return new TsBoundaryPlanBuilder().build(module);
  }

  /**
   * Exposes the deliberately narrow proof relation to compiler-owned macro
   * fixtures. Production planning and tests therefore exercise the same
   * fail-closed comparison instead of duplicating it.
   */
  public static function compareTypes(expected: Type,
      actual: Type): TsBoundaryRelation {
    return TsBoundaryPlanBuilder.compareBoundaryTypes(expected, actual);
  }

  /** Whether TypeScript directly accepts this outer nullish widening. */
  public static function acceptsTopLevelWidening(expected: Type,
      actual: Type): Bool {
    return TsBoundaryPlanBuilder.isTypeScriptAcceptedTopLevelWidening(expected,
      actual);
  }

  public function new(enumCalls: ObjectMap<TypedExpr, TsEnumCallDecision>,
      enumDecisions: Array<TsEnumCallDecision>,
      calls: ObjectMap<TypedExpr, TsCallDecision>,
      callDecisions: Array<TsCallDecision>,
      constructors: ObjectMap<TypedExpr, TsConstructorDecision>,
      constructorDecisions: Array<TsConstructorDecision>,
      returnBridges: ObjectMap<TypedExpr, TsValueBridge>,
      initializerBridges: ObjectMap<TypedExpr, TsValueBridge>,
      assignmentBridges: ObjectMap<TypedExpr, TsValueBridge>,
      valueBridges: Array<TsValueBridge>) {
    this.enumCalls = enumCalls;
    this.enumDecisions = enumDecisions.copy();
    this.calls = calls;
    this.callDecisions = callDecisions.copy();
    this.constructors = constructors;
    this.constructorDecisions = constructorDecisions.copy();
    this.returnBridges = returnBridges;
    this.initializerBridges = initializerBridges;
    this.assignmentBridges = assignmentBridges;
    this.valueBridges = valueBridges.copy();
  }

  /** Returns the decision for this exact typed callee occurrence. */
  public function enumCall(callee: TypedExpr): Null<TsEnumCallDecision> {
    return enumCalls.get(callee);
  }

  /** Returns the decision for this exact ordinary typed callee occurrence. */
  public function call(callee: TypedExpr): Null<TsCallDecision> {
    return calls.get(callee);
  }

  /** Returns the decision for this exact typed `new` expression. */
  public function constructor(expression: TypedExpr): Null<TsConstructorDecision> {
    return constructors.get(expression);
  }

  /** Returns the bridge for this exact typed `TReturn` occurrence. */
  public function returnBridge(expression: TypedExpr): Null<TsValueBridge> {
    return returnBridges.get(expression);
  }

  /** Returns a bridge keyed by the exact initializer expression. */
  public function initializerBridge(initializer: TypedExpr): Null<TsValueBridge> {
    return initializerBridges.get(initializer);
  }

  /** Returns the bridge for this exact typed assignment expression. */
  public function assignmentBridge(expression: TypedExpr): Null<TsValueBridge> {
    return assignmentBridges.get(expression);
  }

  /** Every planned type reference, in deterministic source order. */
  public function referencedTypes(): Array<TsBoundaryReference> {
    final result = new Array<TsBoundaryReference>();
    for (decision in enumDecisions)
      for (type in decision.referencedTypes())
        result.push({
          type: type,
          pos: decision.pos,
          rule: "enum-call"
        });
    for (decision in callDecisions)
      for (bridge in decision.bridges)
        result.push({
          type: bridge.target,
          pos: bridge.source.pos,
          rule: CallArgument
        });
    for (decision in constructorDecisions)
      for (bridge in decision.bridges)
        result.push({
          type: bridge.target,
          pos: bridge.source.pos,
          rule: ConstructorArgument
        });
    for (bridge in valueBridges)
      result.push({
        type: bridge.target,
        pos: bridge.pos,
        rule: bridge.site
      });
    return result;
  }
}

private class TsBoundaryPlanBuilder {
  static inline final MAX_TYPE_DEPTH = 64;

  final enumCalls = new ObjectMap<TypedExpr, TsEnumCallDecision>();
  final enumDecisions = new Array<TsEnumCallDecision>();
  final calls = new ObjectMap<TypedExpr, TsCallDecision>();
  final callDecisions = new Array<TsCallDecision>();
  final constructors = new ObjectMap<TypedExpr, TsConstructorDecision>();
  final constructorDecisions = new Array<TsConstructorDecision>();
  final returnBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final initializerBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final assignmentBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final valueBridges = new Array<TsValueBridge>();
  var narrowingPlan: Null<TsNarrowingPlan>;

  public function new() {}

  public function build(module: Module): TsBoundaryPlan {
    narrowingPlan = module.tsNarrowingPlan;
    for (member in module.members) {
      switch member {
        case MClass(classType, _, fields):
          for (field in fields)
            visit(field.expr, field.type, null);
          if (classType.init != null)
            visit(classType.init, classType.init.t, null);
        case MMain(expression):
          visit(expression, expression.t, null);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new TsBoundaryPlan(enumCalls, enumDecisions, calls, callDecisions,
      constructors, constructorDecisions, returnBridges, initializerBridges,
      assignmentBridges, valueBridges);
  }

  /**
   * Walks typed values with the exact destination supplied by their parent.
   *
   * A `TypedExpr` is one expression node in Haxe's already type-checked AST.
   * This is not a lowering or rewriting pass: it preserves those original node
   * identities and records decisions only for the reviewed parent slots.
   */
  function visit(expression: Null<TypedExpr>, expected: Null<Type>,
      currentReturn: Null<Type>): Void {
    if (expression == null)
      return;
    switch expression.expr {
      case TFunction(fn):
        visit(fn.expr, null, fn.t);
      case TReturn(value):
        if (value != null) {
          planValueBridge(expression, ReturnValue, value, currentReturn,
            returnBridges);
          visit(value, currentReturn, currentReturn);
        }
      case TVar(variable, initializer):
        if (initializer != null) {
          planValueBridge(expression, VariableInitializer, initializer,
            variable.t, initializerBridges, initializer);
          visit(initializer, variable.t, currentReturn);
        }
      case TBinop(OpAssign, left, right):
        planValueBridge(expression, AssignmentRhs, right, left.t,
          assignmentBridges);
        visit(left, null, currentReturn);
        visit(right, left.t, currentReturn);
      case TBinop(OpAssignOp(_), left, right):
        visit(left, null, currentReturn);
        visit(right, left.t, currentReturn);
      case TCall(callee, arguments):
        if (!planEnumCall(expression, callee, arguments, expected))
          planCall(expression, callee, arguments);
        visit(callee, null, currentReturn);
        final formal = callableArguments(callee.t);
        for (index in 0...arguments.length)
          visit(arguments[index], formal != null && index < formal.length ? formal[index].t : null,
            currentReturn);
      case TNew(owner, parameters, arguments):
        final formal = constructorArguments(owner.get(), parameters);
        planConstructor(expression, arguments, formal);
        for (index in 0...arguments.length)
          visit(arguments[index], formal != null && index < formal.length ? formal[index].t : null,
            currentReturn);
      case TIf(condition, thenValue, elseValue):
        visit(condition, null, currentReturn);
        visit(thenValue, expected, currentReturn);
        if (elseValue != null)
          visit(elseValue, expected, currentReturn);
      case TSwitch(condition, cases, defaultValue):
        visit(condition, null, currentReturn);
        for (entry in cases) {
          for (value in entry.values)
            visit(value, null, currentReturn);
          visit(entry.expr, expected, currentReturn);
        }
        if (defaultValue != null)
          visit(defaultValue, expected, currentReturn);
      case TTry(body, catches):
        visit(body, expected, currentReturn);
        for (entry in catches)
          visit(entry.expr, expected, currentReturn);
      case TBlock(values):
        for (index in 0...values.length)
          visit(values[index], index == values.length - 1 ? expected : null,
            currentReturn);
      case TParenthesis(inner) | TMeta(_, inner):
        visit(inner, expected, currentReturn);
      case TCast(inner, null):
        visit(inner, expected, currentReturn);
      case TArrayDecl(values):
        final element = arrayElement(expected);
        for (value in values)
          visit(value, element, currentReturn);
      default:
        expression.iter(child -> visit(child, null, currentReturn));
    }
  }

  function planEnumCall(call: TypedExpr, callee: TypedExpr,
      arguments: Array<TypedExpr>, expected: Null<Type>): Bool {
    final destination = expected == null ? call.t : expected;
    final application = TypeUtil.enumConstructorApplication(callee,
      destination);
    if (application == null)
      return false;
    // Keep the established `never` inference path for explicit null literals.
    // This first boundary-plan slice owns destination-driven non-null payloads.
    if (Lambda.exists(arguments, TypeUtil.isNullConstant))
      return true;

    final bridges = new Array<TsEnumArgumentBridge>();
    for (index in 0...arguments.length) {
      if (index >= application.argumentTypes.length)
        break;
      final target = application.argumentTypes[index];
      final source = erasedCastSource(arguments[index]);
      final relation = compareBoundaryTypes(target, source.t);
      final targetParameter = typeParameterIdentity(target);
      final sourceParameter = typeParameterIdentity(source.t);
      if ((relation == NullabilityOnly && !isKnownNonNull(arguments[index]))
        || (targetParameter != null && targetParameter != sourceParameter)) {
        if (!isTypeScriptAcceptedTopLevelWidening(target, source.t))
          bridges.push(new TsEnumArgumentBridge(index, source, target));
      }
    }

    final decision = new TsEnumCallDecision(call, callee,
      application.parameters, application.argumentTypes, bridges);
    enumCalls.set(callee, decision);
    enumDecisions.push(decision);
    return true;
  }

  /**
   * Plans nullability-only conversions for an ordinary function call.
   *
   * Compiler intrinsics and calls whose callee is itself a call keep their
   * specialized lowering paths. Planning them here could replace syntax such
   * as `js.Syntax.code(...)` with an ordinary TypeScript function call.
   */
  function planCall(call: TypedExpr, callee: TypedExpr,
      arguments: Array<TypedExpr>): Void {
    if (!supportsPlannedArgumentEmission(callee))
      return;
    final formal = callableArguments(callee.t);
    if (formal == null)
      return;

    final bridges = new Array<TsCallArgumentBridge>();
    final count = arguments.length < formal.length ? arguments.length : formal.length;
    for (index in 0...count) {
      final source = erasedCastSource(arguments[index]);
      if (compareBoundaryTypes(formal[index].t, source.t) == NullabilityOnly
        && !isTypeScriptAcceptedTopLevelWidening(formal[index].t, source.t)
        && !isKnownNonNull(arguments[index])) {
        bridges.push(new TsCallArgumentBridge(index, source, formal[index].t));
      }
    }
    if (bridges.length == 0)
      return;

    final decision = new TsCallDecision(call, callee,
      [for (argument in formal) argument.t], bridges);
    calls.set(callee, decision);
    callDecisions.push(decision);
  }

  function planValueBridge(parent: TypedExpr, site: TsBoundarySite,
      source: TypedExpr, target: Null<Type>,
      index: ObjectMap<TypedExpr, TsValueBridge>, ?key: TypedExpr): Void {
    if (target == null
      || compareBoundaryTypes(target, source.t) != NullabilityOnly
      || isTypeScriptAcceptedTopLevelWidening(target, source.t)
      || isKnownNonNull(source))
      return;
    final bridge = new TsValueBridge(parent, site, source, target);
    index.set(key == null ? parent : key, bridge);
    valueBridges.push(bridge);
  }

  function planConstructor(expression: TypedExpr, arguments: Array<TypedExpr>,
      formal: Null<Array<{
      name: String,
      opt: Bool,
      t: Type
    }>>): Void {
    if (formal == null)
      return;
    final bridges = new Array<TsCallArgumentBridge>();
    final count = arguments.length < formal.length ? arguments.length : formal.length;
    for (index in 0...count) {
      final source = erasedCastSource(arguments[index]);
      if (compareBoundaryTypes(formal[index].t, source.t) == NullabilityOnly
        && !isTypeScriptAcceptedTopLevelWidening(formal[index].t, source.t)
        && !isKnownNonNull(arguments[index])) {
        bridges.push(new TsCallArgumentBridge(index, source, formal[index].t));
      }
    }
    if (bridges.length == 0)
      return;
    final decision = new TsConstructorDecision(expression,
      [for (argument in formal) argument.t], bridges);
    constructors.set(expression, decision);
    constructorDecisions.push(decision);
    }

  function isKnownNonNull(source: TypedExpr): Bool {
    if (narrowingPlan == null)
      return false;
    if (narrowingPlan.isKnownNonNull(source))
      return true;
    final unwrapped = erasedCastSource(source);
    return unwrapped != source && narrowingPlan.isKnownNonNull(unwrapped);
  }

  /**
   * Returns true when TypeScript already accepts this outer absence widening.
   *
   * `T` assigns directly to `T | null`, and adding another outer Haxe
   * `Null<...>` wrapper does not add another TypeScript union member. The
   * explicit `Undefinable<T>` contract similarly emits `T | undefined`, which
   * already accepts a present `T`. Neither case needs an assertion.
   *
   * Nested generic changes are different: `Box<T>` may not assign to
   * `Box<T | null>` when `Box` both accepts and returns `T`.
   */
  public static function isTypeScriptAcceptedTopLevelWidening(expected: Type,
      actual: Type): Bool {
    final expectedNullish = NullishContract.forType(expected);
    final actualNullish = NullishContract.forType(actual);
    if (expectedNullish.preservesUndefined && !actualNullish.haxeAllowsNull)
      return true;

    var expectedInner = resolve(expected);
    var actualInner = resolve(actual);
    if (expectedInner == null || actualInner == null)
      return false;

    var expectedHadNull = false;
    while (nullableInner(expectedInner) != null) {
      expectedHadNull = true;
      expectedInner = resolve(nullableInner(expectedInner));
      if (expectedInner == null)
        return false;
    }
    while (nullableInner(actualInner) != null) {
      actualInner = resolve(nullableInner(actualInner));
      if (actualInner == null)
        return false;
    }
    return expectedHadNull
      && compareBoundaryTypes(expectedInner, actualInner) == Identical;
  }

  static function supportsPlannedArgumentEmission(callee: TypedExpr): Bool {
    return switch erasedCastSource(callee).expr {
      case TConst(TSuper):
        false;
      case TIdent('`trace' | "__resources__" | "__new__" | "__instanceof__" | "__typeof__" | "__strict_eq__" | "__strict_neq__" | "__define_feature__" | "__feature__"):
        false;
      case TCall(_, _):
        false;
      case TField(_,
        FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: _})):
        false;
      default:
        true;
    }
  }

  static function callableArguments(type: Type): Null<Array<{
    name: String,
    opt: Bool,
    t: Type
  }>> {
    return switch resolve(type) {
      case TFun(arguments, _): arguments;
      default: null;
    }
  }

  static function constructorArguments(owner: ClassType,
      parameters: Array<Type>): Null<Array<{
      name: String,
      opt: Bool,
      t: Type
    }>> {
    if (owner.constructor == null)
      return null;
    final applied = TypeTools.applyTypeParameters(owner.constructor.get()
      .type, owner.params, parameters);
    return callableArguments(applied);
    }

  static function arrayElement(type: Null<Type>): Null<Type> {
    if (type == null)
      return null;
    return switch resolve(type) {
      case TInst(reference, [element])
        if (reference.get()
          .pack.length == 0 && reference.get().name == "Array"):
        element;
      default:
        null;
    }
  }

  static function erasedCastSource(expression: TypedExpr): TypedExpr {
    return switch expression.expr {
      // A cast without an explicit target is a compiler-inserted type wrapper
      // with no runtime check. A cast with a target can perform a runtime type
      // check, so it must remain part of the emitted source expression.
      case TCast(inner, null) | TParenthesis(inner) | TMeta(_, inner):
        erasedCastSource(inner);
      default:
        expression;
    }
  }

  /**
   * Proves that every corresponding type path is identical or nullability-only.
   *
   * A "path" is a route through nested generic arguments. For example, the
   * second path in `Pair<String, Box<Null<Int>>>` reaches `Int` through the
   * pair's right argument and then the box's element argument. Every path must
   * match or differ only by a `Null` wrapper. One unrelated sibling makes the
   * whole relation incompatible.
   *
   * `Dynamic`, compiler types that have not finished resolving, function
   * variance, anonymous structures, and user-defined abstract conversions
   * fail closed: Genes records no assertion for them.
   */
  public static function compareBoundaryTypes(expected: Type, actual: Type,
      depth = 0): TsBoundaryRelation {
    if (depth > MAX_TYPE_DEPTH)
      return Incompatible;

    // Preserve an exact typedef identity before following its representation.
    // This matters for values such as `haxe.PosInfos`: both sides name the same
    // source type even though its representation is an anonymous object, which
    // this deliberately narrow relation does not otherwise compare.
    final expectedShell = resolveBoundaryShell(expected);
    final actualShell = resolveBoundaryShell(actual);
    if (expectedShell == null || actualShell == null)
      return Incompatible;
    final expectedShellNull = nullableInner(expectedShell);
    final actualShellNull = nullableInner(actualShell);
    if (expectedShellNull != null || actualShellNull != null) {
      final innerRelation = compareBoundaryTypes(expectedShellNull == null ? expectedShell : expectedShellNull,
        actualShellNull == null ? actualShell : actualShellNull, depth
        + 1);
      if (innerRelation == Incompatible)
        return Incompatible;
      return expectedShellNull != null
        && actualShellNull != null ? innerRelation : NullabilityOnly;
    }
    switch [expectedShell, actualShell] {
      case [TType(expectedRef,
        expectedParameters), TType(actualRef, actualParameters)]
        if (sameBaseIdentity(expectedRef.get(), actualRef.get())):
        return compareParameters(expectedParameters, actualParameters,
          depth + 1);
      default:
    }

    final expectedResolved = resolve(expected);
    final actualResolved = resolve(actual);
    if (expectedResolved == null || actualResolved == null)
      return Incompatible;

    final expectedNull = nullableInner(expectedResolved);
    final actualNull = nullableInner(actualResolved);
    if (expectedNull != null || actualNull != null) {
      final innerRelation = compareBoundaryTypes(expectedNull == null ? expectedResolved : expectedNull,
        actualNull == null ? actualResolved : actualNull, depth
        + 1);
      if (innerRelation == Incompatible)
        return Incompatible;
      // Matching `Null` wrappers are not a difference. Only insertion or
      // removal of a wrapper contributes a nullability boundary.
      return expectedNull != null
        && actualNull != null ? innerRelation : NullabilityOnly;
    }

    return switch [expectedResolved, actualResolved] {
      case [TInst(expectedRef,
        expectedParameters), TInst(actualRef, actualParameters)]:
        if (sameClassIdentity(expectedRef,
          actualRef)) compareParameters(expectedParameters, actualParameters,
            depth + 1) else {
          final projected = projectClassParameters(actualRef,
            actualParameters, expectedRef, new ObjectMap(), depth + 1);
          projected == null ? Incompatible : compareParameters(expectedParameters,
            projected, depth
            + 1);
        }
      case [TEnum(expectedRef,
        expectedParameters), TEnum(actualRef, actualParameters)]
        if (sameBaseIdentity(expectedRef.get(), actualRef.get())):
        compareParameters(expectedParameters, actualParameters, depth + 1);
      case [
        TAbstract(expectedRef, expectedParameters),
        TAbstract(actualRef, actualParameters)
      ] if (sameBaseIdentity(expectedRef.get(), actualRef.get())):
        compareParameters(expectedParameters, actualParameters, depth + 1);
      case [TAbstract(expectedRef, expectedParameters), _]
        if (!expectedRef.get().meta.has(":coreType")):
        // TypeEmitter projects an ordinary Haxe abstract through this exact
        // representation type. Comparing that representation is not approval
        // for an arbitrary @:from/@:to conversion.
        compareBoundaryTypes(TypeTools.applyTypeParameters(expectedRef.get()
          .type, expectedRef.get().params, expectedParameters),
          actualResolved, depth
          + 1);
      case [_, TAbstract(actualRef, actualParameters)]
        if (!actualRef.get().meta.has(":coreType")):
        compareBoundaryTypes(expectedResolved,
          TypeTools.applyTypeParameters(actualRef.get().type,
            actualRef.get().params, actualParameters),
          depth + 1);
      case [TFun(expectedArguments,
        expectedResult), TFun(actualArguments, actualResult)]:
        if (expectedArguments.length != actualArguments.length)
          Incompatible else {
          var relation: TsBoundaryRelation = Identical;
          for (index in 0...expectedArguments.length) {
            if (expectedArguments[index].opt != actualArguments[index].opt) {
              relation = Incompatible;
              break;
            }
            final argumentRelation = compareBoundaryTypes(expectedArguments[index].t,
              actualArguments[index].t, depth
              + 1);
            // Function variance is deliberately unsupported. Only exact
            // function siblings can participate inside another nominal type.
            if (argumentRelation != Identical) {
              relation = Incompatible;
              break;
            }
          }
          if (relation == Incompatible)
            Incompatible
          else
            compareBoundaryTypes(expectedResult, actualResult,
              depth + 1) == Identical ? Identical : Incompatible;
        }
      default:
        Incompatible;
    };
  }

  static function compareParameters(expected: Array<Type>,
      actual: Array<Type>, depth: Int): TsBoundaryRelation {
    if (expected.length != actual.length)
      return Incompatible;
    var sawNullability = false;
    for (index in 0...expected.length) {
      switch compareBoundaryTypes(expected[index], actual[index], depth + 1) {
        case Identical:
        case NullabilityOnly:
          sawNullability = true;
        case Incompatible:
          return Incompatible;
      }
    }
    return sawNullability ? NullabilityOnly : Identical;
  }

  static function projectClassParameters(actualRef: Ref<ClassType>,
      actualParameters: Array<Type>, expectedRef: Ref<ClassType>,
      seen: ObjectMap<ClassType, Bool>, depth: Int): Null<Array<Type>> {
    if (depth > MAX_TYPE_DEPTH)
      return null;
    final actual = actualRef.get();
    if (seen.exists(actual))
      return null;
    seen.set(actual, true);

    if (actual.superClass != null) {
      final relation = actual.superClass;
      final parameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actual.params,
            actualParameters)
      ];
      if (sameClassIdentity(relation.t, expectedRef))
        return parameters;
      final projected = projectClassParameters(relation.t, parameters,
        expectedRef, seen, depth + 1);
      if (projected != null)
        return projected;
    }

    for (relation in actual.interfaces) {
      final parameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actual.params,
            actualParameters)
      ];
      if (sameClassIdentity(relation.t, expectedRef))
        return parameters;
      final projected = projectClassParameters(relation.t, parameters,
        expectedRef, seen, depth + 1);
      if (projected != null)
        return projected;
    }
    return null;
  }

  static function resolve(type: Type): Null<Type> {
    return switch type {
      case TType(_, _) | TLazy(_):
        resolve(Context.follow(type));
      case TMono(reference):
        reference.get() == null ? null : resolve(reference.get());
      case TDynamic(_):
        null;
      default:
        type;
    }
  }

  /** Follows compiler wrappers without erasing a named typedef. */
  static function resolveBoundaryShell(type: Type): Null<Type> {
    return switch type {
      case TLazy(resolve):
        resolveBoundaryShell(resolve());
      case TMono(reference):
        reference.get() == null ? null : resolveBoundaryShell(reference.get());
      case TDynamic(_):
        null;
      default:
        type;
    }
  }

  static function nullableInner(type: Type): Null<Type> {
    return switch type {
      case TAbstract(reference, [inner])
        if (reference.get().pack.length == 0 && reference.get().name == "Null"):
        inner;
      default:
        null;
    }
  }

  static function sameClassIdentity(left: Ref<ClassType>,
      right: Ref<ClassType>): Bool {
    final leftType = left.get();
    final rightType = right.get();
    if (!sameBaseIdentity(leftType, rightType))
      return false;
    if (!leftType.kind.match(KTypeParameter(_))
      && !rightType.kind.match(KTypeParameter(_)))
      return true;
    return typeParameterIdentity(TInst(left,
      [])) == typeParameterIdentity(TInst(right, []));
  }

  static function sameBaseIdentity(left: BaseType, right: BaseType): Bool {
    return left.module == right.module && left.name == right.name;
  }

  /**
   * Correlates Haxe's re-encoded views of one generic type parameter.
   *
   * Why: superclass/interface substitution can expose the same logical
   * parameter through different `Ref<ClassType>` wrapper objects. Comparing
   * those wrappers physically loses checked conversions such as `T` to
   * `Null<T>`. What: the parameter's typed owner spelling and complete source
   * range form a request-local correlation key. How: this key never leaves the
   * immutable per-module plan and never identifies ordinary declarations or
   * survives a compiler-server request. The source range is a bounded Haxe
   * macro-API fallback here, not a general declaration-identity policy.
   */
  static function typeParameterIdentity(type: Type): Null<String> {
    return switch resolve(type) {
      case TInst(reference, [])
        if (reference.get().kind.match(KTypeParameter(_))):
        final parameter = reference.get();
        final position = Context.getPosInfos(parameter.pos);
        '${parameter.module}:${parameter.name}:${position.file}:${position.min}:${position.max}';
      default:
        null;
    }
  }
}
#end
