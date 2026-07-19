package genes.ts;

#if macro
import genes.CompilerDiagnostic;
import genes.Module;
import genes.NullishContract;
import genes.SourceMapGenerator.SourcePosition;
import genes.util.TypeUtil;
import haxe.ds.ObjectMap;
import haxe.macro.Expr.Binop;
import haxe.macro.Context;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;
using haxe.macro.Tools;

/**
 * Identifies a value whose non-null state can be tracked without guessing.
 *
 * Why
 * ----
 * The old TypeScript emitter encoded values as strings such as
 * `local:12.name`. That made invalidation depend on spelling: assigning local
 * `12` did not automatically end a fact about `local:12.name`, and a map/key
 * pair had to be split out of a formatted string again.
 *
 * What
 * ----
 * This closed enum represents only values that the current compiler can match
 * exactly: locals, `this`, primitive constants, stable field paths, and one
 * map read. It is deliberately not a general expression tree.
 *
 * How
 * ---
 * Local IDs come from Haxe's typed tree. Field and map identities retain their
 * typed parents, so changing a receiver or key can invalidate every dependent
 * fact structurally. Generated TypeScript names and source positions never
 * participate in equality.
 */
enum TsNarrowValueIdentity {
  LocalValue(id: Int);
  ThisValue;
  StringValue(value: String);
  IntValue(value: Int);
  FloatValue(value: String);
  BoolValue(value: Bool);
  FieldValue(receiver: TsNarrowValueIdentity, field: String);
  MapReadValue(map: TsNarrowValueIdentity, key: TsNarrowValueIdentity);
}

/** Describes how one valid non-null fact entered the function-local state. */
enum TsNarrowProofKind {
  NullGuard;
  MapExistsGuard;
  MapKeyIteration;
  NarrowedInitializer;
}

/** Describes the exact mutation that ended a previously valid fact. */
enum TsNarrowInvalidationKind {
  ValueChanged(value: TsNarrowValueIdentity);
  MapEntryRemoved(map: TsNarrowValueIdentity, key: TsNarrowValueIdentity);
  /**
   * A removal ran on this map, but its computed key has no stable identity.
   * Any previously proved entry on this exact receiver may be the one that
   * disappeared, so all of those entry proofs end. Facts for other maps stay
   * valid; this is not a whole-program alias or call-effect assumption.
   */
  MapEntryPossiblyRemoved(map: TsNarrowValueIdentity);
  MapCleared(map: TsNarrowValueIdentity);
}

/**
 * A stable location in one source-ordered function walk.
 *
 * The plan uses the original `TypedExpr` object only as a private lookup handle
 * for the emitter. Diagnostics and comparisons use this value instead: the
 * function and expression ordinals are deterministic, while the source
 * position tells a reader where the decision came from.
 */
final class TsNarrowProgramPoint {
  public final functionOrdinal: Int;
  public final expressionOrdinal: Int;
  public final source: SourcePosition;

  public function new(functionOrdinal: Int, expressionOrdinal: Int,
      source: SourcePosition) {
    this.functionOrdinal = functionOrdinal;
    this.expressionOrdinal = expressionOrdinal;
    this.source = source;
  }

  public function describe(): String {
    final file = source.file == null ? "<generated>" : source.file;
    return file + ":" + source.line + ":" + source.column
      + " (function " + functionOrdinal + ", expression "
      + expressionOrdinal + ")";
  }
}

/** One non-null fact plus the source rule that introduced it. */
final class TsNarrowFact {
  public final value: TsNarrowValueIdentity;
  public final proof: TsNarrowProofKind;
  public final source: SourcePosition;

  public function new(value: TsNarrowValueIdentity, proof: TsNarrowProofKind,
      source: SourcePosition) {
    this.value = value;
    this.proof = proof;
    this.source = source;
  }
}

/** One mutation and the source location that caused it. */
final class TsNarrowInvalidation {
  public final kind: TsNarrowInvalidationKind;
  public final source: SourcePosition;

  public function new(kind: TsNarrowInvalidationKind,
      source: SourcePosition) {
    this.kind = kind;
    this.source = source;
  }
}

/** Connects an ended fact to the mutation that made it unsafe. */
final class TsNarrowedFactInvalidation {
  public final value: TsNarrowValueIdentity;
  public final cause: TsNarrowInvalidation;

  public function new(value: TsNarrowValueIdentity,
      cause: TsNarrowInvalidation) {
    this.value = value;
    this.cause = cause;
  }
}

/**
 * Immutable narrowing state observed before one typed expression executes.
 *
 * Printers ask only whether a precise identity is present. The retained proof
 * and invalidation records exist so shadow comparisons can explain why the
 * new plan differs from the legacy emitter at the first stable program point.
 */
final class TsNarrowDecision {
  public final point: TsNarrowProgramPoint;
  public final facts: Array<TsNarrowFact>;
  public final invalidated: Array<TsNarrowedFactInvalidation>;

  public function new(point: TsNarrowProgramPoint,
      facts: Array<TsNarrowFact>,
      invalidated: Array<TsNarrowedFactInvalidation>) {
    this.point = point;
    this.facts = facts;
    this.invalidated = invalidated;
  }

  public function factFor(value: TsNarrowValueIdentity): Null<TsNarrowFact> {
    for (fact in facts)
      if (TsNarrowValueIdentityTools.equals(fact.value, value))
        return fact;
    return null;
  }

  public function invalidationFor(
      value: TsNarrowValueIdentity): Null<TsNarrowedFactInvalidation> {
    var index = invalidated.length;
    while (index > 0) {
      index--;
      final entry = invalidated[index];
      if (TsNarrowValueIdentityTools.equals(entry.value, value))
        return entry;
    }
    return null;
  }
}

/** Structural operations for the closed narrowing identity. */
final class TsNarrowValueIdentityTools {
  public static function equals(left: TsNarrowValueIdentity,
      right: TsNarrowValueIdentity): Bool {
    return switch [left, right] {
      case [LocalValue(a), LocalValue(b)]: a == b;
      case [ThisValue, ThisValue]: true;
      case [StringValue(a), StringValue(b)]: a == b;
      case [IntValue(a), IntValue(b)]: a == b;
      case [FloatValue(a), FloatValue(b)]: a == b;
      case [BoolValue(a), BoolValue(b)]: a == b;
      case [FieldValue(aReceiver, aField), FieldValue(bReceiver, bField)]:
        aField == bField && equals(aReceiver, bReceiver);
      case [MapReadValue(aMap, aKey), MapReadValue(bMap, bKey)]:
        equals(aMap, bMap) && equals(aKey, bKey);
      default: false;
    }
  }

  /** True when `value` reads from, or is nested below, `changed`. */
  public static function dependsOn(value: TsNarrowValueIdentity,
      changed: TsNarrowValueIdentity): Bool {
    if (equals(value, changed))
      return true;
    return switch value {
      case FieldValue(receiver, _): dependsOn(receiver, changed);
      case MapReadValue(map, key):
        dependsOn(map, changed) || dependsOn(key, changed);
      default: false;
    }
  }

  /** Beginner-readable diagnostic spelling; never used as identity. */
  public static function describe(value: TsNarrowValueIdentity): String {
    return switch value {
      case LocalValue(id): "local #" + id;
      case ThisValue: "this";
      case StringValue(value): 'string "$value"';
      case IntValue(value): "integer " + value;
      case FloatValue(value): "number " + value;
      case BoolValue(value): "boolean " + value;
      case FieldValue(receiver, field): describe(receiver) + "." + field;
      case MapReadValue(map, key):
        "map read " + describe(map) + "[" + describe(key) + "]";
    }
  }
}

/**
 * Function-local TypeScript narrowing facts derived before source is printed.
 *
 * Why
 * ----
 * A null check is useful only until the checked value changes. The old emitter
 * kept branch facts on a token-writing stack, so replacing a receiver,
 * removing a map entry, clearing a map, or crossing a loop back-edge could
 * leave a stale `!` in generated TypeScript.
 *
 * What
 * ----
 * This plan records the facts valid before each typed expression. It models
 * direct null guards, `Map.exists`, exiting branches, exact assignments,
 * `Map.remove`/`clear`, map-key iteration, pre-test versus post-test loop
 * ordering, loop mutation, and nested function boundaries. Unsupported shapes
 * simply receive no proof.
 *
 * How
 * ---
 * `TsNarrowingPlanBuilder` performs one structured, source-ordered walk per
 * function. It summarizes only explicit mutations needed at loop back-edges;
 * it does not build a control-flow graph, SSA form, alias analysis, or a copy
 * of Haxe's expression tree. `NullishContract` remains the owner of null and
 * missing-value meaning. The TypeScript emitter remains the owner of `!`,
 * `?? null`, layout, and source maps.
 */
final class TsNarrowingPlan {
  final decisions: ObjectMap<TypedExpr, TsNarrowDecision>;

  public static function build(module: Module): TsNarrowingPlan {
    return new TsNarrowingPlanBuilder().build(module);
  }

  public function new(decisions: ObjectMap<TypedExpr, TsNarrowDecision>) {
    this.decisions = decisions;
  }

  public function decisionAt(expression: TypedExpr): Null<TsNarrowDecision> {
    return decisions.get(expression);
  }

  public function identityForRead(
      expression: TypedExpr): Null<TsNarrowValueIdentity> {
    return TsNarrowingPlanBuilder.narrowedReadIdentity(expression);
  }

  public function isKnownNonNull(expression: TypedExpr): Bool {
    final decision = decisionAt(expression);
    final identity = identityForRead(expression);
    return decision != null && identity != null
      && decision.factFor(identity) != null;
  }

  /** Returns the mutation that explains a reviewed legacy/plan mismatch. */
  public function invalidationFor(
      expression: TypedExpr): Null<TsNarrowedFactInvalidation> {
    final decision = decisionAt(expression);
    final identity = identityForRead(expression);
    return decision == null || identity == null
      ? null
      : decision.invalidationFor(identity);
  }

  /** Shared map-shape lookup used by planning and final TS spelling. */
  public static function mapValueType(type: Type,
      ?seen: Map<String, Bool>): Null<Type> {
    if (seen == null)
      seen = [];
    return switch Context.follow(type) {
      case TInst(ref, params):
        final classType = ref.get();
        final id = classType.module + "." + classType.name;
        if (seen.exists(id)) {
          null;
        } else if (classType.module == "haxe.Constraints"
          && classType.name == "IMap" && params.length >= 2) {
          params[1];
        } else {
          seen.set(id, true);
          var found: Null<Type> = null;
          for (iface in classType.interfaces) {
            final ifaceParams = [for (param in iface.params)
              param.applyTypeParameters(classType.params, params)];
            found = mapValueType(TInst(iface.t, ifaceParams), seen);
            if (found != null)
              break;
          }
          if (found == null && classType.superClass != null) {
            final superParams = [for (param in classType.superClass.params)
              param.applyTypeParameters(classType.params, params)];
            found = mapValueType(TInst(classType.superClass.t, superParams),
              seen);
          }
          found;
        }
      default: null;
    }
  }
}

private typedef IteratorOrigin = {
  final localId: Int;
  final map: TsNarrowValueIdentity;
}

/** Mutable builder state; snapshots copied into the public immutable plan. */
private final class TsNarrowingState {
  public final facts: Array<TsNarrowFact>;
  public final invalidated: Array<TsNarrowedFactInvalidation>;
  public final iteratorOrigins: Array<IteratorOrigin>;

  public function new(?facts: Array<TsNarrowFact>,
      ?invalidated: Array<TsNarrowedFactInvalidation>,
      ?iteratorOrigins: Array<IteratorOrigin>) {
    this.facts = facts == null ? [] : facts;
    this.invalidated = invalidated == null ? [] : invalidated;
    this.iteratorOrigins = iteratorOrigins == null ? [] : iteratorOrigins;
  }

  public function copy(): TsNarrowingState {
    return new TsNarrowingState(facts.copy(), invalidated.copy(),
      iteratorOrigins.copy());
  }

  public function factFor(value: TsNarrowValueIdentity): Null<TsNarrowFact> {
    for (fact in facts)
      if (TsNarrowValueIdentityTools.equals(fact.value, value))
        return fact;
    return null;
  }

  public function addFact(fact: TsNarrowFact): TsNarrowingState {
    final next = copy();
    if (next.factFor(fact.value) == null)
      next.facts.push(fact);
    next.removeInvalidation(fact.value);
    return next;
  }

  public function addFacts(values: Array<TsNarrowFact>): TsNarrowingState {
    var next = this;
    for (fact in values)
      next = next.addFact(fact);
    return next;
  }

  /** Removes branch-only proofs before control flow rejoins. */
  public function removeFacts(values: Array<TsNarrowFact>): TsNarrowingState {
    if (values.length == 0)
      return copy();
    final next = copy();
    var index = next.facts.length;
    while (index > 0) {
      index--;
      final current = next.facts[index];
      for (removed in values)
        if (TsNarrowValueIdentityTools.equals(current.value, removed.value)) {
          next.facts.splice(index, 1);
          break;
        }
    }
    return next;
  }

  public function apply(cause: TsNarrowInvalidation): TsNarrowingState {
    final next = copy();
    final kept: Array<TsNarrowFact> = [];
    for (fact in next.facts) {
      if (invalidationAffects(cause.kind, fact.value)) {
        next.invalidated.push(new TsNarrowedFactInvalidation(fact.value,
          cause));
      } else {
        kept.push(fact);
      }
    }
    next.facts.resize(0);
    for (fact in kept)
      next.facts.push(fact);

    switch cause.kind {
      case ValueChanged(value):
        final origins: Array<IteratorOrigin> = [];
        for (origin in next.iteratorOrigins)
          if (origin.localId != localId(value)
            && !TsNarrowValueIdentityTools.dependsOn(origin.map, value))
            origins.push(origin);
        next.iteratorOrigins.resize(0);
        for (origin in origins)
          next.iteratorOrigins.push(origin);
      case MapEntryRemoved(_) | MapEntryPossiblyRemoved(_) | MapCleared(_):
    }
    return next;
  }

  public function applyAll(
      causes: Array<TsNarrowInvalidation>): TsNarrowingState {
    var next = this;
    for (cause in causes)
      next = next.apply(cause);
    return next;
  }

  public function setIteratorOrigin(localId: Int,
      map: TsNarrowValueIdentity): TsNarrowingState {
    final next = copy();
    var index = next.iteratorOrigins.length;
    while (index > 0) {
      index--;
      if (next.iteratorOrigins[index].localId == localId)
        next.iteratorOrigins.splice(index, 1);
    }
    next.iteratorOrigins.push({localId: localId, map: map});
    return next;
  }

  public function iteratorOrigin(localId: Int): Null<TsNarrowValueIdentity> {
    for (origin in iteratorOrigins)
      if (origin.localId == localId)
        return origin.map;
    return null;
  }

  function removeInvalidation(value: TsNarrowValueIdentity): Void {
    var index = invalidated.length;
    while (index > 0) {
      index--;
      if (TsNarrowValueIdentityTools.equals(invalidated[index].value, value))
        invalidated.splice(index, 1);
    }
  }

  static function localId(value: TsNarrowValueIdentity): Int {
    return switch value {
      case LocalValue(id): id;
      default: -1;
    }
  }

  static function invalidationAffects(kind: TsNarrowInvalidationKind,
      fact: TsNarrowValueIdentity): Bool {
    return switch kind {
      case ValueChanged(value):
        TsNarrowValueIdentityTools.dependsOn(fact, value);
      case MapEntryRemoved(map, key):
        switch fact {
          case MapReadValue(factMap, factKey):
            TsNarrowValueIdentityTools.equals(map, factMap)
              && TsNarrowValueIdentityTools.equals(key, factKey);
          default: false;
        }
      case MapEntryPossiblyRemoved(map) | MapCleared(map):
        switch fact {
          case MapReadValue(factMap, _):
            TsNarrowValueIdentityTools.equals(map, factMap);
          default: false;
        }
    }
  }

  public static function join(left: Null<TsNarrowingState>,
      right: Null<TsNarrowingState>): Null<TsNarrowingState> {
    if (left == null)
      return right == null ? null : right.copy();
    if (right == null)
      return left.copy();

    final facts: Array<TsNarrowFact> = [];
    for (fact in left.facts)
      if (right.factFor(fact.value) != null)
        facts.push(fact);

    final invalidated = left.invalidated.copy();
    for (entry in right.invalidated) {
      var found = false;
      for (existing in invalidated)
        if (TsNarrowValueIdentityTools.equals(existing.value, entry.value)
          && sameInvalidation(existing.cause.kind, entry.cause.kind)) {
          found = true;
          break;
        }
      if (!found)
        invalidated.push(entry);
    }

    final origins: Array<IteratorOrigin> = [];
    for (leftOrigin in left.iteratorOrigins)
      for (rightOrigin in right.iteratorOrigins)
        if (leftOrigin.localId == rightOrigin.localId
          && TsNarrowValueIdentityTools.equals(leftOrigin.map,
            rightOrigin.map)) {
          origins.push(leftOrigin);
          break;
        }
    return new TsNarrowingState(facts, invalidated, origins);
  }

  static function sameInvalidation(left: TsNarrowInvalidationKind,
      right: TsNarrowInvalidationKind): Bool {
    return switch [left, right] {
      case [ValueChanged(a), ValueChanged(b)]:
        TsNarrowValueIdentityTools.equals(a, b);
      case [MapEntryRemoved(aMap, aKey), MapEntryRemoved(bMap, bKey)]:
        TsNarrowValueIdentityTools.equals(aMap, bMap)
          && TsNarrowValueIdentityTools.equals(aKey, bKey);
      case [MapEntryPossiblyRemoved(a), MapEntryPossiblyRemoved(b)]:
        TsNarrowValueIdentityTools.equals(a, b);
      case [MapCleared(a), MapCleared(b)]:
        TsNarrowValueIdentityTools.equals(a, b);
      default: false;
    }
  }
}

private final class TsNarrowFlow {
  public final normal: Null<TsNarrowingState>;
  public final effects: Array<TsNarrowInvalidation>;

  public function new(normal: Null<TsNarrowingState>,
      ?effects: Array<TsNarrowInvalidation>) {
    this.normal = normal;
    this.effects = effects == null ? [] : effects;
  }
}

private typedef TsNarrowCondition = {
  final whenTrue: Array<TsNarrowFact>;
  final whenFalse: Array<TsNarrowFact>;
}

/** Source-ordered builder for the bounded function-local plan. */
private final class TsNarrowingPlanBuilder {
  final decisions = new ObjectMap<TypedExpr, TsNarrowDecision>();
  var nextFunctionOrdinal = 0;
  var functionOrdinal = -1;
  var expressionOrdinal = 0;

  public function new() {}

  public function build(module: Module): TsNarrowingPlan {
    for (member in module.members) {
      switch member {
        case MClass(classType, _, fields):
          for (field in fields)
            if (field.expr != null)
              analyzeMemberRoot(field.expr);
          if (classType.init != null)
            analyzeMemberRoot(classType.init);
        case MMain(expression):
          analyzeFunctionScope(expression);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new TsNarrowingPlan(decisions);
  }

  function analyzeMemberRoot(expression: TypedExpr): Void {
    switch expression.expr {
      case TFunction(func): analyzeFunctionScope(func.expr);
      default: analyzeFunctionScope(expression);
    }
  }

  function analyzeFunctionScope(expression: TypedExpr): Void {
    final previousFunction = functionOrdinal;
    final previousExpression = expressionOrdinal;
    functionOrdinal = nextFunctionOrdinal;
    nextFunctionOrdinal++;
    expressionOrdinal = 0;
    analyze(expression, new TsNarrowingState());
    functionOrdinal = previousFunction;
    expressionOrdinal = previousExpression;
  }

  function record(expression: TypedExpr, state: TsNarrowingState): Void {
    if (decisions.exists(expression))
      CompilerDiagnostic.fail(
        "[GTS-NARROW-PLAN-001] One typed expression appeared twice in the "
        + "function-local narrowing walk. The plan requires one deterministic "
        + "program point per source expression.", expression.pos);
    final point = new TsNarrowProgramPoint(functionOrdinal,
      expressionOrdinal, expression.pos);
    expressionOrdinal++;
    decisions.set(expression, new TsNarrowDecision(point,
      state.facts.copy(), state.invalidated.copy()));
  }

  /**
   * Walks one typed expression in its real control/evaluation order.
   *
   * Why: a new Haxe expression kind can introduce a branch, function boundary,
   * or write. Silently treating it as an ordinary leaf could keep a proof past
   * the point where it stopped being true.
   *
   * How: every current `TypedExprDef` kind appears below. Control-flow and
   * mutation kinds have dedicated handlers; ordinary kinds use Haxe's ordered
   * child walk. This exhaustive switch intentionally makes a future Haxe enum
   * addition a compile error until its narrowing behavior is reviewed.
   */
  function analyze(expression: TypedExpr,
      state: TsNarrowingState): TsNarrowFlow {
    record(expression, state);
    return switch expression.expr {
      case TBlock(elements): analyzeBlock(elements, state);
      case TIf(condition, thenExpression, elseExpression):
        analyzeIf(condition, thenExpression, elseExpression, state);
      case TWhile(condition, body, normalWhile):
        analyzeWhile(condition, body, normalWhile, state);
      case TFor(variable, iteratorExpression, body):
        analyzeFor(variable, iteratorExpression, body, state);
      case TFunction(func):
        analyzeFunctionScope(func.expr);
        new TsNarrowFlow(state.copy());
      case TReturn(value):
        final valueFlow = value == null
          ? new TsNarrowFlow(state.copy())
          : analyze(value, state);
        new TsNarrowFlow(null, valueFlow.effects);
      case TThrow(value):
        final valueFlow = analyze(value, state);
        new TsNarrowFlow(null, valueFlow.effects);
      case TBreak | TContinue:
        new TsNarrowFlow(null);
      case TVar(variable, initializer):
        analyzeVariable(expression, variable, initializer, state);
      case TBinop(OpAssign | OpAssignOp(_), left, right):
        analyzeAssignment(expression, left, right, state);
      case TUnop(OpIncrement | OpDecrement, _, target):
        analyzeMutationExpression(expression, target, state);
      case TCall(callee, arguments):
        analyzeCall(expression, callee, arguments, state);
      case TSwitch(subject, cases, defaultExpression):
        analyzeSwitch(subject, cases, defaultExpression, state);
      case TTry(body, catches): analyzeTry(body, catches, state);
      case TConst(_) | TLocal(_) | TArray(_, _) | TField(_, _)
        | TTypeExpr(_) | TParenthesis(_) | TObjectDecl(_)
        | TArrayDecl(_) | TNew(_, _, _) | TBinop(_, _, _)
        | TUnop(_, _, _) | TCast(_, _) | TMeta(_, _)
        | TEnumParameter(_, _, _) | TEnumIndex(_) | TIdent(_):
        analyzeChildren(expression, state);
    }
  }

  function analyzeBlock(elements: Array<TypedExpr>,
      state: TsNarrowingState): TsNarrowFlow {
    var normal: Null<TsNarrowingState> = state;
    var effects: Array<TsNarrowInvalidation> = [];
    for (element in elements) {
      final input = normal == null ? new TsNarrowingState() : normal;
      final flow = analyze(element, input);
      effects = appendEffects(effects, flow.effects);
      if (normal != null) {
        normal = flow.normal;
        if (normal != null)
          normal = normal.addFacts(continuationFacts(element));
      }
    }
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeIf(condition: TypedExpr, thenExpression: TypedExpr,
      elseExpression: Null<TypedExpr>, state: TsNarrowingState): TsNarrowFlow {
    final conditionFlow = analyze(condition, state);
    final afterCondition = conditionFlow.normal == null
      ? new TsNarrowingState()
      : conditionFlow.normal;
    final facts = conditionFactsAfterEvaluation(condition,
      conditionFlow.effects);
    final thenFlow = analyze(thenExpression,
      afterCondition.addFacts(facts.whenTrue));
    final elseFlow = elseExpression == null
      ? new TsNarrowFlow(afterCondition.addFacts(facts.whenFalse))
      : analyze(elseExpression, afterCondition.addFacts(facts.whenFalse));
    final thenNormal = thenFlow.normal == null
      ? null
      : thenFlow.normal.removeFacts(facts.whenTrue);
    final elseNormal = elseFlow.normal == null
      ? null
      : elseFlow.normal.removeFacts(facts.whenFalse);
    return new TsNarrowFlow(
      TsNarrowingState.join(thenNormal, elseNormal),
      appendEffects(conditionFlow.effects,
        appendEffects(thenFlow.effects, elseFlow.effects)));
  }

  function analyzeWhile(condition: TypedExpr, body: TypedExpr,
      normalWhile: Bool, state: TsNarrowingState): TsNarrowFlow {
    // A single typed loop body represents every iteration. Apply mutations the
    // body can perform before recording its entry state, so a proof from an
    // earlier iteration cannot survive at the same program point.
    final loopEffects = collectEffects(body);
    final stableEntry = state.applyAll(loopEffects);
    if (!normalWhile) {
      // A do-while loop executes its body before checking its condition. The
      // body has one shared program point for every iteration, so a condition
      // fact learned after the first iteration cannot be used there: it was
      // not true when that same source expression ran the first time.
      final bodyFlow = analyze(body, stableEntry);
      final afterBody = bodyFlow.normal == null
        ? new TsNarrowingState()
        : bodyFlow.normal;
      final conditionFlow = analyze(condition, afterBody);
      /**
       * A `break` can leave this loop before a guard later in the body runs.
       * `bodyFlow.normal` describes only paths that reached the condition, so
       * facts learned on those paths cannot automatically describe every loop
       * exit. Keep only facts that were already true on entry and survive every
       * direct body/condition mutation. This is deliberately conservative and
       * avoids a general control-flow graph; if future output needs facts first
       * established inside a post-test body, its break/continue exits must be
       * modeled explicitly before those facts can flow past the loop.
       */
      final safeExit = stableEntry.applyAll(conditionFlow.effects);
      return new TsNarrowFlow(safeExit,
        appendEffects(loopEffects,
          appendEffects(bodyFlow.effects, conditionFlow.effects)));
    }
    final conditionFlow = analyze(condition, stableEntry);
    final afterCondition = conditionFlow.normal == null
      ? new TsNarrowingState()
      : conditionFlow.normal;
    final facts = conditionFactsAfterEvaluation(condition,
      conditionFlow.effects);
    final bodyFlow = analyze(body, afterCondition.addFacts(facts.whenTrue));
    final afterLoop = afterCondition.applyAll(loopEffects);
    return new TsNarrowFlow(afterLoop,
      appendEffects(conditionFlow.effects,
        appendEffects(loopEffects, bodyFlow.effects)));
  }

  function analyzeFor(variable: TVar, iteratorExpression: TypedExpr,
      body: TypedExpr, state: TsNarrowingState): TsNarrowFlow {
    final iteratorFlow = analyze(iteratorExpression, state);
    final afterIterator = iteratorFlow.normal == null
      ? new TsNarrowingState()
      : iteratorFlow.normal;
    final loopEffects = collectEffects(body);
    var bodyEntry = afterIterator.applyAll(loopEffects);
    final map = mapKeysOrigin(iteratorExpression, afterIterator);
    if (map != null) {
      bodyEntry = bodyEntry.addFact(new TsNarrowFact(
        MapReadValue(map, LocalValue(variable.id)), MapKeyIteration,
        iteratorExpression.pos));
    }
    final bodyFlow = analyze(body, bodyEntry);
    return new TsNarrowFlow(afterIterator.applyAll(loopEffects),
      appendEffects(iteratorFlow.effects,
        appendEffects(loopEffects, bodyFlow.effects)));
  }

  function analyzeVariable(expression: TypedExpr, variable: TVar,
      initializer: Null<TypedExpr>, state: TsNarrowingState): TsNarrowFlow {
    if (initializer == null)
      return new TsNarrowFlow(state.copy());
    final knownInitializer = isKnownInState(initializer, state);
    final mapOrigin = mapKeysOrigin(initializer, state);
    final keyOrigin = mapIteratorNextOrigin(initializer, state);
    final initializerFlow = analyze(initializer, state);
    var normal = initializerFlow.normal == null
      ? new TsNarrowingState()
      : initializerFlow.normal;
    if (knownInitializer
      && NullishContract.forType(variable.t).haxeAllowsNull) {
      normal = normal.addFact(new TsNarrowFact(LocalValue(variable.id),
        NarrowedInitializer, expression.pos));
    }
    if (mapOrigin != null)
      normal = normal.setIteratorOrigin(variable.id, mapOrigin);
    if (keyOrigin != null) {
      normal = normal.addFact(new TsNarrowFact(
        MapReadValue(keyOrigin, LocalValue(variable.id)), MapKeyIteration,
        initializer.pos));
    }
    return new TsNarrowFlow(normal, initializerFlow.effects);
  }

  function analyzeAssignment(expression: TypedExpr, left: TypedExpr,
      right: TypedExpr, state: TsNarrowingState): TsNarrowFlow {
    final leftFlow = analyze(left, state);
    final afterLeft = leftFlow.normal == null
      ? new TsNarrowingState()
      : leftFlow.normal;
    final rightFlow = analyze(right, afterLeft);
    var normal = rightFlow.normal == null
      ? new TsNarrowingState()
      : rightFlow.normal;
    final effect = changedValueEffect(left, expression);
    final effects = appendEffects(leftFlow.effects, rightFlow.effects);
    if (effect == null)
      return new TsNarrowFlow(normal, effects);
    normal = normal.apply(effect);
    effects.push(effect);
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeMutationExpression(expression: TypedExpr,
      target: TypedExpr, state: TsNarrowingState): TsNarrowFlow {
    final targetFlow = analyze(target, state);
    var normal = targetFlow.normal == null
      ? new TsNarrowingState()
      : targetFlow.normal;
    final effect = changedValueEffect(target, expression);
    final effects = targetFlow.effects.copy();
    if (effect != null) {
      normal = normal.apply(effect);
      effects.push(effect);
    }
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeCall(expression: TypedExpr, callee: TypedExpr,
      arguments: Array<TypedExpr>, state: TsNarrowingState): TsNarrowFlow {
    var flow = analyze(callee, state);
    var normal = flow.normal == null ? new TsNarrowingState() : flow.normal;
    var effects = flow.effects.copy();
    for (argument in arguments) {
      flow = analyze(argument, normal);
      normal = flow.normal == null ? new TsNarrowingState() : flow.normal;
      effects = appendEffects(effects, flow.effects);
    }
    final ownEffects = callEffects(expression);
    normal = normal.applyAll(ownEffects);
    effects = appendEffects(effects, ownEffects);
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeSwitch(subject: TypedExpr,
      cases: Array<{values: Array<TypedExpr>, expr: TypedExpr}>,
      defaultExpression: Null<TypedExpr>,
      state: TsNarrowingState): TsNarrowFlow {
    final subjectFlow = analyze(subject, state);
    final branchState = subjectFlow.normal == null
      ? new TsNarrowingState()
      : subjectFlow.normal;
    var normal: Null<TsNarrowingState> = null;
    var effects = subjectFlow.effects.copy();
    for (caseEntry in cases) {
      var caseState = branchState;
      for (value in caseEntry.values) {
        final valueFlow = analyze(value, caseState);
        caseState = valueFlow.normal == null
          ? new TsNarrowingState()
          : valueFlow.normal;
        effects = appendEffects(effects, valueFlow.effects);
      }
      final caseFlow = analyze(caseEntry.expr, caseState);
      normal = TsNarrowingState.join(normal, caseFlow.normal);
      effects = appendEffects(effects, caseFlow.effects);
    }
    if (defaultExpression == null) {
      normal = TsNarrowingState.join(normal, branchState);
    } else {
      final defaultFlow = analyze(defaultExpression, branchState);
      normal = TsNarrowingState.join(normal, defaultFlow.normal);
      effects = appendEffects(effects, defaultFlow.effects);
    }
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeTry(body: TypedExpr,
      catches: Array<{v: TVar, expr: TypedExpr}>,
      state: TsNarrowingState): TsNarrowFlow {
    final bodyEffects = collectEffects(body);
    final bodyFlow = analyze(body, state);
    var normal = bodyFlow.normal;
    var effects = bodyFlow.effects.copy();
    final catchEntry = state.applyAll(bodyEffects);
    for (entry in catches) {
      final catchFlow = analyze(entry.expr, catchEntry);
      normal = TsNarrowingState.join(normal, catchFlow.normal);
      effects = appendEffects(effects, catchFlow.effects);
    }
    return new TsNarrowFlow(normal, effects);
  }

  function analyzeChildren(expression: TypedExpr,
      state: TsNarrowingState): TsNarrowFlow {
    var normal: Null<TsNarrowingState> = state;
    var effects: Array<TsNarrowInvalidation> = [];
    expression.iter(child -> {
      final childState = normal == null ? new TsNarrowingState() : normal;
      final flow = analyze(child, childState);
      effects = appendEffects(effects, flow.effects);
      if (normal != null)
        normal = flow.normal;
    });
    return new TsNarrowFlow(normal, effects);
  }

  function conditionFacts(expression: TypedExpr): TsNarrowCondition {
    final source: SourcePosition = expression.pos;
    return switch unwrap(expression).expr {
      case TBinop(op = OpEq | OpNotEq, left, right):
        final leftIdentity = narrowedReadIdentity(left);
        if (leftIdentity != null && isNullConstant(right)) {
          nullComparisonFacts(op, leftIdentity, source);
        } else {
          final rightIdentity = narrowedReadIdentity(right);
          rightIdentity != null && isNullConstant(left)
            ? nullComparisonFacts(op, rightIdentity, source)
            : emptyCondition();
        }
      case TBinop(OpBoolAnd, left, right):
        final leftFacts = conditionFacts(left);
        final rightFacts = conditionFacts(right);
        {
          whenTrue: uniqueFacts(leftFacts.whenTrue.concat(
            rightFacts.whenTrue)),
          whenFalse: []
        };
      case TBinop(OpBoolOr, left, right):
        final leftFacts = conditionFacts(left);
        final rightFacts = conditionFacts(right);
        {
          whenTrue: [],
          whenFalse: uniqueFacts(leftFacts.whenFalse.concat(
            rightFacts.whenFalse))
        };
      case TUnop(OpNot, _, inner):
        final innerFacts = conditionFacts(inner);
        {
          whenTrue: innerFacts.whenFalse,
          whenFalse: innerFacts.whenTrue
        };
      case TCall({expr: TField(mapExpression, field)}, [keyExpression])
        if (fieldAccessName(field) == "exists"):
        final map = stableNonNullableMap(mapExpression);
        final key = stableValue(keyExpression);
        if (map == null || key == null) {
          emptyCondition();
        } else {
          whenTrue: [new TsNarrowFact(MapReadValue(map, key),
            MapExistsGuard, source)],
          whenFalse: []
        };
      default: emptyCondition();
    }
  }

  /**
   * Keeps only condition facts that remain true after the whole condition ran.
   *
   * A compound condition can first check a value and then assign to that same
   * value in a later operand. Treating the earlier check as a branch fact would
   * revive a proof that the assignment already ended. Filtering all observed
   * condition mutations is intentionally conservative: a later check may be
   * able to prove the value again, but skipping that optimization is safer than
   * guessing about evaluation order.
   */
  function conditionFactsAfterEvaluation(expression: TypedExpr,
      effects: Array<TsNarrowInvalidation>): TsNarrowCondition {
    final facts = conditionFacts(expression);
    return {
      whenTrue: factsAfterEffects(facts.whenTrue, effects),
      whenFalse: factsAfterEffects(facts.whenFalse, effects)
    };
  }

  static function factsAfterEffects(facts: Array<TsNarrowFact>,
      effects: Array<TsNarrowInvalidation>): Array<TsNarrowFact> {
    if (facts.length == 0 || effects.length == 0)
      return facts;
    return new TsNarrowingState(facts).applyAll(effects).facts;
  }

  /**
   * Preserves the legacy bounded continuation rule at statement boundaries.
   *
   * An `if (value == null) return` statement proves the next statement sees a
   * value. The same `if` nested inside a call argument is merely a value
   * expression and must not leak its branch fact into neighboring arguments.
   */
  function continuationFacts(expression: TypedExpr): Array<TsNarrowFact> {
    return switch unwrap(expression).expr {
      case TIf(condition, thenExpression, null)
        if (definitelyExits(thenExpression)):
        conditionFactsAfterEvaluation(condition,
          collectEffects(condition)).whenFalse;
      default: [];
    }
  }

  static function definitelyExits(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TReturn(_) | TThrow(_) | TContinue | TBreak: true;
      case TBlock(elements):
        elements.length > 0 && definitelyExits(elements[elements.length - 1]);
      case TIf(_, thenExpression, elseExpression):
        elseExpression != null && definitelyExits(thenExpression)
          && definitelyExits(elseExpression);
      default: false;
    }
  }

  static function nullComparisonFacts(op: Binop,
      identity: TsNarrowValueIdentity,
      source: SourcePosition): TsNarrowCondition {
    final fact = new TsNarrowFact(identity, NullGuard, source);
    return op == OpNotEq
      ? {whenTrue: [fact], whenFalse: []}
      : {whenTrue: [], whenFalse: [fact]};
  }

  static function emptyCondition(): TsNarrowCondition {
    return {whenTrue: [], whenFalse: []};
  }

  static function uniqueFacts(facts: Array<TsNarrowFact>): Array<TsNarrowFact> {
    final result: Array<TsNarrowFact> = [];
    for (fact in facts) {
      var found = false;
      for (existing in result)
        if (TsNarrowValueIdentityTools.equals(existing.value, fact.value)) {
          found = true;
          break;
        }
      if (!found)
        result.push(fact);
    }
    return result;
  }

  static function isKnownInState(expression: TypedExpr,
      state: TsNarrowingState): Bool {
    final identity = narrowedReadIdentity(expression);
    return identity != null && state.factFor(identity) != null;
  }

  public static function narrowedReadIdentity(
      expression: TypedExpr): Null<TsNarrowValueIdentity> {
    final unwrapped = unwrap(expression);
    return switch unwrapped.expr {
      case TLocal(variable)
        if (NullishContract.forType(unwrapped.t).haxeAllowsNull):
        LocalValue(variable.id);
      case TCall({expr: TField(mapExpression, field)}, [keyExpression])
        if (fieldAccessName(field) == "get"):
        final map = stableNonNullableMap(mapExpression);
        final key = stableValue(keyExpression);
        map != null && key != null ? MapReadValue(map, key) : null;
      case TField(receiver, field) if (isOptionalField(field)):
        final parent = stableFieldReceiver(receiver);
        parent == null ? null : FieldValue(parent, TypeUtil.fieldName(field));
      default: null;
    }
  }

  static function stableValue(
      expression: TypedExpr): Null<TsNarrowValueIdentity> {
    return switch unwrap(expression).expr {
      case TLocal(variable): LocalValue(variable.id);
      case TConst(TThis): ThisValue;
      case TConst(TString(value)): StringValue(value);
      case TConst(TInt(value)): IntValue(value);
      case TConst(TFloat(value)): FloatValue(value);
      case TConst(TBool(value)): BoolValue(value);
      case TField(receiver, field):
        final parent = stableValue(receiver);
        parent == null ? null : FieldValue(parent, TypeUtil.fieldName(field));
      default: null;
    }
  }

  static function stableFieldReceiver(
      expression: TypedExpr): Null<TsNarrowValueIdentity> {
    return switch unwrap(expression).expr {
      case TLocal(variable): LocalValue(variable.id);
      case TConst(TThis): ThisValue;
      case TField(receiver, field):
        final parent = stableFieldReceiver(receiver);
        parent == null ? null : FieldValue(parent, TypeUtil.fieldName(field));
      default: null;
    }
  }

  static function stableNonNullableMap(
      expression: TypedExpr): Null<TsNarrowValueIdentity> {
    final valueType = TsNarrowingPlan.mapValueType(expression.t);
    return valueType != null
      && !NullishContract.forType(valueType).haxeAllowsNull
      ? stableValue(expression)
      : null;
  }

  static function mapKeysOrigin(expression: TypedExpr,
      state: TsNarrowingState): Null<TsNarrowValueIdentity> {
    return switch unwrap(expression).expr {
      case TCall({expr: TField(mapExpression, field)}, [])
        if (fieldAccessName(field) == "keys"):
        stableNonNullableMap(mapExpression);
      case TLocal(variable): state.iteratorOrigin(variable.id);
      default: null;
    }
  }

  /** Recovers the map that produced one lowered `iterator.next()` key local. */
  static function mapIteratorNextOrigin(expression: TypedExpr,
      state: TsNarrowingState): Null<TsNarrowValueIdentity> {
    return switch unwrap(expression).expr {
      case TCall({expr: TField({expr: TLocal(iterator)}, field)}, [])
        if (fieldAccessName(field) == "next"):
        state.iteratorOrigin(iterator.id);
      default: null;
    }
  }

  static function changedValueEffect(target: TypedExpr,
      sourceExpression: TypedExpr): Null<TsNarrowInvalidation> {
    final value = stableValue(target);
    return value == null ? null : new TsNarrowInvalidation(
      ValueChanged(value), sourceExpression.pos);
  }

  static function callEffects(
      expression: TypedExpr): Array<TsNarrowInvalidation> {
    return switch unwrap(expression).expr {
      case TCall({expr: TField(mapExpression, field)}, arguments):
        final name = fieldAccessName(field);
        final map = stableValue(mapExpression);
        if (map == null) {
          [];
        } else if (name == "remove" && arguments.length == 1) {
          final key = stableValue(arguments[0]);
          [new TsNarrowInvalidation(key == null
            ? MapEntryPossiblyRemoved(map)
            : MapEntryRemoved(map, key), expression.pos)];
        } else if (name == "clear" && arguments.length == 0) {
          [new TsNarrowInvalidation(MapCleared(map), expression.pos)];
        } else {
          [];
        }
      default: [];
    }
  }

  static function collectEffects(
      expression: TypedExpr): Array<TsNarrowInvalidation> {
    final effects: Array<TsNarrowInvalidation> = [];
    function visit(current: TypedExpr): Void {
      // Keep this inventory exhaustive for the same reason as `analyze`: a new
      // typed expression kind must be reviewed before loop summaries can assume
      // that walking its children finds every direct mutation.
      switch current.expr {
        case TFunction(_):
          // Creating a callback does not execute its body in this scope.
          return;
        case TBinop(OpAssign | OpAssignOp(_), left, _):
          final effect = changedValueEffect(left, current);
          if (effect != null)
            effects.push(effect);
        case TUnop(OpIncrement | OpDecrement, _, target):
          final effect = changedValueEffect(target, current);
          if (effect != null)
            effects.push(effect);
        case TCall(_, _):
          for (effect in callEffects(current))
            effects.push(effect);
        case TConst(_) | TLocal(_) | TArray(_, _) | TField(_, _)
          | TTypeExpr(_) | TParenthesis(_) | TObjectDecl(_)
          | TArrayDecl(_) | TNew(_, _, _) | TBinop(_, _, _)
          | TUnop(_, _, _) | TVar(_, _) | TBlock(_) | TFor(_, _, _)
          | TIf(_, _, _) | TWhile(_, _, _) | TSwitch(_, _, _)
          | TTry(_, _) | TReturn(_) | TBreak | TContinue | TThrow(_)
          | TCast(_, _) | TMeta(_, _) | TEnumParameter(_, _, _)
          | TEnumIndex(_) | TIdent(_):
      }
      current.iter(visit);
    }
    visit(expression);
    return effects;
  }

  static function appendEffects(left: Array<TsNarrowInvalidation>,
      right: Array<TsNarrowInvalidation>): Array<TsNarrowInvalidation> {
    final result = left.copy();
    for (effect in right)
      result.push(effect);
    return result;
  }

  static function isOptionalField(field: FieldAccess): Bool {
    return switch field {
      case FAnon(reference) | FInstance(_, _, reference)
        | FStatic(_, reference):
        NullishContract.forField(reference.get()).mayBeOmitted;
      default: false;
    }
  }

  static function fieldAccessName(field: FieldAccess): Null<String> {
    return switch field {
      case FInstance(_, _, reference) | FStatic(_, reference)
        | FAnon(reference):
        TypeUtil.classFieldName(reference.get());
      case FDynamic(name): name;
      default: null;
    }
  }

  static function isNullConstant(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TConst(TNull): true;
      default: false;
    }
  }

  static function unwrap(expression: TypedExpr): TypedExpr {
    var current = expression;
    while (current != null) {
      switch current.expr {
        case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
          current = inner;
        default:
          return current;
      }
    }
    return expression;
  }
}
#end
