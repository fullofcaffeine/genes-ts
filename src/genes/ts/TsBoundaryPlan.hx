package genes.ts;

#if macro
import genes.Module;
import genes.NullishContract;
import genes.LocalBindingPlan;
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
  var RuntimeGuardedBinding = "runtime-guarded-binding";
}

/**
 * TypeScript-only projection for one Haxe runtime byte-cache read.
 *
 * The host declarations keep these properties optional because an arbitrary
 * JavaScript buffer has not necessarily passed through `haxe.io.Bytes`.
 * Haxe's JS runtime nevertheless has two narrower read contracts:
 *
 * - `hxBytes` is a nullable cached `Bytes` wrapper, so JavaScript `undefined`
 *   must first become Haxe `null` and then cross the typed boundary.
 * - `bufferValue` is read from the private storage of a typed `haxe.io.Bytes`
 *   instance, after the runtime has initialized it. TypeScript needs a
 *   presence assertion and the exact Haxe destination because Haxe writes an
 *   ArrayBuffer while hxnodejs writes a Uint8Array subclass.
 *
 * The optional `bytes` cache is intentionally not bridged. `Bytes.fastGet`
 * is normally inlined before Genes sees the typed AST, so an arbitrary
 * same-named native-buffer read cannot be proven to come from that API.
 */
enum TsRuntimeByteCacheReadAction {
  NullableWrapper(target: Type);
  InitializedValueAs(target: Type);
}

class TsRuntimeByteCacheRead {
  public final expression: TypedExpr;
  public final action: TsRuntimeByteCacheReadAction;
  public final pos: Position;

  public function new(expression: TypedExpr,
      action: TsRuntimeByteCacheReadAction) {
    this.expression = expression;
    this.action = action;
    this.pos = expression.pos;
  }
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

/**
 * One function literal assigned to an opaque native-host callback property.
 *
 * Haxe's generated WebIDL externs use `haxe.Constraints.Function` when they do
 * not describe a callback's parameters. TypeScript's host declarations can be
 * more specific. The assignment therefore uses the property's own TypeScript
 * type as the authority instead of inventing that host signature in Genes.
 */
class TsHostCallbackBridge {
  public final parent: TypedExpr;
  public final target: TypedExpr;
  public final source: TypedExpr;
  public final pos: Position;

  public function new(parent: TypedExpr, target: TypedExpr, source: TypedExpr) {
    this.parent = parent;
    this.target = target;
    this.source = source;
    this.pos = source.pos;
  }
}

/**
 * One typed local initialized after Haxe's opaque runtime type guard.
 *
 * Haxe lowers some typed catch arms to `Boot.__instanceof(raw, Target)` and
 * then initializes the catch variable from `raw`. TypeScript sees the helper
 * as an ordinary Boolean function, so it cannot recover the guarded type. The
 * bridge records Haxe's exact raw-local identity and target while the original
 * branch structure is still available.
 */
class TsRuntimeGuardBridge {
  public final source: TypedExpr;
  public final target: Type;
  public final pos: Position;

  public function new(source: TypedExpr, target: Type, pos: Position) {
    this.source = source;
    this.target = target;
    this.pos = pos;
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

/**
 * One generic enum constructor used as a function value.
 *
 * Haxe can use the receiving function type to determine enum parameters that
 * do not occur in a constructor's payload. TypeScript otherwise sees a bare
 * generic function and infers each missing parameter as `never`. `parameters`
 * records the exact destination-supplied application that the emitter writes
 * as a TypeScript instantiation expression such as `Choice.Left<A, B>`.
 */
class TsEnumReferenceDecision {
  public final expression: TypedExpr;
  public final parameters: Array<Type>;
  public final pos: Position;

  public function new(expression: TypedExpr, parameters: Array<Type>) {
    this.expression = expression;
    this.parameters = parameters.copy();
    this.pos = expression.pos;
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
  final enumReferences: ObjectMap<TypedExpr, TsEnumReferenceDecision>;
  final enumReferenceDecisions: Array<TsEnumReferenceDecision>;
  final calls: ObjectMap<TypedExpr, TsCallDecision>;
  final callDecisions: Array<TsCallDecision>;
  final constructors: ObjectMap<TypedExpr, TsConstructorDecision>;
  final constructorDecisions: Array<TsConstructorDecision>;
  final returnBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final initializerBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final assignmentBridges: ObjectMap<TypedExpr, TsValueBridge>;
  final hostCallbackBridges: ObjectMap<TypedExpr, TsHostCallbackBridge>;
  final runtimeGuardBridges: ObjectMap<TypedExpr, TsRuntimeGuardBridge>;
  final runtimeGuardDecisions: Array<TsRuntimeGuardBridge>;
  final runtimeByteCacheReads: ObjectMap<TypedExpr, TsRuntimeByteCacheRead>;
  final runtimeByteCacheReadDecisions: Array<TsRuntimeByteCacheRead>;
  final retaggedLocalReads: ObjectMap<TypedExpr, Bool>;
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

  /**
   * Reports whether two compiler types have the same declaration structure.
   *
   * Unlike `compareTypes`, this relation does not project a class through a
   * parent/interface or an ordinary abstract through its representation. It is
   * the fail-closed proof used for enum constructors passed as functions.
   */
  public static function hasExactTypeIdentity(expected: Type,
      actual: Type): Bool {
    return TsBoundaryPlanBuilder.compareExactTypes(expected, actual);
  }

  /** Whether TypeScript directly accepts this outer nullish widening. */
  public static function acceptsTopLevelWidening(expected: Type,
      actual: Type): Bool {
    return TsBoundaryPlanBuilder.isTypeScriptAcceptedTopLevelWidening(expected,
      actual);
  }

  /**
   * Whether this is Haxe's exact lowered caught-value unwrap sequence.
   *
   * Both boundary planning and local TypeScript annotation consume this one
   * typed-AST predicate. Keeping the recognition here prevents the emitter
   * from accepting a broader dynamic initializer than the guarded-binding
   * proof.
   */
  public static function isLoweredCatchUnwrap(expression: TypedExpr): Bool {
    return TsBoundaryPlanBuilder.isExceptionCaughtUnwrap(expression);
  }

  public function new(enumCalls: ObjectMap<TypedExpr, TsEnumCallDecision>,
      enumDecisions: Array<TsEnumCallDecision>,
      enumReferences: ObjectMap<TypedExpr, TsEnumReferenceDecision>,
      enumReferenceDecisions: Array<TsEnumReferenceDecision>,
      calls: ObjectMap<TypedExpr, TsCallDecision>,
      callDecisions: Array<TsCallDecision>,
      constructors: ObjectMap<TypedExpr, TsConstructorDecision>,
      constructorDecisions: Array<TsConstructorDecision>,
      returnBridges: ObjectMap<TypedExpr, TsValueBridge>,
      initializerBridges: ObjectMap<TypedExpr, TsValueBridge>,
      assignmentBridges: ObjectMap<TypedExpr, TsValueBridge>,
      hostCallbackBridges: ObjectMap<TypedExpr, TsHostCallbackBridge>,
      runtimeGuardBridges: ObjectMap<TypedExpr, TsRuntimeGuardBridge>,
      runtimeGuardDecisions: Array<TsRuntimeGuardBridge>,
      runtimeByteCacheReads: ObjectMap<TypedExpr, TsRuntimeByteCacheRead>,
      runtimeByteCacheReadDecisions: Array<TsRuntimeByteCacheRead>,
      retaggedLocalReads: ObjectMap<TypedExpr, Bool>,
      valueBridges: Array<TsValueBridge>) {
    this.enumCalls = enumCalls;
    this.enumDecisions = enumDecisions.copy();
    this.enumReferences = enumReferences;
    this.enumReferenceDecisions = enumReferenceDecisions.copy();
    this.calls = calls;
    this.callDecisions = callDecisions.copy();
    this.constructors = constructors;
    this.constructorDecisions = constructorDecisions.copy();
    this.returnBridges = returnBridges;
    this.initializerBridges = initializerBridges;
    this.assignmentBridges = assignmentBridges;
    this.hostCallbackBridges = hostCallbackBridges;
    this.runtimeGuardBridges = runtimeGuardBridges;
    this.runtimeGuardDecisions = runtimeGuardDecisions.copy();
    this.runtimeByteCacheReads = runtimeByteCacheReads;
    this.runtimeByteCacheReadDecisions = runtimeByteCacheReadDecisions.copy();
    this.retaggedLocalReads = retaggedLocalReads;
    this.valueBridges = valueBridges.copy();
  }

  /** Returns the decision for this exact typed callee occurrence. */
  public function enumCall(callee: TypedExpr): Null<TsEnumCallDecision> {
    return enumCalls.get(callee);
  }

  /** Returns the decision for this exact enum-constructor function value. */
  public function enumReference(expression: TypedExpr): Null<TsEnumReferenceDecision> {
    return enumReferences.get(expression);
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

  /** Returns the exact native-host callback decision for this assignment. */
  public function hostCallbackBridge(expression: TypedExpr): Null<TsHostCallbackBridge> {
    return hostCallbackBridges.get(expression);
  }

  /** Returns the opaque-guard decision for this exact local initializer. */
  public function runtimeGuardBridge(initializer: TypedExpr): Null<TsRuntimeGuardBridge> {
    return runtimeGuardBridges.get(initializer);
  }

  /** Returns the exact Haxe runtime byte-cache decision for this field read. */
  public function runtimeByteCacheRead(expression: TypedExpr): Null<TsRuntimeByteCacheRead> {
    return runtimeByteCacheReads.get(expression);
  }

  /**
   * Whether Haxe retagged this exact read of a nullable local as non-null.
   *
   * The local declaration deliberately stays nullable. Only this original
   * typed-AST read may receive TypeScript's compile-time-only `!` assertion.
   */
  public function localReadNeedsNonNullAssertion(expression: TypedExpr): Bool {
    return retaggedLocalReads.exists(expression);
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
    for (decision in enumReferenceDecisions)
      for (type in decision.parameters)
        result.push({
          type: type,
          pos: decision.pos,
          rule: "enum-reference"
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
    for (bridge in runtimeGuardDecisions)
      result.push({
        type: bridge.target,
        pos: bridge.pos,
        rule: RuntimeGuardedBinding
      });
    for (decision in runtimeByteCacheReadDecisions)
      switch decision.action {
        case NullableWrapper(target):
          result.push({
            type: target,
            pos: decision.pos,
            rule: "runtime-byte-cache-read"
          });
        case InitializedValueAs(target):
          result.push({
            type: target,
            pos: decision.pos,
            rule: "runtime-byte-cache-read"
          });
      }
    return result;
  }
}

private class TsBoundaryPlanBuilder {
  static inline final MAX_TYPE_DEPTH = 64;

  final enumCalls = new ObjectMap<TypedExpr, TsEnumCallDecision>();
  final enumDecisions = new Array<TsEnumCallDecision>();
  final enumReferences = new ObjectMap<TypedExpr, TsEnumReferenceDecision>();
  final enumReferenceDecisions = new Array<TsEnumReferenceDecision>();
  final calls = new ObjectMap<TypedExpr, TsCallDecision>();
  final callDecisions = new Array<TsCallDecision>();
  final constructors = new ObjectMap<TypedExpr, TsConstructorDecision>();
  final constructorDecisions = new Array<TsConstructorDecision>();
  final returnBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final initializerBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final assignmentBridges = new ObjectMap<TypedExpr, TsValueBridge>();
  final hostCallbackBridges = new ObjectMap<TypedExpr, TsHostCallbackBridge>();
  final runtimeGuardBridges = new ObjectMap<TypedExpr, TsRuntimeGuardBridge>();
  final runtimeGuardDecisions = new Array<TsRuntimeGuardBridge>();
  final runtimeByteCacheReads = new ObjectMap<TypedExpr,
    TsRuntimeByteCacheRead>();
  final runtimeByteCacheReadDecisions = new Array<TsRuntimeByteCacheRead>();
  final retaggedLocalReads = new ObjectMap<TypedExpr, Bool>();
  final prototypeBackedLocals = new Map<Int, Type>();
  // Haxe lowering can clone TVar wrapper objects. The compiler-assigned id is
  // the stable, function-local identity also used by Genes' name/flow plans.
  final exceptionUnwrapLocals = new Map<Int, Bool>();
  final valueBridges = new Array<TsValueBridge>();
  var narrowingPlan: Null<TsNarrowingPlan>;
  var localBindingPlan: Null<LocalBindingPlan>;
  var currentOwnerModule: Null<String>;
  var currentOwnerName: Null<String>;
  var currentFieldName: Null<String>;

  public function new() {}

  public function build(module: Module): TsBoundaryPlan {
    narrowingPlan = module.tsNarrowingPlan;
    localBindingPlan = module.localBindingPlan;
    for (member in module.members) {
      switch member {
        case MClass(classType, _, fields):
          currentOwnerModule = classType.module;
          currentOwnerName = classType.name;
          for (field in fields) {
            currentFieldName = field.name;
            visit(field.expr, field.type, null);
          }
          currentFieldName = null;
          if (classType.init != null)
            visit(classType.init, classType.init.t, null);
          currentOwnerModule = null;
          currentOwnerName = null;
        case MMain(expression):
          currentOwnerModule = null;
          currentOwnerName = null;
          currentFieldName = null;
          visit(expression, expression.t, null);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new TsBoundaryPlan(enumCalls, enumDecisions, enumReferences,
      enumReferenceDecisions, calls, callDecisions, constructors,
      constructorDecisions, returnBridges, initializerBridges,
      assignmentBridges, hostCallbackBridges, runtimeGuardBridges,
      runtimeGuardDecisions, runtimeByteCacheReads,
      runtimeByteCacheReadDecisions, retaggedLocalReads, valueBridges);
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
      case TLocal(variable):
        planRetaggedLocalRead(expression, variable);
      case TField(_, FEnum(_, _)):
        planEnumReference(expression, expected);
      case TFunction(fn):
        visit(fn.expr, null, fn.t);
      case TReturn(value):
        if (value != null) {
          if (!planPrototypeBackedReturn(expression, value, currentReturn))
            planValueBridge(expression, ReturnValue, value, currentReturn,
              returnBridges);
          visit(value, currentReturn, currentReturn);
        }
      case TVar(variable, initializer):
        if (initializer != null) {
          if (isExceptionCaughtUnwrap(initializer))
            exceptionUnwrapLocals.set(variable.id, true);
          final prototypeTarget = isCurrentField("js.node.buffer.Buffer",
            "Helper",
            "bytesOfBuffer") ? prototypeCreatedType(initializer) : null;
          if (prototypeTarget != null)
            prototypeBackedLocals.set(variable.id, prototypeTarget);
          planValueBridge(expression, VariableInitializer, initializer,
            variable.t, initializerBridges, initializer);
          visit(initializer, variable.t, currentReturn);
        }
      case TBinop(OpAssign, left, right):
        if (!planHostCallbackBridge(expression, left, right))
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
        final guard = opaqueRuntimeGuard(condition);
        if (guard != null)
          planImmediateRuntimeGuardedBinding(thenValue, guard.raw,
            guard.target, thenValue.pos);
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
      case TField(receiver, field):
        planRuntimeByteCacheRead(expression, receiver, field, expected);
        visit(receiver, null, currentReturn);
      default:
        expression.iter(child -> visit(child, null, currentReturn));
    }
  }

  /**
   * Preserves a non-null fact attached to one read of a nullable local.
   *
   * Why: inline expansion can introduce a temporary to evaluate a receiver
   * once before evaluating a side-effectful argument. Haxe keeps the
   * temporary's declaration nullable, but its checked AST can retag the exact
   * later `TLocal` read as the non-null payload type. TypeScript sees only the
   * nullable declaration and otherwise reports that the temporary may be
   * `null`.
   *
   * For example, Haxe can lower this:
   *
   * ```haxe
   * receiver.push(build(value));
   * ```
   *
   * into the equivalent typed sequence:
   *
   * ```haxe
   * var temporary:Null<Receiver> = receiver;
   * var built = build(value);
   * temporary.push(built); // this read is typed as Receiver
   * ```
   *
   * What: record only that exact read node. The emitted declaration remains
   * `Receiver | null`; assignment targets and other reads do not inherit the
   * decision.
   *
   * How: require an ordinary Haxe `Null<T>` declaration, a read that no longer
   * permits null, and exact type identity between the read and the declaration
   * after removing only its outer Haxe `Null`. Dynamic, Unknown,
   * Undefinable, and unresolved types fail closed. Existing flow facts also
   * take precedence so Genes does not print a redundant assertion.
   */
  function planRetaggedLocalRead(expression: TypedExpr, variable: TVar): Void {
    final declared = NullishContract.forType(variable.t);
    final read = NullishContract.forType(expression.t);
    if (!declared.haxeAllowsNull
      || declared.preservesUndefined
      || declared.dynamicBoundary
      || read.haxeAllowsNull
      || read.preservesUndefined
      || read.dynamicBoundary
      || !compareExactTypes(expression.t,
        NullishContract.stripHaxeNull(variable.t))
      || isKnownNonNull(expression))
      return;

    retaggedLocalReads.set(expression, true);
  }

  /**
   * Plans the two private cache reads whose runtime provenance survives in
   * the typed AST produced from Haxe's JS `Bytes` implementation.
   *
   * Why: the ambient declarations must keep the fields optional for arbitrary
   * native buffers, but Haxe's untyped standard-library code carries a
   * stronger contract at specific reads. A nullable `hxBytes` lookup observes
   * an absent JavaScript property as Haxe `null`; a `bufferValue` read from a
   * typed `Bytes` object's private storage follows its initialized backing
   * buffer. The third cache, `bytes`, is declared but deliberately not planned
   * because normal inlining erases the `Bytes.fastGet` call identity.
   *
   * How: require the original untyped `FDynamic` access, the exact property
   * name, and the compiler-owned API that establishes its meaning.
   * `hxBytes` is limited to Haxe's `Bytes.ofData`; `bufferValue` must be read
   * from the exact private storage field of a typed `haxe.io.Bytes` instance.
   * A same-named read from a fresh native buffer has no proof and therefore
   * receives no decision.
   */
  function planRuntimeByteCacheRead(expression: TypedExpr,
      receiver: TypedExpr, field: FieldAccess, expected: Null<Type>): Void {
    final name = switch field {
      case FDynamic(value): value;
      default: return;
    };

    final action: Null<TsRuntimeByteCacheReadAction> = switch name {
      case "hxBytes"
        if (isCurrentField("haxe.io.Bytes", "Bytes", "ofData")
          && isArrayBufferStorage(receiver.t)):
        if (expected != null && isNullableHaxeBytes(expected))
          NullableWrapper(expected) else null;
      case "bufferValue"
        if (isUint8ArrayStorage(receiver.t)
          && isHaxeBytesStorageField(receiver)):
        final target = expected == null ? expression.t : expected;
        if (isExactArrayBuffer(target)) InitializedValueAs(target) else null;
      default:
        null;
    };
    if (action == null)
      return;

    final decision = new TsRuntimeByteCacheRead(expression, action);
    runtimeByteCacheReads.set(expression, decision);
    runtimeByteCacheReadDecisions.push(decision);
  }

  static function isNullableHaxeBytes(type: Type): Bool {
    final contract = NullishContract.forType(type);
    if (!contract.haxeAllowsNull || contract.preservesUndefined)
      return false;
    return isExactHaxeBytes(NullishContract.stripHaxeNull(type));
  }

  static function isExactHaxeBytes(type: Type): Bool {
    return switch resolve(type) {
      case TInst(_.get() => {module: "haxe.io.Bytes", name: "Bytes"}, []):
        true;
      default:
        false;
    }
  }

  static function isArrayBufferStorage(type: Type): Bool {
    return isClassOrSubclass(type, "js.lib.ArrayBuffer", "ArrayBuffer");
  }

  static function isExactArrayBuffer(type: Type): Bool {
    return switch resolve(type) {
      case TInst(_.get() => {
        module: "js.lib.ArrayBuffer",
        name: "ArrayBuffer"
      }, []):
        true;
      default:
        false;
    }
  }

  static function isUint8ArrayStorage(type: Type): Bool {
    return isClassOrSubclass(type, "js.lib.Uint8Array", "Uint8Array");
  }

  function isCurrentField(module: String, owner: String, field: String): Bool {
    return currentOwnerModule == module && currentOwnerName == owner
      && currentFieldName == field;
  }

  static function isHaxeBytesStorageField(expression: TypedExpr): Bool {
    return switch erasedCastSource(expression).expr {
      case TField(_,
        FInstance(_.get() => {module: "haxe.io.Bytes", name: "Bytes"}, _,
          _.get() => field)):
        TypeUtil.classFieldName(field) == "b";
      default:
        false;
    }
  }

  static function isClassOrSubclass(type: Type, module: String, name: String,
      depth = 0): Bool {
    if (depth > MAX_TYPE_DEPTH)
      return false;
    return switch type {
      case TType(_, _) | TLazy(_):
        isClassOrSubclass(Context.follow(type), module, name, depth + 1);
      case TMono(reference) if (reference.get() != null):
        isClassOrSubclass(reference.get(), module, name, depth + 1);
      case TInst(reference, _):
        final owner = reference.get();
        if (owner.module == module && owner.name == name) true; else
          if (owner.superClass != null) {
          final parentType = TInst(owner.superClass.t, owner.superClass.params);
          isClassOrSubclass(parentType, module, name, depth + 1);
        } else false;
      default:
        false;
    }
  }

  /**
   * Bridges a local created from the exact prototype of its return class.
   *
   * hxnodejs constructs a zero-copy `Bytes` wrapper with
   * `Object.create(Bytes.prototype)`, fills its storage fields, then returns
   * that same local. JavaScript therefore has the correct runtime prototype,
   * but TypeScript sees only the anonymous fields assigned afterward. This
   * proof records the identity assertion only when the created prototype and
   * declared return type are exactly `haxe.io.Bytes`. Other
   * `Object.create(Target.prototype)` patterns remain outside this
   * byte-runtime compatibility rule.
   */
  function planPrototypeBackedReturn(parent: TypedExpr, source: TypedExpr,
      target: Null<Type>): Bool {
    if (target == null)
      return false;
    final local = switch erasedCastSource(source).expr {
      case TLocal(variable): variable;
      default: return false;
    };
    final prototypeType = prototypeBackedLocals.get(local.id);
    if (prototypeType == null
      || !compareExactTypes(target, prototypeType)
      || localBindingPlan == null
      || localBindingPlan.isReassigned(local))
      return false;

    final bridge = new TsValueBridge(parent, ReturnValue, source, target);
    returnBridges.set(parent, bridge);
    valueBridges.push(bridge);
    return true;
  }

  static function prototypeCreatedType(expression: TypedExpr): Null<Type> {
    return switch erasedCastSource(expression).expr {
      case TCall(callee, [prototype]) if (isObjectCreate(callee)):
        final target = prototypeOwnerType(prototype);
        if (target != null && isExactHaxeBytes(target)) target else null;
      default:
        null;
    }
  }

  static function isObjectCreate(callee: TypedExpr): Bool {
    return switch erasedCastSource(callee).expr {
      case TField(_,
        FStatic(_.get() => {module: "js.lib.Object", name: "Object"},
          _.get() => field)):
        TypeUtil.classFieldName(field) == "create";
      default:
        false;
    }
  }

  static function prototypeOwnerType(expression: TypedExpr): Null<Type> {
    return switch erasedCastSource(expression).expr {
      case TField(owner, field) if (TypeUtil.fieldName(field) == "prototype"):
        switch erasedCastSource(owner).expr {
          case TTypeExpr(moduleType = TClassDecl(_)):
            DependencyPlan.moduleTypeToType(moduleType);
          default:
            null;
        }
      default:
        null;
    }
  }

  /**
   * Plans an enum constructor that Haxe has accepted as a function value.
   *
   * The expected callable's result selects the enum application. Requiring the
   * constructor's complete checked function type to match that expected
   * callable keeps this rule deliberately narrow: optionality differences,
   * function variance, nullability bridges, unresolved types, and unrelated
   * callable conversions remain visible to TypeScript.
   */
  function planEnumReference(expression: TypedExpr,
      expected: Null<Type>): Void {
    final expectedCallable = callableArgumentsAndReturn(expected);
    if (expectedCallable == null)
      return;
    final application = TypeUtil.enumConstructorApplication(expression,
      expectedCallable.result);
    if (application == null || !compareExactTypes(expected, expression.t))
      return;

    final decision = new TsEnumReferenceDecision(expression,
      application.parameters);
    enumReferences.set(expression, decision);
    enumReferenceDecisions.push(decision);
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

  static function callableArgumentsAndReturn(type: Null<Type>): Null<{
    arguments: Array<{name: String, opt: Bool, t: Type}>,
    result: Type
  }> {
    if (type == null)
      return null;
    return switch resolveBoundaryShell(type) {
      case TFun(arguments, result):
        {arguments: arguments, result: result};
      default:
        null;
    }
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

  /**
   * Plans an assignment to an opaque callback slot on a JavaScript host extern.
   *
   * The left side must be a stable local field such as `reader.onerror`.
   * TypeScript permits that entity name in a type query (`typeof
   * reader.onerror`) without evaluating `reader` again. Restricting the rule to
   * exact `js.*` native extern ownership and Haxe's opaque Function constraint
   * keeps ordinary user properties and concrete callback signatures out.
   *
   * A local has two relevant types here. Its declaration records every value
   * the binding may hold, while one typed occurrence may be retagged after
   * Haxe inlines a call. Both must already exclude null: a non-null assertion
   * is legal in value code (`reader!.onerror`) but cannot appear in the bare
   * entity name required by a TypeScript type query.
   */
  function planHostCallbackBridge(parent: TypedExpr, target: TypedExpr,
      value: TypedExpr): Bool {
    final source = erasedCastSource(value);
    if (!source.expr.match(TFunction(_)))
      return false;
    return switch target.expr {
      case TField(receiver = {expr: TLocal(_)}, FInstance(owner, _, field)):
        if (isNativeJavaScriptHostExtern(owner.get())
          && isOpaqueHaxeFunction(field.get().type)
          && isBareTypeQueryReceiver(receiver)
          && !hasAuthoredTypeOverride(field.get())) {
          hostCallbackBridges.set(parent,
            new TsHostCallbackBridge(parent, target, source));
          true;
        } else false;
      default:
        false;
    }
  }

  static function isNativeJavaScriptHostExtern(owner: ClassType): Bool {
    return
      owner.isExtern // `@:native` can rewrite `ClassType.pack` to the runtime path. The
      // canonical Haxe module remains the stable source identity.
      && StringTools.startsWith(owner.module, "js.")
      && owner.meta.has(":native")
      && !owner.meta.has(":jsRequire");
  }

  static function isOpaqueHaxeFunction(type: Type): Bool {
    return switch resolveBoundaryShell(type) {
      case TAbstract(reference, _): final abstractType = reference.get(); abstractType.module == "haxe.Constraints" && abstractType.name == "Function";
      default:
        false;
    }
  }

  static function isBareTypeQueryReceiver(receiver: TypedExpr): Bool {
    return switch receiver.expr {
      case TLocal(variable): isBareTypeQueryReceiverType(receiver.t) && isBareTypeQueryReceiverType(variable.t);
      default:
        false;
    }
  }

  static function isBareTypeQueryReceiverType(type: Type): Bool {
    final contract = NullishContract.forType(type);
    return !contract.emittedAllowsNull
      && !contract.preservesUndefined
      && !contract.unknownBoundary
      && !contract.dynamicBoundary;
  }

  static function hasAuthoredTypeOverride(field: ClassField): Bool {
    return field.meta.has(":ts.type") || field.meta.has(":genes.type");
  }

  /**
   * Recognizes Haxe's lowered typed-catch guard from compiler identities.
   *
   * Why: `js.Boot.__instanceof` returns only `Bool` in its TypeScript surface,
   * so TypeScript cannot narrow the checked value. Haxe nevertheless emits the
   * helper after unwrapping a caught value and uses its true branch as the
   * authority for the typed catch variable.
   *
   * What/How: require the exact `js.Boot.__instanceof` field, an exact local
   * previously initialized by `haxe.Exception.caught(...).unwrap()`, and a
   * class or enum type expression. Printed helper names, arbitrary Boolean
   * predicates, and ordinary dynamic locals do not qualify.
   */
  function opaqueRuntimeGuard(condition: TypedExpr): Null<{
    raw: TVar,
    target: Type
  }> {
    return switch erasedCastSource(condition).expr {
      case TCall(callee, [rawExpression, targetExpression]):
        final moduleType = runtimeGuardTarget(targetExpression);
        switch erasedCastSource(rawExpression).expr {
          case TLocal(raw):
            if (isBootInstanceof(callee)
              && exceptionUnwrapLocals.exists(raw.id) && moduleType != null) {
                raw: raw,
                target: DependencyPlan.moduleTypeToType(moduleType)
              } else null;
          default:
            null;
        }
      default:
        null;
    }
  }

  /**
   * Extracts only the class/enum value passed as a runtime guard target.
   *
   * Haxe casts that type expression to `Dynamic` because
   * `Boot.__instanceof` accepts a dynamic second argument. Unwrapping is safe
   * only after proving the innermost expression is still an exact type value;
   * this helper must never be reused to erase ordinary value casts.
   */
  static function runtimeGuardTarget(expression: TypedExpr): Null<ModuleType> {
    return switch expression.expr {
      case TTypeExpr(moduleType = TClassDecl(_) | TEnumDecl(_)):
        moduleType;
      case TCast(inner, _) | TParenthesis(inner) | TMeta(_, inner):
        runtimeGuardTarget(inner);
      default:
        null;
    }
  }

  static function isBootInstanceof(callee: TypedExpr): Bool {
    switch erasedCastSource(callee).expr {
      case TField(_, FStatic(owner, field)):
        final ownerType = owner.get();
        final fieldName = field.get().name;
        return ownerType.module == "js.Boot" && ownerType.name == "Boot"
          && fieldName == "__instanceof";
      default:
        return false;
    }
  }

  public static function isExceptionCaughtUnwrap(expression: TypedExpr): Bool {
    return switch erasedCastSource(expression).expr {
      case TCall(unwrapCallee, []) if (isExceptionUnwrapCallee(unwrapCallee)):
        true;
      default:
        false;
    }
  }

  static function isExceptionUnwrapCallee(callee: TypedExpr): Bool {
    return switch erasedCastSource(callee).expr {
      case TField(receiver,
        FInstance(_, _, field) | FStatic(_, field) | FAnon(field))
        if (TypeUtil.classFieldName(field.get()) == "unwrap"):
        isExceptionCaughtCall(receiver);
      default:
        false;
    }
  }

  static function isExceptionCaughtCall(expression: TypedExpr): Bool {
    return switch erasedCastSource(expression).expr {
      case TCall(caughtCallee, [_]):
        switch erasedCastSource(caughtCallee).expr {
          case TField(_,
            FStatic(_.get() => {module: "haxe.Exception", name: "Exception"},
              _.get() => {name: "caught"})):
            true;
          default:
            false;
        }
      default:
        false;
    }
  }

  /**
   * Plans only Haxe's immediate lowered binding in the guard's true branch.
   *
   * Why: walking arbitrary later statements would require a complete
   * side-effect analysis. A closure can capture and replace the guarded local,
   * then be called before a later binding without exposing a direct assignment
   * at that call site. Treating the later binding as still guarded would hide a
   * real strict-TypeScript error behind an unsound assertion.
   *
   * What/How: Haxe's typed-catch lowering places the typed local first in the
   * successful branch. Follow only transparent block/metadata wrappers to that
   * first expression, require the exact guarded raw local and target type, and
   * stop. User-authored statements, nested functions, writes, calls, and
   * branches before a binding therefore fail closed.
   */
  function planImmediateRuntimeGuardedBinding(expression: TypedExpr,
      raw: TVar, target: Type, guardPos: Position): Void {
    switch expression.expr {
      case TVar(variable, initializer):
        if (initializer != null) {
          final source = runtimeGuardedSource(initializer, raw);
          if (source != null
            && compareBoundaryTypes(variable.t, target) == Identical) {
            final bridge = new TsRuntimeGuardBridge(source, target, guardPos);
            runtimeGuardBridges.set(initializer, bridge);
            runtimeGuardDecisions.push(bridge);
          }
        }
      case TBlock(expressions):
        if (expressions.length > 0)
          planImmediateRuntimeGuardedBinding(expressions[0], raw, target,
            guardPos);
      case TParenthesis(inner) | TMeta(_, inner):
        planImmediateRuntimeGuardedBinding(inner, raw, target, guardPos);
      default:
    }
  }

  /**
   * Returns the guarded raw local beneath Haxe's typed-catch cast.
   *
   * The cast is compiler-authored evidence about the catch variable, but
   * emitting it directly does not help TypeScript because the source remains
   * broad. This unwrapping is confined to the already-proved guard branch and
   * requires the exact guarded `TVar`; arbitrary casts never enter the plan.
   */
  static function runtimeGuardedSource(expression: TypedExpr,
      raw: TVar): Null<TypedExpr> {
    return switch expression.expr {
      case TLocal(candidate) if (candidate.id == raw.id):
        expression;
      case TCast(inner, _) | TParenthesis(inner) | TMeta(_, inner):
        runtimeGuardedSource(inner, raw);
      default:
        null;
    }
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

  /**
   * Compares literal compiler type structure without boundary projections.
   *
   * Typedefs, resolved monomorphs, and lazy shells are transparent aliases.
   * Classes, enums, abstracts, and type parameters must retain the same typed
   * declaration identity, and every callable slot must match recursively.
   */
  public static function compareExactTypes(expected: Type, actual: Type,
      depth = 0): Bool {
    if (depth > MAX_TYPE_DEPTH)
      return false;
    final expectedResolved = resolveExact(expected);
    final actualResolved = resolveExact(actual);
    if (expectedResolved == null || actualResolved == null)
      return false;

    return switch [expectedResolved, actualResolved] {
      case [TInst(expectedRef,
        expectedParameters), TInst(actualRef, actualParameters)]: sameClassIdentity(expectedRef,
          actualRef) && exactParameters(expectedParameters, actualParameters,
          depth + 1);
      case [TEnum(expectedRef,
        expectedParameters), TEnum(actualRef, actualParameters)]: sameBaseIdentity(expectedRef.get(),
          actualRef.get()) && exactParameters(expectedParameters,
          actualParameters, depth + 1);
      case [
        TAbstract(expectedRef, expectedParameters),
        TAbstract(actualRef, actualParameters)
      ]: sameBaseIdentity(expectedRef.get(),
        actualRef.get()) && exactParameters(expectedParameters,
          actualParameters, depth + 1);
      case [TFun(expectedArguments,
        expectedResult), TFun(actualArguments, actualResult)]:
        if (expectedArguments.length != actualArguments.length) false else {
          var identical = true;
          for (index in 0...expectedArguments.length) {
            if (expectedArguments[index].opt != actualArguments[index].opt
              || !compareExactTypes(expectedArguments[index].t,
                actualArguments[index].t, depth + 1)) {
              identical = false;
              break;
            }
          }
          identical && compareExactTypes(expectedResult, actualResult,
            depth + 1)
          ;
        }
      default:
        false;
    };
  }

  static function exactParameters(expected: Array<Type>, actual: Array<Type>,
      depth: Int): Bool {
    if (expected.length != actual.length)
      return false;
    for (index in 0...expected.length)
      if (!compareExactTypes(expected[index], actual[index], depth + 1))
        return false;
    return true;
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

  /** Follows aliases but preserves nominal and abstract declarations. */
  static function resolveExact(type: Type): Null<Type> {
    return switch type {
      case TType(_, _) | TLazy(_):
        resolveExact(Context.follow(type));
      case TMono(reference):
        reference.get() == null ? null : resolveExact(reference.get());
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
