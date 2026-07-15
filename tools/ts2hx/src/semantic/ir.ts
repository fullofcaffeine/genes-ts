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
    summary: "Preserves finally ordering and propagation through a typed JavaScript boundary helper.",
    limitation: "Return, break, or continue crossing the protected region is rejected."
  },
  {
    id: "exceptions.finally-outer-transfer",
    category: "exceptions",
    support: "unsupported",
    portableGrade: "U",
    summary: "Outer return/break/continue completion through finally is not yet normalized.",
    limitation: "The completion-record IR does not yet model transfer to an enclosing function or loop."
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
    summary: "Preserves the exercised ESM value/type binding and re-export subset.",
    limitation: "Non-relative packages remain JavaScript extern boundaries; local-only projects may be portable after separate evidence."
  },
  {
    id: "modules.side-effect-import",
    category: "modules",
    support: "unsupported",
    portableGrade: "U",
    summary: "Bare side-effect imports have no explicit Haxe initialization edge yet.",
    limitation: "Strict mode rejects them instead of silently dropping their effects."
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
    variant: "outer completion crossing finally"
  },
  {
    featureId: "modules.side-effect-import",
    diagnosticId: "TS2HX-MODULES-SIDE-EFFECT-IMPORT-001",
    variant: "bare side-effect import without an initialization edge"
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

/** Collects deterministic feature provenance while semantic plans are built. */
export class SemanticRecorder {
  private readonly uses = new Map<string, SemanticFeatureUse>();

  public record(featureId: SemanticFeatureId, sourceFile: string, sf: ts.SourceFile, node: ts.Node): void {
    const start = node.getStart(sf, false);
    const end = node.getEnd();
    const position = sf.getLineAndCharacterOfPosition(start);
    const source: SemanticSource = {
      file: sourceFile,
      start,
      end,
      line: position.line + 1,
      column: position.character + 1,
      syntaxKind: ts.SyntaxKind[node.kind] ?? `SyntaxKind(${node.kind})`
    };
    const key = `${featureId}\u0000${source.file}\u0000${start}\u0000${end}`;
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
 * Selects exception lowering before printing.
 *
 * A callback-based finally helper preserves normal/throw completion, but a
 * return/break/continue inside that callback would target the callback rather
 * than the original outer scope. Such transfers therefore fail closed until a
 * completion-record node exists.
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
