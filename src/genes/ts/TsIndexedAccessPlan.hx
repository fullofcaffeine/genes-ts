package genes.ts;

#if macro
import genes.CompilerDiagnostic;
import genes.Module;
import genes.NullishContract;
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Expr.Binop;
import haxe.macro.Expr.Position;
import haxe.macro.Expr.Unop;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;
using Lambda;

/** The finite compound-operation families supported by indexed planning. */
enum TsIndexedCompoundKind {
  Arithmetic(binop: Binop);
  Bitwise(binop: Binop);
  LogicalAnd;
  LogicalOr;
  Nullish;
}

/** The two JavaScript update operations that can target an indexed slot. */
enum TsIndexedUpdateKind {
  Increment;
  Decrement;
}

/** Whether an update returns its new or previous value. */
enum TsIndexedUpdateForm {
  Prefix;
  Postfix;
}

/** The role of one indexed assignment target in the final typed Haxe tree. */
enum TsIndexedTargetKind {
  PlainWrite;
  Compound(kind: TsIndexedCompoundKind);
  Update(kind: TsIndexedUpdateKind, form: TsIndexedUpdateForm);
}

/** How TypeScript can treat the value that appears before one index access. */
enum TsIndexedReceiverProjection {
  DirectReceiver;
  FlowAlreadyProvesPresent;
  BoundaryAlreadyAssertsExactRead;
  AssertOrdinaryHaxeNullableReceiver;
}

/** How an ordinary indexed value read preserves its Haxe type in TypeScript. */
enum TsIndexedReadProjection {
  DirectRead;
  NormalizeMissingToHaxeNull;
  AssertExactTypeParameter(type: Type);
  AssertConcreteSlotPresent;
}

/** The primitive JavaScript operation domain proved by Haxe's final type. */
enum TsNativeOperatorDomain {
  NumberDomain;
  StringDomain;
}

/** How the indexed root participates in a write or native read/write operation. */
enum TsIndexedTargetProjection {
  WriteOnly;
  DirectNativeReadModifyWrite;
  AssertSlotPresent;
  AssertPrimitiveCoercionDomain(domain: TsNativeOperatorDomain);
}

/** A target wrapper whose final TypeScript spelling is known before printing. */
enum TsIndexedTargetWrapper {
  Parenthesis;
  ErasedMetadata(name: String);
  ErasedImplicitCast;
}

/** One immutable decision for an ordinary indexed read occurrence. */
final class TsIndexedReadDecision {
  public final expression: TypedExpr;
  public final receiverProjection: TsIndexedReceiverProjection;
  public final resultProjection: TsIndexedReadProjection;

  public function new(expression: TypedExpr,
      receiverProjection: TsIndexedReceiverProjection,
      resultProjection: TsIndexedReadProjection) {
    this.expression = expression;
    this.receiverProjection = receiverProjection;
    this.resultProjection = resultProjection;
  }
}

/** One immutable decision for an indexed write or update occurrence. */
final class TsIndexedTargetDecision {
  public final operation: TypedExpr;
  public final authoredTarget: TypedExpr;
  public final coreArray: TypedExpr;
  public final wrappers: Array<TsIndexedTargetWrapper>;
  public final kind: TsIndexedTargetKind;
  public final receiverProjection: TsIndexedReceiverProjection;
  public final targetProjection: TsIndexedTargetProjection;

  public function new(operation: TypedExpr, authoredTarget: TypedExpr,
      coreArray: TypedExpr, wrappers: Array<TsIndexedTargetWrapper>,
      kind: TsIndexedTargetKind,
      receiverProjection: TsIndexedReceiverProjection,
      targetProjection: TsIndexedTargetProjection) {
    this.operation = operation;
    this.authoredTarget = authoredTarget;
    this.coreArray = coreArray;
    this.wrappers = wrappers.copy();
    this.kind = kind;
    this.receiverProjection = receiverProjection;
    this.targetProjection = targetProjection;
  }
}

/** One deterministic, test-only description of a planned source occurrence. */
final class TsIndexedInventoryEntry {
  public final ordinal: Int;
  public final description: String;
  public final pos: Position;

  public function new(ordinal: Int, description: String, pos: Position) {
    this.ordinal = ordinal;
    this.description = description;
    this.pos = pos;
  }
}

private typedef TsIndexedTargetRoot = {
  final core: TypedExpr;
  final wrappers: Array<TsIndexedTargetWrapper>;
}

private enum TsIndexedTargetRootResult {
  NotIndexed;
  Indexed(root: TsIndexedTargetRoot);
}

/**
 * Records every TypeScript-only decision for an indexed Haxe expression.
 *
 * Why
 * ----
 * TypeScript's `noUncheckedIndexedAccess` adds `undefined` to indexed reads.
 * Haxe does not add that type. A plain write, a numeric update, a nullable
 * receiver, and a logical assignment therefore need different TypeScript
 * treatment even when all four contain the same `values[index]` syntax.
 * Printer-local state cannot recover those roles reliably through wrappers.
 *
 * What
 * ----
 * This request-local plan stores one decision for each exact typed `TArray`
 * read and each exact parent operation whose target is an indexed expression.
 * Receiver presence, slot presence, primitive coercion, writable-target type,
 * and wrapper transparency remain separate closed facts.
 *
 * How
 * ---
 * The builder walks the final typed module once. It uses exact `TypedExpr`
 * objects as private lookup keys and consumes `NullishContract`,
 * `TsNarrowingPlan`, and `TsBoundaryPlan`. It does not inspect source text,
 * generated names, TypeScript diagnostics, or emitted code. The first landing
 * keeps this plan in shadow mode: the TypeScript emitter builds and inventories
 * it, but the established printer still owns output until the follow-up PR.
 */
final class TsIndexedAccessPlan {
  final reads: ObjectMap<TypedExpr, TsIndexedReadDecision>;
  final targets: ObjectMap<TypedExpr, TsIndexedTargetDecision>;
  final inventory: Array<TsIndexedInventoryEntry>;

  public static function build(module: Module): TsIndexedAccessPlan {
    return new TsIndexedAccessPlanBuilder().build(module);
  }

  #if genes.ts.indexed_access_inventory
  /**
   * Classifies one synthetic typed operation for the focused fixture only.
   *
   * Haxe 4.3 cannot spell retained `&&=` or `||=` in source and erases some
   * target wrappers during typing. The fixture therefore builds those exact
   * `TypedExpr` forms and sends them through the same production builder
   * methods. This hook is absent from ordinary compiler builds and never
   * authorizes output.
   */
  public static function probeTypedOperation(operation: TypedExpr): String {
    return new TsIndexedAccessPlanBuilder().probeTypedOperation(operation);
  }

  /** Classifies one synthetic ordinary indexed read for the focused fixture. */
  public static function probeTypedRead(expression: TypedExpr): String {
    return new TsIndexedAccessPlanBuilder().probeTypedRead(expression);
  }
  #end

  public function new(reads: ObjectMap<TypedExpr, TsIndexedReadDecision>,
      targets: ObjectMap<TypedExpr, TsIndexedTargetDecision>,
      inventory: Array<TsIndexedInventoryEntry>) {
    this.reads = reads;
    this.targets = targets;
    this.inventory = inventory.copy();
  }

  /** Returns the decision for one exact ordinary indexed-read occurrence. */
  public function readDecision(expression: TypedExpr): TsIndexedReadDecision {
    final decision = reads.get(expression);
    return
      decision == null ? CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] An indexed read reached TypeScript emission "
      + "without an immutable access decision.",
      expression.pos) : decision;
  }

  /** Returns the indexed target decision for one exact parent operation. */
  public function targetDecision(operation: TypedExpr): Null<TsIndexedTargetDecision> {
    return targets.get(operation);
  }

  /** Returns deterministic shadow evidence without exposing mutable storage. */
  public function inventoryEntries(): Array<TsIndexedInventoryEntry> {
    return inventory.copy();
  }

  /** Resolves only a bare, printable Haxe type parameter through safe shells. */
  public static function exactTypeParameter(type: Type, depth = 0): Null<Type> {
    if (depth > 64)
      return null;
    return switch type {
      case TInst(reference, [])
        if (reference.get().kind.match(KTypeParameter(_))):
        type;
      case TMono(reference) if (reference.get() != null):
        exactTypeParameter(reference.get(), depth + 1);
      case TLazy(resolve):
        exactTypeParameter(resolve(), depth + 1);
      case TType(_, _):
        exactTypeParameter(Context.follow(type), depth + 1);
      default:
        null;
    }
  }
}

private final class TsIndexedAccessPlanBuilder {
  final reads = new ObjectMap<TypedExpr, TsIndexedReadDecision>();
  final targets = new ObjectMap<TypedExpr, TsIndexedTargetDecision>();
  final targetRoots = new ObjectMap<TypedExpr, Bool>();
  final inventory = new Array<TsIndexedInventoryEntry>();
  var narrowingPlan: TsNarrowingPlan;
  var boundaryPlan: TsBoundaryPlan;
  var currentOwner: Null<ClassType>;
  var currentFieldName: Null<String>;

  public function new() {}

  public function build(module: Module): TsIndexedAccessPlan {
    narrowingPlan = module.tsNarrowingPlan;
    boundaryPlan = module.tsBoundaryPlan;
    for (member in module.members) {
      switch member {
        case MClass(classType, _, fields):
          for (field in fields)
            if (field.expr != null) {
              currentOwner = classType;
              currentFieldName = field.name;
              visit(field.expr);
            }
          if (classType.init != null) {
            currentFieldName = null;
            visit(classType.init);
          }
        case MMain(expression):
          currentOwner = null;
          currentFieldName = null;
          visit(expression);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new TsIndexedAccessPlan(reads, targets, inventory);
  }

  #if genes.ts.indexed_access_inventory
  public function probeTypedOperation(operation: TypedExpr): String {
    final input = switch operation.expr {
      case TBinop(OpAssign, target, _): {target: target, kind: PlainWrite};
      case TBinop(OpAssignOp(binop), target, _): {
          target: target,
          kind: Compound(classifyCompound(operation, binop))
        };
      case TUnop(OpIncrement, postFix, target): {
          target: target,
          kind: Update(Increment, postFix ? Postfix : Prefix)
        };
      case TUnop(OpDecrement, postFix, target): {
          target: target,
          kind: Update(Decrement, postFix ? Postfix : Prefix)
        };
      default:
        return
          CompilerDiagnostic.fail("[GTS-INDEX-PLAN-001] The typed probe requires an assignment or "
          + "update operation.",
          operation.pos);
    };
    final decision = planTarget(operation, input.target, input.kind);
    if (decision == null)
      return
        CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] The typed probe requires an indexed target.",
        operation.pos);
    return inventory[0].description;
  }

  public function probeTypedRead(expression: TypedExpr): String {
    switch expression.expr {
      case TArray(receiver, _):
        planRead(expression, receiver);
      default:
        return
          CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] The typed probe requires an indexed read.",
          expression.pos);
    }
    return inventory[0].description;
  }
  #end

  /** Walks each operation in evaluation order while preserving use roles. */
  function visit(expression: TypedExpr): Void {
    switch expression.expr {
      case TBinop(OpAssign, target, rhs):
        visitAssignment(expression, target, rhs, PlainWrite);
      case TBinop(OpAssignOp(binop), target, rhs):
        if (indexedBelow(target))
          visitAssignment(expression, target, rhs,
            Compound(classifyCompound(expression, binop)));
        else {
          visit(target);
          visit(rhs);
        }
      case TUnop(OpIncrement, postFix, target):
        visitUpdate(expression, target,
          Update(Increment, postFix ? Postfix : Prefix));
      case TUnop(OpDecrement, postFix, target):
        visitUpdate(expression, target,
          Update(Decrement, postFix ? Postfix : Prefix));
      case TArray(receiver, index):
        planRead(expression, receiver);
        visit(receiver);
        visit(index);
      case TFunction(func):
        for (argument in func.args)
          if (argument.value != null)
            visit(argument.value);
        visit(func.expr);
      default:
        expression.iter(visit);
    }
  }

  function visitAssignment(operation: TypedExpr, target: TypedExpr,
      rhs: TypedExpr, kind: TsIndexedTargetKind): Void {
    final planned = planTarget(operation, target, kind);
    if (planned == null)
      visit(target);
    else
      visitTargetChildren(planned);
    visit(rhs);
  }

  function visitUpdate(operation: TypedExpr, target: TypedExpr,
      kind: TsIndexedTargetKind): Void {
    final planned = planTarget(operation, target, kind);
    if (planned == null)
      visit(target);
    else
      visitTargetChildren(planned);
  }

  function visitTargetChildren(decision: TsIndexedTargetDecision): Void {
    switch decision.coreArray.expr {
      case TArray(receiver, index):
        visit(receiver);
        visit(index);
      default:
        CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] A planned indexed target lost its TArray root.",
          decision.coreArray.pos);
    }
  }

  function planRead(expression: TypedExpr, receiver: TypedExpr): Void {
    if (reads.exists(expression) || targetRoots.exists(expression))
      CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] One typed indexed expression appeared in more "
        + "than one source role.",
        expression.pos);
    final decision = new TsIndexedReadDecision(expression,
      planReceiver(receiver), planReadProjection(expression, receiver));
    reads.set(expression, decision);
    record("read:"
      + describeReceiver(decision.receiverProjection)
      + ":"
      + describeRead(decision.resultProjection),
      expression.pos);
  }

  function planTarget(operation: TypedExpr, authoredTarget: TypedExpr,
      kind: TsIndexedTargetKind): Null<TsIndexedTargetDecision> {
    final root = switch unwrapTarget(authoredTarget) {
      case NotIndexed: return null;
      case Indexed(found): found;
    }
    if (targets.exists(operation) || reads.exists(root.core)
      || targetRoots.exists(root.core))
      CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] One typed indexed target appeared in more than "
        + "one source role.",
        operation.pos);

    final receiver = switch root.core.expr {
      case TArray(found, _): found;
      default: return
          CompilerDiagnostic.fail("[GTS-INDEX-PLAN-002] A planned indexed target has no TArray root.",
          root.core.pos);
    }
    final decision = new TsIndexedTargetDecision(operation, authoredTarget,
      root.core, root.wrappers, kind, planReceiver(receiver),
      planTargetProjection(root.core, kind));
    targets.set(operation, decision);
    targetRoots.set(root.core, true);
    record("target:" + describeTargetKind(kind) + ":"
      + describeReceiver(decision.receiverProjection) + ":"
      + describeTargetProjection(decision.targetProjection) + ":wrappers="
      + describeWrappers(root.wrappers),
      operation.pos);
    return decision;
  }

  static function classifyCompound(expression: TypedExpr,
      binop: Binop): TsIndexedCompoundKind {
    return switch binop {
      case OpAdd | OpSub | OpMult | OpDiv | OpMod:
        Arithmetic(binop);
      case OpAnd | OpOr | OpXor | OpShl | OpShr | OpUShr:
        Bitwise(binop);
      case OpBoolAnd:
        LogicalAnd;
      case OpBoolOr:
        LogicalOr;
      case OpNullCoal:
        Nullish;
      default:
        CompilerDiagnostic.fail("[GTS-INDEX-PLAN-001] This indexed read/write operator is not part "
          + "of the reviewed TypeScript operation matrix.",
          expression.pos);
    }
  }

  function unwrapTarget(target: TypedExpr): TsIndexedTargetRootResult {
    final wrappers = new Array<TsIndexedTargetWrapper>();
    var current = target;
    while (true) {
      switch current.expr {
        case TParenthesis(inner):
          wrappers.push(Parenthesis);
          current = inner;
        case TMeta(metadata, inner):
          if (metadata.name == ":loopLabel"
            || metadata.name == "loopLabel"
            || metadata.name == ":jsAsync"
            || metadata.name == "jsAsync")
            return
              indexedBelow(inner) ? CompilerDiagnostic.fail("[GTS-INDEX-WRAP-001] Syntax-producing metadata cannot wrap an "
              + "indexed assignment target.",
              current.pos) : NotIndexed;
          wrappers.push(ErasedMetadata(metadata.name));
          current = inner;
        case TCast(inner, null):
          if (!implicitCastIsTransparent(current, inner))
            return
              indexedBelow(inner) ? CompilerDiagnostic.fail("[GTS-INDEX-WRAP-001] This implicit cast changes the TypeScript "
              + "assignment target and cannot be erased safely.",
              current.pos) : NotIndexed;
          wrappers.push(ErasedImplicitCast);
          current = inner;
        case TCast(inner, _):
          return
            indexedBelow(inner) ? CompilerDiagnostic.fail("[GTS-INDEX-WRAP-001] A runtime or explicit cast cannot remain a "
            + "writable indexed target.",
            current.pos) : NotIndexed;
        case TArray(_, _):
          return Indexed({core: current, wrappers: wrappers});
        default:
          return NotIndexed;
      }
    }
    return NotIndexed;
  }

  static function indexedBelow(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TArray(_, _): true;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        indexedBelow(inner);
      default: false;
    }
  }

  function implicitCastIsTransparent(castExpression: TypedExpr,
      inner: TypedExpr): Bool {
    return TsBoundaryPlan.hasExactTypeIdentity(castExpression.t, inner.t)
      || TsBoundaryPlan.acceptsTopLevelWidening(castExpression.t, inner.t)
      || (boundaryPlan != null
        && boundaryPlan.localReadNeedsNonNullAssertion(inner))
      || isFlowProvedPresent(inner);
  }

  function planReceiver(receiver: TypedExpr): TsIndexedReceiverProjection {
    final contract = NullishContract.forType(receiver.t);
    if (contract.dynamicBoundary)
      return DirectReceiver;
    if (hasUnresolvedRoot(receiver.t))
      return
        CompilerDiagnostic.fail("[GTS-INDEX-BOUNDARY-001] An unresolved receiver type cannot authorize "
        + "a TypeScript indexed access.",
        receiver.pos);
    if (boundaryPlan != null
      && boundaryPlan.localReadNeedsNonNullAssertion(receiver))
      return BoundaryAlreadyAssertsExactRead;
    if (isFlowProvedPresent(receiver))
      return FlowAlreadyProvesPresent;
    if (contract.explicitUndefined || contract.unknownBoundary)
      return
        CompilerDiagnostic.fail("[GTS-INDEX-BOUNDARY-001] An undefined-aware or unknown receiver must "
        + "be converted or narrowed before indexed access.",
        receiver.pos);
    return
      contract.haxeAllowsNull ? AssertOrdinaryHaxeNullableReceiver : DirectReceiver;
  }

  function isFlowProvedPresent(expression: TypedExpr): Bool {
    return narrowingPlan != null
      && narrowingPlan.decisionAt(expression) != null
      && narrowingPlan.identityForRead(expression) != null
      && narrowingPlan.isKnownNonNull(expression);
  }

  function planReadProjection(expression: TypedExpr,
      receiver: TypedExpr): TsIndexedReadProjection {
    final contract = NullishContract.forType(expression.t);
    if (contract.dynamicBoundary
      || NullishContract.forType(receiver.t).dynamicBoundary)
      return DirectRead;
    // Haxe's JS standard library uses untyped indexed reads for its two global
    // type registries and inside Type.enumParameters. Those exact compiler
    // identities can retain an unresolved result even though their Haxe
    // contract uses null for a missing value. No other unresolved read enters.
    if (hasUnresolvedMonomorph(expression.t)
      && (isDynamicAccessWithDynamicPayload(receiver.t)
        || isHaxeDynamicRegistry(receiver) || isHaxeTypeEnumParameters()))
      return NormalizeMissingToHaxeNull;
    if (hasUnresolvedMonomorph(expression.t))
      return
        CompilerDiagnostic.fail("[GTS-INDEX-BOUNDARY-001] An unresolved indexed-result type cannot "
        + "authorize a TypeScript read projection.",
        expression.pos);
    if (contract.preservesUndefined)
      return DirectRead;
    if (contract.haxeAllowsNull)
      return NormalizeMissingToHaxeNull;
    final parameter = TsIndexedAccessPlan.exactTypeParameter(expression.t);
    return
      parameter == null ? AssertConcreteSlotPresent : AssertExactTypeParameter(parameter);
  }

  static function planTargetProjection(core: TypedExpr,
      kind: TsIndexedTargetKind): TsIndexedTargetProjection {
    final contract = NullishContract.forType(core.t);
    if (contract.dynamicBoundary || indexedReceiverIsDynamic(core)
      || indexedReceiverIsHaxeDynamicRegistry(core))
      return kind == PlainWrite ? WriteOnly : DirectNativeReadModifyWrite;
    if (hasUnresolvedMonomorph(core.t))
      return
        CompilerDiagnostic.fail("[GTS-INDEX-BOUNDARY-001] An unresolved indexed-target type cannot "
        + "authorize a TypeScript write or update.",
        core.pos);
    if (kind == PlainWrite)
      return WriteOnly;
    return switch kind {
      case PlainWrite:
        WriteOnly;
      case Compound(LogicalAnd | LogicalOr | Nullish):
        DirectNativeReadModifyWrite;
      case Compound(Arithmetic(binop)):
        planPrimitiveOperation(core, contract, binop, false);
      case Compound(Bitwise(binop)):
        planPrimitiveOperation(core, contract, binop, true);
      case Update(_, _):
        planPrimitiveOperation(core, contract, null, true);
    }
  }

  static function planPrimitiveOperation(core: TypedExpr,
      contract: NullishContract, binop: Null<Binop>,
      numericOnly: Bool): TsIndexedTargetProjection {
    if (contract.dynamicBoundary)
      return DirectNativeReadModifyWrite;
    if (contract.preservesUndefined)
      return
        CompilerDiagnostic.fail("[GTS-INDEX-BOUNDARY-001] Arithmetic and update operations cannot "
        + "erase an explicit undefined or unknown indexed boundary.",
        core.pos);
    final domain = primitiveDomain(NullishContract.stripHaxeNull(core.t),
      binop, numericOnly);
    if (domain == null)
      return
        CompilerDiagnostic.fail("[GTS-INDEX-DOMAIN-001] The indexed operation has no reviewed native "
        + "number or string domain.",
        core.pos);
    return
      contract.haxeAllowsNull ? AssertPrimitiveCoercionDomain(domain) : AssertSlotPresent;
  }

  static function primitiveDomain(type: Type, binop: Null<Binop>,
      numericOnly: Bool, depth = 0): Null<TsNativeOperatorDomain> {
    if (depth > 64)
      return null;
    return switch type {
      case TMono(reference) if (reference.get() != null):
        primitiveDomain(reference.get(), binop, numericOnly, depth + 1);
      case TLazy(resolve):
        primitiveDomain(resolve(), binop, numericOnly, depth + 1);
      case TType(_, _):
        primitiveDomain(Context.follow(type), binop, numericOnly, depth + 1);
      case TAbstract(reference, _):
        final abstractType = reference.get();
        if (abstractType.pack.length == 0
          && abstractType.module == "StdTypes"
          && (abstractType.name == "Int" || abstractType.name == "Float"
            || abstractType.name == "UInt")) NumberDomain else null;
      case TInst(reference, []):
        final classType = reference.get();
        if (!numericOnly && binop == OpAdd && classType.pack.length == 0
          && classType.module == "String" && classType.name == "String")
          StringDomain else null;
      default:
        null;
    }
  }

  static function indexedReceiverIsDynamic(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TArray(receiver, _): NullishContract.forType(receiver.t)
          .dynamicBoundary || isDynamicAccessWithDynamicPayload(receiver.t);
      default:
        false;
    }
  }

  /** Whether an indexed target writes Haxe's own heterogeneous registry. */
  static function indexedReceiverIsHaxeDynamicRegistry(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TArray(receiver, _): isHaxeDynamicRegistry(receiver);
      default: false;
    }
  }

  /** Recognizes only Haxe's exact DynamicAccess<Dynamic> dictionary contract. */
  static function isDynamicAccessWithDynamicPayload(type: Type,
      depth = 0): Bool {
    if (depth > 64)
      return false;
    return switch type {
      case TMono(reference) if (reference.get() != null):
        isDynamicAccessWithDynamicPayload(reference.get(), depth + 1);
      case TLazy(resolve):
        isDynamicAccessWithDynamicPayload(resolve(), depth + 1);
      case TType(_, _):
        isDynamicAccessWithDynamicPayload(Context.follow(type), depth + 1);
      case TAbstract(reference, [payload]):
        final abstractType = reference.get();
        abstractType.pack.length == 1
        && abstractType.pack[0] == "haxe"
        && abstractType.module == "haxe.DynamicAccess"
        && abstractType.name == "DynamicAccess"
        && NullishContract.forType(payload).dynamicBoundary;
      default:
        false;
    }
  }

  /** Recognizes Haxe's two compiler-owned heterogeneous runtime registries. */
  static function isHaxeDynamicRegistry(expression: TypedExpr): Bool {
    return switch expression.expr {
      // TIdent is the complete typed identity for these JS-generator
      // intrinsics; it has no ClassField or ModuleType owner.
      case TIdent("$hxClasses" | "$hxEnums"): true;
      case TArray(inner, _) | TField(inner, _):
        isHaxeDynamicRegistry(inner);
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        isHaxeDynamicRegistry(inner);
      default: false;
    }
  }

  /** Recognizes only the untyped parameter read in Haxe's standard Type API. */
  function isHaxeTypeEnumParameters(): Bool {
    if (currentOwner == null || currentFieldName == null)
      return false;
    return currentOwner.pack.length == 0 && currentOwner.module == "Type"
      && currentOwner.name == "Type" && currentFieldName == "enumParameters";
  }

  static function hasUnresolvedMonomorph(type: Type, depth = 0): Bool {
    if (depth > 64)
      return true;
    return switch type {
      case TMono(reference): final resolved = reference.get(); resolved == null || hasUnresolvedMonomorph(resolved,
          depth
          + 1);
      case TLazy(resolve):
        hasUnresolvedMonomorph(resolve(), depth + 1);
      case TType(_, parameters) | TInst(_, parameters) |
        TEnum(_, parameters) | TAbstract(_, parameters):
        parameters.exists(parameter -> hasUnresolvedMonomorph(parameter,
          depth + 1));
      case TFun(arguments, result): arguments.exists(argument ->
          hasUnresolvedMonomorph(argument.t, depth
          + 1)) || hasUnresolvedMonomorph(result, depth + 1);
      case TDynamic(inner): inner != null && hasUnresolvedMonomorph(inner,
          depth + 1);
      case TAnonymous(reference):
        reference.get()
          .fields.exists(field -> hasUnresolvedMonomorph(field.type,
            depth + 1));
      default:
        false;
    }
  }

  /** Whether only the receiver itself, rather than a nested element, is open. */
  static function hasUnresolvedRoot(type: Type, depth = 0): Bool {
    if (depth > 64)
      return true;
    return switch type {
      case TMono(reference): final resolved = reference.get(); resolved == null || hasUnresolvedRoot(resolved,
          depth
          + 1);
      case TLazy(resolve):
        hasUnresolvedRoot(resolve(), depth + 1);
      case TType(_, _):
        hasUnresolvedRoot(Context.follow(type), depth + 1);
      default:
        false;
    }
  }

  function record(description: String, pos: Position): Void {
    inventory.push(new TsIndexedInventoryEntry(inventory.length, description,
      pos));
  }

  static function describeReceiver(projection: TsIndexedReceiverProjection): String {
    return switch projection {
      case DirectReceiver: "direct";
      case FlowAlreadyProvesPresent: "flow-present";
      case BoundaryAlreadyAssertsExactRead: "boundary-present";
      case AssertOrdinaryHaxeNullableReceiver: "assert-nullable";
    }
  }

  static function describeRead(projection: TsIndexedReadProjection): String {
    return switch projection {
      case DirectRead: "direct";
      case NormalizeMissingToHaxeNull: "normalize-null";
      case AssertExactTypeParameter(_): "assert-type-parameter";
      case AssertConcreteSlotPresent: "assert-slot";
    }
  }

  static function describeTargetKind(kind: TsIndexedTargetKind): String {
    return switch kind {
      case PlainWrite: "write";
      case Compound(Arithmetic(binop)): "arithmetic-" + binop;
      case Compound(Bitwise(binop)): "bitwise-" + binop;
      case Compound(LogicalAnd): "logical-and";
      case Compound(LogicalOr): "logical-or";
      case Compound(Nullish): "nullish";
      case Update(Increment, Prefix): "prefix-increment";
      case Update(Increment, Postfix): "postfix-increment";
      case Update(Decrement, Prefix): "prefix-decrement";
      case Update(Decrement, Postfix): "postfix-decrement";
    }
  }

  static function describeTargetProjection(projection: TsIndexedTargetProjection): String {
    return switch projection {
      case WriteOnly: "write-only";
      case DirectNativeReadModifyWrite: "direct-rmw";
      case AssertSlotPresent: "assert-slot";
      case AssertPrimitiveCoercionDomain(NumberDomain): "coerce-number";
      case AssertPrimitiveCoercionDomain(StringDomain): "coerce-string";
    }
  }

  static function describeWrappers(wrappers: Array<TsIndexedTargetWrapper>): String {
    if (wrappers.length == 0)
      return "none";
    return wrappers.map(wrapper -> switch wrapper {
      case Parenthesis: "parenthesis";
      case ErasedMetadata(name): "metadata(" + name + ")";
      case ErasedImplicitCast: "implicit-cast";
    }).join(",");
  }
}
#end
