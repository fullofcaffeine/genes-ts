import ts from "../typescript-api.js";

/**
 * Stable identifiers for JavaScript semantics that ts2hx either preserves or
 * rejects deliberately.
 *
 * Why: a source-to-source translator must not equate "the generated Haxe
 * compiled" with semantic support. These identifiers let the normalizer record
 * the exact contract used by each source construct before a Haxe printer runs.
 *
 * What: every entry has a support level and a portability grade. `J1` means the
 * behavior is preserved for Haxe's JavaScript target through a named helper;
 * `P0` is ordinary Haxe; `U` is rejected in strict mode.
 *
 * How: the feature table is emitted into each translation manifest and the
 * semantic differential harness asserts the exercised occurrences. IDs are an
 * external diagnostic/reporting contract and must remain stable.
 */
export type SemanticFeatureId =
  | "values.explicit-undefined"
  | "parameters.undefined-default"
  | "locals.uninitialized"
  | "coercion.truthiness"
  | "coercion.strict-equality"
  | "coercion.unary-plus"
  | "evaluation.compound-assignment"
  | "loops.for-continue-step"
  | "switch.fallthrough"
  | "switch.continue"
  | "exceptions.try-catch"
  | "exceptions.finally"
  | "exceptions.finally-outer-transfer"
  | "this.class-and-lexical-arrow"
  | "prototypes.dynamic-mutation"
  | "async.await"
  | "modules.esm-bindings"
  | "modules.esm-runtime-requests"
  | "modules.side-effect-import";

export type SemanticCategory =
  | "values"
  | "parameters"
  | "locals"
  | "coercion"
  | "evaluation-order"
  | "control-flow"
  | "exceptions"
  | "object-model"
  | "async"
  | "modules";

export type SemanticSupport = "supported" | "supported-with-helper" | "unsupported";
export type PortabilityGrade = "P0" | "P1" | "J1" | "A" | "U";

export type SemanticFeatureContract = {
  id: SemanticFeatureId;
  category: SemanticCategory;
  support: SemanticSupport;
  portableGrade: PortabilityGrade;
  summary: string;
  limitation: string | null;
};

export const SEMANTIC_SUPPORT_MATRIX: readonly SemanticFeatureContract[] = [
  {
    id: "values.explicit-undefined",
    category: "values",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves JavaScript undefined as distinct from null.",
    limitation: null
  },
  {
    id: "parameters.undefined-default",
    category: "parameters",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Runs a default initializer only for omission or exact undefined.",
    limitation: null
  },
  {
    id: "locals.uninitialized",
    category: "locals",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Keeps an explicitly typed local uninitialized, using real undefined when the source type exposes it.",
    limitation: "An uninitialized declaration without an explicit type is rejected."
  },
  {
    id: "coercion.truthiness",
    category: "coercion",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Uses exact JavaScript boolean coercion in conditions and logical expressions.",
    limitation: null
  },
  {
    id: "coercion.strict-equality",
    category: "coercion",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves TypeScript strict equality and switch case identity without host coercion.",
    limitation: null
  },
  {
    id: "coercion.unary-plus",
    category: "coercion",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves JavaScript unary-plus numeric coercion through a typed genes helper.",
    limitation: null
  },
  {
    id: "evaluation.compound-assignment",
    category: "evaluation-order",
    support: "supported",
    portableGrade: "P0",
    summary: "Evaluates compound-assignment receivers, keys, prior values, and RHS once in JavaScript order.",
    limitation: "The supported lvalue subset is identifiers, property access, and element access."
  },
  {
    id: "loops.for-continue-step",
    category: "control-flow",
    support: "supported",
    portableGrade: "P0",
    summary: "Runs a lowered for-loop increment before continue targets the loop again.",
    limitation: "Labeled continue is not supported."
  },
  {
    id: "switch.fallthrough",
    category: "control-flow",
    support: "supported",
    portableGrade: "P0",
    summary: "Preserves case search, default position, fallthrough, and break with a normalized state machine.",
    limitation: null
  },
  {
    id: "switch.continue",
    category: "control-flow",
    support: "supported",
    portableGrade: "P0",
    summary: "Propagates unlabelled continue from a lowered switch to its real enclosing loop.",
    limitation: "Labeled continue remains unsupported."
  },
  {
    id: "exceptions.try-catch",
    category: "exceptions",
    support: "supported",
    portableGrade: "P0",
    summary: "Preserves ordinary try/catch and exception propagation.",
    limitation: null
  },
  {
    id: "exceptions.finally",
    category: "exceptions",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves finally ordering and propagation through typed local or completion-aware helpers.",
    limitation: "The promoted contract remains local completion; synchronous typed return crossing is staged evidence, while loop transfers and excluded function forms still fail closed."
  },
  {
    id: "exceptions.finally-outer-transfer",
    category: "exceptions",
    support: "unsupported",
    portableGrade: "U",
    summary: "Typed synchronous return completion is normalized as staged evidence, but the broader outer-transfer row is not yet promoted.",
    limitation: "Break/continue, async, generators, constructors, anonymous forms, labels, and unsupported return carriers remain fail closed until the complete target differential lands."
  },
  {
    id: "this.class-and-lexical-arrow",
    category: "object-model",
    support: "supported",
    portableGrade: "P0",
    summary: "Preserves class-method this and lexical arrow capture in the supported class subset.",
    limitation: null
  },
  {
    id: "prototypes.dynamic-mutation",
    category: "object-model",
    support: "unsupported",
    portableGrade: "U",
    summary: "Dynamic prototype mutation is outside the strict translated-Haxe subset.",
    limitation: "Use an explicit typed extern/helper boundary or assisted mode."
  },
  {
    id: "async.await",
    category: "async",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Lowers async/await through genes.js.Async for the JavaScript target.",
    limitation: null
  },
  {
    id: "modules.esm-bindings",
    category: "modules",
    support: "supported",
    portableGrade: "J1",
    summary: "Preserves supported direct ESM names, aliases, type/value roles, and immutable value reads after runtime-request planning.",
    limitation: "It does not own request retention/order, mutable live bindings, package loading, converted cycles, or runtime re-exports."
  },
  {
    id: "modules.esm-runtime-requests",
    category: "modules",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves every supported effective ESM request in configured TypeScript emit order across both Genes profiles.",
    limitation: "The capability requires genes-esm; standard Haxe, non-ESM emit, converted cycles, and runtime re-exports fail closed."
  },
  {
    id: "modules.side-effect-import",
    category: "modules",
    support: "supported-with-helper",
    portableGrade: "J1",
    summary: "Preserves binding-free packages, manifest-owned external-relative resources, and acyclic converted imports through the shared request plan.",
    limitation: "Unresolved or unconverted sources, unmanifested runtime files, and unsupported attribute/resource shapes remain strict failures."
  }
];

export type SemanticFailClosedCase = {
  featureId: SemanticFeatureId;
  diagnosticId: string;
  variant: string;
};

/**
 * Canonical lossy variants exercised by the strict semantic fixture.
 *
 * Why: a supported feature may still reject a narrower variant, such as a
 * labeled continue. Counting only unsupported feature rows would therefore
 * understate the fail-closed evidence, while counting diagnostics directly in
 * tests would leave public documentation vulnerable to stale hard-coded
 * numbers.
 *
 * What: each entry links one stable diagnostic to the semantic contract whose
 * boundary it proves. This is evidence inventory, not an exhaustive catalog of
 * every syntax error the translator can report.
 *
 * How: the three-runtime differential test derives its expected diagnostics
 * from this table, and the documentation gate derives the advertised strict
 * failure count from the same owner.
 */
export const SEMANTIC_FAIL_CLOSED_CASES: readonly SemanticFailClosedCase[] = [
  {
    featureId: "exceptions.finally-outer-transfer",
    diagnosticId: "TS2HX-EXCEPTIONS-FINALLY-OUTER-TRANSFER-001",
    variant: "outer completion in an excluded async or unsupported target/carrier context"
  },
  {
    featureId: "modules.side-effect-import",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001",
    variant: "unsupported import attribute shape"
  },
  {
    featureId: "modules.esm-runtime-requests",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001",
    variant: "converted runtime-request cycle"
  },
  {
    featureId: "modules.side-effect-import",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-EXTERNAL-RELATIVE-001",
    variant: "external relative runtime file without a staging manifest"
  },
  {
    featureId: "modules.esm-runtime-requests",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001",
    variant: "runtime re-export without an ordered live-binding plan"
  },
  {
    featureId: "modules.side-effect-import",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNCONVERTED-SOURCE-001",
    variant: "relative source outside the conversion set"
  },
  {
    featureId: "modules.side-effect-import",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNRESOLVED-001",
    variant: "unresolved relative runtime request"
  },
  {
    featureId: "modules.esm-bindings",
    diagnosticId: "TS2HX-MODULES-ESM-BINDINGS-LIVE-001",
    variant: "mutable imported live binding"
  },
  {
    featureId: "modules.esm-runtime-requests",
    diagnosticId: "TS2HX-MODULES-ESM-RUNTIME-MODULE-KIND-001",
    variant: "configured non-ESM module lowering"
  },
  {
    featureId: "modules.esm-bindings",
    diagnosticId: "TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001",
    variant: "bound package runtime request"
  },
  {
    featureId: "modules.esm-runtime-requests",
    diagnosticId: "TS2HX-MODULES-ESM-RUNTIME-TARGET-001",
    variant: "effective request under the request-free standard-Haxe profile"
  },
  {
    featureId: "prototypes.dynamic-mutation",
    diagnosticId: "TS2HX-PROTOTYPES-DYNAMIC-MUTATION-001",
    variant: "dynamic prototype mutation"
  },
  {
    featureId: "switch.continue",
    diagnosticId: "TS2HX-SWITCH-CONTINUE-001",
    variant: "labeled continue from a switch"
  }
];

export type SemanticSource = {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
  syntaxKind: string;
};

export type SemanticFeatureUse = {
  featureId: SemanticFeatureId;
  source: SemanticSource;
};

export type SemanticFeatureDisposition = SemanticFeatureContract & {
  occurrences: SemanticSource[];
};

/** Builds one stable, one-based source record shared by semantic plans. */
function semanticSourceForNode(sourceFile: string, sf: ts.SourceFile,
  node: ts.Node): SemanticSource {
  const start = node.getStart(sf, false);
  const end = node.getEnd();
  const position = sf.getLineAndCharacterOfPosition(start);
  return {
    file: sourceFile,
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
    syntaxKind: ts.SyntaxKind[node.kind] ?? `SyntaxKind(${node.kind})`
  };
}

/** Collects deterministic feature provenance while semantic plans are built. */
export class SemanticRecorder {
  private readonly uses = new Map<string, SemanticFeatureUse>();

  public record(featureId: SemanticFeatureId, sourceFile: string, sf: ts.SourceFile, node: ts.Node): void {
    const source = semanticSourceForNode(sourceFile, sf, node);
    const key = `${featureId}\u0000${source.file}\u0000${source.start}\u0000${source.end}`;
    this.uses.set(key, { featureId, source });
  }

  /** Returns the complete stable matrix, annotated with occurrences in this run. */
  public dispositions(): SemanticFeatureDisposition[] {
    const allUses = Array.from(this.uses.values()).sort((a, b) =>
      a.featureId.localeCompare(b.featureId)
      || a.source.file.localeCompare(b.source.file)
      || a.source.start - b.source.start
    );

    return SEMANTIC_SUPPORT_MATRIX.map((contract) => ({
      ...contract,
      occurrences: allUses
        .filter((use) => use.featureId === contract.id)
        .map((use) => use.source)
    }));
  }
}

export type ConditionPlan = {
  expression: ts.Expression;
  coercion: "boolean" | "nullish-object" | "js-truthiness";
};

/** Classifies a condition before the Haxe printer chooses its spelling. */
export function planCondition(checker: ts.TypeChecker, expression: ts.Expression): ConditionPlan {
  const type = checker.getTypeAtLocation(expression);
  const flags = type.getFlags();
  const isBoolean = (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0;
  if (isBoolean) return { expression, coercion: "boolean" };

  const constituents = type.isUnion() ? type.types : [type];
  const hasNullish = constituents.some((item) =>
    (item.getFlags() & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0
  );
  const concrete = constituents.filter((item) =>
    (item.getFlags() & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0
  );
  const concreteAlwaysTruthyObjects = concrete.length > 0 && concrete.every((item) =>
    (item.getFlags() & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) !== 0
  );
  if (hasNullish && concreteAlwaysTruthyObjects)
    return { expression, coercion: "nullish-object" };

  return { expression, coercion: "js-truthiness" };
}

export type ParameterPlan = {
  parameter: ts.ParameterDeclaration;
  name: string;
  isRest: boolean;
  isOptional: boolean;
  defaultValue: ts.Expression | null;
  defaultGuard: "exact-undefined" | null;
};

/** Normalizes absence/default semantics independently from Haxe syntax. */
export function planParameter(parameter: ts.ParameterDeclaration, index: number): ParameterPlan {
  return {
    parameter,
    name: ts.isIdentifier(parameter.name) ? parameter.name.text : `_p${index}`,
    isRest: parameter.dotDotDotToken !== undefined,
    isOptional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
    defaultValue: parameter.initializer ?? null,
    defaultGuard: parameter.initializer ? "exact-undefined" : null
  };
}

export type LocalDeclarationPlan =
  | { kind: "initialized"; declaration: ts.VariableDeclaration; initializer: ts.Expression }
  | { kind: "uninitialized"; declaration: ts.VariableDeclaration; explicitType: ts.TypeNode }
  | { kind: "unsupported-inferred-uninitialized"; declaration: ts.VariableDeclaration };

/** Refuses to invent a runtime value for a JavaScript-uninitialized local. */
export function planLocalDeclaration(declaration: ts.VariableDeclaration): LocalDeclarationPlan {
  if (declaration.initializer)
    return { kind: "initialized", declaration, initializer: declaration.initializer };
  if (declaration.type)
    return { kind: "uninitialized", declaration, explicitType: declaration.type };
  return { kind: "unsupported-inferred-uninitialized", declaration };
}

export type ForLoopPlan = {
  statement: ts.ForStatement;
  initializer: ts.ForInitializer;
  condition: ts.Expression;
  continueStep: ts.Expression;
};

export type AssignmentTargetPlan =
  | { kind: "identifier"; identifier: ts.Identifier }
  | { kind: "property"; receiver: ts.Expression; property: ts.Identifier }
  | { kind: "element"; receiver: ts.Expression; key: ts.Expression }
  | { kind: "unsupported"; expression: ts.Expression };

/** Separates lvalue evaluation from assignment rendering. */
export function planAssignmentTarget(expression: ts.Expression): AssignmentTargetPlan {
  const target = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(target)) return { kind: "identifier", identifier: target };
  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.name))
    return { kind: "property", receiver: target.expression, property: target.name };
  if (ts.isElementAccessExpression(target) && target.argumentExpression)
    return { kind: "element", receiver: target.expression, key: target.argumentExpression };
  return { kind: "unsupported", expression: target };
}

/** Detects writes whose receiver chain crosses JavaScript's prototype object. */
export function isPrototypeMutationTarget(expression: ts.Expression): boolean {
  const target = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (ts.isPropertyAccessExpression(target)) {
    if (target.name.text === "prototype") return true;
    return isPrototypeMutationTarget(target.expression);
  }
  if (ts.isElementAccessExpression(target)) {
    if (target.argumentExpression && ts.isStringLiteral(target.argumentExpression)
      && target.argumentExpression.text === "prototype") return true;
    return isPrototypeMutationTarget(target.expression);
  }
  return false;
}

export function planForLoop(statement: ts.ForStatement): ForLoopPlan | null {
  if (!statement.initializer || !statement.condition || !statement.incrementor) return null;
  return {
    statement,
    initializer: statement.initializer,
    condition: statement.condition,
    continueStep: statement.incrementor
  };
}

export type SwitchClausePlan = {
  index: number;
  label: ts.Expression | null;
  statements: readonly ts.Statement[];
};

/**
 * Describes the control transfer a lowered switch must preserve.
 *
 * Why: Haxe has no JavaScript-style switch fallthrough, so the emitter renders
 * a switch as a state machine inside a synthetic `do/while(false)`. A plain
 * emitted `continue` would target that synthetic loop instead of the source
 * loop and silently change behavior.
 *
 * What: `outer-loop` identifies the first unlabelled continue that escapes the
 * switch; `unsupported-labeled` retains the exact source node for a stable
 * diagnostic; `none` permits the simpler state machine.
 *
 * How: the emitter turns `outer-loop` into an explicit flag/break transfer and
 * propagates it through any enclosing lowered switches before continuing the
 * real loop. The source node also owns manifest provenance.
 */
export type SwitchContinuePlan =
  | { kind: "none" }
  | { kind: "outer-loop"; statement: ts.ContinueStatement }
  | { kind: "unsupported-labeled"; statement: ts.ContinueStatement };

export type SwitchPlan = {
  statement: ts.SwitchStatement;
  discriminant: ts.Expression;
  clauses: SwitchClausePlan[];
  defaultIndex: number | null;
  continuePlan: SwitchContinuePlan;
};

/**
 * Classifies continue statements that would escape a switch in JavaScript.
 *
 * Why: merely searching for `continue` is incorrect. A continue inside a real
 * nested loop belongs to that loop, while one inside a nested switch still
 * targets the surrounding real loop. Function/class bodies are separate
 * control-flow regions and must not affect their containing switch.
 *
 * What: the walk returns one representative source node and the strongest
 * required disposition. Any labeled continue makes the switch fail closed;
 * otherwise an unlabelled continue at real-loop depth zero requests transfer.
 *
 * How: iteration statements increment `loopDepth`; nested switches deliberately
 * do not. Traversal stops at function/class boundaries and after finding an
 * unsupported labeled variant. Rendering details remain in the emitter.
 */
function planContinueEscapingSwitch(root: ts.Node): SwitchContinuePlan {
  let plan: SwitchContinuePlan = { kind: "none" };
  function visit(node: ts.Node, loopDepth: number): void {
    if (plan.kind === "unsupported-labeled") return;
    if (node !== root && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    if (ts.isContinueStatement(node)) {
      if (node.label) plan = { kind: "unsupported-labeled", statement: node };
      else if (loopDepth === 0 && plan.kind === "none")
        plan = { kind: "outer-loop", statement: node };
      return;
    }
    const nextLoopDepth = ts.isIterationStatement(node, false) ? loopDepth + 1 : loopDepth;
    ts.forEachChild(node, (child) => visit(child, nextLoopDepth));
  }
  visit(root, 0);
  return plan;
}

function hasTransferEscapingCallback(root: ts.Node): boolean {
  let found = false;
  function visit(node: ts.Node, loopDepth: number, breakableDepth: number): void {
    if (found) return;
    if (node !== root && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    if (ts.isContinueStatement(node)) {
      if (node.label || loopDepth === 0) found = true;
      return;
    }
    if (ts.isBreakStatement(node)) {
      if (node.label || breakableDepth === 0) found = true;
      return;
    }

    const isLoop = ts.isIterationStatement(node, false);
    const isBreakable = isLoop || ts.isSwitchStatement(node);
    ts.forEachChild(node, (child) => visit(
      child,
      isLoop ? loopDepth + 1 : loopDepth,
      isBreakable ? breakableDepth + 1 : breakableDepth
    ));
  }
  visit(root, 0, 0);
  return found;
}

/** Stable, source-local identifiers used only by completion planning. */
export type CompletionFunctionId = `function:${number}`;
export type CompletionCallbackId = `${CompletionFunctionId}/callback:${number}`;
export type CompletionFinallyId = `${CompletionFunctionId}/finally:${number}`;
export type CompletionTargetId = `${CompletionFunctionId}/target:${number}`;
export type CompletionTransferId = `${CompletionFunctionId}/transfer:${number}`;
export type CompletionCallbackPath = readonly CompletionCallbackId[];

export type CompletionFunctionForm =
  | "function-declaration"
  | "class-method"
  | "constructor"
  | "function-expression"
  | "arrow"
  | "object-method"
  | "accessor"
  | "other";

export type CompletionFunctionExclusion =
  | "async"
  | "generator"
  | "constructor"
  | "anonymous-function-form"
  | "object-method"
  | "accessor"
  | "generic-function"
  | "expression-body";

export type CompletionReturnCarrierFailure =
  | "missing-explicit-return-type"
  | "mixed-bare-and-value-return"
  | "value-return-in-void-function"
  | "bare-return-in-value-function"
  | "weak-return-type";

/**
 * Describes the generic payload required only when a return crosses a callback.
 *
 * `unused` deliberately covers functions whose only crossing transfers are
 * break/continue; their future carrier can instantiate the abrupt enum with
 * `Void`. A nullable source payload remains a value carrier because normal
 * callback completion is represented outside the enum as `null`.
 */
export type CompletionReturnCarrierPlan =
  | Readonly<{ kind: "unused" }>
  | Readonly<{ kind: "void"; sourceType: ts.TypeNode }>
  | Readonly<{ kind: "value"; sourceType: ts.TypeNode }>
  | Readonly<{
      kind: "unsupported";
      sourceType: ts.TypeNode | null;
      reason: CompletionReturnCarrierFailure;
    }>;

export type CompletionCallbackPlan = Readonly<{
  id: CompletionCallbackId;
  finallyId: CompletionFinallyId;
  role: "protected" | "finalizer";
  parentPath: CompletionCallbackPath;
  path: CompletionCallbackPath;
  source: SemanticSource;
}>;

export type CompletionLoopKind =
  | "while"
  | "do"
  | "for"
  | "for-of"
  | "for-in";

export type CompletionControlTargetPlan = Readonly<{
  id: CompletionTargetId;
  functionId: CompletionFunctionId;
  kind: "function-return" | "loop" | "switch";
  node: ts.Node;
  ownerPath: CompletionCallbackPath;
  loopKind: CompletionLoopKind | null;
  continueStep: ts.Expression | null;
  source: SemanticSource;
}>;

export type CompletionTransferKind =
  | "return-value"
  | "return-void"
  | "break"
  | "continue";

export type CompletionTransferUnsupportedReason =
  | "labeled-transfer"
  | "missing-target"
  | "target-path-not-prefix";

export type CompletionTransferPlan = Readonly<{
  id: CompletionTransferId;
  functionId: CompletionFunctionId;
  node: ts.ReturnStatement | ts.BreakStatement | ts.ContinueStatement;
  kind: CompletionTransferKind;
  targetId: CompletionTargetId | null;
  sourcePath: CompletionCallbackPath;
  targetPath: CompletionCallbackPath | null;
  crossedCallbacks: readonly CompletionCallbackId[];
  disposition: "direct" | "encode" | "unsupported";
  unsupportedReason: CompletionTransferUnsupportedReason | null;
  source: SemanticSource;
}>;

export type CompletionFinallyStrategy =
  | "finally-helper-local"
  | "finally-helper-completion"
  | "unsupported-outer-transfer";

export type CompletionFinallyPlan = Readonly<{
  id: CompletionFinallyId;
  statement: ts.TryStatement;
  parentPath: CompletionCallbackPath;
  protectedCallback: CompletionCallbackPlan;
  finalizerCallback: CompletionCallbackPlan;
  strategy: CompletionFinallyStrategy;
  crossingTransfers: readonly CompletionTransferId[];
  unsupportedTransfers: readonly CompletionTransferId[];
  legacyHasOuterTransfer: boolean;
  shadowMatchesLegacy: boolean;
  source: SemanticSource;
}>;

export type FunctionCompletionPlan = Readonly<{
  id: CompletionFunctionId;
  node: ts.FunctionLikeDeclaration;
  name: string;
  form: CompletionFunctionForm;
  returnTarget: CompletionControlTargetPlan;
  returnCarrier: CompletionReturnCarrierPlan;
  exclusions: readonly CompletionFunctionExclusion[];
  callbacks: readonly CompletionCallbackPlan[];
  finallyRegions: readonly CompletionFinallyPlan[];
  targets: readonly CompletionControlTargetPlan[];
  transfers: readonly CompletionTransferPlan[];
  needsModuleAbruptType: boolean;
  source: SemanticSource;
}>;

export type SourceCompletionPlan = Readonly<{
  sourceFile: string;
  functions: readonly FunctionCompletionPlan[];
  functionByStart: ReadonlyMap<number, FunctionCompletionPlan>;
  finallyByStart: ReadonlyMap<number, CompletionFinallyPlan>;
  transferByStart: ReadonlyMap<number, CompletionTransferPlan>;
}>;

type CompletionWalkState = Readonly<{
  callbackPath: CompletionCallbackPath;
  breakTargets: readonly CompletionControlTargetPlan[];
  continueTargets: readonly CompletionControlTargetPlan[];
}>;

type MutableFinallyPlan = {
  id: CompletionFinallyId;
  statement: ts.TryStatement;
  parentPath: CompletionCallbackPath;
  protectedCallback: CompletionCallbackPlan;
  finalizerCallback: CompletionCallbackPlan;
  legacyHasOuterTransfer: boolean;
  source: SemanticSource;
};

function completionFunctionId(ordinal: number): CompletionFunctionId {
  return `function:${ordinal}`;
}

function completionCallbackId(functionId: CompletionFunctionId,
    ordinal: number): CompletionCallbackId {
  return `${functionId}/callback:${ordinal}`;
}

function completionFinallyId(functionId: CompletionFunctionId,
    ordinal: number): CompletionFinallyId {
  return `${functionId}/finally:${ordinal}`;
}

function completionTargetId(functionId: CompletionFunctionId,
    ordinal: number): CompletionTargetId {
  return `${functionId}/target:${ordinal}`;
}

function completionTransferId(functionId: CompletionFunctionId,
    ordinal: number): CompletionTransferId {
  return `${functionId}/transfer:${ordinal}`;
}

function isCompletionPathPrefix(prefix: CompletionCallbackPath,
    value: CompletionCallbackPath): boolean {
  return prefix.length <= value.length
    && prefix.every((callback, index) => callback === value[index]);
}

function completionFunctionForm(node: ts.FunctionLikeDeclaration): CompletionFunctionForm {
  if (ts.isFunctionDeclaration(node)) return "function-declaration";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isFunctionExpression(node)) return "function-expression";
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
    return "accessor";
  if (ts.isMethodDeclaration(node))
    return ts.isClassLike(node.parent) ? "class-method" : "object-method";
  return "other";
}

/** Narrows TypeScript's broad signature guard to declarations with bodies. */
function isCompletionFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function completionFunctionName(node: ts.FunctionLikeDeclaration,
    form: CompletionFunctionForm, source: SemanticSource,
    sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node))
    && node.name)
    return node.name.text;
  if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)) && node.name)
    return node.name.getText(sf);
  return `<${form}@${source.line}:${source.column}>`;
}

function hasCompletionModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function completionFunctionExclusions(node: ts.FunctionLikeDeclaration,
    form: CompletionFunctionForm): CompletionFunctionExclusion[] {
  const exclusions: CompletionFunctionExclusion[] = [];
  if (hasCompletionModifier(node, ts.SyntaxKind.AsyncKeyword))
    exclusions.push("async");
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)) && node.asteriskToken)
    exclusions.push("generator");
  if (form === "constructor") exclusions.push("constructor");
  if ((form === "function-declaration" && !node.name)
    || form === "function-expression" || form === "arrow" || form === "other")
    exclusions.push("anonymous-function-form");
  if (form === "object-method") exclusions.push("object-method");
  if (form === "accessor") exclusions.push("accessor");
  if (node.typeParameters && node.typeParameters.length > 0)
    exclusions.push("generic-function");
  if (!node.body || !ts.isBlock(node.body)) exclusions.push("expression-body");
  return exclusions;
}

function returnTypeContainsWeakKeyword(node: ts.TypeNode): boolean {
  let weak = false;
  function visit(current: ts.Node): void {
    if (weak) return;
    if (current.kind === ts.SyntaxKind.AnyKeyword
      || current.kind === ts.SyntaxKind.UnknownKeyword
      || current.kind === ts.SyntaxKind.UndefinedKeyword) {
      weak = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return weak;
}

/**
 * Looks through aliases before a value-return carrier is admitted.
 *
 * Source syntax alone cannot reveal that `type Result = number | undefined`
 * permits implicit JavaScript fallthrough. The project TypeChecker supplies
 * the resolved signature, so aliases to `any`, `unknown`, standalone `null`,
 * or any union containing `undefined` retain the same fail-closed boundary as
 * their directly written forms. Nullable unions remain valid because `null`
 * is a real payload inside `ReturnValue`, not the outer normal sentinel.
 */
function resolvedReturnTypeIsWeak(checker: ts.TypeChecker,
    node: ts.FunctionLikeDeclaration): boolean {
  const signature = checker.getSignatureFromDeclaration(node);
  if (!signature) return true;
  const returnType = checker.getReturnTypeOfSignature(signature);
  const flags = returnType.getFlags();
  if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown
    | ts.TypeFlags.Undefined)) !== 0)
    return true;
  if ((flags & ts.TypeFlags.Null) !== 0) return true;
  if (returnType.isUnionOrIntersection()) {
    return returnType.types.some((member) => {
      const memberFlags = member.getFlags();
      return (memberFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown
        | ts.TypeFlags.Undefined)) !== 0;
    });
  }
  return false;
}

function planCompletionReturnCarrier(node: ts.FunctionLikeDeclaration,
    transfers: readonly CompletionTransferPlan[],
    sf: ts.SourceFile,
    checker: ts.TypeChecker | null): CompletionReturnCarrierPlan {
  const crossingReturns = transfers.filter((transfer) =>
    transfer.disposition === "encode"
    && (transfer.kind === "return-value" || transfer.kind === "return-void")
  );
  if (crossingReturns.length === 0) return { kind: "unused" };

  const sourceType = node.type ?? null;
  if (!sourceType) {
    return {
      kind: "unsupported",
      sourceType,
      reason: "missing-explicit-return-type"
    };
  }

  const hasValue = crossingReturns.some((transfer) => transfer.kind === "return-value");
  const hasVoid = crossingReturns.some((transfer) => transfer.kind === "return-void");
  if (hasValue && hasVoid) {
    return {
      kind: "unsupported",
      sourceType,
      reason: "mixed-bare-and-value-return"
    };
  }

  const sourceTypeText = sourceType.getText(sf).trim();
  if (returnTypeContainsWeakKeyword(sourceType)
    || (checker !== null && resolvedReturnTypeIsWeak(checker, node))
    || sourceTypeText === "undefined" || sourceTypeText === "null") {
    return {
      kind: "unsupported",
      sourceType,
      reason: "weak-return-type"
    };
  }

  const returnsVoid = sourceType.kind === ts.SyntaxKind.VoidKeyword;
  if (returnsVoid && hasValue) {
    return {
      kind: "unsupported",
      sourceType,
      reason: "value-return-in-void-function"
    };
  }
  if (!returnsVoid && hasVoid) {
    return {
      kind: "unsupported",
      sourceType,
      reason: "bare-return-in-value-function"
    };
  }
  return returnsVoid
    ? { kind: "void", sourceType }
    : { kind: "value", sourceType };
}

function completionLoopKind(node: ts.Node): CompletionLoopKind | null {
  if (ts.isWhileStatement(node)) return "while";
  if (ts.isDoStatement(node)) return "do";
  if (ts.isForStatement(node)) return "for";
  if (ts.isForOfStatement(node)) return "for-of";
  if (ts.isForInStatement(node)) return "for-in";
  return null;
}

/**
 * Plans one function's callback crossings without changing production output.
 *
 * Why: textual loop depth cannot say whether an inner completion stops at a
 * target inside an outer callback or must propagate through that callback.
 * Nested function bodies also cannot inherit their parent's targets.
 *
 * What: the walk assigns deterministic function-local IDs to real targets,
 * synthetic protected/finalizer callbacks, and every transfer. Callback paths
 * make ownership explicit; `crossedCallbacks` is the inner-to-outer suffix a
 * transfer must leave.
 *
 * How: targets capture the callback path where they are declared. A valid
 * unlabelled transfer may only target a path that prefixes its source path.
 * Planning records the completion strategy, then independently compares it
 * with the legacy callback-escape detector. The emitter consumes target IDs
 * for direct control flow and callback paths for the staged typed-return
 * subset; unsupported loop transfers and excluded function forms still fail
 * closed from these same immutable facts.
 */
function planFunctionCompletion(node: ts.FunctionLikeDeclaration,
    functionId: CompletionFunctionId, sourceFile: string,
    sf: ts.SourceFile, checker: ts.TypeChecker | null): FunctionCompletionPlan {
  const functionSource = semanticSourceForNode(sourceFile, sf, node);
  const form = completionFunctionForm(node);
  const callbacks: CompletionCallbackPlan[] = [];
  const targets: CompletionControlTargetPlan[] = [];
  const transfers: CompletionTransferPlan[] = [];
  const mutableFinallyRegions: MutableFinallyPlan[] = [];
  let callbackOrdinal = 0;
  let finallyOrdinal = 0;
  let targetOrdinal = 0;
  let transferOrdinal = 0;

  function addTarget(kind: CompletionControlTargetPlan["kind"],
      targetNode: ts.Node, ownerPath: CompletionCallbackPath,
      loopKind: CompletionLoopKind | null,
      continueStep: ts.Expression | null): CompletionControlTargetPlan {
    const target: CompletionControlTargetPlan = {
      id: completionTargetId(functionId, targetOrdinal++),
      functionId,
      kind,
      node: targetNode,
      ownerPath: [...ownerPath],
      loopKind,
      continueStep,
      source: semanticSourceForNode(sourceFile, sf, targetNode)
    };
    targets.push(target);
    return target;
  }

  const returnTarget = addTarget("function-return", node, [], null, null);

  function addTransfer(transferNode: ts.ReturnStatement
      | ts.BreakStatement | ts.ContinueStatement,
      kind: CompletionTransferKind,
      candidateTarget: CompletionControlTargetPlan | null,
      state: CompletionWalkState,
      labeled: boolean): void {
    const sourcePath: CompletionCallbackPath = [...state.callbackPath];
    let target = labeled ? null : candidateTarget;
    let unsupportedReason: CompletionTransferUnsupportedReason | null = labeled
      ? "labeled-transfer"
      : null;
    if (!target && !unsupportedReason) unsupportedReason = "missing-target";

    let targetPath: CompletionCallbackPath | null = target
      ? [...target.ownerPath]
      : null;
    let crossedCallbacks: readonly CompletionCallbackId[] = [];
    if (target && targetPath) {
      if (isCompletionPathPrefix(targetPath, sourcePath)) {
        crossedCallbacks = sourcePath.slice(targetPath.length).reverse();
      } else {
        target = null;
        targetPath = null;
        unsupportedReason = "target-path-not-prefix";
      }
    }

    transfers.push({
      id: completionTransferId(functionId, transferOrdinal++),
      functionId,
      node: transferNode,
      kind,
      targetId: target?.id ?? null,
      sourcePath,
      targetPath,
      crossedCallbacks,
      disposition: unsupportedReason
        ? "unsupported"
        : crossedCallbacks.length > 0 ? "encode" : "direct",
      unsupportedReason,
      source: semanticSourceForNode(sourceFile, sf, transferNode)
    });
  }

  function visit(current: ts.Node, state: CompletionWalkState): void {
    if (current !== node && (ts.isFunctionLike(current) || ts.isClassLike(current)))
      return;

    if (ts.isTryStatement(current) && current.finallyBlock) {
      const id = completionFinallyId(functionId, finallyOrdinal++);
      const parentPath: CompletionCallbackPath = [...state.callbackPath];
      const protectedId = completionCallbackId(functionId, callbackOrdinal++);
      const finalizerId = completionCallbackId(functionId, callbackOrdinal++);
      const protectedCallback: CompletionCallbackPlan = {
        id: protectedId,
        finallyId: id,
        role: "protected",
        parentPath,
        path: [...parentPath, protectedId],
        source: semanticSourceForNode(sourceFile, sf, current.tryBlock)
      };
      const finalizerCallback: CompletionCallbackPlan = {
        id: finalizerId,
        finallyId: id,
        role: "finalizer",
        parentPath,
        path: [...parentPath, finalizerId],
        source: semanticSourceForNode(sourceFile, sf, current.finallyBlock)
      };
      callbacks.push(protectedCallback, finalizerCallback);
      const legacyNodes: ts.Node[] = [current.tryBlock];
      if (current.catchClause) legacyNodes.push(current.catchClause.block);
      legacyNodes.push(current.finallyBlock);
      mutableFinallyRegions.push({
        id,
        statement: current,
        parentPath,
        protectedCallback,
        finalizerCallback,
        legacyHasOuterTransfer: legacyNodes.some(hasTransferEscapingCallback),
        source: semanticSourceForNode(sourceFile, sf, current)
      });

      const protectedState: CompletionWalkState = {
        ...state,
        callbackPath: protectedCallback.path
      };
      visit(current.tryBlock, protectedState);
      if (current.catchClause) visit(current.catchClause.block, protectedState);
      visit(current.finallyBlock, {
        ...state,
        callbackPath: finalizerCallback.path
      });
      return;
    }

    if (ts.isReturnStatement(current)) {
      addTransfer(current, current.expression ? "return-value" : "return-void",
        returnTarget, state, false);
      return;
    }
    if (ts.isBreakStatement(current)) {
      addTransfer(current, "break",
        state.breakTargets[state.breakTargets.length - 1] ?? null,
        state, current.label !== undefined);
      return;
    }
    if (ts.isContinueStatement(current)) {
      addTransfer(current, "continue",
        state.continueTargets[state.continueTargets.length - 1] ?? null,
        state, current.label !== undefined);
      return;
    }

    const loopKind = completionLoopKind(current);
    if (loopKind) {
      const continueStep = ts.isForStatement(current)
        ? current.incrementor ?? null
        : null;
      const target = addTarget("loop", current, state.callbackPath,
        loopKind, continueStep);
      const loopState: CompletionWalkState = {
        ...state,
        breakTargets: [...state.breakTargets, target],
        continueTargets: [...state.continueTargets, target]
      };
      if (ts.isWhileStatement(current) || ts.isDoStatement(current)
        || ts.isForStatement(current) || ts.isForOfStatement(current)
        || ts.isForInStatement(current))
        visit(current.statement, loopState);
      return;
    }

    if (ts.isSwitchStatement(current)) {
      const target = addTarget("switch", current, state.callbackPath, null, null);
      const switchState: CompletionWalkState = {
        ...state,
        breakTargets: [...state.breakTargets, target]
      };
      for (const clause of current.caseBlock.clauses)
        for (const statement of clause.statements)
          visit(statement, switchState);
      return;
    }

    ts.forEachChild(current, (child) => visit(child, state));
  }

  const initialState: CompletionWalkState = {
    callbackPath: [],
    breakTargets: [],
    continueTargets: []
  };
  if (node.body && ts.isBlock(node.body)) visit(node.body, initialState);

  const returnCarrier = planCompletionReturnCarrier(node, transfers, sf, checker);
  const exclusions = completionFunctionExclusions(node, form);
  const functionUnsupported = exclusions.length > 0
    || returnCarrier.kind === "unsupported";
  const finallyRegions: CompletionFinallyPlan[] = mutableFinallyRegions.map((region) => {
    const callbackIds = [
      region.protectedCallback.id,
      region.finalizerCallback.id
    ];
    const crossingTransfers = transfers.filter((transfer) =>
      transfer.crossedCallbacks.some((callback) => callbackIds.includes(callback))
    );
    const unsupportedTransfers = transfers.filter((transfer) =>
      transfer.disposition === "unsupported"
      && transfer.sourcePath.some((callback) => callbackIds.includes(callback))
    );
    const shadowHasOuterTransfer = crossingTransfers.length > 0
      || unsupportedTransfers.length > 0;
    return {
      ...region,
      strategy: !shadowHasOuterTransfer
        ? "finally-helper-local"
        : functionUnsupported || unsupportedTransfers.length > 0
          ? "unsupported-outer-transfer"
          : "finally-helper-completion",
      crossingTransfers: crossingTransfers.map((transfer) => transfer.id),
      unsupportedTransfers: unsupportedTransfers.map((transfer) => transfer.id),
      shadowMatchesLegacy: shadowHasOuterTransfer === region.legacyHasOuterTransfer
    };
  });

  return {
    id: functionId,
    node,
    name: completionFunctionName(node, form, functionSource, sf),
    form,
    returnTarget,
    returnCarrier,
    exclusions,
    callbacks,
    finallyRegions,
    targets,
    transfers,
    needsModuleAbruptType: finallyRegions.some((region) =>
      region.strategy === "finally-helper-completion"),
    source: functionSource
  };
}

/**
 * Builds a behavior-neutral completion inventory for one TypeScript source.
 *
 * Why: Haxe emission must consume stable ownership facts rather than
 * reconstructing control flow from mutable printer stacks. What: every
 * function with a body receives an independent plan and lookup maps retain its
 * try/transfer provenance. How: discovery follows source preorder, while all
 * counters live inside this call; repeated and same-process translations are
 * therefore deterministic and cannot leak IDs between projects.
 */
export function planSourceCompletions(sf: ts.SourceFile,
    sourceFile: string, checker: ts.TypeChecker | null = null): SourceCompletionPlan {
  const functions: FunctionCompletionPlan[] = [];
  let functionOrdinal = 0;
  function discover(current: ts.Node): void {
    if (isCompletionFunctionLike(current) && current.body) {
      functions.push(planFunctionCompletion(
        current,
        completionFunctionId(functionOrdinal++),
        sourceFile,
        sf,
        checker
      ));
    }
    ts.forEachChild(current, discover);
  }
  discover(sf);

  const functionByStart = new Map<number, FunctionCompletionPlan>();
  const finallyByStart = new Map<number, CompletionFinallyPlan>();
  const transferByStart = new Map<number, CompletionTransferPlan>();
  for (const fn of functions) {
    functionByStart.set(fn.source.start, fn);
    for (const region of fn.finallyRegions)
      finallyByStart.set(region.source.start, region);
    for (const transfer of fn.transfers)
      transferByStart.set(transfer.source.start, transfer);
  }
  return {
    sourceFile,
    functions,
    functionByStart,
    finallyByStart,
    transferByStart
  };
}

/** Returns whether every shadow finally decision agrees with current rejection. */
export function completionPlanMatchesLegacy(plan: SourceCompletionPlan): boolean {
  return plan.functions.every((fn) =>
    fn.finallyRegions.every((region) => region.shadowMatchesLegacy));
}

/** Captures case order/fallthrough before rendering a Haxe state machine. */
export function planSwitch(statement: ts.SwitchStatement): SwitchPlan {
  const clauses: SwitchClausePlan[] = statement.caseBlock.clauses.map((clause, index) => ({
    index,
    label: ts.isCaseClause(clause) ? clause.expression : null,
    statements: clause.statements
  }));
  const defaultClause = clauses.find((clause) => clause.label === null);
  return {
    statement,
    discriminant: statement.expression,
    clauses,
    defaultIndex: defaultClause?.index ?? null,
    continuePlan: planContinueEscapingSwitch(statement.caseBlock)
  };
}

export type TryPlan = {
  statement: ts.TryStatement;
  strategy: "direct-catch" | "finally-helper" | "unsupported-outer-transfer";
};

/**
 * Retains the pre-completion-planner decision for shadow comparison.
 *
 * Why: the original implementation answered only whether any transfer escaped
 * a synthetic callback. Keeping that small classifier during the staged
 * migration lets tests prove that the richer callback/target plan recognizes
 * every old rejection before production behavior expands.
 *
 * What: this function reports the legacy `direct-catch`, local-helper, or
 * unsupported decision. It does not own current Haxe emission; emitters consume
 * `SourceCompletionPlan`, which also records the transfer's real target and
 * every callback it crosses.
 *
 * How: planner tests compare this result with `shadowMatchesLegacy`. Remove the
 * compatibility API only after all staged completion lowering has landed and
 * the shadow evidence no longer protects a migration boundary.
 */
export function planTry(statement: ts.TryStatement): TryPlan {
  if (!statement.finallyBlock) return { statement, strategy: "direct-catch" };
  const protectedNodes: ts.Node[] = [statement.tryBlock];
  if (statement.catchClause) protectedNodes.push(statement.catchClause.block);
  protectedNodes.push(statement.finallyBlock);
  const hasOuterTransfer = protectedNodes.some(hasTransferEscapingCallback);
  return {
    statement,
    strategy: hasOuterTransfer ? "unsupported-outer-transfer" : "finally-helper"
  };
}
