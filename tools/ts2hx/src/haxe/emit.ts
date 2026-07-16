import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import ts from "../typescript-api.js";
import { toHaxeModuleName, toHaxePackagePath } from "../util.js";
import {
  inspectEffectiveModuleRequests,
  type EffectiveImportShape,
  type EffectiveModuleFormat,
  type EffectiveModuleRequestInventory,
  type EffectiveRuntimeRequest
} from "../semantic/effective-module-requests.js";
import {
  typeScriptCompilerFacts,
  type TypeScriptCompilerFacts
} from "../semantic/compiler-facts.js";
import {
  planPackageExternBinding,
  type PackageExternSource,
  type SupportedPackageExternBindingPlan
} from "../semantic/package-extern-plan.js";
import {
  SemanticRecorder,
  isPrototypeMutationTarget,
  planAssignmentTarget,
  planCondition,
  planForLoop,
  planLocalDeclaration,
  planParameter,
  planSourceCompletions,
  planSwitch,
  type CompletionCallbackPlan,
  type CompletionCallbackPath,
  type CompletionControlTargetPlan,
  type CompletionFinallyPlan,
  type CompletionTargetId,
  type CompletionTransferPlan,
  type FunctionCompletionPlan,
  type PortabilityGrade,
  type SemanticFeatureDisposition,
  type SemanticFeatureId,
  type SourceCompletionPlan
} from "../semantic/ir.js";
import {
  loadRuntimeModuleManifest,
  runtimeModuleRequestKey,
  type RuntimeModuleManifestEntry,
  type RuntimeModuleManifestPlan
} from "./runtime-modules.js";

export type EmitHaxeOptions = {
  projectDir: string;
  rootDir: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: ts.SourceFile[];
  outDir: string;
  basePackage: string;
  /** Runtime compiler contract required by the generated Haxe tree. */
  runtimeProfile: RuntimeProfile;
  /** Translation policy. Strict JS semantics are the default. */
  mode?: TranslationMode;
  /** Replace the prior output tree instead of preserving unrelated files. */
  cleanOutDir?: boolean;
  /** Optional hash-pinned ownership plan for external relative runtime files. */
  runtimeModulesManifest?: string;
};

export type TranslationMode = "strict-js" | "assisted";
export type RuntimeProfile = "genes-esm" | "standard-haxe-js";
export type RequiredCompilerCapability = "genes.esm-runtime-requests";

export type TranslationDiagnostic = {
  id: string;
  severity: "error" | "loss";
  mode: TranslationMode;
  source: {
    file: string;
    start: number;
    end: number;
    line: number;
    column: number;
  };
  syntaxKind: string;
  semanticCategory: "file" | "module" | "declaration" | "control-flow" | "expression";
  message: string;
  support: "unsupported";
  portableGrade: PortabilityGrade;
  outputFile: string | null;
  remediation: string;
};

export type TranslationFileDisposition = {
  sourceFile: string;
  status: "emitted" | "declaration-only" | "unsupported";
  outputFile: string | null;
  diagnosticIds: string[];
};

export type RuntimeModuleDisposition = {
  importer: string;
  specifier: string;
  runtimeSpecifier: string;
  importType: string | null;
  source: string;
  stagedFile: string;
  owner: string;
  sha256: string;
};

export type TranslationModuleRequestDisposition = {
  source: TranslationDiagnostic["source"];
  sourceOrdinal: number;
  disposition: "runtime-request" | "type-only" | "elided";
  /** Runtime order within the emitted source module; absent requests use null. */
  ordinal: number | null;
  specifier: string;
  moduleFormat: EffectiveModuleFormat | null;
  emittedShape: EffectiveImportShape | null;
};

export type TranslationManifest = {
  schemaVersion: 3;
  mode: TranslationMode;
  status: "success" | "failed" | "assisted";
  basePackage: string;
  targetProfile: RuntimeProfile;
  compiler: TypeScriptCompilerFacts;
  requiredCompilerCapabilities: RequiredCompilerCapability[];
  moduleRequests: TranslationModuleRequestDisposition[];
  plannedFiles: string[];
  files: TranslationFileDisposition[];
  diagnostics: TranslationDiagnostic[];
  /** Hash-pinned external relative modules staged by this transaction. */
  runtimeModules: RuntimeModuleDisposition[];
  /** Complete support catalog plus source occurrences observed in this run. */
  features: SemanticFeatureDisposition[];
};

export type EmitHaxeResult = {
  status: TranslationManifest["status"];
  writtenFiles: string[];
  diagnostics: TranslationDiagnostic[];
  dispositions: TranslationFileDisposition[];
  manifest: TranslationManifest;
};

type EmittedFile = {
  filePath: string;
  content: string | Uint8Array;
};

type SourceEmitOutcome =
  | { kind: "emitted"; emitted: EmittedFile }
  | { kind: "declaration-only" }
  | { kind: "unsupported"; emitted: EmittedFile | null; diagnostics: TranslationDiagnostic[] };

type ImportSpec = {
  moduleSpecifier: string;
  isTypeOnly: boolean;
  defaultImport: string | null;
  namespaceImport: string | null;
  named: Array<{ name: string; alias: string | null; isTypeOnly: boolean }>;
};

type ExportFromSpec =
  | { kind: "named"; moduleSpecifier: string; elements: Array<{ exported: string; source: string }> }
  | { kind: "all"; moduleSpecifier: string };

type RuntimeImportRequest =
  | {
      kind: "external";
      statement: ts.ImportDeclaration;
      runtimeSpecifier: string;
      importType: string | null;
      manifestEntry: RuntimeModuleManifestEntry | null;
    }
  | {
      kind: "internal-binding";
      statement: ts.ImportDeclaration;
      anchor: string;
    }
  | {
      kind: "internal-target";
      statement: ts.ImportDeclaration;
      anchor: string;
    };

type RuntimeImportProblem = {
  statement: ts.Node;
  id: string;
  message: string;
  remediation?: string;
  forceError?: boolean;
};

type SourceRuntimeImportPlan = {
  /** Every configured-TypeScript runtime request, including rejected edges. */
  occurrences: readonly ts.ImportDeclaration[];
  requests: readonly RuntimeImportRequest[];
  problems: readonly RuntimeImportProblem[];
};

type ConvertedRuntimeTargetPlan = {
  /** Collision-free module field consumed by the Genes dependency planner. */
  markerName: string;
};

type RuntimeImportInventory = {
  sourceFile: ts.SourceFile;
  /** Requests retained by the configured TypeScript emitter, in emit order. */
  runtimeImports: readonly EffectiveRuntimeImportOccurrence[];
};

type EffectiveRuntimeImportOccurrence = {
  statement: ts.ImportDeclaration;
  request: EffectiveRuntimeRequest;
};

type ConvertedRuntimeEdge = {
  targetFile: ts.SourceFile;
};

type ProjectRuntimeImportPlan = {
  bySourceFile: ReadonlyMap<string, SourceRuntimeImportPlan>;
  targetBySourceFile: ReadonlyMap<string, ConvertedRuntimeTargetPlan>;
  /** Strong declaration facts for package requests accepted by this plan. */
  packageBindingsByStatement: ReadonlyMap<
    ts.ImportDeclaration,
    readonly SupportedPackageExternBindingPlan[]
  >;
  /** Effective bound package declarations that need an extern or assisted scaffold. */
  packageExternStatements: ReadonlySet<ts.ImportDeclaration>;
  stagedFiles: readonly EmittedFile[];
  dispositions: readonly RuntimeModuleDisposition[];
};

function isRelativeModuleSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function stripTsExtension(spec: string): string {
  return spec.replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
}

function moduleTargetFromImport(opts: {
  projectDir: string;
  rootDir: string;
  fromFile: string;
  basePackage: string;
}, spec: string): {
  packagePath: string;
  moduleName: string;
} {
  const fromDir = path.dirname(opts.fromFile);
  const resolved = path.resolve(fromDir, stripTsExtension(spec));

  const relativeToRoot = path.relative(opts.rootDir, resolved);
  const relNoExt = relativeToRoot.replace(/\.(tsx?|jsx?)$/i, "");
  const segments = relNoExt.split(path.sep).filter((p) => p.length > 0);

  const fileBase = segments.length > 0 ? segments[segments.length - 1] : "Module";
  const dirSegments = segments.slice(0, -1);

  return {
    packagePath: toHaxePackagePath([opts.basePackage, ...dirSegments]),
    moduleName: toHaxeModuleName(fileBase)
  };
}

function isLikelyTypeName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Function-local control state consumed while spelling an immutable plan.
 *
 * Why: a source-file-wide loop-depth stack lets a nested arrow or method see
 * targets owned by its containing function. It also cannot distinguish two
 * targets that happen to sit at the same textual depth across synthetic
 * `try/finally` callbacks.
 *
 * What: every source function gets a fresh state keyed by semantic target ID.
 * `activeTargets` preserves lexical nesting, `continueSteps` retains the exact
 * lowered-for increment string, and switch escape flags name the real loop
 * they eventually continue. `callbackPath` identifies the synthetic protected
 * or finalizer callback currently being spelled. The generated-name set keeps
 * compiler locals from shadowing any identifier already present in the source
 * function, including identifiers inside nested syntax.
 *
 * How: `withFunctionEmitState` looks up the immutable source plan, installs a
 * new state, and restores the caller in `finally`. `withCompletionCallback`
 * changes only the callback path; actual nested source functions install a new
 * state with empty callback, target, and switch stacks.
 */
type FunctionEmitState = {
  plan: FunctionCompletionPlan;
  callbackPath: CompletionCallbackPath;
  activeTargets: CompletionTargetId[];
  targetById: ReadonlyMap<CompletionTargetId, CompletionControlTargetPlan>;
  targetNumberById: ReadonlyMap<CompletionTargetId, number>;
  continueSteps: Map<CompletionTargetId, string | null>;
  switchContinueTransfers: Array<{ flag: string; targetId: CompletionTargetId }>;
  generatedLocalNames: Set<string>;
};

type EmitContext = {
  checker: ts.TypeChecker;
  identifierRewrites: Map<string, string>;
  tmpCounter: number;
  sourceFile: ts.SourceFile;
  sourceFilePath: string;
  semanticRecorder: SemanticRecorder;
  semanticFailures: SemanticFailure[];
  /** Scoped textual substitutions introduced by normalized expression plans. */
  expressionRewrites: Map<string, string>;
  /** Immutable callback/target inventory for this source file. */
  completionPlan: SourceCompletionPlan;
  /** Current source function; nested functions install an independent state. */
  functionState: FunctionEmitState | null;
  /** Collision-safe private enum used only by completion-aware functions. */
  completionAbruptTypeName: string | null;
};

type SemanticFailure = {
  featureId: SemanticFeatureId;
  node: ts.Node;
  message: string;
  category: TranslationDiagnostic["semanticCategory"];
};

function recordSemantic(ctx: EmitContext, featureId: SemanticFeatureId, node: ts.Node): void {
  ctx.semanticRecorder.record(featureId, ctx.sourceFilePath, ctx.sourceFile, node);
}

function rejectSemantic(
  ctx: EmitContext,
  featureId: SemanticFeatureId,
  node: ts.Node,
  message: string,
  category: TranslationDiagnostic["semanticCategory"]
): null {
  recordSemantic(ctx, featureId, node);
  ctx.semanticFailures.push({ featureId, node, message, category });
  return null;
}

function expressionKey(ctx: EmitContext, expression: ts.Expression): string {
  return expression.getText(ctx.sourceFile);
}

function withExpressionRewrite<T>(
  ctx: EmitContext,
  source: ts.Expression,
  replacement: string,
  emit: () => T
): T {
  const key = expressionKey(ctx, source);
  const prior = ctx.expressionRewrites.get(key);
  ctx.expressionRewrites.set(key, replacement);
  try {
    return emit();
  } finally {
    if (prior === undefined) ctx.expressionRewrites.delete(key);
    else ctx.expressionRewrites.set(key, prior);
  }
}

function nextTmp(ctx: EmitContext, prefix = "__ts2hx_tmp"): string {
  const n = ctx.tmpCounter;
  ctx.tmpCounter++;
  return `${prefix}${n}`;
}

function withFunctionEmitState<T>(ctx: EmitContext,
    node: ts.FunctionLikeDeclaration, emit: () => T): T {
  const start = node.getStart(ctx.sourceFile, false);
  const plan = ctx.completionPlan.functionByStart.get(start);
  if (!plan) {
    throw new Error(
      `Completion plan is missing ${ts.SyntaxKind[node.kind] ?? "function"} at `
      + `${ctx.sourceFilePath}:${start}.`
    );
  }
  const previous = ctx.functionState;
  const generatedLocalNames = new Set<string>();
  function collectIdentifiers(current: ts.Node): void {
    if (ts.isIdentifier(current)) generatedLocalNames.add(current.text);
    ts.forEachChild(current, collectIdentifiers);
  }
  collectIdentifiers(node);
  ctx.functionState = {
    plan,
    callbackPath: [],
    activeTargets: [],
    targetById: new Map(plan.targets.map((target) => [target.id, target])),
    targetNumberById: new Map(
      plan.targets.map((target, index) => [target.id, index])
    ),
    continueSteps: new Map(),
    switchContinueTransfers: [],
    generatedLocalNames
  };
  try {
    return emit();
  } finally {
    ctx.functionState = previous;
  }
}

function requireFunctionEmitState(ctx: EmitContext): FunctionEmitState {
  if (!ctx.functionState) {
    throw new Error(
      `Control-flow emission escaped a source function in ${ctx.sourceFilePath}.`
    );
  }
  return ctx.functionState;
}

function targetForNode(ctx: EmitContext, node: ts.Node,
    kind: CompletionControlTargetPlan["kind"]): CompletionControlTargetPlan {
  const state = requireFunctionEmitState(ctx);
  const target = state.plan.targets.find((candidate) =>
    candidate.node === node && candidate.kind === kind);
  if (!target) {
    throw new Error(
      `Completion plan is missing ${kind} target at `
      + `${ctx.sourceFilePath}:${node.getStart(ctx.sourceFile, false)}.`
    );
  }
  return target;
}

function withActiveTarget<T>(ctx: EmitContext,
    target: CompletionControlTargetPlan, continueStep: string | null,
    emit: () => T): T {
  const state = requireFunctionEmitState(ctx);
  state.activeTargets.push(target.id);
  state.continueSteps.set(target.id, continueStep);
  try {
    return emit();
  } finally {
    state.continueSteps.delete(target.id);
    const removed = state.activeTargets.pop();
    if (removed !== target.id)
      throw new Error(`Completion target stack corrupted while leaving ${target.id}.`);
  }
}

function currentLoopTarget(state: FunctionEmitState): CompletionControlTargetPlan | null {
  for (let index = state.activeTargets.length - 1; index >= 0; index--) {
    const target = state.targetById.get(state.activeTargets[index] as CompletionTargetId);
    if (target?.kind === "loop") return target;
  }
  return null;
}

function nextFunctionLocal(ctx: EmitContext, prefix: string): string {
  const state = requireFunctionEmitState(ctx);
  let name = nextTmp(ctx, prefix);
  while (state.generatedLocalNames.has(name))
    name = nextTmp(ctx, prefix);
  state.generatedLocalNames.add(name);
  return name;
}

/**
 * Claims a readable pattern-local name without perturbing temp ordinals.
 *
 * Dispatch variables are scoped to generated switch cases, but Haxe still
 * rejects some shadowing shapes. Reusing the familiar base keeps existing
 * return-only output byte-stable; a deterministic suffix is added only when
 * the source function or an earlier generated case already owns that name.
 */
function claimFunctionLocal(ctx: EmitContext, base: string): string {
  const state = requireFunctionEmitState(ctx);
  let name = base;
  let suffix = 2;
  while (state.generatedLocalNames.has(name)) {
    name = `${base}${suffix}`;
    suffix++;
  }
  state.generatedLocalNames.add(name);
  return name;
}

function nextCompletionLocal(ctx: EmitContext): string {
  return nextFunctionLocal(ctx, "__ts2hx_completion");
}

function callbackPathsEqual(left: CompletionCallbackPath,
    right: CompletionCallbackPath): boolean {
  return left.length === right.length
    && left.every((callback, index) => callback === right[index]);
}

function callbackPathIsPrefix(prefix: CompletionCallbackPath,
    value: CompletionCallbackPath): boolean {
  return prefix.length <= value.length
    && prefix.every((callback, index) => callback === value[index]);
}

function completionTargetForId(state: FunctionEmitState,
    targetId: CompletionTargetId): CompletionControlTargetPlan {
  const target = state.targetById.get(targetId);
  if (!target)
    throw new Error(`Completion plan is missing target ${targetId}.`);
  return target;
}

function completionTargetNumber(state: FunctionEmitState,
    targetId: CompletionTargetId): number {
  const target = state.targetNumberById.get(targetId);
  if (target === undefined)
    throw new Error(`Completion plan is missing numeric target ${targetId}.`);
  return target;
}

/**
 * Enters one synthetic completion callback without changing source-function ownership.
 *
 * Why: a nested `finally` may return a record to an enclosing synthetic
 * callback, but a real nested source function must still receive entirely new
 * state. Treating those two boundaries alike would skip outer protected
 * statements or target a caller's return.
 *
 * What: only the immutable callback path changes. Real loop targets, switch
 * escapes, and the function return carrier remain owned by the current source
 * function.
 *
 * How: the planner proves that the region parent equals the current path. The
 * emitter checks that invariant, installs the child path for statement
 * spelling, and restores the parent in `finally` even when emission rejects a
 * nested construct.
 */
function withCompletionCallback<T>(ctx: EmitContext,
    callback: CompletionCallbackPlan, emit: () => T): T {
  const state = requireFunctionEmitState(ctx);
  const previous = state.callbackPath;
  if (!callbackPathsEqual(previous, callback.parentPath)) {
    throw new Error(
      `Completion callback ${callback.id} expected parent `
      + `${JSON.stringify(callback.parentPath)}, got ${JSON.stringify(previous)}.`
    );
  }
  state.callbackPath = callback.path;
  try {
    return emit();
  } finally {
    state.callbackPath = previous;
  }
}

function completionTransferForNode(ctx: EmitContext,
    node: ts.ReturnStatement | ts.BreakStatement
      | ts.ContinueStatement): CompletionTransferPlan {
  const start = node.getStart(ctx.sourceFile, false);
  const transfer = ctx.completionPlan.transferByStart.get(start);
  const state = requireFunctionEmitState(ctx);
  if (!transfer || transfer.functionId !== state.plan.id) {
    throw new Error(
      `Completion plan is missing transfer at ${ctx.sourceFilePath}:${start}.`
    );
  }
  return transfer;
}

function completionFinallyForNode(ctx: EmitContext,
    node: ts.TryStatement): CompletionFinallyPlan {
  const start = node.getStart(ctx.sourceFile, false);
  const region = ctx.completionPlan.finallyByStart.get(start);
  const state = requireFunctionEmitState(ctx);
  if (!region || region.statement !== node
    || !state.plan.finallyRegions.some((candidate) => candidate.id === region.id)) {
    throw new Error(
      `Completion plan is missing finally region at ${ctx.sourceFilePath}:${start}.`
    );
  }
  return region;
}

function completionTransfersForRegion(fn: FunctionCompletionPlan,
    region: CompletionFinallyPlan): CompletionTransferPlan[] {
  return region.crossingTransfers.map((transferId) => {
    const transfer = fn.transfers.find((candidate) => candidate.id === transferId);
    if (!transfer)
      throw new Error(`Finally region ${region.id} refers to missing ${transferId}.`);
    return transfer;
  });
}

const COMPLETION_LOOP_KINDS = new Set(["while", "do", "for", "for-of"]);

/**
 * Checks the exact synchronous target subset before a callback is printed.
 *
 * Why: the semantic planner intentionally inventories more syntax than this
 * emitter has proved. Treating every planned target as printable would turn a
 * useful ownership model into an accidental support claim.
 *
 * What: return targets require a matching strong carrier; break may target a
 * supported real loop or source switch; continue may target only a supported
 * real loop. `for...in` remains outside the strict statement subset.
 *
 * How: every crossing transfer is resolved through the immutable function
 * target table. A false result makes the containing source `try` produce the
 * stable fail-closed diagnostic before any output tree is published.
 */
function isSupportedCompletionRegion(fn: FunctionCompletionPlan,
    region: CompletionFinallyPlan): boolean {
  if (region.strategy !== "finally-helper-completion") return false;
  if (fn.returnCarrier.kind === "unused"
    || fn.returnCarrier.kind === "unsupported")
    return false;
  const transfers = completionTransfersForRegion(fn, region);
  if (transfers.length === 0) return false;
  return transfers.every((transfer) => {
    if (!transfer.targetId || !transfer.targetPath) return false;
    const target = fn.targets.find((candidate) => candidate.id === transfer.targetId);
    if (!target) return false;
    if (transfer.kind === "return-value")
      return target.id === fn.returnTarget.id && fn.returnCarrier.kind === "value";
    if (transfer.kind === "return-void")
      return target.id === fn.returnTarget.id && fn.returnCarrier.kind === "void";
    if (transfer.kind === "break") {
      return target.kind === "switch"
        || (target.kind === "loop" && target.loopKind !== null
          && COMPLETION_LOOP_KINDS.has(target.loopKind));
    }
    return target.kind === "loop" && target.loopKind !== null
      && COMPLETION_LOOP_KINDS.has(target.loopKind);
  });
}

function sourceNeedsCompletionType(plan: SourceCompletionPlan): boolean {
  return plan.functions.some((fn) => fn.finallyRegions.some((region) =>
    isSupportedCompletionRegion(fn, region)));
}

type EmittedCompletionCarrier = Readonly<{
  typeName: string;
  payloadType: string;
  carrierType: string;
  kind: "value" | "void" | "control";
}>;

function emittedTypeContainsWeakBoundary(type: string): boolean {
  return /(^|[<,( ]|->)(?:Dynamic|Any)(?=$|[>,) ]|->)/.test(type);
}

/**
 * Projects the planner's explicit return annotation into one strong Haxe type.
 *
 * The semantic plan rejects missing, mixed, broad, and implicit-undefined
 * carriers. This final spelling check catches source syntax that the current
 * Haxe type printer cannot represent without falling back to `Dynamic` or
 * core `Any`. Returning `null` asks the containing `try` to fail closed before
 * generated output is published.
 */
function completionCarrier(ctx: EmitContext,
    state = requireFunctionEmitState(ctx)): EmittedCompletionCarrier | null {
  const typeName = ctx.completionAbruptTypeName;
  if (!typeName) return null;
  const plan = state.plan.returnCarrier;
  if (plan.kind === "control") {
    const functionReturnType = emitType(plan.sourceType);
    if (emittedTypeContainsWeakBoundary(functionReturnType)) return null;
    return {
      typeName,
      payloadType: "Void",
      carrierType: `${typeName}<Void>`,
      kind: "control"
    };
  }
  if (plan.kind === "void") {
    return {
      typeName,
      payloadType: "Void",
      carrierType: `${typeName}<Void>`,
      kind: "void"
    };
  }
  if (plan.kind !== "value") return null;
  const payloadType = emitType(plan.sourceType);
  if (emittedTypeContainsWeakBoundary(payloadType)) return null;
  return {
    typeName,
    payloadType,
    carrierType: `${typeName}<${payloadType}>`,
    kind: "value"
  };
}

/**
 * Validates every completion region before spelling its surrounding function.
 *
 * A supported transfer can sit inside a statement form that the emitter never
 * descends into (for example, the currently unsupported `for...in`). Without a
 * function preflight, that shape would receive a generic declaration failure
 * instead of the stable source-positioned outer-completion diagnostic. The
 * check is read-only and reports only the first region, matching normal
 * fail-fast function emission and preserving transactional output.
 */
function validateCompletionFunction(ctx: EmitContext): boolean {
  const state = requireFunctionEmitState(ctx);
  for (const region of state.plan.finallyRegions) {
    if (region.strategy === "finally-helper-local") continue;
    if (region.strategy === "unsupported-outer-transfer"
      || !isSupportedCompletionRegion(state.plan, region)) {
      rejectSemantic(
        ctx,
        "exceptions.finally-outer-transfer",
        region.statement,
        "This return, break, or continue crosses a finally boundary outside the typed synchronous completion subset.",
        "control-flow"
      );
      return false;
    }
    if (!completionCarrier(ctx, state)) {
      rejectSemantic(
        ctx,
        "exceptions.finally-outer-transfer",
        region.statement,
        "The explicit return type cannot be represented by a strong Haxe completion carrier.",
        "control-flow"
      );
      return false;
    }
  }
  return true;
}

/**
 * Satisfies Haxe's value-return check without inventing a fallback value.
 *
 * TypeScript has already accepted the whole project. For this staged boundary,
 * a completion-aware value function has an explicit strong return annotation
 * that cannot contain implicit `undefined`; a reachable fallthrough would have
 * been a TypeScript error. Haxe cannot derive that fact through the generic
 * callback result, so the generated function ends with an invariant throw.
 * The throw is unreachable for accepted input and is safer than fabricating a
 * number, string, object, or cast merely to satisfy Haxe's local analysis.
 */
function appendCompletionReturnGuard(ctx: EmitContext, body: string,
    indent: string): string {
  const state = requireFunctionEmitState(ctx);
  if (state.plan.returnCarrier.kind !== "value"
    || !state.plan.finallyRegions.some((region) =>
      isSupportedCompletionRegion(state.plan, region)))
    return body;
  const message = JSON.stringify(
    `Typed completion function ${state.plan.name} reached impossible fallthrough.`
  );
  const guard = `${indent}throw new haxe.Exception(${message});`;
  return body.length > 0 ? `${body}\n${guard}` : guard;
}

type ExternModule = {
  moduleSpecifier: string;
  className: string;
  /**
   * Runtime export name to its checker-validated shape. `null` is retained
   * only for assisted scaffolding whose package request still fails closed.
   */
  members: Map<string, SupportedPackageExternBindingPlan["member"] | null>;
};

function isValidHaxeIdentifier(name: string): boolean {
  return /^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name);
}

// Minimal reserved-word protection for extern field names.
// Keep this list short and add to it when real-world fixtures demand it.
const HAXE_RESERVED = new Set([
  "default",
  "function",
  "var",
  "final",
  "class",
  "enum",
  "typedef",
  "package",
  "import",
  "public",
  "private",
  "static",
  "new",
  "null",
  "true",
  "false"
]);

function externFieldForExportName(exportedName: string): { hxName: string; nativeName: string | null } {
  if (exportedName === "default") return { hxName: "__default", nativeName: "default" };
  if (isValidHaxeIdentifier(exportedName) && !HAXE_RESERVED.has(exportedName)) return { hxName: exportedName, nativeName: null };

  const cleaned = exportedName
    .replace(/^[^_a-zA-Z]+/, "_")
    .replace(/[^_a-zA-Z0-9]/g, "_");
  const hxName = cleaned.length > 0 && !HAXE_RESERVED.has(cleaned) ? cleaned : `_${cleaned}`;
  return { hxName, nativeName: exportedName };
}

function externModuleNameFromSpecifier(spec: string): string {
  return toHaxeModuleName(spec.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "_"));
}

function collectNamespaceMemberAccesses(sf: ts.SourceFile, namespaceImports: Array<{ alias: string; moduleSpecifier: string }>): Map<string, Set<string>> {
  const aliasToSpec = new Map<string, string>();
  for (const imp of namespaceImports) aliasToSpec.set(imp.alias, imp.moduleSpecifier);

  const perSpec = new Map<string, Set<string>>();
  function add(spec: string, name: string) {
    const existing = perSpec.get(spec) ?? new Set<string>();
    existing.add(name);
    perSpec.set(spec, existing);
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const spec = aliasToSpec.get(node.expression.text);
      if (spec) add(spec, node.name.text);
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      const spec = aliasToSpec.get(node.expression.text);
      if (spec) add(spec, node.argumentExpression.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return perSpec;
}

function addExternMember(
  ex: ExternModule,
  runtimeExportName: string,
  member: SupportedPackageExternBindingPlan["member"] | null
): void {
  const existing = ex.members.get(runtimeExportName);
  if (existing === undefined || (existing === null && member !== null)) {
    ex.members.set(runtimeExportName, member);
    return;
  }
  if (existing === null || member === null) return;
  if (JSON.stringify(existing) !== JSON.stringify(member)) {
    throw new Error(
      `Conflicting package declarations were planned for ${JSON.stringify(ex.moduleSpecifier)} `
        + `export ${JSON.stringify(runtimeExportName)}.`
    );
  }
}

/**
 * Projects source imports plus validated runtime plans into extern modules.
 *
 * Why: source syntax is still needed in assisted mode, but successful package
 * translation must never infer a Haxe type while printing. The runtime planner
 * is the sole producer of strong member shapes.
 *
 * What: source-only members begin as explicit weak scaffolding. A supported
 * request replaces those entries with immutable function or readonly-value
 * records. Conflicting strong records are compiler invariant failures.
 *
 * How: modules remain keyed by their literal runtime specifier. Member order is
 * normalized only by the printer, so Program and Map iteration cannot change
 * generated files.
 */
function buildExternModules(
  opts: EmitHaxeOptions,
  packageBindingsByStatement: ReadonlyMap<
    ts.ImportDeclaration,
    readonly SupportedPackageExternBindingPlan[]
  >,
  packageExternStatements: ReadonlySet<ts.ImportDeclaration>
): Map<string, ExternModule> {
  const externs = new Map<string, ExternModule>();

  for (const sf of opts.sourceFiles) {
    const imports = sf.statements
      .filter((statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) && packageExternStatements.has(statement)
      )
      .flatMap((statement) => {
        const spec = importSpecFromStatement(statement);
        return spec ? [spec] : [];
      });

    for (const imp of imports) {
      const existing = externs.get(imp.moduleSpecifier);
      const ex: ExternModule =
        existing ??
        ({
          moduleSpecifier: imp.moduleSpecifier,
          className: externModuleNameFromSpecifier(imp.moduleSpecifier),
          members: new Map<string, SupportedPackageExternBindingPlan["member"] | null>()
        } as ExternModule);

      if (imp.defaultImport) addExternMember(ex, "default", null);
      for (const el of imp.named.filter((el) => !el.isTypeOnly)) {
        const exportedName = el.alias ?? el.name;
        addExternMember(ex, exportedName, null);
      }

      externs.set(imp.moduleSpecifier, ex);
    }

    const namespaceImports = imports
      .filter((i) => !isRelativeModuleSpecifier(i.moduleSpecifier) && i.namespaceImport)
      .map((i) => ({ alias: i.namespaceImport as string, moduleSpecifier: i.moduleSpecifier }));
    const accessed = collectNamespaceMemberAccesses(sf, namespaceImports);
    for (const [spec, names] of accessed.entries()) {
      const ex = externs.get(spec);
      if (!ex) continue;
      for (const n of names) addExternMember(ex, n, null);
    }
  }

  for (const bindings of packageBindingsByStatement.values()) {
    for (const binding of bindings) {
      const ex = externs.get(binding.moduleSpecifier);
      if (!ex) {
        throw new Error(
          `Typed package plan has no extern module for ${JSON.stringify(binding.moduleSpecifier)}.`
        );
      }
      addExternMember(ex, binding.runtimeExportName, binding.member);
    }
  }

  return externs;
}

function emitExternModuleFile(opts: EmitHaxeOptions, ex: ExternModule): { filePath: string; content: string } {
  const externPackage = toHaxePackagePath([opts.basePackage, "extern"]);
  const basePackageDirs = opts.basePackage.split(".").filter((p) => p.length > 0);
  const outAbsFile = path.resolve(opts.outDir, path.join(...basePackageDirs, "extern", `${ex.className}.hx`));

  const lines: string[] = [];
  lines.push(`package ${externPackage};`);
  lines.push("");
  lines.push("/**");
  lines.push(" * Runtime package boundary generated by ts2hx.");
  lines.push(" *");
  lines.push(" * @:jsRequire preserves the literal package identity for both Genes output");
  lines.push(" * profiles. Strong members come only from checker-validated declaration-file");
  lines.push(" * functions and constants; weak members are assisted-only loss scaffolds.");
  lines.push(" */");
  lines.push(`@:jsRequire(${JSON.stringify(ex.moduleSpecifier)})`);
  lines.push(`extern class ${ex.className} {`);
  for (const [exportName, member] of Array.from(ex.members.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const f = externFieldForExportName(exportName);
    const native = f.nativeName ? `@:native(${JSON.stringify(f.nativeName)}) ` : "";
    if (member === null) {
      lines.push(`  ${native}static var ${f.hxName}: Dynamic;`);
    } else if (member.kind === "function") {
      const parameters = member.parameters
        .map((parameter) => `${parameter.name}:${parameter.type}`)
        .join(", ");
      lines.push(
        `  ${native}static function ${f.hxName}(${parameters}):${member.returnType};`
      );
    } else {
      lines.push(
        `  ${native}static var ${f.hxName}(default, never):${member.valueType};`
      );
    }
  }
  lines.push(`}`);
  lines.push("");

  return { filePath: outAbsFile, content: lines.join("\n") };
}

type BindingMode = "declare" | "assign";

type DeclareKeyword = "var" | "final";

function emitBindingTarget(expr: ts.Expression): string | null {
  if (ts.isParenthesizedExpression(expr)) return emitBindingTarget(expr.expression);
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = emitBindingTarget(expr.expression);
    if (!left) return null;
    return `${left}.${expr.name.text}`;
  }
  if (ts.isElementAccessExpression(expr)) {
    const left = emitBindingTarget(expr.expression);
    if (!left || !expr.argumentExpression || !ts.isStringLiteral(expr.argumentExpression)) return null;
    return `${left}[${JSON.stringify(expr.argumentExpression.text)}]`;
  }
  return null;
}

function canDotAccessField(name: string): boolean {
  return isValidHaxeIdentifier(name) && !HAXE_RESERVED.has(name);
}

function emitDestructureFromBindingName(opts: {
  ctx: EmitContext;
  mode: BindingMode;
  declareKeyword?: DeclareKeyword;
  name: ts.BindingName;
  valueExpr: string;
  indent: string;
}): string[] | null {
  const { ctx, mode, name, valueExpr, indent } = opts;
  const declareKeyword: DeclareKeyword = opts.declareKeyword ?? "var";
  const out: string[] = [];

  if (ts.isIdentifier(name)) {
    out.push(
      mode === "declare"
        ? `${indent}${declareKeyword} ${name.text} = ${valueExpr};`
        : `${indent}${name.text} = ${valueExpr};`
    );
    return out;
  }

  if (ts.isObjectBindingPattern(name)) {
    const takenKeys: string[] = [];

    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        if (!ts.isIdentifier(el.name)) return null;
        const restName = el.name.text;
        out.push(`${indent}${declareKeyword} ${restName} = js.lib.Object.assign(cast {}, ${valueExpr});`);
        for (const k of takenKeys) out.push(`${indent}Reflect.deleteField(${restName}, ${JSON.stringify(k)});`);
        continue;
      }

      const key =
        el.propertyName && ts.isIdentifier(el.propertyName)
          ? el.propertyName.text
          : el.propertyName && ts.isStringLiteral(el.propertyName)
            ? el.propertyName.text
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
      if (!key) return null;
      takenKeys.push(key);

      const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;

      const rawTmp = nextTmp(ctx);
      out.push(`${indent}var ${rawTmp} = ${access};`);

      let effectiveValue = rawTmp;
      if (el.initializer) {
        const def = emitExpression(ctx, el.initializer);
        if (!def) return null;
        effectiveValue = `(${rawTmp} == null ? ${def} : ${rawTmp})`;
      }

      const targetName = el.name;
      if (ts.isIdentifier(targetName)) {
        out.push(
          mode === "declare"
            ? `${indent}${declareKeyword} ${targetName.text} = ${effectiveValue};`
            : `${indent}${targetName.text} = ${effectiveValue};`
        );
      } else {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
        const nested = emitDestructureFromBindingName({ ctx, mode, declareKeyword, name: targetName, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
      }
    }

    return out;
  }

  if (ts.isArrayBindingPattern(name)) {
    let index = 0;
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) {
        index++;
        continue;
      }

      if (el.dotDotDotToken) {
        if (!ts.isIdentifier(el.name)) return null;
        const restName = el.name.text;
        out.push(`${indent}${declareKeyword} ${restName} = ${valueExpr}.slice(${index});`);
        continue;
      }

      const access = `${valueExpr}[${index}]`;
      index++;

      const rawTmp = nextTmp(ctx);
      out.push(`${indent}var ${rawTmp} = ${access};`);

      let effectiveValue = rawTmp;
      if (el.initializer) {
        const def = emitExpression(ctx, el.initializer);
        if (!def) return null;
        effectiveValue = `(${rawTmp} == null ? ${def} : ${rawTmp})`;
      }

      if (ts.isIdentifier(el.name)) {
        out.push(
          mode === "declare"
            ? `${indent}${declareKeyword} ${el.name.text} = ${effectiveValue};`
            : `${indent}${el.name.text} = ${effectiveValue};`
        );
      } else {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
        const nested = emitDestructureFromBindingName({ ctx, mode, declareKeyword, name: el.name, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
      }
    }

    return out;
  }

  return null;
}

function emitDestructureAssignmentFromExpression(opts: {
  ctx: EmitContext;
  pattern: ts.Expression;
  valueExpr: string;
  indent: string;
}): string[] | null {
  const { ctx, pattern, valueExpr, indent } = opts;
  const out: string[] = [];

  if (ts.isParenthesizedExpression(pattern)) {
    return emitDestructureAssignmentFromExpression({ ctx, pattern: pattern.expression, valueExpr, indent });
  }

  if (ts.isObjectLiteralExpression(pattern)) {
    const takenKeys: string[] = [];
    for (const prop of pattern.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const target = emitBindingTarget(prop.expression);
        if (!target) return null;
        out.push(`${indent}${target} = js.lib.Object.assign(cast {}, ${valueExpr});`);
        for (const k of takenKeys) out.push(`${indent}Reflect.deleteField(${target}, ${JSON.stringify(k)});`);
        continue;
      }

      if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        takenKeys.push(key);
        const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;
        const rawTmp = nextTmp(ctx);
        out.push(`${indent}var ${rawTmp} = ${access};`);
        if (prop.objectAssignmentInitializer) {
          const def = emitExpression(ctx, prop.objectAssignmentInitializer);
          if (!def) return null;
          out.push(`${indent}${key} = (${rawTmp} == null ? ${def} : ${rawTmp});`);
        } else {
          out.push(`${indent}${key} = ${rawTmp};`);
        }
        continue;
      }

      if (ts.isPropertyAssignment(prop)) {
        const key =
          ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
        if (!key) return null;
        takenKeys.push(key);

        const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;

        // Defaults in assignment patterns: `{a: b = 1} = obj` or `{a: {b} = {}} = obj`.
        if (ts.isBinaryExpression(prop.initializer) && prop.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const rhsTmp = nextTmp(ctx);
          out.push(`${indent}var ${rhsTmp} = ${access};`);
          const def = emitExpression(ctx, prop.initializer.right);
          if (!def) return null;
          const effectiveValue = `(${rhsTmp} == null ? ${def} : ${rhsTmp})`;

          const left = prop.initializer.left;
          if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
            const nestedTmp = nextTmp(ctx);
            out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
            const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: left, valueExpr: nestedTmp, indent });
            if (!nested) return null;
            out.push(...nested);
            continue;
          }

          const target = emitBindingTarget(left);
          if (!target) return null;
          out.push(`${indent}${target} = ${effectiveValue};`);
          continue;
        }

        if (ts.isObjectLiteralExpression(prop.initializer) || ts.isArrayLiteralExpression(prop.initializer)) {
          const nestedTmp = nextTmp(ctx);
          out.push(`${indent}var ${nestedTmp}: Dynamic = ${access};`);
          const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: prop.initializer, valueExpr: nestedTmp, indent });
          if (!nested) return null;
          out.push(...nested);
          continue;
        }

        const target = emitBindingTarget(prop.initializer);
        if (!target) return null;
        out.push(`${indent}${target} = ${access};`);
        continue;
      }

      return null;
    }

    return out;
  }

  if (ts.isArrayLiteralExpression(pattern)) {
    let index = 0;
    for (const el of pattern.elements) {
      if (ts.isOmittedExpression(el)) {
        index++;
        continue;
      }
      if (ts.isSpreadElement(el)) {
        const target = emitBindingTarget(el.expression);
        if (!target) return null;
        out.push(`${indent}${target} = ${valueExpr}.slice(${index});`);
        continue;
      }

      const access = `${valueExpr}[${index}]`;
      index++;

      // Defaults in assignment patterns: `[a = 1] = arr` or `[{a} = {}] = arr`.
      if (ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const rhsTmp = nextTmp(ctx);
        out.push(`${indent}var ${rhsTmp} = ${access};`);
        const def = emitExpression(ctx, el.right);
        if (!def) return null;
        const effectiveValue = `(${rhsTmp} == null ? ${def} : ${rhsTmp})`;

        const left = el.left;
        if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
          const nestedTmp = nextTmp(ctx);
          out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
          const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: left, valueExpr: nestedTmp, indent });
          if (!nested) return null;
          out.push(...nested);
          continue;
        }

        const target = emitBindingTarget(left);
        if (!target) return null;
        out.push(`${indent}${target} = ${effectiveValue};`);
        continue;
      }

      if (ts.isObjectLiteralExpression(el) || ts.isArrayLiteralExpression(el)) {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${access};`);
        const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: el, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
        continue;
      }

      const target = emitBindingTarget(el);
      if (!target) return null;
      out.push(`${indent}${target} = ${access};`);
    }

    return out;
  }

  return null;
}

function emitType(typeNode: ts.TypeNode | undefined): string {
  if (!typeNode) return "Dynamic";

  function emitTypeName(typeName: ts.EntityName): string | null {
    if (ts.isIdentifier(typeName)) return typeName.text;
    if (ts.isQualifiedName(typeName)) {
      const left = emitTypeName(typeName.left);
      if (!left) return null;
      return `${left}.${typeName.right.text}`;
    }
    return null;
  }

  function eitherType(items: string[]): string {
    const cleaned = items.filter((t) => t !== "Dynamic");
    if (cleaned.length === 0) return "Dynamic";
    if (cleaned.length === 1) return cleaned[0] as string;

    let out = `haxe.extern.EitherType<${cleaned[0]}, ${cleaned[1]}>`;
    for (const next of cleaned.slice(2)) out = `haxe.extern.EitherType<${out}, ${next}>`;
    return out;
  }

  switch (typeNode.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "Float";
    case ts.SyntaxKind.StringKeyword:
      return "String";
    case ts.SyntaxKind.BooleanKeyword:
      return "Bool";
    case ts.SyntaxKind.VoidKeyword:
      return "Void";
    case ts.SyntaxKind.UndefinedKeyword:
      return "genes.ts.Undefinable<Any>";
    case ts.SyntaxKind.NullKeyword:
      return "Null<Any>";
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return "Dynamic";
    case ts.SyntaxKind.TypeReference: {
      const ref = typeNode as ts.TypeReferenceNode;
      const baseName = emitTypeName(ref.typeName);
      if (!baseName) return "Dynamic";

      // Builtin mappings for Haxe-for-JS.
      // TS's global `Promise<T>` maps to `js.lib.Promise<T>` in Haxe.
      const mappedBase =
        baseName === "Promise"
          ? "js.lib.Promise"
          : baseName === "RegExp"
            ? "EReg"
          : baseName === "HTMLAnchorElement"
            ? "js.html.AnchorElement"
          : baseName === "ReadonlyArray"
            ? "Array"
            : baseName === "JSX.Element"
              ? "genes.react.Element"
              : baseName;

      const typeArgs = ref.typeArguments ?? [];
      if (typeArgs.length === 0) return mappedBase;

      const args = typeArgs.map((a) => emitType(a));
      return `${mappedBase}<${args.join(", ")}>`;
    }
    case ts.SyntaxKind.ArrayType: {
      const arr = typeNode as ts.ArrayTypeNode;
      return `Array<${emitType(arr.elementType)}>`;
    }
    case ts.SyntaxKind.ParenthesizedType: {
      const p = typeNode as ts.ParenthesizedTypeNode;
      return emitType(p.type);
    }
    case ts.SyntaxKind.FunctionType: {
      const fn = typeNode as ts.FunctionTypeNode;
      const argTypes = fn.parameters.map((p) => {
        const base = p.dotDotDotToken ? `haxe.extern.Rest<${emitRestElementType(p.type)}>` : emitType(p.type);
        return p.questionToken ? `Null<${base}>` : base;
      });
      const ret = emitType(fn.type);
      if (argTypes.length === 0) return `Void->${ret}`;
      return [...argTypes, ret].join("->");
    }
    case ts.SyntaxKind.UnionType: {
      const un = typeNode as ts.UnionTypeNode;

      function isNullType(item: ts.TypeNode): boolean {
        return item.kind === ts.SyntaxKind.NullKeyword
          || (ts.isLiteralTypeNode(item) && item.literal.kind === ts.SyntaxKind.NullKeyword);
      }

      function isUndefinedType(item: ts.TypeNode): boolean {
        return item.kind === ts.SyntaxKind.UndefinedKeyword;
      }

      // Keep JavaScript undefined separate from Haxe null. Undefinable is a
      // real target-polymorphic Haxe abstraction, so this remains valid in both
      // genes-ts and classic Genes output instead of relying on a TS type string.
      const hadNull = un.types.some(isNullType);
      const hadUndefined = un.types.some(isUndefinedType);
      const nonNullable = un.types.filter(
        (t) => !isNullType(t) && !isUndefinedType(t)
      );

      function applyNullish(core: string): string {
        const nullable = hadNull ? `Null<${core}>` : core;
        return hadUndefined ? `genes.ts.Undefinable<${nullable}>` : nullable;
      }

      // Simple literal unions.
      const stringLits: string[] = [];
      const numberLits: string[] = [];
      let boolOnly = true;
      for (const t of nonNullable) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
          stringLits.push(t.literal.text);
          boolOnly = false;
          continue;
        }
        if (ts.isLiteralTypeNode(t) && ts.isNumericLiteral(t.literal)) {
          numberLits.push(t.literal.text);
          boolOnly = false;
          continue;
        }
        if (t.kind === ts.SyntaxKind.TrueKeyword || t.kind === ts.SyntaxKind.FalseKeyword) continue;
        boolOnly = false;
      }

      if (boolOnly && nonNullable.length > 0) return applyNullish("Bool");
      if (stringLits.length === nonNullable.length && nonNullable.length > 0) return applyNullish("String");
      if (numberLits.length === nonNullable.length && nonNullable.length > 0) return applyNullish("Float");

      const emitted = nonNullable.map((t) => emitType(t));
      const core = eitherType(emitted);
      return applyNullish(core);
    }
    case ts.SyntaxKind.TypeLiteral: {
      const lit = typeNode as ts.TypeLiteralNode;
      if (lit.members.length === 0) return "{}";

      const parts: string[] = [];
      for (const member of lit.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const isOptional = !!member.questionToken;
          const fieldType = emitType(member.type);
          parts.push(isOptional ? `@:optional @:ts.optional var ${member.name.text}: ${fieldType};` : `var ${member.name.text}: ${fieldType};`);
          continue;
        }
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
          const isOptional = !!member.questionToken;
          const params = member.parameters.map((p) => {
            const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
            const isParamOptional = !!p.questionToken;
            const t = emitType(p.type);
            return `${isParamOptional ? "?" : ""}${id}: ${t}`;
          });
          const ret = emitType(member.type);
          parts.push(`${isOptional ? "@:optional " : ""}function ${member.name.text}(${params.join(", ")}): ${ret};`);
          continue;
        }
        return "Dynamic";
      }

      return `{ ${parts.join(" ")} }`;
    }
    default:
      return "Dynamic";
  }
}

/**
 * Detects values whose TypeScript contract is the standard `RegExp` interface.
 *
 * Why: TypeScript spells matching and replacement as methods on `RegExp` and
 * `String`, while typed Haxe exposes the same native-JS behavior through
 * `EReg.match` and `EReg.replace`. Asking the checker keeps this lowering
 * scope-aware for identifiers instead of guessing from their names.
 */
function isRegExpExpression(ctx: EmitContext, expr: ts.Expression): boolean {
  if (ts.isRegularExpressionLiteral(expr)) return true;
  const type = ctx.checker.getTypeAtLocation(expr);
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return symbol?.getName() === "RegExp" || ctx.checker.typeToString(type) === "RegExp";
}

/** Returns whether the checker identifies an expression as a standard array. */
function isArrayExpression(ctx: EmitContext, expr: ts.Expression): boolean {
  const type = ctx.checker.getTypeAtLocation(expr);
  return ctx.checker.isArrayType(type) || ctx.checker.isTupleType(type);
}

function emitRestElementType(typeNode: ts.TypeNode | undefined): string {
  if (!typeNode) return "Dynamic";
  if (ts.isArrayTypeNode(typeNode)) return emitType(typeNode.elementType);
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const name = typeNode.typeName.text;
    if ((name === "Array" || name === "ReadonlyArray") && typeNode.typeArguments && typeNode.typeArguments.length === 1) {
      return emitType(typeNode.typeArguments[0] as ts.TypeNode);
    }
  }
  // Best-effort fallback: treat the annotation as the element type already.
  return emitType(typeNode);
}

type EmittedParameterList = {
  parameters: string[];
  prelude: string[];
  bodyRewrites: Map<string, string>;
};

function withIdentifierRewrites<T>(
  ctx: EmitContext,
  rewrites: Map<string, string>,
  emit: () => T
): T {
  const prior = new Map<string, string | null>();
  for (const [name, replacement] of rewrites) {
    prior.set(name, ctx.identifierRewrites.get(name) ?? null);
    ctx.identifierRewrites.set(name, replacement);
  }
  try {
    return emit();
  } finally {
    for (const [name, replacement] of prior) {
      if (replacement === null) ctx.identifierRewrites.delete(name);
      else ctx.identifierRewrites.set(name, replacement);
    }
  }
}

/**
 * Renders parameters from normalized absence/default plans.
 *
 * The semantic plan owns the important decision: TypeScript defaults test
 * exact `undefined`. This renderer only spells that decision with the typed
 * `Undefinable.isAbsent` boundary and handles binding-pattern setup.
 */
function emitParameters(
  ctx: EmitContext,
  sourceParameters: readonly ts.ParameterDeclaration[],
  indent: string
): EmittedParameterList | null {
  const parameters: string[] = [];
  const prelude: string[] = [];
  const bodyRewrites = new Map<string, string>();

  for (let index = 0; index < sourceParameters.length; index++) {
    const plan = planParameter(sourceParameters[index] as ts.ParameterDeclaration, index);
    const parameter = plan.parameter;
    const baseParameterType = plan.isRest
      ? `haxe.extern.Rest<${emitRestElementType(parameter.type)}>`
      : emitType(parameter.type);
    const parameterType = plan.defaultValue
      ? `genes.ts.Undefinable<${baseParameterType}>`
      : baseParameterType;
    const namePrefix = plan.isOptional ? "?" : "";
    const typeSuffix = parameter.type || plan.isRest ? `: ${parameterType}` : "";

    if (plan.defaultValue) {
      recordSemantic(ctx, "parameters.undefined-default", parameter);
      const defaultValue = withIdentifierRewrites(
        ctx,
        bodyRewrites,
        () => emitExpression(ctx, plan.defaultValue as ts.Expression)
      );
      if (!defaultValue) return null;
      prelude.push(
        `${indent}if (genes.ts.Undefinable.isAbsent(${plan.name})) ${plan.name} = ${defaultValue};`
      );
    }

    if (!ts.isIdentifier(parameter.name)) {
      const sourceTemp = nextTmp(ctx);
      const sourceValue = plan.defaultValue ? `${plan.name}.assumePresent()` : plan.name;
      prelude.push(`${indent}var ${sourceTemp} = ${sourceValue};`);
      const destructured = emitDestructureFromBindingName({
        ctx,
        mode: "declare",
        declareKeyword: "var",
        name: parameter.name,
        valueExpr: sourceTemp,
        indent
      });
      if (!destructured) return null;
      prelude.push(...destructured);
    } else if (plan.defaultValue) {
      const normalized = nextTmp(ctx, `__ts2hx_${plan.name}_value`);
      prelude.push(`${indent}var ${normalized}: ${baseParameterType} = ${plan.name}.assumePresent();`);
      bodyRewrites.set(plan.name, normalized);
    }

    parameters.push(`${namePrefix}${plan.name}${typeSuffix}`);
  }

  return { parameters, prelude, bodyRewrites };
}

function emitIife(bodyLines: string[]): string {
  return `(function() {\n${bodyLines.join("\n")}\n})()`;
}

function isIntrinsicJsxTag(tag: string): boolean {
  if (!tag || tag.length === 0) return false;
  const first = tag.charCodeAt(0);
  return (first >= "a".charCodeAt(0) && first <= "z".charCodeAt(0)) || tag.includes("-");
}

function normalizeJsxText(s: string): string {
  // Collapse whitespace so indentation/newlines in TSX don't create accidental whitespace-only text nodes.
  const collapsed = s.replace(/[ \t\r\n]+/g, " ");
  // Drop whitespace-only nodes, but preserve meaningful boundary spaces by not trimming.
  if (collapsed.trim().length === 0) return "";
  return collapsed;
}

function emitJsxTag(ctx: EmitContext, tagName: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagName)) {
    const raw = tagName.text;
    if (isIntrinsicJsxTag(raw)) return JSON.stringify(raw);
    return emitExpression(ctx, tagName);
  }
  if (ts.isJsxNamespacedName(tagName as unknown as ts.Node)) {
    const ns = (tagName as unknown as ts.JsxNamespacedName).namespace.text;
    const name = (tagName as unknown as ts.JsxNamespacedName).name.text;
    const raw = `${ns}:${name}`;
    return JSON.stringify(raw);
  }
  // Best-effort: treat member expressions (`Foo.Bar`) as normal expressions.
  if (ts.isPropertyAccessExpression(tagName as unknown as ts.Node)) {
    return emitExpression(ctx, tagName as unknown as ts.Expression);
  }
  return null;
}

function emitJsxProps(ctx: EmitContext, attrs: ts.JsxAttributes): string[] | null {
  const out: string[] = [];
  for (const prop of attrs.properties) {
    if (ts.isJsxAttribute(prop)) {
      const name = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isJsxNamespacedName(prop.name)
          ? `${prop.name.namespace.text}:${prop.name.name.text}`
          : null;
      if (!name) return null;
      let valueExpr: string | null = null;
      if (!prop.initializer) {
        valueExpr = "true";
      } else if (ts.isStringLiteral(prop.initializer)) {
        valueExpr = JSON.stringify(prop.initializer.text);
      } else if (ts.isJsxExpression(prop.initializer)) {
        const inner = prop.initializer.expression;
        if (!inner) continue; // `{/* comment */}` / empty expression
        valueExpr = emitExpression(ctx, inner);
        if (valueExpr && typeIncludesUndefined(ctx.checker.getTypeAtLocation(inner)))
          valueExpr = `genes.ts.Undefinable.fromNullable(${valueExpr})`;
      } else {
        return null;
      }
      if (!valueExpr) return null;
      out.push(`{ name: ${JSON.stringify(name)}, value: ${valueExpr} }`);
      continue;
    }

    if (ts.isJsxSpreadAttribute(prop)) {
      const spread = emitExpression(ctx, prop.expression);
      if (!spread) return null;
      out.push(`{ spread: ${spread} }`);
      continue;
    }

    return null;
  }
  return out;
}

function emitJsxChildren(ctx: EmitContext, children: readonly ts.JsxChild[]): string[] | null {
  const out: string[] = [];
  let pendingText: string | null = null;

  function flushText() {
    if (pendingText == null) return;
    out.push(JSON.stringify(pendingText));
    pendingText = null;
  }

  for (const child of children) {
    if (ts.isJsxText(child)) {
      const norm = normalizeJsxText(child.text);
      if (norm.length === 0) continue;
      pendingText = pendingText == null ? norm : normalizeJsxText(pendingText + norm);
      continue;
    }

    flushText();

    if (ts.isJsxExpression(child)) {
      const inner = child.expression;
      if (!inner) continue;
      let emitted = emitExpression(ctx, inner);
      if (!emitted) return null;
      if (
        ts.isConditionalExpression(inner) &&
        ((isJsxExpressionNode(inner.whenTrue) && inner.whenFalse.kind === ts.SyntaxKind.NullKeyword) ||
          (inner.whenTrue.kind === ts.SyntaxKind.NullKeyword && isJsxExpressionNode(inner.whenFalse)))
      ) {
        emitted = `genes.react.Children.nullable(${emitted})`;
      }
      out.push(emitted);
      continue;
    }

    // JsxElement / JsxSelfClosingElement / JsxFragment are expressions.
    const emitted = emitExpression(ctx, child as unknown as ts.Expression);
    if (!emitted) return null;
    out.push(emitted);
  }

  flushText();
  return out;
}

function isJsxExpressionNode(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) return isJsxExpressionNode(node.expression);
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function typeIncludesUndefined(type: ts.Type): boolean {
  if ((type.getFlags() & ts.TypeFlags.Undefined) !== 0) return true;
  return type.isUnion() && type.types.some(typeIncludesUndefined);
}

function emitJsxRoot(ctx: EmitContext, expr: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): string | null {
  if (ts.isJsxFragment(expr)) {
    const children = emitJsxChildren(ctx, expr.children);
    if (!children) return null;
    return `genes.react.internal.Jsx.__frag([${children.join(", ")}])`;
  }

  if (ts.isJsxSelfClosingElement(expr)) {
    const tag = emitJsxTag(ctx, expr.tagName);
    if (!tag) return null;
    const props = emitJsxProps(ctx, expr.attributes);
    if (!props) return null;
    return `genes.react.internal.Jsx.__jsx(${tag}, [${props.join(", ")}], [])`;
  }

  // JsxElement
  const tag = emitJsxTag(ctx, expr.openingElement.tagName);
  if (!tag) return null;
  const props = emitJsxProps(ctx, expr.openingElement.attributes);
  if (!props) return null;
  const children = emitJsxChildren(ctx, expr.children);
  if (!children) return null;
  return `genes.react.internal.Jsx.__jsx(${tag}, [${props.join(", ")}], [${children.join(", ")}])`;
}

type EmittedLValue = {
  setup: string[];
  read: string;
  target: string;
};

/** Renders a validated lvalue while making receiver/key evaluation explicit. */
function emitAssignmentTarget(ctx: EmitContext, expression: ts.Expression): EmittedLValue | null {
  const plan = planAssignmentTarget(expression);
  if (plan.kind === "identifier") {
    return { setup: [], read: plan.identifier.text, target: plan.identifier.text };
  }

  if (plan.kind === "property") {
    const receiver = emitExpression(ctx, plan.receiver);
    if (!receiver) return null;
    const receiverTemp = nextTmp(ctx, "__ts2hx_recv");
    const target = `${receiverTemp}.${plan.property.text}`;
    return { setup: [`  var ${receiverTemp} = ${receiver};`], read: target, target };
  }

  if (plan.kind === "element") {
    const receiver = emitExpression(ctx, plan.receiver);
    const key = emitExpression(ctx, plan.key);
    if (!receiver || !key) return null;
    const receiverTemp = nextTmp(ctx, "__ts2hx_recv");
    const keyTemp = nextTmp(ctx, "__ts2hx_key");
    const target = `${receiverTemp}[${keyTemp}]`;
    return {
      setup: [`  var ${receiverTemp} = ${receiver};`, `  var ${keyTemp} = ${key};`],
      read: target,
      target
    };
  }

  return null;
}

function emitCompoundAssignment(
  ctx: EmitContext,
  expression: ts.BinaryExpression,
  operatorText: string
): string | null {
  const lvalue = emitAssignmentTarget(ctx, expression.left);
  if (!lvalue) return null;
  const right = emitExpression(ctx, expression.right);
  if (!right) return null;
  recordSemantic(ctx, "evaluation.compound-assignment", expression);

  const oldValue = nextTmp(ctx, "__ts2hx_old");
  const rightValue = nextTmp(ctx, "__ts2hx_rhs");
  return emitIife([
    ...lvalue.setup,
    `  var ${oldValue} = ${lvalue.read};`,
    `  var ${rightValue} = ${right};`,
    `  return ${lvalue.target} = (${oldValue} ${operatorText} ${rightValue});`
  ]);
}

function emitLogicalAssignment(ctx: EmitContext, expression: ts.BinaryExpression): string | null {
  const lvalue = emitAssignmentTarget(ctx, expression.left);
  if (!lvalue) return null;
  const right = emitExpression(ctx, expression.right);
  if (!right) return null;
  recordSemantic(ctx, "evaluation.compound-assignment", expression);

  const current = nextTmp(ctx, "__ts2hx_current");
  let condition: string;
  if (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
    condition = `${current} == null`;
  } else {
    recordSemantic(ctx, "coercion.truthiness", expression.left);
    const truthy = `genes.js.Truthiness.isTruthy(${current})`;
    condition = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
      ? truthy
      : `!(${truthy})`;
  }

  return emitIife([
    ...lvalue.setup,
    `  var ${current} = ${lvalue.read};`,
    `  if (${condition}) {`,
    `    ${current} = ${right};`,
    `    ${lvalue.target} = ${current};`,
    "  }",
    `  return ${current};`
  ]);
}

function emitArrowFunctionExpression(ctx: EmitContext,
    fn: ts.ArrowFunction): string | null {
  return withFunctionEmitState(ctx, fn, () => {
    if (!validateCompletionFunction(ctx)) return null;
    const isAsync = fn.modifiers?.some((m) =>
      m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
    if (isAsync) recordSemantic(ctx, "async.await", fn);
    const emittedParameters = emitParameters(ctx, fn.parameters, "  ");
    if (!emittedParameters) return null;
    const params = emittedParameters.parameters;
    const prelude = emittedParameters.prelude;
    const bodyRewrites = emittedParameters.bodyRewrites;

    const asyncPrefix = isAsync ? "@:async " : "";
    const asyncReturnTypeSuffix = isAsync ? `: ${emitType(fn.type)}` : "";
    const fnBody = fn.body;

    if (ts.isBlock(fnBody)) {
      const body = withIdentifierRewrites(
        ctx,
        bodyRewrites,
        () => emitStatements(ctx, fnBody.statements, "  ")
      );
      if (body == null) return null;
      const merged = prelude.length > 0
        ? (body.length > 0 ? `${prelude.join("\n")}\n${body}` : prelude.join("\n"))
        : body;
      return `${asyncPrefix}function(${params.join(", ")})${asyncReturnTypeSuffix} {\n${merged}\n}`;
    }

    const bodyExpr = withIdentifierRewrites(ctx, bodyRewrites,
      () => emitExpression(ctx, fnBody));
    if (!bodyExpr) return null;
    if (!isAsync && prelude.length === 0)
      return `function(${params.join(", ")}) return ${bodyExpr}`;
    if (isAsync) {
      const mergedPrelude = prelude.length > 0 ? `${prelude.join("\n")}\n` : "";
      return `${asyncPrefix}function(${params.join(", ")})${asyncReturnTypeSuffix} {\n${mergedPrelude}  return ${bodyExpr};\n}`;
    }

    return `function(${params.join(", ")}) {\n${prelude.join("\n")}\n  return ${bodyExpr};\n}`;
  });
}

function emitExpression(ctx: EmitContext, expr: ts.Expression): string | null {
  const normalizedRewrite = ctx.expressionRewrites.get(expressionKey(ctx, expr));
  if (normalizedRewrite !== undefined) return normalizedRewrite;

  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return (expr as ts.NumericLiteral).text;
    case ts.SyntaxKind.StringLiteral:
      return JSON.stringify((expr as ts.StringLiteral).text);
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return JSON.stringify((expr as ts.NoSubstitutionTemplateLiteral).text);
    case ts.SyntaxKind.RegularExpressionLiteral: {
      const raw = (expr as ts.RegularExpressionLiteral).text;
      const delimiter = raw.lastIndexOf("/");
      if (!raw.startsWith("/") || delimiter <= 0) return null;
      const pattern = raw.slice(1, delimiter);
      const flags = raw.slice(delimiter + 1);
      // Constructor form is deliberate: unlike Haxe's `~/.../flags` parser,
      // it safely preserves JS patterns containing an unescaped slash inside a
      // character class or Unicode escape sequences for noncharacters.
      return `new EReg(${JSON.stringify(pattern)}, ${JSON.stringify(flags)})`;
    }
    case ts.SyntaxKind.TrueKeyword:
      return "true";
    case ts.SyntaxKind.FalseKeyword:
      return "false";
    case ts.SyntaxKind.NullKeyword:
      return "null";
    case ts.SyntaxKind.Identifier: {
      const name = (expr as ts.Identifier).text;
      if (name === "undefined") {
        recordSemantic(ctx, "values.explicit-undefined", expr);
        return "genes.ts.Undefinable.absent()";
      }
      if (name === "Promise") return "js.lib.Promise";
      return ctx.identifierRewrites.get(name) ?? name;
    }
    case ts.SyntaxKind.JsxElement:
    case ts.SyntaxKind.JsxSelfClosingElement:
    case ts.SyntaxKind.JsxFragment:
      return emitJsxRoot(ctx, expr as unknown as ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment);
    case ts.SyntaxKind.ThisKeyword:
      recordSemantic(ctx, "this.class-and-lexical-arrow", expr);
      return "this";
    case ts.SyntaxKind.ParenthesizedExpression: {
      const inner = emitExpression(ctx, (expr as ts.ParenthesizedExpression).expression);
      return inner ? `(${inner})` : null;
    }
    case ts.SyntaxKind.TemplateExpression: {
      const t = expr as ts.TemplateExpression;
      const parts: string[] = [];

      // Haxe does not allow `Float + String` in strict typing, but does allow `String + Float`.
      // Ensure we always start concatenation with a String.
      if (t.head.text.length === 0) parts.push('""');
      else parts.push(JSON.stringify(t.head.text));

      for (const span of t.templateSpans) {
        const value = emitExpression(ctx, span.expression);
        if (!value) return null;
        parts.push(value);

        const tail = span.literal.text;
        if (tail.length > 0) parts.push(JSON.stringify(tail));
      }

      return `(${parts.join(" + ")})`;
    }
    case ts.SyntaxKind.NonNullExpression: {
      const inner = emitExpression(ctx, (expr as ts.NonNullExpression).expression);
      return inner ? `(${inner})` : null;
    }
    case ts.SyntaxKind.ArrowFunction: {
      const fn = expr as ts.ArrowFunction;
      return emitArrowFunctionExpression(ctx, fn);
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = expr as ts.ObjectLiteralExpression;
      const literalFields: string[] = [];
      const parts: string[] = [];
      let sawSpread = false;

      function flushLiteral() {
        if (literalFields.length === 0) return;
        parts.push(`{ ${literalFields.join(", ")} }`);
        literalFields.length = 0;
      }

      for (const prop of obj.properties) {
        if (ts.isSpreadAssignment(prop)) {
          sawSpread = true;
          flushLiteral();
          const spreadValue = emitExpression(ctx, prop.expression);
          if (!spreadValue) return null;
          parts.push(spreadValue);
          continue;
        }

        if (ts.isPropertyAssignment(prop)) {
          const name =
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
          if (!name) return null;
          const value = emitExpression(ctx, prop.initializer);
          if (!value) return null;
          literalFields.push(`${name}: ${value}`);
          continue;
        }

        if (ts.isShorthandPropertyAssignment(prop)) {
          const name = prop.name.text;
          const value = ctx.identifierRewrites.get(name) ?? name;
          literalFields.push(`${name}: ${value}`);
          continue;
        }

        if (ts.isMethodDeclaration(prop) && prop.name) {
          const name =
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
          if (!name) return null;
          if (!prop.body) return null;

          const fn = withFunctionEmitState(ctx, prop, () => {
            if (!validateCompletionFunction(ctx)) return null;
            const params = prop.parameters.map((p) => {
              const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
              const isOptional = !!p.questionToken;
              const t = emitType(p.type);
              return `${isOptional ? "?" : ""}${id}: ${t}`;
            });

            if (prop.body?.statements.length === 1
              && ts.isReturnStatement(prop.body.statements[0])) {
              const ret = prop.body.statements[0] as ts.ReturnStatement;
              if (!ret.expression) return null;
              const retExpr = emitExpression(ctx, ret.expression);
              return retExpr ? `function(${params.join(", ")}) return ${retExpr}` : null;
            }
            const body = emitStatements(ctx, prop.body?.statements ?? [], "  ");
            return body == null
              ? null
              : `function(${params.join(", ")}) {\n${body}\n}`;
          });
          if (!fn) return null;

          literalFields.push(`${name}: ${fn}`);
          continue;
        }

        return null;
      }

      if (!sawSpread) return `{ ${literalFields.join(", ")} }`;

      flushLiteral();
      if (parts.length === 0) return "{}";
      // `js.lib.Object.assign` returns the target type, so use a `Dynamic` target to avoid
      // over-constraining the inferred anonymous-structure type (which would break field access).
      return `js.lib.Object.assign(cast {}, ${parts.join(", ")})`;
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = expr as ts.ArrayLiteralExpression;
      const items = arr.elements.map((e) => emitExpression(ctx, e));
      if (items.some((a) => a == null)) return null;
      return `[${items.join(", ")}]`;
    }
    case ts.SyntaxKind.ElementAccessExpression: {
      const el = expr as ts.ElementAccessExpression;
      const left = emitExpression(ctx, el.expression);
      const index = el.argumentExpression ? emitExpression(ctx, el.argumentExpression) : null;
      if (!left || !index) return null;
      const hasQuestionDot = "questionDotToken" in el && (el as unknown as { questionDotToken?: unknown }).questionDotToken != null;
      if (!hasQuestionDot) return `${left}[${index}]`;

      const tmp = nextTmp(ctx);
      const idx = nextTmp(ctx, "__ts2hx_idx");
      return emitIife([
        `  var ${tmp} = ${left};`,
        `  var ${idx} = ${index};`,
        `  return (${tmp} == null ? null : ${tmp}[${idx}]);`
      ]);
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      const access = expr as ts.PropertyAccessExpression;
      const left = emitExpression(ctx, access.expression);
      if (!left) return null;
      const hasQuestionDot = "questionDotToken" in access && (access as unknown as { questionDotToken?: unknown }).questionDotToken != null;
      if (!hasQuestionDot) return `${left}.${access.name.text}`;

      const tmp = nextTmp(ctx);
      return emitIife([`  var ${tmp} = ${left};`, `  return (${tmp} == null ? null : ${tmp}.${access.name.text});`]);
    }
    case ts.SyntaxKind.NewExpression: {
      const ne = expr as ts.NewExpression;
      let callee = emitExpression(ctx, ne.expression);
      if (!callee) return null;
      if (ts.isIdentifier(ne.expression) && ne.expression.text === "Error") {
        // TS `Error` maps to `js.lib.Error` on the JS target.
        callee = "js.lib.Error";
      }
      const args = (ne.arguments ?? []).map((a) => emitExpression(ctx, a));
      if (args.some((a) => a == null)) return null;
      return `new ${callee}(${args.join(", ")})`;
    }
    case ts.SyntaxKind.BinaryExpression: {
      const bin = expr as ts.BinaryExpression;
      const op = bin.operatorToken.kind;

      if (
        isPrototypeMutationTarget(bin.left)
        && (op === ts.SyntaxKind.EqualsToken
          || op === ts.SyntaxKind.PlusEqualsToken
          || op === ts.SyntaxKind.MinusEqualsToken
          || op === ts.SyntaxKind.AsteriskEqualsToken
          || op === ts.SyntaxKind.SlashEqualsToken
          || op === ts.SyntaxKind.QuestionQuestionEqualsToken
          || op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
          || op === ts.SyntaxKind.BarBarEqualsToken)
      ) {
        return rejectSemantic(
          ctx,
          "prototypes.dynamic-mutation",
          bin,
          "Dynamic prototype mutation is not representable as strict typed Haxe.",
          "expression"
        );
      }

      // Preserve the common host-capability guard without embedding raw
      // `typeof` syntax in generated Haxe modules.
      const callableOperand =
        ts.isTypeOfExpression(bin.left) && ts.isStringLiteral(bin.right) && bin.right.text === "function"
          ? bin.left.expression
          : ts.isStringLiteral(bin.left) && bin.left.text === "function" && ts.isTypeOfExpression(bin.right)
            ? bin.right.expression
            : null;
      if (
        callableOperand !== null &&
        (op === ts.SyntaxKind.EqualsEqualsToken ||
          op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      ) {
        const value = emitExpression(ctx, callableOperand);
        if (!value) return null;
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken)
          recordSemantic(ctx, "coercion.strict-equality", bin);
        const check = `genes.js.TypeChecks.isFunction(${value})`;
        return op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken
          ? `!(${check})`
          : check;
      }

      const exactUndefinedOperand =
        ts.isIdentifier(bin.right) && bin.right.text === "undefined"
          ? { value: bin.left, undefinedNode: bin.right }
          : ts.isIdentifier(bin.left) && bin.left.text === "undefined"
            ? { value: bin.right, undefinedNode: bin.left }
            : null;
      if (
        exactUndefinedOperand
        && (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      ) {
        const value = emitExpression(ctx, exactUndefinedOperand.value);
        if (!value) return null;
        recordSemantic(ctx, "values.explicit-undefined", exactUndefinedOperand.undefinedNode);
        recordSemantic(ctx, "coercion.strict-equality", bin);
        const check = `genes.ts.Undefinable.isAbsent(${value})`;
        return op === ts.SyntaxKind.ExclamationEqualsEqualsToken ? `!(${check})` : check;
      }

      if (
        op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        op === ts.SyntaxKind.BarBarEqualsToken
      ) {
        return emitLogicalAssignment(ctx, bin);
      }

      // Destructuring assignment: `({a, b} = obj)` / `([a, b] = arr)`.
      if (op === ts.SyntaxKind.EqualsToken) {
        const rhs = emitExpression(ctx, bin.right);
        if (!rhs) return null;

        const pattern = ts.isParenthesizedExpression(bin.left) ? bin.left.expression : bin.left;
        if (ts.isObjectLiteralExpression(pattern) || ts.isArrayLiteralExpression(pattern)) {
          const tmp = nextTmp(ctx);
          const body: string[] = [];
          body.push(`  var ${tmp} = ${rhs};`);
          const assigns = emitDestructureAssignmentFromExpression({ ctx, pattern, valueExpr: tmp, indent: "  " });
          if (!assigns) return null;
          body.push(...assigns);
          body.push(`  return ${tmp};`);
          recordSemantic(ctx, "evaluation.compound-assignment", bin);
          return `(function() {\n${body.join("\n")}\n})()`;
        }
      }

      if (
        op === ts.SyntaxKind.PlusEqualsToken ||
        op === ts.SyntaxKind.MinusEqualsToken ||
        op === ts.SyntaxKind.AsteriskEqualsToken ||
        op === ts.SyntaxKind.SlashEqualsToken
      ) {
        const operatorText = ts.tokenToString(op)?.replace("=", "") ?? "+";
        return emitCompoundAssignment(ctx, bin, operatorText);
      }

      const left = emitExpression(ctx, bin.left);
      const right = emitExpression(ctx, bin.right);
      if (!left || !right) return null;
      if (op === ts.SyntaxKind.EqualsToken) {
        return `${left} = ${right}`;
      }
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        recordSemantic(ctx, "coercion.strict-equality", bin);
        return `genes.js.Equality.strict(${left}, ${right})`;
      }
      if (op === ts.SyntaxKind.EqualsEqualsToken) {
        return `(${left} == ${right})`;
      }
      if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        recordSemantic(ctx, "coercion.strict-equality", bin);
        return `!(genes.js.Equality.strict(${left}, ${right}))`;
      }
      if (op === ts.SyntaxKind.ExclamationEqualsToken) {
        return `(${left} != ${right})`;
      }
      if (
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.MinusToken ||
        op === ts.SyntaxKind.AsteriskToken ||
        op === ts.SyntaxKind.SlashToken
      ) {
        const opText = ts.tokenToString(op) ?? "+";
        return `(${left} ${opText} ${right})`;
      }
      if (
        op === ts.SyntaxKind.LessThanToken ||
        op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken ||
        op === ts.SyntaxKind.GreaterThanEqualsToken
      ) {
        const opText = ts.tokenToString(op) ?? "<";
        return `(${left} ${opText} ${right})`;
      }
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        recordSemantic(ctx, "coercion.truthiness", bin.left);
        return `(genes.js.Truthiness.isTruthy(${left}) ? ${right} : ${left})`;
      }
      if (op === ts.SyntaxKind.BarBarToken) {
        recordSemantic(ctx, "coercion.truthiness", bin.left);
        if (
          ts.isIdentifier(bin.right) &&
          bin.right.text === "undefined"
        ) {
          return `(genes.js.Truthiness.isTruthy(${left}) ? genes.ts.Undefinable.fromNullable(${left}) : ${right})`;
        }
        return `(genes.js.Truthiness.isTruthy(${left}) ? ${left} : ${right})`;
      }
      if (op === ts.SyntaxKind.QuestionQuestionToken) {
        return `(${left} ?? ${right})`;
      }
      return null;
    }
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const un = expr as ts.PrefixUnaryExpression;
      switch (un.operator) {
        case ts.SyntaxKind.ExclamationToken: {
          const condition = emitCondition(ctx, un.operand);
          return condition ? `!(${condition})` : null;
        }
        case ts.SyntaxKind.PlusToken: {
          const inner = emitExpression(ctx, un.operand);
          if (!inner) return null;
          recordSemantic(ctx, "coercion.unary-plus", un);
          return `genes.js.Coercion.toNumber(${inner})`;
        }
        case ts.SyntaxKind.MinusToken: {
          const inner = emitExpression(ctx, un.operand);
          if (!inner) return null;
          return `-(${inner})`;
        }
        case ts.SyntaxKind.PlusPlusToken: {
          const inner = emitExpression(ctx, un.operand);
          if (!inner) return null;
          return `++${inner}`;
        }
        case ts.SyntaxKind.MinusMinusToken: {
          const inner = emitExpression(ctx, un.operand);
          if (!inner) return null;
          return `--${inner}`;
        }
        default:
          return null;
      }
    }
    case ts.SyntaxKind.PostfixUnaryExpression: {
      const un = expr as ts.PostfixUnaryExpression;
      const inner = emitExpression(ctx, un.operand);
      if (!inner) return null;
      switch (un.operator) {
        case ts.SyntaxKind.PlusPlusToken:
          return `${inner}++`;
        case ts.SyntaxKind.MinusMinusToken:
          return `${inner}--`;
        default:
          return null;
      }
    }
    case ts.SyntaxKind.TypeOfExpression: {
      const t = expr as ts.TypeOfExpression;
      const inner = emitExpression(ctx, t.expression);
      if (!inner) return null;
      return `js.Syntax.typeof(${inner})`;
    }
    case ts.SyntaxKind.AwaitExpression: {
      const aw = expr as ts.AwaitExpression;
      const inner = emitExpression(ctx, aw.expression);
      if (!inner) return null;
      recordSemantic(ctx, "async.await", aw);
      // Use the genes-ts async/await sugar macro. This keeps output close to TS,
      // while remaining valid Haxe-for-JS (macro expands to native `await`).
      return `genes.js.Async.await(${inner})`;
    }
    case ts.SyntaxKind.ConditionalExpression: {
      const cond = expr as ts.ConditionalExpression;
      const conditionPlan = planCondition(ctx.checker, cond.condition);
      if (conditionPlan.coercion === "nullish-object") {
        const conditionValue = emitExpression(ctx, cond.condition);
        if (!conditionValue) return null;
        recordSemantic(ctx, "coercion.truthiness", cond.condition);
        const conditionTemp = nextTmp(ctx, "__ts2hx_condition");
        const whenTrue = withExpressionRewrite(
          ctx,
          cond.condition,
          `genes.ts.Present.require(${conditionTemp})`,
          () => emitExpression(ctx, cond.whenTrue)
        );
        const whenFalse = emitExpression(ctx, cond.whenFalse);
        if (!whenTrue || !whenFalse) return null;
        return emitIife([
          `  var ${conditionTemp} = ${conditionValue};`,
          `  return (${conditionTemp} != null ? ${whenTrue} : ${whenFalse});`
        ]);
      }
      const test = emitCondition(ctx, cond.condition);
      const whenTrue = emitExpression(ctx, cond.whenTrue);
      const whenFalse = emitExpression(ctx, cond.whenFalse);
      if (!test || !whenTrue || !whenFalse) return null;
      if (ts.isIdentifier(cond.whenFalse) && cond.whenFalse.text === "undefined")
        return `(${test} ? genes.ts.Undefinable.fromNullable(${whenTrue}) : ${whenFalse})`;
      if (ts.isIdentifier(cond.whenTrue) && cond.whenTrue.text === "undefined")
        return `(${test} ? ${whenTrue} : genes.ts.Undefinable.fromNullable(${whenFalse}))`;
      return `(${test} ? ${whenTrue} : ${whenFalse})`;
    }
    case ts.SyntaxKind.CallExpression: {
      const call = expr as ts.CallExpression;

      if (ts.isCallChain(call)) {
        const args = call.arguments.map((a) => emitExpression(ctx, a));
        if (args.some((a) => a == null)) return null;
        const argsArray = `cast [${args.join(", ")}]`;

        const callHasQuestionDot =
          "questionDotToken" in call && (call as unknown as { questionDotToken?: unknown }).questionDotToken != null;

        const calleeNode = call.expression;

        if (ts.isPropertyAccessExpression(calleeNode)) {
          const recv = emitExpression(ctx, calleeNode.expression);
          if (!recv) return null;

          const recvTmp = nextTmp(ctx, "__ts2hx_recv");
          const fnTmp = nextTmp(ctx, "__ts2hx_fn");

          const receiverOptional = ts.isPropertyAccessChain(calleeNode);

          const body: string[] = [];
          body.push(`  var ${recvTmp} = ${recv};`);
          if (receiverOptional) body.push(`  if (${recvTmp} == null) return null;`);
          body.push(`  var ${fnTmp} = ${recvTmp}.${calleeNode.name.text};`);
          if (callHasQuestionDot) body.push(`  if (${fnTmp} == null) return null;`);
          body.push(`  return Reflect.callMethod(${recvTmp}, ${fnTmp}, ${argsArray});`);
          return emitIife(body);
        }

        if (ts.isElementAccessExpression(calleeNode)) {
          const recv = emitExpression(ctx, calleeNode.expression);
          const idxExpr = calleeNode.argumentExpression ? emitExpression(ctx, calleeNode.argumentExpression) : null;
          if (!recv || !idxExpr) return null;

          const recvTmp = nextTmp(ctx, "__ts2hx_recv");
          const idxTmp = nextTmp(ctx, "__ts2hx_idx");
          const fnTmp = nextTmp(ctx, "__ts2hx_fn");

          const receiverOptional = ts.isElementAccessChain(calleeNode);

          const body: string[] = [];
          body.push(`  var ${recvTmp} = ${recv};`);
          if (receiverOptional) body.push(`  if (${recvTmp} == null) return null;`);
          body.push(`  var ${idxTmp} = ${idxExpr};`);
          body.push(`  var ${fnTmp} = ${recvTmp}[${idxTmp}];`);
          if (callHasQuestionDot) body.push(`  if (${fnTmp} == null) return null;`);
          body.push(`  return Reflect.callMethod(${recvTmp}, ${fnTmp}, ${argsArray});`);
          return emitIife(body);
        }

        const callee = emitExpression(ctx, calleeNode);
        if (!callee) return null;
        const fnTmp = nextTmp(ctx, "__ts2hx_fn");
        return emitIife([
          `  var ${fnTmp} = ${callee};`,
          `  if (${fnTmp} == null) return null;`,
          `  return ${fnTmp}(${args.join(", ")});`
        ]);
      }

      // Best-effort builtin mappings for Haxe-for-JS (v0).
      if (ts.isPropertyAccessExpression(call.expression)) {
        const access = call.expression;
        const left = emitExpression(ctx, access.expression);
        if (!left) return null;

        // Haxe's Array callbacks expose only the value, while JavaScript also
        // supplies the index. Route indexed callbacks through a typed generic
        // helper so inferred callback parameters remain compileable Haxe.
        if (
          (access.name.text === "map" || access.name.text === "forEach") &&
          call.arguments.length === 1 &&
          isArrayExpression(ctx, access.expression)
        ) {
          const callbackNode = call.arguments[0];
          if (
            (ts.isArrowFunction(callbackNode) || ts.isFunctionExpression(callbackNode)) &&
            callbackNode.parameters.length >= 2
          ) {
            const callback = emitExpression(ctx, callbackNode);
            if (!callback) return null;
            const helper = access.name.text === "map" ? "mapWithIndex" : "forEachWithIndex";
            return `genes.js.ArrayCallbacks.${helper}(${left}, ${callback})`;
          }
        }

        // `regex.test(value)` -> `regex.match(value)`.
        if (access.name.text === "test" && isRegExpExpression(ctx, access.expression)) {
          if (call.arguments.length !== 1) return null;
          const value = emitExpression(ctx, call.arguments[0]);
          if (!value) return null;
          return `(${left}).match(${value})`;
        }

        // `value.replace(regex, replacement)` -> `regex.replace(value, replacement)`.
        // EReg's JS implementation calls native String#replace, including global
        // flags and replacement-string capture semantics.
        if (
          access.name.text === "replace" &&
          call.arguments.length === 2 &&
          isRegExpExpression(ctx, call.arguments[0] as ts.Expression)
        ) {
          const regex = emitExpression(ctx, call.arguments[0] as ts.Expression);
          const replacement = emitExpression(ctx, call.arguments[1] as ts.Expression);
          if (!regex || !replacement) return null;
          // Parentheses are required when the receiver is a regex literal with
          // flags: without them Haxe can parse `.replace` as part of the literal.
          return `(${regex}).replace(${left}, ${replacement})`;
        }

        // `JSON.stringify(x)` -> `haxe.Json.stringify(x)`
        if (access.name.text === "stringify" && ts.isIdentifier(access.expression) && access.expression.text === "JSON") {
          if (call.arguments.length !== 1) return null;
          const arg0 = emitExpression(ctx, call.arguments[0]);
          if (!arg0) return null;
          return `haxe.Json.stringify(${arg0})`;
        }

        // `str.trim()` -> `StringTools.trim(str)`
        if (access.name.text === "trim" && call.arguments.length === 0) {
          return `StringTools.trim(${left})`;
        }

        // `arr.slice()` -> `arr.slice(0)` (Haxe requires at least the `pos` arg).
        if (access.name.text === "slice" && call.arguments.length === 0) {
          return `${left}.slice(0)`;
        }

        // `console.log(x)` -> `trace(x)`
        if (access.name.text === "log" && ts.isIdentifier(access.expression) && access.expression.text === "console") {
          if (call.arguments.length !== 1) return null;
          const arg0 = emitExpression(ctx, call.arguments[0]);
          if (!arg0) return null;
          return `trace(${arg0})`;
        }
      }

      const callee = emitExpression(ctx, call.expression);
      if (!callee) return null;
      const args = call.arguments.map((a) => emitExpression(ctx, a));
      if (args.some((a) => a == null)) return null;
      return `${callee}(${args.join(", ")})`;
    }
    default:
      return null;
  }
}

function emitStatements(ctx: EmitContext, statements: readonly ts.Statement[], indent: string): string | null {
  const out: string[] = [];

  for (const stmt of statements) {
    const emitted = emitStatement(ctx, stmt, indent);
    if (emitted == null) return null;
    if (emitted.length > 0) out.push(emitted);
  }

  return out.join("\n");
}

/**
 * Lowers JavaScript truthiness at control-flow boundaries.
 *
 * TypeScript permits strings, arrays, objects, and nullable values in boolean
 * positions, while Haxe requires `Bool`. Keeping the conversion in the typed
 * genes runtime helper preserves JavaScript semantics without scattering raw
 * syntax through generated Haxe modules.
 */
function emitCondition(ctx: EmitContext, expr: ts.Expression): string | null {
  const plan = planCondition(ctx.checker, expr);
  const emitted = emitExpression(ctx, plan.expression);
  if (!emitted) return null;
  if (plan.coercion === "boolean") return emitted;
  recordSemantic(ctx, "coercion.truthiness", expr);
  if (plan.coercion === "nullish-object") return `(${emitted} != null)`;
  return `genes.js.Truthiness.isTruthy(${emitted})`;
}

function emitDirectTryCatch(ctx: EmitContext, stmt: ts.TryStatement, indent: string): string | null {
  if (!stmt.catchClause) return null;
  const tryBlock = emitStatement(ctx, stmt.tryBlock, indent);
  if (tryBlock == null) return null;
  const catchName =
    stmt.catchClause.variableDeclaration && ts.isIdentifier(stmt.catchClause.variableDeclaration.name)
      ? stmt.catchClause.variableDeclaration.name.text
      : "e";
  const catchBody = emitStatement(ctx, stmt.catchClause.block, indent);
  if (catchBody == null) return null;
  const tryBlockNoIndent = tryBlock.startsWith(indent) ? tryBlock.slice(indent.length) : tryBlock;
  const catchBodyNoIndent = catchBody.startsWith(indent) ? catchBody.slice(indent.length) : catchBody;
  return `${indent}try ${tryBlockNoIndent} catch (${catchName}: Any) ${catchBodyNoIndent}`;
}

/**
 * Emits a continue for one real loop from the immutable semantic plan.
 *
 * A lowered switch uses `do ... while (false)` so source `break` has a concrete
 * target. A source `continue` must not target that synthetic loop. While switch
 * clauses are rendered, this function instead records the transfer and breaks
 * the synthetic loop. Once outside it, the same function either propagates
 * through an enclosing synthetic switch or performs the real loop continue,
 * including a lowered for-loop increment exactly once.
 */
function emitContinueToTarget(ctx: EmitContext, targetId: CompletionTargetId,
    indent: string): string {
  const state = requireFunctionEmitState(ctx);
  const loopTarget = completionTargetForId(state, targetId);
  if (loopTarget.kind !== "loop" || !state.activeTargets.includes(targetId)) {
    throw new Error(
      `Continue target ${targetId} is not an active loop in ${ctx.sourceFilePath}.`
    );
  }
  const switchTransfer = state.switchContinueTransfers
    .slice()
    .reverse()
    .find((transfer) => transfer.targetId === loopTarget.id);
  if (switchTransfer)
    return `${indent}${switchTransfer.flag} = true;\n${indent}break;`;

  const continueStep = state.continueSteps.get(loopTarget.id) ?? null;
  return continueStep
    ? `${indent}${continueStep};\n${indent}continue;`
    : `${indent}continue;`;
}

function emitContinue(ctx: EmitContext, indent: string): string {
  const state = requireFunctionEmitState(ctx);
  const loopTarget = currentLoopTarget(state);
  if (!loopTarget)
    throw new Error(`Continue has no active loop target in ${ctx.sourceFilePath}.`);
  return emitContinueToTarget(ctx, loopTarget.id, indent);
}

function emitBreakToTarget(ctx: EmitContext, targetId: CompletionTargetId,
    indent: string): string {
  const state = requireFunctionEmitState(ctx);
  const target = completionTargetForId(state, targetId);
  if ((target.kind !== "loop" && target.kind !== "switch")
    || !state.activeTargets.includes(targetId)) {
    throw new Error(
      `Break target ${targetId} is not active in ${ctx.sourceFilePath}.`
    );
  }
  // Haxe switches do not own `break`; inside the generated enum/target switch,
  // this still exits the nearest real loop. A source switch is deliberately
  // represented by its surrounding synthetic `do/while(false)` target.
  return `${indent}break;`;
}

type CompletionDispatchAction = "dispatch" | "propagate";

function completionDispatchAction(state: FunctionEmitState,
    transfer: CompletionTransferPlan): CompletionDispatchAction {
  if (!transfer.targetId || !transfer.targetPath)
    throw new Error(`Completion transfer ${transfer.id} has no resolved target.`);
  const target = completionTargetForId(state, transfer.targetId);
  if (!callbackPathsEqual(target.ownerPath, transfer.targetPath)) {
    throw new Error(
      `Completion transfer ${transfer.id} disagrees with target ${target.id} ownership.`
    );
  }
  if (callbackPathsEqual(target.ownerPath, state.callbackPath)) return "dispatch";
  if (callbackPathIsPrefix(target.ownerPath, state.callbackPath)) return "propagate";
  throw new Error(
    `Completion transfer ${transfer.id} cannot move from `
    + `${JSON.stringify(state.callbackPath)} to ${JSON.stringify(target.ownerPath)}.`
  );
}

function completionTargetsByKind(state: FunctionEmitState,
    transfers: readonly CompletionTransferPlan[],
    kind: "break" | "continue"): Array<{
      targetId: CompletionTargetId;
      targetNumber: number;
      action: CompletionDispatchAction;
    }> {
  const targets = new Map<CompletionTargetId, CompletionDispatchAction>();
  for (const transfer of transfers) {
    if (transfer.kind !== kind || !transfer.targetId) continue;
    const action = completionDispatchAction(state, transfer);
    const prior = targets.get(transfer.targetId);
    if (prior && prior !== action)
      throw new Error(`Completion target ${transfer.targetId} has inconsistent ownership.`);
    targets.set(transfer.targetId, action);
  }
  return Array.from(targets, ([targetId, action]) => ({
    targetId,
    targetNumber: completionTargetNumber(state, targetId),
    action
  })).sort((left, right) => left.targetNumber - right.targetNumber);
}

function emitTargetCompletionCase(ctx: EmitContext,
    transfers: readonly CompletionTransferPlan[],
    kind: "break" | "continue", completionName: string,
    carrier: EmittedCompletionCarrier, indent: string): string[] {
  const state = requireFunctionEmitState(ctx);
  const targets = completionTargetsByKind(state, transfers, kind);
  if (targets.length === 0) return [];
  const targetLocal = claimFunctionLocal(ctx, `__ts2hx_${kind}_target`);
  const constructor = kind === "break" ? "BreakTo" : "ContinueTo";
  const lines = [
    `${indent}  case ${carrier.typeName}.${constructor}(${targetLocal}):`,
    `${indent}    switch (${targetLocal}) {`
  ];
  for (const target of targets) {
    lines.push(`${indent}      case ${target.targetNumber}:`);
    if (target.action === "propagate") {
      lines.push(`${indent}        return ${completionName};`);
      continue;
    }
    lines.push(kind === "break"
      ? emitBreakToTarget(ctx, target.targetId, indent + "        ")
      : emitContinueToTarget(ctx, target.targetId, indent + "        "));
  }
  lines.push(
    `${indent}      default:`,
    `${indent}        throw new haxe.Exception("ts2hx received an unplanned ${kind} target.");`,
    `${indent}    }`
  );
  return lines;
}

/**
 * Stops or propagates an abrupt record at the first callback path that owns it.
 *
 * Why: an inner `continue` may target a loop inside an outer protected
 * callback, while another syntactically similar continue targets a loop around
 * both finalizers. Propagating both would skip valid outer-body statements;
 * dispatching both would skip an outer finalizer.
 *
 * What: the immutable target path decides the action. A target owned at the
 * current path becomes a real return/break/continue. A target owned by a strict
 * prefix is returned unchanged so the next helper can run its finalizer.
 *
 * How: target IDs become deterministic function-local integers only at this
 * final spelling boundary. The generated switch contains exactly the target
 * cases proven reachable from this region and rejects every impossible tag.
 */
function emitCompletionDispatch(ctx: EmitContext,
    region: CompletionFinallyPlan, completionName: string,
    carrier: EmittedCompletionCarrier, indent: string): string {
  const state = requireFunctionEmitState(ctx);
  if (!callbackPathsEqual(state.callbackPath, region.parentPath)) {
    throw new Error(
      `Finally region ${region.id} returned at the wrong callback path.`
    );
  }

  const transfers = completionTransfersForRegion(state.plan, region);
  const actions = transfers.map((transfer) =>
    completionDispatchAction(state, transfer));
  if (actions.length > 0 && actions.every((action) => action === "propagate"))
    return `${indent}if (${completionName} != null) return ${completionName};`;

  const lines = [`${indent}switch (${completionName}) {`];
  const valueReturns = transfers.filter((transfer) =>
    transfer.kind === "return-value");
  if (valueReturns.length > 0) {
    const valueTransfer = valueReturns[0];
    if (!valueTransfer)
      throw new Error(`Finally region ${region.id} lost its value return.`);
    if (carrier.kind !== "value")
      throw new Error(`Value return reached ${carrier.kind} carrier dispatch.`);
    const returnValue = claimFunctionLocal(ctx, "value");
    lines.push(
      `${indent}  case ${carrier.typeName}.ReturnValue(${returnValue}):`,
      completionDispatchAction(state, valueTransfer)
        === "propagate"
        ? `${indent}    return ${completionName};`
        : `${indent}    return ${returnValue};`
    );
  }
  const voidReturns = transfers.filter((transfer) =>
    transfer.kind === "return-void");
  if (voidReturns.length > 0) {
    const voidTransfer = voidReturns[0];
    if (!voidTransfer)
      throw new Error(`Finally region ${region.id} lost its void return.`);
    if (carrier.kind !== "void")
      throw new Error(`Void return reached ${carrier.kind} carrier dispatch.`);
    lines.push(
      `${indent}  case ${carrier.typeName}.ReturnVoid:`,
      completionDispatchAction(state, voidTransfer)
        === "propagate"
        ? `${indent}    return ${completionName};`
        : `${indent}    return;`
    );
  }
  lines.push(...emitTargetCompletionCase(
    ctx, transfers, "break", completionName, carrier, indent
  ));
  lines.push(...emitTargetCompletionCase(
    ctx, transfers, "continue", completionName, carrier, indent
  ));
  // A `Void` carrier cannot destructure the statically impossible
  // `ReturnValue(Void)` constructor. The default covers every unreachable
  // constructor without weakening the enum or fabricating a payload.
  lines.push(
    `${indent}  case null:`,
    `${indent}    {}`,
    `${indent}  default:`,
    `${indent}    throw new haxe.Exception("ts2hx received an unplanned completion variant.");`,
    `${indent}}`
  );
  return lines.join("\n");
}

/**
 * Emits typed completion-aware `try/finally` callbacks.
 *
 * Why: a source return, break, or continue cannot directly leave the synthetic
 * callbacks used to model `finally`; it would target the callback rather than
 * the original function, loop, or switch.
 *
 * What: protected and finalizer callbacks return either `null` (normal) or one
 * private abrupt enum value. `FinallyCompletion.run` applies JavaScript's
 * precedence rule exactly once, after which the result is dispatched at the
 * first owning target path or propagated through an enclosing callback.
 *
 * How: callback paths come from the immutable semantic plan. Return
 * expressions are constructor arguments, so they evaluate once before the
 * finalizer. Host throws remain throws; the runtime helper preserves or
 * replaces them without putting a weak thrown value in the generated enum.
 */
function emitCompletionTry(ctx: EmitContext, stmt: ts.TryStatement,
    region: CompletionFinallyPlan, carrier: EmittedCompletionCarrier,
    indent: string): string | null {
  if (!stmt.finallyBlock) return null;
  const completionName = nextCompletionLocal(ctx);
  const callbackType = `Null<${carrier.carrierType}>`;
  const bodyIndent = indent + "      ";

  const protectedBody = withCompletionCallback(ctx, region.protectedCallback, () =>
    stmt.catchClause
      ? emitDirectTryCatch(ctx, stmt, bodyIndent)
      : emitStatements(ctx, stmt.tryBlock.statements, bodyIndent)
  );
  if (protectedBody == null) return null;
  const finalizerBody = withCompletionCallback(ctx, region.finalizerCallback, () =>
    emitStatements(ctx, stmt.finallyBlock?.statements ?? [], bodyIndent)
  );
  if (finalizerBody == null) return null;

  const lines = [
    `${indent}final ${completionName}:${callbackType} =`,
    `${indent}  genes.js.FinallyCompletion.run(`,
    `${indent}    function():${callbackType} {`,
    protectedBody,
    `${bodyIndent}return null;`,
    `${indent}    },`,
    `${indent}    function():${callbackType} {`,
    finalizerBody,
    `${bodyIndent}return null;`,
    `${indent}    }`,
    `${indent}  );`,
    emitCompletionDispatch(ctx, region, completionName, carrier, indent)
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

function emitStatement(ctx: EmitContext, stmt: ts.Statement, indent: string): string | null {
  if (ts.isLabeledStatement(stmt)) {
    // An unused statement label has no runtime effect. Any labeled break or
    // continue remains visible in the nested statement and therefore either
    // receives its feature-specific strict diagnostic or fails the containing
    // lowering; the label is never silently treated as an unlabelled transfer.
    return emitStatement(ctx, stmt.statement, indent);
  }

  if (ts.isBlock(stmt)) {
    const inner = emitStatements(ctx, stmt.statements, indent + "  ");
    if (inner == null) return null;
    if (inner.length === 0) return `${indent}{}`;
    return `${indent}{\n${inner}\n${indent}}`;
  }

  if (ts.isReturnStatement(stmt)) {
    const transfer = completionTransferForNode(ctx, stmt);
    if (transfer.disposition === "encode") {
      const state = requireFunctionEmitState(ctx);
      if (!callbackPathsEqual(state.callbackPath, transfer.sourcePath)) {
        throw new Error(
          `Transfer ${transfer.id} expected callback path `
          + `${JSON.stringify(transfer.sourcePath)}, got `
          + `${JSON.stringify(state.callbackPath)}.`
        );
      }
      const carrier = completionCarrier(ctx, state);
      if (!carrier) {
        throw new Error(
          `Transfer ${transfer.id} reached emission without a strong completion carrier.`
        );
      }
      if (!stmt.expression)
        return `${indent}return ${carrier.typeName}.ReturnVoid;`;
      const expr = emitExpression(ctx, stmt.expression);
      if (!expr) return null;
      // Materialize the source value once at its declared return type before
      // constructing the generic record. A direct `ReturnValue(null)` makes
      // Haxe infer the constructor payload as bottom even when the surrounding
      // callback expects `Null<String>`; genes-ts would then need an unsafe
      // generic cast. The typed local preserves evaluation order and gives
      // both Genes profiles the same strong constructor instantiation.
      const returnValue = nextFunctionLocal(ctx, "__ts2hx_return_value");
      return [
        `${indent}final ${returnValue}:${carrier.payloadType} = ${expr};`,
        `${indent}return ${carrier.typeName}.ReturnValue(${returnValue});`
      ].join("\n");
    }
    if (transfer.disposition === "unsupported") return null;
    if (!stmt.expression) return `${indent}return;`;
    const expr = emitExpression(ctx, stmt.expression);
    if (!expr) return null;
    return `${indent}return ${expr};`;
  }

  if (ts.isExpressionStatement(stmt)) {
    const expr = emitExpression(ctx, stmt.expression);
    if (!expr) return null;
    return `${indent}${expr};`;
  }

  if (ts.isVariableStatement(stmt)) {
    const keyword = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "final" : "var";
    const decls: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
        const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";

        const plan = planLocalDeclaration(decl);
        if (plan.kind === "initialized") {
          const init = emitExpression(ctx, plan.initializer);
          if (!init) return null;
          decls.push(`${indent}${keyword} ${name}${typeSuffix} = ${init};`);
          continue;
        }

        if (plan.kind === "unsupported-inferred-uninitialized") {
          return rejectSemantic(
            ctx,
            "locals.uninitialized",
            decl,
            "An uninitialized local needs an explicit source type; ts2hx will not invent a Dynamic/default value.",
            "declaration"
          );
        }

        recordSemantic(ctx, "locals.uninitialized", decl);
        // Haxe and JavaScript both support a declaration without an initializer.
        // If the declared source type explicitly admits undefined, initialize
        // with the real host value so Haxe's own definite-assignment check does
        // not force a fabricated number/string/null. Otherwise leave the local
        // uninitialized and retain the source checker's assignment proof.
        const emittedType = emitType(plan.explicitType);
        const initializer = emittedType.startsWith("genes.ts.Undefinable<")
          ? " = genes.ts.Undefinable.absent()"
          : "";
        decls.push(`${indent}${keyword} ${name}: ${emittedType}${initializer};`);
        continue;
      }

      if (!decl.initializer) return null;
      const init = emitExpression(ctx, decl.initializer);
      if (!init) return null;
      const tmp = nextTmp(ctx);
      const tmpTypeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
      decls.push(`${indent}${keyword} ${tmp}${tmpTypeSuffix} = ${init};`);
      const destructured = emitDestructureFromBindingName({
        ctx,
        mode: "declare",
        declareKeyword: keyword,
        name: decl.name,
        valueExpr: tmp,
        indent
      });
      if (!destructured) return null;
      decls.push(...destructured);
    }
    return decls.join("\n");
  }

  if (ts.isIfStatement(stmt)) {
    const cond = emitCondition(ctx, stmt.expression);
    if (!cond) return null;
    const thenPart = emitStatement(ctx, stmt.thenStatement, ts.isBlock(stmt.thenStatement) ? indent : indent + "  ");
    if (thenPart == null) return null;
    const thenBlock = ts.isBlock(stmt.thenStatement) ? thenPart : `${indent}{\n${thenPart}\n${indent}}`;

    if (!stmt.elseStatement) return `${indent}if (${cond}) ${thenBlock}`;

    const elsePart = emitStatement(ctx, stmt.elseStatement, ts.isBlock(stmt.elseStatement) ? indent : indent + "  ");
    if (elsePart == null) return null;
    const elseBlock = ts.isBlock(stmt.elseStatement) ? elsePart : `${indent}{\n${elsePart}\n${indent}}`;
    return `${indent}if (${cond}) ${thenBlock} else ${elseBlock}`;
  }

  if (ts.isBreakStatement(stmt)) {
    const transfer = completionTransferForNode(ctx, stmt);
    if (transfer.disposition === "unsupported" || !transfer.targetId) return null;
    if (transfer.disposition === "encode") {
      const state = requireFunctionEmitState(ctx);
      if (!callbackPathsEqual(state.callbackPath, transfer.sourcePath)) {
        throw new Error(
          `Transfer ${transfer.id} expected callback path `
          + `${JSON.stringify(transfer.sourcePath)}, got `
          + `${JSON.stringify(state.callbackPath)}.`
        );
      }
      const carrier = completionCarrier(ctx, state);
      if (!carrier)
        throw new Error(`Transfer ${transfer.id} has no strong completion carrier.`);
      return `${indent}return ${carrier.typeName}.BreakTo(`
        + `${completionTargetNumber(state, transfer.targetId)});`;
    }
    return emitBreakToTarget(ctx, transfer.targetId, indent);
  }

  if (ts.isContinueStatement(stmt)) {
    const transfer = completionTransferForNode(ctx, stmt);
    if (transfer.disposition === "unsupported" || !transfer.targetId) return null;
    if (transfer.disposition === "encode") {
      const state = requireFunctionEmitState(ctx);
      if (!callbackPathsEqual(state.callbackPath, transfer.sourcePath)) {
        throw new Error(
          `Transfer ${transfer.id} expected callback path `
          + `${JSON.stringify(transfer.sourcePath)}, got `
          + `${JSON.stringify(state.callbackPath)}.`
        );
      }
      const carrier = completionCarrier(ctx, state);
      if (!carrier)
        throw new Error(`Transfer ${transfer.id} has no strong completion carrier.`);
      return `${indent}return ${carrier.typeName}.ContinueTo(`
        + `${completionTargetNumber(state, transfer.targetId)});`;
    }
    return emitContinueToTarget(ctx, transfer.targetId, indent);
  }

  if (ts.isThrowStatement(stmt)) {
    const expr = stmt.expression ? emitExpression(ctx, stmt.expression) : null;
    if (!expr) return null;
    return `${indent}throw ${expr};`;
  }

  if (ts.isTryStatement(stmt)) {
    if (!stmt.finallyBlock) {
      recordSemantic(ctx, "exceptions.try-catch", stmt);
      return emitDirectTryCatch(ctx, stmt, indent);
    }

    const state = requireFunctionEmitState(ctx);
    const region = completionFinallyForNode(ctx, stmt);
    if (region.strategy === "unsupported-outer-transfer"
      || (region.strategy === "finally-helper-completion"
        && !isSupportedCompletionRegion(state.plan, region))) {
      return rejectSemantic(
        ctx,
        "exceptions.finally-outer-transfer",
        stmt,
        "This return, break, or continue crosses a finally boundary outside the typed synchronous completion subset.",
        "control-flow"
      );
    }

    if (region.strategy === "finally-helper-completion") {
      const carrier = completionCarrier(ctx, state);
      if (!carrier) {
        return rejectSemantic(
          ctx,
          "exceptions.finally-outer-transfer",
          stmt,
          "The explicit return type cannot be represented by a strong Haxe completion carrier.",
          "control-flow"
        );
      }
      recordSemantic(ctx, "exceptions.finally", stmt);
      recordSemantic(ctx, "exceptions.finally-outer-transfer", stmt);
      if (stmt.catchClause)
        recordSemantic(ctx, "exceptions.try-catch", stmt.catchClause);
      return emitCompletionTry(ctx, stmt, region, carrier, indent);
    }

    recordSemantic(ctx, "exceptions.finally", stmt);
    if (stmt.catchClause) recordSemantic(ctx, "exceptions.try-catch", stmt.catchClause);
    const bodyIndent = indent + "    ";
    // Even a callback-local helper owns a real planner path. Entering it has
    // no textual effect, but it lets an inner completion stop at a loop or
    // switch declared inside this callback instead of propagating past valid
    // outer-body statements.
    const protectedBody = withCompletionCallback(
      ctx,
      region.protectedCallback,
      () => stmt.catchClause
        ? emitDirectTryCatch(ctx, stmt, bodyIndent)
        : emitStatements(ctx, stmt.tryBlock.statements, bodyIndent)
    );
    if (protectedBody == null || !stmt.finallyBlock) return null;
    const finalizerBody = withCompletionCallback(
      ctx,
      region.finalizerCallback,
      () => emitStatements(ctx, stmt.finallyBlock?.statements ?? [], bodyIndent)
    );
    if (finalizerBody == null) return null;
    return [
      `${indent}genes.js.TryFinally.run(`,
      `${indent}  function() {`,
      protectedBody,
      `${indent}  },`,
      `${indent}  function() {`,
      finalizerBody,
      `${indent}  }`,
      `${indent});`
    ].filter((line) => line.length > 0).join("\n");
  }

  if (ts.isWhileStatement(stmt)) {
    const cond = emitCondition(ctx, stmt.expression);
    if (!cond) return null;
    const target = targetForNode(ctx, stmt, "loop");
    const bodyPart = withActiveTarget(ctx, target, null, () =>
      emitStatement(ctx, stmt.statement,
        ts.isBlock(stmt.statement) ? indent : indent + "  ")
    );
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}while (${cond}) ${bodyBlock}`;
  }

  if (ts.isDoStatement(stmt)) {
    const cond = emitCondition(ctx, stmt.expression);
    if (!cond) return null;
    const target = targetForNode(ctx, stmt, "loop");
    const bodyPart = withActiveTarget(ctx, target, null, () =>
      emitStatement(ctx, stmt.statement,
        ts.isBlock(stmt.statement) ? indent : indent + "  ")
    );
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}do ${bodyBlock} while (${cond});`;
  }

  if (ts.isSwitchStatement(stmt)) {
    const plan = planSwitch(stmt);
    const functionState = requireFunctionEmitState(ctx);
    const switchTarget = targetForNode(ctx, stmt, "switch");
    const enclosingLoopTarget = currentLoopTarget(functionState);
    if (plan.continuePlan.kind === "unsupported-labeled") {
      return rejectSemantic(
        ctx,
        "switch.continue",
        plan.continuePlan.statement,
        "Labeled continue from inside a switch is not represented by the strict subset.",
        "control-flow"
      );
    }
    if (plan.continuePlan.kind === "outer-loop" && !enclosingLoopTarget) {
      return rejectSemantic(
        ctx,
        "switch.continue",
        plan.continuePlan.statement,
        "Continue from inside a switch has no enclosing loop target.",
        "control-flow"
      );
    }

    const discriminant = emitExpression(ctx, plan.discriminant);
    if (!discriminant) return null;
    recordSemantic(ctx, "switch.fallthrough", stmt);
    recordSemantic(ctx, "coercion.strict-equality", stmt);
    const valueTemp = nextTmp(ctx, "__ts2hx_switch_value");
    const stateTemp = nextTmp(ctx, "__ts2hx_switch_state");
    const continueFlag = plan.continuePlan.kind === "outer-loop"
      ? nextTmp(ctx, "__ts2hx_switch_continue")
      : null;
    const lines: string[] = [
      `${indent}{`,
      `${indent}  var ${valueTemp} = ${discriminant};`,
      `${indent}  var ${stateTemp} = -1;`
    ];
    if (continueFlag && plan.continuePlan.kind === "outer-loop") {
      recordSemantic(ctx, "switch.continue", plan.continuePlan.statement);
      lines.push(`${indent}  var ${continueFlag} = false;`);
    }

    // JavaScript evaluates case expressions in source order and stops after
    // the first match. Default is selected only after every case misses.
    for (const clause of plan.clauses) {
      if (!clause.label) continue;
      const label = emitExpression(ctx, clause.label);
      if (!label) return null;
      lines.push(
        `${indent}  if (${stateTemp} == -1 && genes.js.Equality.strict(${valueTemp}, ${label})) ${stateTemp} = ${clause.index};`
      );
    }
    if (plan.defaultIndex !== null)
      lines.push(`${indent}  if (${stateTemp} == -1) ${stateTemp} = ${plan.defaultIndex};`);

    lines.push(`${indent}  if (${stateTemp} >= 0) do {`);
    const clausesEmitted = withActiveTarget(ctx, switchTarget, null, () => {
      if (continueFlag && enclosingLoopTarget) {
        functionState.switchContinueTransfers.push({
          flag: continueFlag,
          targetId: enclosingLoopTarget.id
        });
      }
      try {
        for (const clause of plan.clauses) {
          const body = emitStatements(ctx, clause.statements, indent + "      ");
          if (body == null) return false;
          lines.push(`${indent}    if (${stateTemp} <= ${clause.index}) {`);
          if (body.length > 0) lines.push(body);
          lines.push(`${indent}    }`);
        }
        return true;
      } finally {
        if (continueFlag && enclosingLoopTarget) {
          const removed = functionState.switchContinueTransfers.pop();
          if (removed?.flag !== continueFlag
            || removed.targetId !== enclosingLoopTarget.id) {
            throw new Error(
              `Switch continue stack corrupted while leaving ${switchTarget.id}.`
            );
          }
        }
      }
    });
    if (!clausesEmitted) return null;
    lines.push(`${indent}  } while (false);`);
    if (continueFlag) {
      lines.push(`${indent}  if (${continueFlag}) {`);
      lines.push(emitContinue(ctx, indent + "    "));
      lines.push(`${indent}  }`);
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
  }

  if (ts.isForStatement(stmt)) {
    const plan = planForLoop(stmt);
    if (!plan) return null;
    recordSemantic(ctx, "loops.for-continue-step", stmt);

    const initLines: string[] = [];
    if (ts.isVariableDeclarationList(plan.initializer)) {
      for (const decl of plan.initializer.declarations) {
        if (!ts.isIdentifier(decl.name)) return null;
        const init = decl.initializer ? emitExpression(ctx, decl.initializer) : null;
        if (!init) return null;
        initLines.push(`${indent}  var ${decl.name.text} = ${init};`);
      }
    } else {
      const init = emitExpression(ctx, plan.initializer);
      if (!init) return null;
      initLines.push(`${indent}  ${init};`);
    }

    const cond = emitCondition(ctx, plan.condition);
    const inc = emitExpression(ctx, plan.continueStep);
    if (!cond || !inc) return null;

    const target = targetForNode(ctx, stmt, "loop");
    const bodyInner = withActiveTarget(ctx, target, inc, () =>
      ts.isBlock(stmt.statement)
        ? emitStatements(ctx, stmt.statement.statements, indent + "    ")
        : emitStatement(ctx, stmt.statement, indent + "    ")
    );
    if (bodyInner == null) return null;

    const whileBody =
      bodyInner.length === 0
        ? `${indent}  while (${cond}) {\n${indent}    ${inc};\n${indent}  }`
        : `${indent}  while (${cond}) {\n${bodyInner}\n${indent}    ${inc};\n${indent}  }`;

    return `${indent}{\n${initLines.join("\n")}\n${whileBody}\n${indent}}`;
  }

  if (ts.isForOfStatement(stmt)) {
    if (!ts.isVariableDeclarationList(stmt.initializer)) return null;
    const decl = stmt.initializer.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name)) return null;
    const name = decl.name.text;

    const iter = emitExpression(ctx, stmt.expression);
    if (!iter) return null;

    const target = targetForNode(ctx, stmt, "loop");
    const bodyPart = withActiveTarget(ctx, target, null, () =>
      emitStatement(ctx, stmt.statement,
        ts.isBlock(stmt.statement) ? indent : indent + "  ")
    );
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}for (${name} in ${iter}) ${bodyBlock}`;
  }

  return null;
}

function emitFunctionLike(opts: {
  node: ts.FunctionLikeDeclaration;
  name: string;
  parameters: readonly ts.ParameterDeclaration[];
  returnType: ts.TypeNode | undefined;
  body: ts.Block | undefined;
  modifierPrefix: string;
  omitReturnType?: boolean;
  ctx: EmitContext;
}): string | null {
  return withFunctionEmitState(opts.ctx, opts.node, () => {
    if (!validateCompletionFunction(opts.ctx)) return null;
    const emittedParameters = emitParameters(opts.ctx, opts.parameters, "  ");
    if (!emittedParameters) return null;
    const params = emittedParameters.parameters;
    const prelude = emittedParameters.prelude;

    const returnType = emitType(opts.returnType);
    const returnTypeSuffix = opts.omitReturnType ? "" : `: ${returnType}`;

    if (!opts.body) return null;
    const emittedBody = withIdentifierRewrites(
      opts.ctx,
      emittedParameters.bodyRewrites,
      () => emitStatements(opts.ctx, opts.body?.statements ?? [], "  ")
    );
    if (emittedBody == null) return null;
    let body = emittedBody.length > 0 ? emittedBody : "";
    if (prelude.length > 0)
      body = body.length > 0
        ? `${prelude.join("\n")}\n${body}`
        : prelude.join("\n");
    body = appendCompletionReturnGuard(opts.ctx, body, "  ");

    return `${opts.modifierPrefix}function ${opts.name}(${params.join(", ")})${returnTypeSuffix} {\n${body}\n}`;
  });
}

function emitAnonFunctionLike(opts: {
  node: ts.FunctionLikeDeclaration;
  parameters: readonly ts.ParameterDeclaration[];
  returnType: ts.TypeNode | undefined;
  body: ts.Block | undefined;
  omitReturnType?: boolean;
  ctx: EmitContext;
}): string | null {
  return withFunctionEmitState(opts.ctx, opts.node, () => {
    if (!validateCompletionFunction(opts.ctx)) return null;
    const emittedParameters = emitParameters(opts.ctx, opts.parameters, "  ");
    if (!emittedParameters) return null;
    const params = emittedParameters.parameters;
    const prelude = emittedParameters.prelude;

    const returnType = emitType(opts.returnType);
    const returnTypeSuffix = opts.omitReturnType ? "" : `: ${returnType}`;

    if (!opts.body) return null;
    const emittedBody = withIdentifierRewrites(
      opts.ctx,
      emittedParameters.bodyRewrites,
      () => emitStatements(opts.ctx, opts.body?.statements ?? [], "  ")
    );
    if (emittedBody == null) return null;
    let body = emittedBody.length > 0 ? emittedBody : "";
    if (prelude.length > 0)
      body = body.length > 0
        ? `${prelude.join("\n")}\n${body}`
        : prelude.join("\n");

    return `function(${params.join(", ")})${returnTypeSuffix} {\n${body}\n}`;
  });
}

function emitFunction(ctx: EmitContext, fn: ts.FunctionDeclaration): string | null {
  return emitFunctionLike({
    node: fn,
    name: fn.name?.text ?? "anon",
    parameters: fn.parameters,
    returnType: fn.type,
    body: fn.body,
    modifierPrefix: "",
    ctx
  });
}

/**
 * Emits a call-time forwarding function for a static async helper.
 *
 * Reading a helper's static function into a module-level `final` can run before
 * Haxe initializes that static field, producing an undefined callable. A
 * wrapper preserves the source function identity at the module surface while
 * deferring the helper lookup until invocation. Default handling remains in
 * the validated helper body and is not duplicated here.
 */
function emitAsyncForwarder(opts: {
  name: string;
  helperName: string;
  helperField: string;
  parameters: readonly ts.ParameterDeclaration[];
  returnType: ts.TypeNode | undefined;
}): string | null {
  const parameters: string[] = [];
  const argumentsList: string[] = [];
  for (let index = 0; index < opts.parameters.length; index++) {
    const plan = planParameter(opts.parameters[index] as ts.ParameterDeclaration, index);
    if (plan.isRest) return null;
    const baseType = emitType(plan.parameter.type);
    const parameterType = plan.defaultValue
      ? `genes.ts.Undefinable<${baseType}>`
      : baseType;
    parameters.push(`${plan.isOptional ? "?" : ""}${plan.name}: ${parameterType}`);
    argumentsList.push(plan.name);
  }
  return [
    `function ${opts.name}(${parameters.join(", ")}): ${emitType(opts.returnType)} {`,
    `  return ${opts.helperName}.${opts.helperField}(${argumentsList.join(", ")});`,
    "}"
  ].join("\n");
}

function emitTypeAlias(decl: ts.TypeAliasDeclaration): string {
  const name = decl.name.text;
  if (ts.isUnionTypeNode(decl.type)) {
    const items = decl.type.types;
    const stringLits: string[] = [];
    for (const item of items) {
      if (!ts.isLiteralTypeNode(item) || !ts.isStringLiteral(item.literal)) {
        stringLits.length = 0;
        break;
      }
      stringLits.push(item.literal.text);
    }
    if (stringLits.length > 0) {
      const lines: string[] = [];
      lines.push(`enum abstract ${name}(String) from String to String {`);
      for (const lit of stringLits) {
        const member = toHaxeModuleName(lit);
        lines.push(`  var ${member} = ${JSON.stringify(lit)};`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }
  }

  const type = emitType(decl.type);
  return `typedef ${name} = ${type};`;
}

function emitInterface(decl: ts.InterfaceDeclaration): string {
  const name = decl.name.text;

  const lines: string[] = [];
  lines.push(`typedef ${name} = {`);

  for (const member of decl.members) {
    if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
      const isOptional = !!member.questionToken;
      const fieldType = emitType(member.type);
      if (isOptional) lines.push(`  @:optional @:ts.optional var ${member.name.text}: ${fieldType};`);
      else lines.push(`  var ${member.name.text}: ${fieldType};`);
      continue;
    }
    if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
      const isOptional = !!member.questionToken;
      const params = member.parameters.map((p) => {
        const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
        const isParamOptional = !!p.questionToken;
        const t = emitType(p.type);
        return `${isParamOptional ? "?" : ""}${id}: ${t}`;
      });
      const ret = emitType(member.type);
      const prefix = isOptional ? "  @:optional " : "  ";
      lines.push(`${prefix}function ${member.name.text}(${params.join(", ")}): ${ret};`);
      continue;
    }
  }

  lines.push(`}`);
  return lines.join("\n");
}

function emitEnum(decl: ts.EnumDeclaration): string {
  const name = decl.name.text;

  let underlying: "Float" | "String" = "Float";
  for (const member of decl.members) {
    if (member.initializer && ts.isStringLiteral(member.initializer)) underlying = "String";
  }

  const lines: string[] = [];
  lines.push(`enum abstract ${name}(${underlying}) from ${underlying} to ${underlying} {`);

  let nextNumeric = 0;
  for (const member of decl.members) {
    const memberName = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteral(member.name)
        ? member.name.text
        : "Member";

    let valueText: string | null = null;
    if (!member.initializer) {
      valueText = underlying === "String" ? JSON.stringify(memberName) : String(nextNumeric);
      nextNumeric++;
    } else if (ts.isNumericLiteral(member.initializer)) {
      valueText = member.initializer.text;
      nextNumeric = parseInt(member.initializer.text, 10) + 1;
    } else if (ts.isStringLiteral(member.initializer)) {
      valueText = JSON.stringify(member.initializer.text);
    }

    if (!valueText) continue;
    lines.push(`  var ${memberName} = ${valueText};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

function emitClass(ctx: EmitContext, decl: ts.ClassDeclaration, forcedName?: string): string | null {
  const name = forcedName ?? decl.name?.text ?? "AnonymousClass";
  const lines: string[] = [];

  lines.push(`class ${name} {`);
  const ctorInsertAt = lines.length;
  let sawConstructor = false;

  for (const member of decl.members) {
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isPrivate = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const visibility = isPrivate ? "private" : "public";
      const type = emitType(member.type);
      lines.push(`  ${visibility} ${isStatic ? "static " : ""}var ${member.name.text}: ${type};`);
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      sawConstructor = true;
      const emitted = emitFunctionLike({
        node: member,
        name: "new",
        parameters: member.parameters,
        returnType: undefined,
        body: member.body,
        modifierPrefix: "  public ",
        omitReturnType: true,
        ctx
      });
      if (!emitted) return null;
      lines.push(...emitted.split("\n").map((l, i) => (i === 0 ? l : `  ${l}`)));
      continue;
    }

    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isPrivate = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const isAsync = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
      if (isAsync) recordSemantic(ctx, "async.await", member);
      const visibility = isPrivate ? "private" : "public";
      const emitted = emitFunctionLike({
        node: member,
        name: member.name.text,
        parameters: member.parameters,
        returnType: member.type,
        body: member.body,
        modifierPrefix: isAsync ? `  @:async\n  ${visibility} ${isStatic ? "static " : ""}` : `  ${visibility} ${isStatic ? "static " : ""}`,
        ctx
      });
      if (!emitted) return null;
      lines.push(...emitted.split("\n").map((l, i) => (i === 0 ? l : `  ${l}`)));
      continue;
    }
  }

  // TS classes always have a constructor (implicit if none is declared), but Haxe requires an
  // explicit `new` to allow instantiation.
  if (!sawConstructor) lines.splice(ctorInsertAt, 0, `  public function new() {}`);

  lines.push(`}`);
  return lines.join("\n");
}

function importSpecFromStatement(stmt: ts.ImportDeclaration): ImportSpec | null {
  if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) return null;
  const moduleSpecifier = stmt.moduleSpecifier.text;
  const clause = stmt.importClause;
  if (!clause) return null;
  const isTypeOnly = clause.isTypeOnly;

  const defaultImport = clause.name ? clause.name.text : null;
  let namespaceImport: string | null = null;
  let named: Array<{ name: string; alias: string | null; isTypeOnly: boolean }> = [];

  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaceImport = clause.namedBindings.name.text;
    } else if (ts.isNamedImports(clause.namedBindings)) {
      named = clause.namedBindings.elements.map((el) => ({
        name: el.name.text,
        alias: el.propertyName ? el.propertyName.text : null,
        isTypeOnly: isTypeOnly || el.isTypeOnly
      }));
    }
  }

  return { moduleSpecifier, isTypeOnly, defaultImport, namespaceImport, named };
}

function collectImports(sf: ts.SourceFile): ImportSpec[] {
  const imports: ImportSpec[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = importSpecFromStatement(stmt);
    if (spec) imports.push(spec);
  }

  return imports;
}

function collectExportFroms(sf: ts.SourceFile): ExportFromSpec[] {
  const exports: ExportFromSpec[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleSpecifier = stmt.moduleSpecifier.text;

    if (!stmt.exportClause) {
      exports.push({ kind: "all", moduleSpecifier });
      continue;
    }

    if (!ts.isNamedExports(stmt.exportClause)) continue;
    const elements = stmt.exportClause.elements.map((el) => ({
      exported: el.name.text,
      source: el.propertyName ? el.propertyName.text : el.name.text
    }));
    exports.push({ kind: "named", moduleSpecifier, elements });
  }

  return exports;
}

type ExportKind = "value" | "type" | "both";

type LocalExportSpec = { exported: string; source: string; isTypeOnly: boolean };

function collectLocalExports(sf: ts.SourceFile): LocalExportSpec[] {
  const exports: LocalExportSpec[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (stmt.moduleSpecifier) continue;
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;

    for (const el of stmt.exportClause.elements) {
      exports.push({
        exported: el.name.text,
        source: el.propertyName ? el.propertyName.text : el.name.text,
        isTypeOnly: (stmt.isTypeOnly ?? false) || (el.isTypeOnly ?? false)
      });
    }
  }

  return exports;
}

function collectLocalDeclarationKinds(sf: ts.SourceFile): Map<string, ExportKind> {
  const kinds = new Map<string, ExportKind>();

  function set(name: string, kind: ExportKind) {
    const prev = kinds.get(name);
    if (!prev) {
      kinds.set(name, kind);
      return;
    }
    if (prev === kind) return;
    kinds.set(name, "both");
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      set(stmt.name.text, "value");
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) set(decl.name.text, "value");
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt)) {
      set(stmt.name.text, "type");
      continue;
    }
    if (ts.isTypeAliasDeclaration(stmt)) {
      set(stmt.name.text, "type");
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      set(stmt.name.text, "both");
      continue;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      set(stmt.name.text, "both");
      continue;
    }
  }

  return kinds;
}

function collectExportKinds(sf: ts.SourceFile): Map<string, ExportKind> {
  const kinds = new Map<string, ExportKind>();

  function set(name: string, kind: ExportKind) {
    const prev = kinds.get(name);
    if (!prev) {
      kinds.set(name, kind);
      return;
    }
    if (prev === kind) return;
    kinds.set(name, "both");
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "value");
      continue;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "both");
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "both");
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "type");
      continue;
    }
    if (ts.isTypeAliasDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "type");
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) set(decl.name.text, "value");
      }
      continue;
    }
  }

  return kinds;
}

function resolveRelativeSourceFile(program: ts.Program, fromFile: string, moduleSpecifier: string): ts.SourceFile | null {
  if (!isRelativeModuleSpecifier(moduleSpecifier)) return null;
  const fromDir = path.dirname(fromFile);
  const resolvedBase = path.resolve(fromDir, stripTsExtension(moduleSpecifier));
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`
  ];
  for (const candidate of candidates) {
    const sf = program.getSourceFile(candidate);
    if (sf) return sf;
  }
  return null;
}

function portablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function translationDiagnostic(opts: EmitHaxeOptions, sf: ts.SourceFile, node: ts.Node, details: {
  id: string;
  category: TranslationDiagnostic["semanticCategory"];
  message: string;
  outputFile: string | null;
  portableGrade?: PortabilityGrade;
  remediation?: string;
  forceError?: boolean;
}): TranslationDiagnostic {
  const start = node.getStart(sf, false);
  const end = node.getEnd();
  const position = sf.getLineAndCharacterOfPosition(start);
  return {
    id: details.id,
    severity: details.forceError || (opts.mode ?? "strict-js") !== "assisted"
      ? "error"
      : "loss",
    mode: opts.mode ?? "strict-js",
    source: {
      file: portablePath(path.relative(opts.rootDir, sf.fileName)),
      start,
      end,
      line: position.line + 1,
      column: position.character + 1
    },
    syntaxKind: ts.SyntaxKind[node.kind] ?? `SyntaxKind(${node.kind})`,
    semanticCategory: details.category,
    message: details.message,
    support: "unsupported",
    portableGrade: details.portableGrade ?? "U",
    outputFile: details.outputFile,
    remediation: details.remediation
      ?? "Refactor the construct or rerun with --mode assisted to produce explicitly lossy scaffolding."
  };
}

type ParsedImportAttribute =
  | { ok: true; importType: string | null }
  | { ok: false; message: string };

function parseImportAttribute(statement: ts.ImportDeclaration): ParsedImportAttribute {
  const attributes = statement.attributes;
  if (!attributes) return { ok: true, importType: null };
  if (attributes.elements.length !== 1)
    return { ok: false, message: "Only one literal ESM import attribute named type is supported." };

  const attribute = attributes.elements[0];
  if (!attribute)
    return { ok: false, message: "The ESM import attribute could not be read." };
  const name = ts.isIdentifier(attribute.name) || ts.isStringLiteral(attribute.name)
    ? attribute.name.text
    : "";
  if (name !== "type" || !ts.isStringLiteral(attribute.value) || attribute.value.text.length === 0)
    return { ok: false, message: "Only a non-empty literal type import attribute is supported." };
  return { ok: true, importType: attribute.value.text };
}

type ConvertedRequestBindingPlan =
  | { supported: true; anchor: string | null }
  | { supported: false };

/**
 * Resolves a TypeScript import/export alias to the declaration it denotes.
 *
 * Why: the checker reports local import names and re-exported names as alias
 * symbols, while stability is a property of the original runtime declaration.
 * What: callers receive the first non-alias symbol, or the last symbol when a
 * malformed/cyclic alias chain cannot make further progress.
 * How: compiler-owned symbol identity plus a visited set makes the walk
 * deterministic and prevents a broken declaration graph from looping.
 */
function unwrapAliasSymbol(checker: ts.TypeChecker, initial: ts.Symbol | undefined): ts.Symbol | undefined {
  let symbol = initial;
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

/**
 * Recognizes an identifier as part of an assignment target.
 *
 * Parentheses and destructuring wrappers are transparent, but ordinary reads,
 * call arguments, and property receivers are not. This deliberately answers a
 * narrow syntactic question; symbol identity is checked by the caller.
 */
function isBindingWriteReference(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent)) {
      return parent.left === current
        && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      return parent.operand === current;
    }
    if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) {
      return parent.initializer === current;
    }
    if (
      ts.isParenthesizedExpression(parent)
      || ts.isArrayLiteralExpression(parent)
      || ts.isObjectLiteralExpression(parent)
      || ts.isSpreadElement(parent)
      || ts.isSpreadAssignment(parent)
      || ts.isShorthandPropertyAssignment(parent)
      || (ts.isPropertyAssignment(parent) && parent.initializer === current)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Proves that a translated import observes one stable ESM binding identity.
 *
 * `const` and `export default <expression>` are stable by construction.
 * Function, class, and enum declarations are accepted only when a checker walk
 * finds no assignment to their declaration binding. `let` and `var` remain
 * fail-closed even without a visible write because their live-binding contract
 * permits mutation that the current Haxe anchor does not model.
 */
function isImmutableRuntimeSymbol(checker: ts.TypeChecker, initial: ts.Symbol | undefined): boolean {
  const symbol = unwrapAliasSymbol(checker, initial);
  const declaration = symbol?.valueDeclaration;
  if (!declaration) return false;
  if (ts.isExportAssignment(declaration) && !declaration.isExportEquals) return true;
  if (
    ts.isVariableDeclaration(declaration)
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  ) return true;
  if (
    !symbol
    || (!ts.isFunctionDeclaration(declaration)
      && !ts.isClassDeclaration(declaration)
      && !ts.isEnumDeclaration(declaration))
  ) return false;

  // Function/class/enum declarations are stable in the supported translator
  // subset only when their module never assigns the declaration binding.
  // `let`/`var` remain rejected even without an observed write because their
  // live-binding contract is explicitly mutable.
  let written = false;
  const visit = (node: ts.Node): void => {
    if (written) return;
    if (
      ts.isIdentifier(node)
      && node !== declaration.name
      && unwrapAliasSymbol(checker, checker.getSymbolAtLocation(node)) === symbol
      && isBindingWriteReference(node)
    ) {
      written = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return !written;
}

/**
 * Tests whether a stable TypeScript binding is also a legal Haxe value token.
 *
 * ts2hx lowers TypeScript enums to enum abstracts. Their identifiers work in
 * member access (`Status.Active`) but Haxe forbids passing the abstract itself
 * as a value to the internal marker macro. Other supported runtime declarations
 * lower to module fields or class/type expressions understood by Genes. When
 * no legal local token exists, planning uses the converted target marker.
 */
function isHaxeValueAnchorSymbol(checker: ts.TypeChecker, initial: ts.Symbol | undefined): boolean {
  const declaration = unwrapAliasSymbol(checker, initial)?.valueDeclaration;
  return declaration !== undefined && !ts.isEnumDeclaration(declaration);
}

/**
 * Validates namespace reads without turning the namespace into a runtime value.
 *
 * Why: ts2hx rewrites a converted namespace member directly to its generated
 * Haxe module field. Passing the namespace object around, computing arbitrary
 * keys, or reading mutable exports would require live-binding evidence that is
 * deliberately outside this increment.
 *
 * What: every value use must be a static property access (or a string-literal
 * element access), and every selected export must resolve to an immutable
 * `const` or default-expression binding.
 *
 * How: identifier references are matched through the TypeChecker, then export
 * symbols are read from the aliased module symbol. The carrier itself uses a
 * target marker, so none of these validation reads reaches generated JS/TS.
 */
function hasOnlyImmutableStaticNamespaceReads(
  opts: EmitHaxeOptions,
  sourceFile: ts.SourceFile,
  namespaceImport: ts.NamespaceImport
): boolean {
  const localSymbol = opts.checker.getSymbolAtLocation(namespaceImport.name);
  if (!localSymbol) return false;
  const exportNames = new Set<string>();
  let supported = true;

  const visit = (node: ts.Node): void => {
    if (!supported) return;
    if (
      ts.isIdentifier(node)
      && node !== namespaceImport.name
      && opts.checker.getSymbolAtLocation(node) === localSymbol
    ) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        exportNames.add(parent.name.text);
      } else if (
        ts.isElementAccessExpression(parent)
        && parent.expression === node
        && parent.argumentExpression
        && ts.isStringLiteralLike(parent.argumentExpression)
      ) {
        exportNames.add(parent.argumentExpression.text);
      } else {
        supported = false;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!supported) return false;

  const moduleSymbol = unwrapAliasSymbol(opts.checker, localSymbol);
  if (!moduleSymbol) return false;
  const exports = new Map(
    opts.checker.getExportsOfModule(moduleSymbol).map((symbol) => [symbol.getName(), symbol] as const)
  );
  return Array.from(exportNames).every((name) =>
    isImmutableRuntimeSymbol(opts.checker, exports.get(name))
  );
}

/**
 * Classifies the converted binding forms whose ESM reads are already proven.
 *
 * Why: a request carrier must retain TypeScript's effective module request
 * without turning a mutable live binding or namespace object into a snapshot.
 *
 * What: binding-free `bare`/`empty` requests use a deterministic target marker.
 * Default, named, aliased, and mixed clauses use the first real binding as a
 * DCE anchor after every retained value resolves to an immutable export.
 * Namespace requests use a target marker and permit only static immutable
 * member reads. Every other binding form receives a stable fail-closed result.
 *
 * How: classification consumes the post-transform request shape but validates
 * declarations and reads through the original Program's TypeChecker. The
 * resulting anchor is compiler-internal and is erased after Genes builds its
 * ordered dependency projection.
 */
function convertedRequestBindingPlan(
  opts: EmitHaxeOptions,
  sourceFile: ts.SourceFile,
  occurrence: EffectiveRuntimeImportOccurrence
): ConvertedRequestBindingPlan {
  const { statement, request } = occurrence;
  if (request.emittedShape === "bare" || request.emittedShape === "empty") {
    return { supported: true, anchor: null };
  }

  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return { supported: false };
  const anchors: string[] = [];
  for (const retained of request.runtimeBindings) {
    if (retained.kind === "namespace") {
      const bindings = clause.namedBindings;
      if (
        !bindings
        || !ts.isNamespaceImport(bindings)
        || bindings.name.text !== retained.localName
        || !hasOnlyImmutableStaticNamespaceReads(opts, sourceFile, bindings)
      ) return { supported: false };
      continue;
    }

    const namedBindings = clause.namedBindings;
    const identifier = retained.kind === "default"
      ? clause.name
      : namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.find((element) =>
          !element.isTypeOnly && element.name.text === retained.localName
        )?.name
        : undefined;
    if (!identifier || identifier.text !== retained.localName) return { supported: false };
    const symbol = opts.checker.getSymbolAtLocation(identifier);
    if (!isImmutableRuntimeSymbol(opts.checker, symbol)) {
      return { supported: false };
    }
    if (isHaxeValueAnchorSymbol(opts.checker, symbol)) anchors.push(identifier.text);
  }

  if (request.runtimeBindings.length === 0) return { supported: false };
  return { supported: true, anchor: anchors[0] ?? null };
}

function isBindingFreeRequestShape(shape: EffectiveImportShape): boolean {
  return shape === "bare" || shape === "empty";
}

function sourceImportHasValueBindings(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
}

type PackageRuntimeRequestPlan =
  | Readonly<{
      supported: true;
      bindings: readonly SupportedPackageExternBindingPlan[];
    }>
  | Readonly<{
      supported: false;
      reason: string;
    }>;

function packageExternSource(opts: EmitHaxeOptions, node: ts.Node): PackageExternSource {
  const sourceFile = node.getSourceFile();
  const start = node.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: portablePath(path.relative(opts.rootDir, sourceFile.fileName)),
    start,
    end: node.getEnd(),
    line: position.line + 1,
    column: position.character + 1
  };
}

function packageBindingFailure(
  localReference: string,
  reason: string
): PackageRuntimeRequestPlan {
  const readableReason = reason.replace(/-/g, " ");
  return {
    supported: false,
    reason:
      `Package binding ${JSON.stringify(localReference)} cannot use the first typed extern boundary `
      + `because of ${readableReason}. Only declaration-file primitive constants and simple `
      + "monomorphic primitive functions are supported."
  };
}

/**
 * Distinguishes source-owned binding reads from transform-synthesized ones.
 *
 * Why: classic JSX and other TypeScript transforms can retain an import and
 * create uses that do not exist in the typed source tree ts2hx lowers. Treating
 * that binding as an ordinary unused import would preserve loading but omit the
 * synthesized call, which is not semantic parity.
 *
 * What: a true result means at least one original identifier resolves to the
 * import alias. A false result is accepted only under verbatim module syntax,
 * where retaining an otherwise unused declaration is the explicit contract.
 *
 * How: checker symbol identity avoids matching shadowed names. The declaration
 * token itself is excluded, and traversal stops at the first real reference.
 */
function hasOriginalImportBindingUse(
  opts: EmitHaxeOptions,
  sourceFile: ts.SourceFile,
  declaration: ts.Identifier
): boolean {
  const symbol = opts.checker.getSymbolAtLocation(declaration);
  if (!symbol) return false;
  const state = { found: false };
  const visit = (node: ts.Node): void => {
    if (state.found) return;
    if (
      ts.isIdentifier(node)
      && node !== declaration
      && opts.checker.getSymbolAtLocation(node) === symbol
    ) {
      state.found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return state.found;
}

/**
 * Collects the statically named members read through one package namespace.
 *
 * Why: a Haxe extern class can model `Package.member`, but it cannot preserve a
 * JavaScript module namespace object's identity, enumeration, computed reads,
 * or passage through arbitrary calls. Pretending otherwise would turn a typed
 * import into a snapshot-like object with different runtime semantics.
 *
 * What: the first boundary accepts property reads whose receiver resolves to
 * the exact namespace import symbol. Unused namespaces are valid because their
 * effective request is still preserved by the ordered request carrier.
 *
 * How: checker symbol identity distinguishes the import from shadowed local
 * names. Each selected member is planned independently through the closed
 * package-extern algebra. Computed and sanitized member spellings remain
 * explicit failures until expression lowering can represent them directly.
 */
function planPackageNamespaceBindings(
  opts: EmitHaxeOptions,
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
  namespaceImport: ts.NamespaceImport
): PackageRuntimeRequestPlan {
  const localSymbol = opts.checker.getSymbolAtLocation(namespaceImport.name);
  if (!localSymbol) return packageBindingFailure(namespaceImport.name.text, "missing-symbol");

  const memberNodes = new Map<string, ts.Identifier>();
  const state: { unsupportedUse: ts.Identifier | null } = { unsupportedUse: null };
  const visit = (node: ts.Node): void => {
    if (state.unsupportedUse) return;
    if (
      ts.isIdentifier(node)
      && node !== namespaceImport.name
      && opts.checker.getSymbolAtLocation(node) === localSymbol
    ) {
      const parent = node.parent;
      if (
        ts.isPropertyAccessExpression(parent)
        && parent.expression === node
        && ts.isIdentifier(parent.name)
      ) {
        const field = externFieldForExportName(parent.name.text);
        if (field.hxName !== parent.name.text) {
          state.unsupportedUse = node;
          return;
        }
        if (!memberNodes.has(parent.name.text)) memberNodes.set(parent.name.text, parent.name);
      } else {
        state.unsupportedUse = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (state.unsupportedUse) {
    return packageBindingFailure(
      state.unsupportedUse.text,
      "namespace-object-or-computed-member-use"
    );
  }

  const bindings: SupportedPackageExternBindingPlan[] = [];
  for (const [runtimeExportName, memberNode] of Array.from(memberNodes.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const plan = planPackageExternBinding({
      checker: opts.checker,
      projectDir: opts.projectDir,
      moduleSpecifier,
      runtimeExportName,
      localReference: `${namespaceImport.name.text}.${runtimeExportName}`,
      symbol: opts.checker.getSymbolAtLocation(memberNode),
      source: packageExternSource(opts, memberNode)
    });
    if (plan.disposition === "unsupported") {
      return packageBindingFailure(plan.localReference, plan.reason);
    }
    bindings.push(plan);
  }
  return { supported: true, bindings };
}

/**
 * Validates every binding retained by TypeScript for one package request.
 *
 * Why: original import syntax may contain values that TypeScript elides. The
 * configured transform is authoritative for runtime requests, while the
 * original typed nodes are authoritative for alias identity and declarations.
 *
 * What: default, named, aliased, mixed, and statically-read namespace bindings
 * are accepted only when every retained value receives a strong immutable
 * package-extern plan. One unsupported member rejects the whole declaration so
 * a partial extern cannot be mistaken for executable parity.
 *
 * How: retained local names are matched back to their original clause nodes,
 * then checker symbols flow into `planPackageExternBinding`. The result holds
 * no AST or checker objects beyond its statement-keyed project ownership.
 */
function planPackageRuntimeRequest(
  opts: EmitHaxeOptions,
  sourceFile: ts.SourceFile,
  occurrence: EffectiveRuntimeImportOccurrence
): PackageRuntimeRequestPlan {
  const { statement, request } = occurrence;
  const clause = statement.importClause;
  const moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;
  if (!clause || clause.isTypeOnly || request.runtimeBindings.length === 0) {
    return packageBindingFailure(moduleSpecifier, "missing-runtime-binding");
  }

  const bindings: SupportedPackageExternBindingPlan[] = [];
  for (const retained of request.runtimeBindings) {
    if (retained.kind === "namespace") {
      const namespace = clause.namedBindings;
      if (
        !namespace
        || !ts.isNamespaceImport(namespace)
        || namespace.name.text !== retained.localName
      ) {
        return packageBindingFailure(retained.localName, "request-clause-mismatch");
      }
      if (
        !hasOriginalImportBindingUse(opts, sourceFile, namespace.name)
        && opts.program.getCompilerOptions().verbatimModuleSyntax !== true
      ) {
        return packageBindingFailure(
          retained.localName,
          "compiler-synthesized-or-unproven-binding-use"
        );
      }
      const namespacePlan = planPackageNamespaceBindings(
        opts,
        sourceFile,
        moduleSpecifier,
        namespace
      );
      if (!namespacePlan.supported) return namespacePlan;
      bindings.push(...namespacePlan.bindings);
      continue;
    }

    const namedBindings = clause.namedBindings;
    const identifier = retained.kind === "default"
      ? clause.name
      : namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.find((element) =>
          !element.isTypeOnly && element.name.text === retained.localName
        )?.name
        : undefined;
    if (!identifier || identifier.text !== retained.localName) {
      return packageBindingFailure(retained.localName, "request-clause-mismatch");
    }
    if (
      !hasOriginalImportBindingUse(opts, sourceFile, identifier)
      && opts.program.getCompilerOptions().verbatimModuleSyntax !== true
    ) {
      return packageBindingFailure(
        retained.localName,
        "compiler-synthesized-or-unproven-binding-use"
      );
    }

    const runtimeExportName = retained.kind === "default"
      ? "default"
      : namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.find((element) => element.name === identifier)?.propertyName?.text
          ?? identifier.text
        : identifier.text;
    const field = externFieldForExportName(runtimeExportName);
    if (
      runtimeExportName !== "default"
      && (field.hxName !== runtimeExportName || runtimeExportName === "__default")
    ) {
      return packageBindingFailure(
        identifier.text,
        "runtime-export-name-needs-sanitization"
      );
    }
    const plan = planPackageExternBinding({
      checker: opts.checker,
      projectDir: opts.projectDir,
      moduleSpecifier,
      runtimeExportName,
      localReference: identifier.text,
      symbol: opts.checker.getSymbolAtLocation(identifier),
      source: packageExternSource(opts, identifier)
    });
    if (plan.disposition === "unsupported") {
      return packageBindingFailure(plan.localReference, plan.reason);
    }
    bindings.push(plan);
  }

  const byExport = new Map<string, SupportedPackageExternBindingPlan>();
  for (const binding of bindings) {
    const prior = byExport.get(binding.runtimeExportName);
    if (prior && JSON.stringify(prior.member) !== JSON.stringify(binding.member)) {
      return packageBindingFailure(binding.localReference, "conflicting-export-declarations");
    }
    byExport.set(binding.runtimeExportName, prior ?? binding);
  }
  return {
    supported: true,
    bindings: Array.from(byExport.values()).sort((a, b) =>
      a.runtimeExportName.localeCompare(b.runtimeExportName)
    )
  };
}

function runtimeReexports(sourceFile: ts.SourceFile): ts.ExportDeclaration[] {
  return sourceFile.statements.filter((statement): statement is ts.ExportDeclaration => {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || statement.isTypeOnly)
      return false;
    if (!statement.exportClause) return true;
    // `export * as namespace from "..."` is a runtime module request too.
    if (!ts.isNamedExports(statement.exportClause)) return true;
    return statement.exportClause.elements.some((element) => !element.isTypeOnly);
  });
}

function relativeDiskCandidates(fromFile: string, moduleSpecifier: string): string[] {
  const resolvedBase = path.resolve(path.dirname(fromFile), stripTsExtension(moduleSpecifier));
  return [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`
  ];
}

function resolveRelativeDiskFile(fromFile: string, moduleSpecifier: string): string | null {
  for (const candidate of relativeDiskCandidates(fromFile, moduleSpecifier)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isConvertibleSourcePath(filePath: string): boolean {
  return /\.(d\.)?(tsx?|jsx?)$/i.test(filePath);
}

function sourceOutputRelativeFile(opts: EmitHaxeOptions, sourceFile: ts.SourceFile): string {
  const relative = path.relative(opts.rootDir, sourceFile.fileName);
  const directory = path.dirname(relative);
  const fileBase = path.basename(relative).replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
  const moduleName = toHaxeModuleName(fileBase);
  const basePackageDirs = opts.basePackage.split(".").filter((part) => part.length > 0);
  return path.join(...basePackageDirs, directory, `${moduleName}.hx`);
}

function problem(
  statement: ts.Node,
  id: string,
  message: string
): RuntimeImportProblem {
  return { statement, id, message };
}

/** Normalizes Program file order before manifest and diagnostic selection. */
function sortedRequestInventoryFiles(
  opts: EmitHaxeOptions,
  inventory: EffectiveModuleRequestInventory
): EffectiveModuleRequestInventory["files"] {
  return inventory.files.slice().sort((a, b) =>
    portablePath(path.relative(opts.rootDir, a.sourceFile)).localeCompare(
      portablePath(path.relative(opts.rootDir, b.sourceFile))
    )
  );
}

/** Projects read-only compiler evidence into the stable public manifest form. */
function manifestModuleRequests(
  opts: EmitHaxeOptions,
  inventory: EffectiveModuleRequestInventory
): TranslationModuleRequestDisposition[] {
  return sortedRequestInventoryFiles(opts, inventory).flatMap(file =>
    file.imports.map(entry => ({
      source: {
        file: portablePath(path.relative(opts.rootDir, entry.sourceFile)),
        start: entry.sourceStart,
        end: entry.sourceEnd,
        line: entry.sourceLine,
        column: entry.sourceColumn
      },
      sourceOrdinal: entry.sourceOrdinal,
      disposition: entry.disposition,
      ordinal: entry.disposition === "runtime-request" ? entry.requestOrdinal : null,
      specifier: entry.specifier,
      moduleFormat: entry.disposition === "runtime-request" ? entry.moduleFormat : null,
      emittedShape: entry.disposition === "runtime-request" ? entry.emittedShape : null
    }))
  );
}

/** Selects the first runtime request by portable file path, then emit order. */
function firstEffectiveRuntimeRequest(
  opts: EmitHaxeOptions,
  inventory: EffectiveModuleRequestInventory
): EffectiveRuntimeRequest | null {
  for (const file of sortedRequestInventoryFiles(opts, inventory)) {
    const request = file.runtimeRequests
      .slice()
      .sort((a, b) => a.requestOrdinal - b.requestOrdinal || a.sourceStart - b.sourceStart)[0];
    if (request) return request;
  }
  return null;
}

/**
 * Allocates the semantic-only field that makes one converted module typeable.
 *
 * Why: a bare relative import has no Haxe value binding for DCE to retain, but
 * Genes needs a compiler-owned static field reference in order to recover the
 * generated module identity from the typed AST.
 *
 * What: the base name is a stable hash of the normalized source path. A local
 * declaration/import collision receives the first deterministic numeric
 * suffix. The name is shared by the target emitter and every importing carrier
 * in this immutable project plan.
 *
 * How: the emitted field is marked `@:keep` and
 * `@:genes.compilerInternal`. Haxe therefore types the target before Genes
 * consumes the reference, while all implementation and declaration printers
 * erase the field. The hash is an identifier aid only; request identity remains
 * the compiler-owned Haxe module type.
 */
function convertedTargetMarkerName(opts: EmitHaxeOptions, sourceFile: ts.SourceFile): string {
  const sourcePath = portablePath(path.relative(opts.rootDir, sourceFile.fileName));
  const hash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 10);
  const base = `__ts2hx_init_${hash}`;
  const usedNames = new Set(collectLocalDeclarationKinds(sourceFile).keys());
  for (const imp of collectImports(sourceFile)) {
    if (imp.defaultImport) usedNames.add(imp.defaultImport);
    if (imp.namespaceImport) usedNames.add(imp.namespaceImport);
    for (const named of imp.named) usedNames.add(named.name);
  }
  if (sourceFile.statements.some((statement) =>
    ts.isExportAssignment(statement) && !statement.isExportEquals
  )) usedNames.add("__default");

  let markerName = base;
  let suffix = 2;
  while (usedNames.has(markerName)) {
    markerName = `${base}_${suffix}`;
    suffix++;
  }
  return markerName;
}

/**
 * Classifies the converted runtime graph into strongly connected components.
 *
 * Why: no converted cycle is supported until ESM instantiation, temporal-dead-
 * zone, and mutation behavior agree in all three runtimes. Re-running
 * reachability from each request would make planning quadratic on large
 * migrations.
 *
 * What: the endpoints of an existing edge participate in a cycle when they
 * have the same returned component number (including a self-edge). Component
 * numbers are internal; only equality is semantic.
 *
 * How: iterative Kosaraju passes avoid JavaScript call-stack limits. Sorted
 * nodes and neighbors make the plan deterministic even though component IDs do
 * not reach emitted source or diagnostics.
 */
function convertedRuntimeComponents(
  graph: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlyMap<string, number> {
  const nodes = new Set<string>();
  for (const [source, targets] of graph) {
    nodes.add(source);
    for (const target of targets) nodes.add(target);
  }
  const orderedNodes = Array.from(nodes).sort((a, b) => a.localeCompare(b));
  const forward = new Map<string, readonly string[]>();
  const reverse = new Map<string, string[]>();
  for (const node of orderedNodes) {
    forward.set(node, Array.from(graph.get(node) ?? []).sort((a, b) => a.localeCompare(b)));
    reverse.set(node, []);
  }
  for (const [source, targets] of forward) {
    for (const target of targets) reverse.get(target)?.push(source);
  }
  for (const sources of reverse.values()) sources.sort((a, b) => a.localeCompare(b));

  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of orderedNodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ node: string; neighbors: readonly string[]; nextIndex: number }> = [
      { node: start, neighbors: forward.get(start) ?? [], nextIndex: 0 }
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      const next = frame.neighbors[frame.nextIndex];
      if (next !== undefined) {
        frame.nextIndex++;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ node: next, neighbors: forward.get(next) ?? [], nextIndex: 0 });
        }
        continue;
      }
      stack.pop();
      finishOrder.push(frame.node);
    }
  }

  const componentByNode = new Map<string, number>();
  let component = 0;
  for (let index = finishOrder.length - 1; index >= 0; index--) {
    const start = finishOrder[index];
    if (start === undefined || componentByNode.has(start)) continue;
    const stack = [start];
    componentByNode.set(start, component);
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const predecessor of reverse.get(current) ?? []) {
        if (componentByNode.has(predecessor)) continue;
        componentByNode.set(predecessor, component);
        stack.push(predecessor);
      }
    }
    component++;
  }
  return componentByNode;
}

/**
 * Builds one immutable runtime-import sequence before any source file prints.
 *
 * Why: per-file binding collection drops bare declarations and cannot preserve
 * their order relative to bound imports. It also cannot safely decide whether
 * a relative request names converted code, a build-owned runtime file, or a
 * missing dependency.
 *
 * What: every effective ESM request receives exactly one ordered disposition.
 * Acyclic converted bare, empty, named, default, namespace, and combined
 * default clauses use a real immutable binding or deterministic target marker.
 * Bare packages, validated primitive package bindings, and manifest-owned
 * relative resources become external marker calls. Weak package declarations,
 * mutable bindings, non-ESM lowering, converted cycles, runtime re-exports,
 * and ambiguous relative/attribute shapes fail closed at their source node.
 *
 * How: final TypeScript transform evidence supplies request presence, shape,
 * module format, and order. The planner resolves those facts against the exact
 * conversion set, checker symbols, SCC graph, and optional hash-verified
 * staging manifest. Resource bytes are read now but committed only after every
 * source file has been validated.
 */
function buildProjectRuntimeImportPlan(
  opts: EmitHaxeOptions,
  effectiveRequests: EffectiveModuleRequestInventory
): ProjectRuntimeImportPlan {
  const manifest: RuntimeModuleManifestPlan | null = opts.runtimeModulesManifest
    ? loadRuntimeModuleManifest(opts.runtimeModulesManifest)
    : null;
  const sortedSourceFiles = opts.sourceFiles.slice().sort((a, b) => a.fileName.localeCompare(b.fileName));
  const conversionSet = new Set(sortedSourceFiles.map((sourceFile) => path.resolve(sourceFile.fileName)));
  const bySourceFile = new Map<string, SourceRuntimeImportPlan>();
  const targetBySourceFile = new Map<string, ConvertedRuntimeTargetPlan>();
  const packageBindingsByStatement = new Map<
    ts.ImportDeclaration,
    readonly SupportedPackageExternBindingPlan[]
  >();
  const packageExternStatements = new Set<ts.ImportDeclaration>();
  const usedManifestEntries = new Set<RuntimeModuleManifestEntry>();
  const inventories: RuntimeImportInventory[] = [];
  const convertedEdgeByStatement = new Map<ts.ImportDeclaration, ConvertedRuntimeEdge>();
  const convertedGraph = new Map<string, Set<string>>();
  const packageClassOwner = new Map<
    string,
    { moduleSpecifier: string; statement: ts.ImportDeclaration }
  >();
  const collidingPackageStatements = new Set<ts.ImportDeclaration>();
  const effectiveBySourcePath = new Map(
    effectiveRequests.files.map((file) => [path.resolve(file.sourceFile), file] as const)
  );

  for (const sourceFile of sortedSourceFiles) {
    const imports = sourceFile.statements.filter(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
    );
    const sourceKey = path.resolve(sourceFile.fileName);
    const effectiveFile = effectiveBySourcePath.get(sourceKey);
    if (!effectiveFile)
      throw new Error(`Effective request inventory omitted ${sourceFile.fileName}.`);
    const importBySpan = new Map(
      imports.map((statement) => [`${statement.getStart(sourceFile)}:${statement.getEnd()}`, statement] as const)
    );
    const runtimeImports = effectiveFile.runtimeRequests
      .slice()
      .sort((a, b) => a.requestOrdinal - b.requestOrdinal || a.sourceStart - b.sourceStart)
      .map((request): EffectiveRuntimeImportOccurrence => {
        const statement = importBySpan.get(`${request.sourceStart}:${request.sourceEnd}`);
        if (!statement) {
          throw new Error(
            `Could not recover effective request ${request.specifier} at `
              + `${sourceFile.fileName}:${request.sourceStart}.`
          );
        }
        return { statement, request };
      });
    const sourceInventory = { sourceFile, runtimeImports };
    inventories.push(sourceInventory);

    for (const { statement } of runtimeImports) {
      const moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      if (!isRelativeModuleSpecifier(moduleSpecifier)) {
        if (sourceImportHasValueBindings(statement)) {
          const className = externModuleNameFromSpecifier(moduleSpecifier);
          const owner = packageClassOwner.get(className);
          if (!owner) {
            packageClassOwner.set(className, { moduleSpecifier, statement });
          } else if (owner.moduleSpecifier !== moduleSpecifier) {
            collidingPackageStatements.add(owner.statement);
            collidingPackageStatements.add(statement);
          }
        }
        continue;
      }
      const targetFile = resolveRelativeSourceFile(opts.program, sourceFile.fileName, moduleSpecifier);
      if (!targetFile || !conversionSet.has(path.resolve(targetFile.fileName))) continue;

      const targetKey = path.resolve(targetFile.fileName);
      convertedEdgeByStatement.set(statement, { targetFile });
      const targets = convertedGraph.get(sourceKey) ?? new Set<string>();
      targets.add(targetKey);
      convertedGraph.set(sourceKey, targets);
    }
  }

  const convertedComponents = convertedRuntimeComponents(convertedGraph);

  // Reject each converted SCC once, at its earliest request occurrence. A
  // later edge in the same SCC must not generate a carrier merely because it
  // has a usable binding: ESM instantiation, TDZ, and live mutation semantics
  // are properties of the whole component.
  const cyclicStatements = new Set<ts.ImportDeclaration>();
  const cycleOccurrences = new Map<
    number,
    Array<{ sourceFile: ts.SourceFile; occurrence: EffectiveRuntimeImportOccurrence }>
  >();
  for (const inventory of inventories) {
    const sourceKey = path.resolve(inventory.sourceFile.fileName);
    for (const occurrence of inventory.runtimeImports) {
      const { statement } = occurrence;
      const edge = convertedEdgeByStatement.get(statement);
      if (!edge) continue;
      const targetKey = path.resolve(edge.targetFile.fileName);
      const sourceComponent = convertedComponents.get(sourceKey);
      const targetComponent = convertedComponents.get(targetKey);
      if (sourceComponent === undefined || sourceComponent !== targetComponent) continue;
      cyclicStatements.add(statement);
      const entries = cycleOccurrences.get(sourceComponent) ?? [];
      entries.push({ sourceFile: inventory.sourceFile, occurrence });
      cycleOccurrences.set(sourceComponent, entries);
    }
  }
  const cycleProblemStatements = new Set<ts.ImportDeclaration>();
  for (const entries of cycleOccurrences.values()) {
    entries.sort((a, b) =>
      portablePath(path.relative(opts.rootDir, a.sourceFile.fileName)).localeCompare(
        portablePath(path.relative(opts.rootDir, b.sourceFile.fileName))
      )
      || a.occurrence.request.sourceStart - b.occurrence.request.sourceStart
    );
    const first = entries[0];
    if (first) cycleProblemStatements.add(first.occurrence.statement);
  }

  function internalTargetAnchor(
    sourceFile: ts.SourceFile,
    statement: ts.ImportDeclaration,
    moduleSpecifier: string,
    edge: ConvertedRuntimeEdge
  ): string {
    const targetKey = path.resolve(edge.targetFile.fileName);
    let targetPlan = targetBySourceFile.get(targetKey);
    if (!targetPlan) {
      targetPlan = { markerName: convertedTargetMarkerName(opts, edge.targetFile) };
      targetBySourceFile.set(targetKey, targetPlan);
    }
    const target = moduleTargetFromImport(
      {
        projectDir: opts.projectDir,
        rootDir: opts.rootDir,
        fromFile: sourceFile.fileName,
        basePackage: opts.basePackage
      },
      moduleSpecifier
    );
    const moduleBase = target.packagePath.length > 0
      ? `${target.packagePath}.${target.moduleName}`
      : target.moduleName;
    return `${moduleBase}.${targetPlan.markerName}`;
  }

  for (const { sourceFile, runtimeImports } of inventories) {

    const sourcePath = portablePath(path.relative(opts.rootDir, sourceFile.fileName));
    const requests: RuntimeImportRequest[] = [];
    const problems: RuntimeImportProblem[] = runtimeReexports(sourceFile).map((statement) =>
      problem(
        statement,
        "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001",
        "Runtime re-exports require a shared ordered declaration and live-binding plan that is not yet proven."
      )
    );

    for (const occurrence of runtimeImports) {
      const { statement, request } = occurrence;
      const moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      if (collidingPackageStatements.has(statement)) {
        problems.push({
          statement,
          id: "TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001",
          message:
            `Package specifier ${JSON.stringify(moduleSpecifier)} collides with another generated `
            + `extern module name ${JSON.stringify(externModuleNameFromSpecifier(moduleSpecifier))}.`,
          remediation:
            "Use a project without colliding package spellings until deterministic extern aliases are supported.",
          forceError: true
        });
        continue;
      }
      if (
        !isRelativeModuleSpecifier(moduleSpecifier)
        && sourceImportHasValueBindings(statement)
      ) {
        packageExternStatements.add(statement);
      }

      if (request.moduleFormat !== "esm") {
        problems.push(problem(
          statement,
          "TS2HX-MODULES-ESM-RUNTIME-MODULE-KIND-001",
          `Configured TypeScript emit lowers ${JSON.stringify(moduleSpecifier)} as ${request.moduleFormat}, not ESM.`
        ));
        continue;
      }

      if (cyclicStatements.has(statement)) {
        if (cycleProblemStatements.has(statement)) {
          problems.push(problem(
            statement,
            "TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001",
            "A converted runtime-request cycle has unproven ESM instantiation, TDZ, and live-binding semantics."
          ));
        }
        continue;
      }

      const attribute = parseImportAttribute(statement);
      if (!attribute.ok) {
        problems.push(problem(
          statement,
          "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001",
          attribute.message
        ));
        continue;
      }

      if (!isRelativeModuleSpecifier(moduleSpecifier)) {
        if (!isBindingFreeRequestShape(request.emittedShape)) {
          if (attribute.importType !== null) {
            problems.push(problem(
              statement,
              "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001",
              "A bound package request cannot preserve an import attribute through its typed extern binding."
            ));
            continue;
          }
          const packagePlan = planPackageRuntimeRequest(opts, sourceFile, occurrence);
          if (!packagePlan.supported) {
            problems.push(problem(
              statement,
              "TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001",
              packagePlan.reason
            ));
            continue;
          }
          packageBindingsByStatement.set(statement, packagePlan.bindings);
        }
        requests.push({
          kind: "external",
          statement,
          runtimeSpecifier: moduleSpecifier,
          importType: attribute.importType,
          manifestEntry: null
        });
        continue;
      }

      const resolvedSource = resolveRelativeSourceFile(opts.program, sourceFile.fileName, moduleSpecifier);
      if (resolvedSource && conversionSet.has(path.resolve(resolvedSource.fileName))) {
        if (attribute.importType !== null) {
          problems.push(problem(
            statement,
            "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001",
            "An import attribute cannot be preserved when a relative source is converted to a generated Haxe module."
          ));
          continue;
        }
        const edge = convertedEdgeByStatement.get(statement);
        if (!edge)
          throw new Error(`Converted request edge was not planned for ${sourceFile.fileName}.`);
        const bindingPlan = convertedRequestBindingPlan(opts, sourceFile, occurrence);
        if (!bindingPlan.supported) {
          problems.push(problem(
            statement,
            "TS2HX-MODULES-ESM-BINDINGS-LIVE-001",
            "The retained binding is mutable or cannot be reduced to a static immutable export read."
          ));
          continue;
        }
        if (bindingPlan.anchor) {
          requests.push({ kind: "internal-binding", statement, anchor: bindingPlan.anchor });
        } else {
          requests.push({
            kind: "internal-target",
            statement,
            anchor: internalTargetAnchor(sourceFile, statement, moduleSpecifier, edge)
          });
        }
        continue;
      }

      const diskFile = resolveRelativeDiskFile(sourceFile.fileName, moduleSpecifier);
      if (
        (resolvedSource && isConvertibleSourcePath(resolvedSource.fileName))
        || (diskFile && isConvertibleSourcePath(diskFile))
      ) {
        problems.push(problem(
          statement,
          "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNCONVERTED-SOURCE-001",
          `Relative source ${JSON.stringify(moduleSpecifier)} is not a member of the configured conversion set.`
        ));
        continue;
      }

      const manifestEntry = manifest?.byRequest.get(runtimeModuleRequestKey(sourcePath, moduleSpecifier)) ?? null;
      if (manifestEntry) {
        if (!isBindingFreeRequestShape(request.emittedShape)) {
          problems.push(problem(
            statement,
            "TS2HX-MODULES-SIDE-EFFECT-IMPORT-EXTERNAL-RELATIVE-001",
            "The current runtime-module manifest preserves binding-free relative requests only."
          ));
          continue;
        }
        if (attribute.importType !== manifestEntry.importType) {
          problems.push(problem(
            statement,
            "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001",
            "The source import attribute must exactly match the runtime-module manifest entry."
          ));
          continue;
        }
        usedManifestEntries.add(manifestEntry);
        requests.push({
          kind: "external",
          statement,
          runtimeSpecifier: manifestEntry.runtimeSpecifier,
          importType: manifestEntry.importType,
          manifestEntry
        });
        continue;
      }

      if (diskFile) {
        problems.push(problem(
          statement,
          "TS2HX-MODULES-SIDE-EFFECT-IMPORT-EXTERNAL-RELATIVE-001",
          `External relative runtime file ${JSON.stringify(moduleSpecifier)} requires a hash-pinned runtime-module manifest entry.`
        ));
      } else {
        problems.push(problem(
          statement,
          "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNRESOLVED-001",
          `Relative runtime import ${JSON.stringify(moduleSpecifier)} cannot be resolved.`
        ));
      }
    }

    if (runtimeImports.length > 0 || problems.length > 0) {
      bySourceFile.set(path.resolve(sourceFile.fileName), {
        occurrences: runtimeImports.map((occurrence) => occurrence.statement),
        requests,
        problems
      });
    }
  }

  const stagedByPath = new Map<string, { hash: string; file: EmittedFile }>();
  const dispositions: RuntimeModuleDisposition[] = [];
  for (const entry of Array.from(usedManifestEntries).sort((a, b) =>
    a.importer.localeCompare(b.importer) || a.specifier.localeCompare(b.specifier)
  )) {
    const importer = opts.sourceFiles.find(
      (sourceFile) => portablePath(path.relative(opts.rootDir, sourceFile.fileName)) === entry.importer
    );
    if (!importer)
      throw new Error(`Runtime-module manifest importer is not in the conversion set: ${entry.importer}.`);

    const importerOutput = portablePath(sourceOutputRelativeFile(opts, importer));
    const importerDirectory = path.posix.dirname(importerOutput);
    const runtimeTarget = path.posix.normalize(path.posix.join(importerDirectory, entry.runtimeSpecifier));
    const stagedTarget = path.posix.normalize(path.posix.join(importerDirectory, entry.stagedPath));
    if (runtimeTarget !== stagedTarget)
      throw new Error(
        `Runtime-module staging mismatch for ${entry.importer} ${entry.specifier}: ` +
        `${entry.runtimeSpecifier} resolves to ${runtimeTarget}, not ${stagedTarget}.`
      );
    if (stagedTarget === ".." || stagedTarget.startsWith("../") || path.posix.isAbsolute(stagedTarget))
      throw new Error(`Runtime-module staged path escapes the output tree: ${stagedTarget}.`);

    const filePath = path.resolve(opts.outDir, ...stagedTarget.split("/"));
    const prior = stagedByPath.get(stagedTarget);
    if (prior && prior.hash !== entry.sha256)
      throw new Error(`Runtime modules with different hashes target the same staged file: ${stagedTarget}.`);
    if (!prior) {
      stagedByPath.set(stagedTarget, {
        hash: entry.sha256,
        file: { filePath, content: fs.readFileSync(entry.sourceFile) }
      });
    }
    dispositions.push({
      importer: entry.importer,
      specifier: entry.specifier,
      runtimeSpecifier: entry.runtimeSpecifier,
      importType: entry.importType,
      source: entry.source,
      stagedFile: stagedTarget,
      owner: entry.owner,
      sha256: entry.sha256
    });
  }

  return {
    bySourceFile,
    targetBySourceFile,
    packageBindingsByStatement,
    packageExternStatements,
    stagedFiles: Array.from(stagedByPath.values(), (value) => value.file)
      .sort((a, b) => a.filePath.localeCompare(b.filePath)),
    dispositions
  };
}

/**
 * Applies the request-free standard-Haxe capability boundary before emission.
 *
 * Why: a normal Haxe JS compilation cannot consume compiler-owned ESM request
 * carriers or promise their initialization order. Assisted scaffolding is not
 * allowed to turn that missing compiler capability into an executable claim.
 *
 * What: only the first effective runtime request receives the stable target
 * diagnostic, selected independently of TypeScript Program iteration order.
 * Genes profiles keep the existing semantic request plan unchanged.
 *
 * How: the immutable TypeScript provenance is matched back to its original
 * `ImportDeclaration`, then added as a forced error to the normal per-file
 * plan. Rendering may collect other diagnostics, but the transaction status is
 * always failed and no staged Haxe or runtime resource is published.
 */
function applyRuntimeProfileBoundary(
  opts: EmitHaxeOptions,
  inventory: EffectiveModuleRequestInventory,
  plan: ProjectRuntimeImportPlan
): ProjectRuntimeImportPlan {
  if (opts.runtimeProfile !== "standard-haxe-js") return plan;
  const firstRequest = firstEffectiveRuntimeRequest(opts, inventory);
  if (!firstRequest) return plan;

  const sourceFile = opts.sourceFiles.find(
    source => path.resolve(source.fileName) === path.resolve(firstRequest.sourceFile)
  );
  const statement = sourceFile?.statements.find((node): node is ts.ImportDeclaration =>
    ts.isImportDeclaration(node)
    && node.getStart(sourceFile) === firstRequest.sourceStart
    && node.getEnd() === firstRequest.sourceEnd
  );
  if (!sourceFile || !statement) {
    throw new Error(
      `Could not recover the first effective request at ${firstRequest.sourceFile}:${firstRequest.sourceStart}`
    );
  }

  const sourceKey = path.resolve(sourceFile.fileName);
  const existing = plan.bySourceFile.get(sourceKey) ?? {
    occurrences: [statement],
    requests: [],
    problems: []
  };
  const bySourceFile = new Map(plan.bySourceFile);
  bySourceFile.set(sourceKey, {
    occurrences: existing.occurrences,
    requests: existing.requests,
    problems: [{
      statement,
      id: "TS2HX-MODULES-ESM-RUNTIME-TARGET-001",
      message:
        `Configured TypeScript emit retains runtime module request ${JSON.stringify(firstRequest.specifier)}; `
        + "the standard-haxe-js profile cannot preserve its ESM initialization contract.",
      remediation:
        "Select --runtime-profile genes-esm and compile with classic Genes or genes-ts, "
        + "or remove the effective runtime request from configured TypeScript emit.",
      forceError: true
    }, ...existing.problems]
  });
  return { ...plan, bySourceFile };
}

/**
 * Converts one source file without mutating the output tree.
 *
 * Every input receives an explicit disposition. Unsupported lowering returns a
 * diagnostic tied to the nearest top-level source node plus optional assisted
 * scaffolding; callers decide whether that scaffold may be committed. This
 * separation is the fail-closed boundary that prevents a printer-level `null`
 * from silently becoming a successful project conversion.
 */
function emitHaxeSourceFile(
  opts: EmitHaxeOptions,
  sf: ts.SourceFile,
  semanticRecorder: SemanticRecorder,
  runtimeImportPlan: SourceRuntimeImportPlan | null,
  runtimeTargetPlan: ConvertedRuntimeTargetPlan | null
): SourceEmitOutcome {
  const absFile = sf.fileName;
  if (absFile.endsWith(".d.ts")) return { kind: "declaration-only" };
  if (!(absFile.endsWith(".ts") || absFile.endsWith(".tsx") || absFile.endsWith(".js") || absFile.endsWith(".jsx"))) {
    return {
      kind: "unsupported",
      emitted: null,
      diagnostics: [
        translationDiagnostic(opts, sf, sf, {
          id: "TS2HX-FILE-KIND-001",
          category: "file",
          message: `Unsupported source-file extension: ${path.extname(absFile) || "(none)"}.`,
          outputFile: null
        })
      ]
    };
  }

  const relToRoot = path.relative(opts.rootDir, absFile);
  const relDir = path.dirname(relToRoot);
  const fileBase = path.basename(relToRoot).replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
  const moduleName = toHaxeModuleName(fileBase);

  const basePackageDirs = opts.basePackage.split(".").filter((p) => p.length > 0);
  const outRelFile = path.join(...basePackageDirs, relDir, `${moduleName}.hx`);
  const outAbsFile = path.resolve(opts.outDir, outRelFile);
  const portableOutFile = portablePath(outRelFile);

  const packageSegments = relDir === "." ? [] : relDir.split(path.sep).filter((p) => p.length > 0);
  const packagePath = toHaxePackagePath([opts.basePackage, ...packageSegments]);

  const out: string[] = [];
  out.push(`package ${packagePath};`);
  out.push("");
  const fileDiagnostics: TranslationDiagnostic[] = [];

  function recordUnsupported(node: ts.Node, message: string,
      category: TranslationDiagnostic["semanticCategory"] = "declaration",
      id = "TS2HX-UNSUPPORTED-LOWERING-001",
      remediation?: string,
      forceError = false): TranslationDiagnostic {
    const diagnostic = translationDiagnostic(opts, sf, node, {
      id,
      category,
      message,
      outputFile: portableOutFile,
      remediation,
      forceError
    });
    if (out[out.length - 1] !== "")
      out.push("");
    out.push(
      `// ${diagnostic.id}: assisted output omitted ${diagnostic.syntaxKind} at ` +
      `${diagnostic.source.file}:${diagnostic.source.line}:${diagnostic.source.column}.`
    );
    fileDiagnostics.push(diagnostic);
    return diagnostic;
  }

  function unsupported(node: ts.Node, message: string,
      category: TranslationDiagnostic["semanticCategory"] = "declaration"): SourceEmitOutcome {
    if (ctx.semanticFailures.length > 0) recordSemanticFailures();
    else recordUnsupported(node, message, category);
    return {
      kind: "unsupported",
      emitted: { filePath: outAbsFile, content: out.join("\n").trimEnd() + "\n" },
      diagnostics: fileDiagnostics
    };
  }

  const sourceFilePath = portablePath(path.relative(opts.rootDir, sf.fileName));
  const ctx: EmitContext = {
    checker: opts.checker,
    identifierRewrites: new Map(),
    tmpCounter: 0,
    sourceFile: sf,
    sourceFilePath,
    semanticRecorder,
    semanticFailures: [],
    expressionRewrites: new Map(),
    completionPlan: planSourceCompletions(sf, sourceFilePath, opts.checker),
    functionState: null,
    completionAbruptTypeName: null
  };

  function recordSemanticFailures(): void {
    for (const failure of ctx.semanticFailures) {
      const id = `TS2HX-${failure.featureId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-001`;
      recordUnsupported(failure.node, failure.message, failure.category, id);
    }
    ctx.semanticFailures.length = 0;
  }

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause) {
        recordSemantic(ctx, "modules.side-effect-import", statement);
      } else {
        recordSemantic(ctx, "modules.esm-bindings", statement);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement))
      recordSemantic(ctx, "modules.esm-bindings", statement);
  }

  // Runtime requests are a separate semantic contract from the source binding
  // surface. Record the exact post-TypeScript-transform occurrences, including
  // requests whose resolution later fails, so elided/type-only declarations do
  // not accidentally inherit a Genes initialization claim.
  for (const statement of runtimeImportPlan?.occurrences ?? [])
    recordSemantic(ctx, "modules.esm-runtime-requests", statement);
  for (const runtimeProblem of runtimeImportPlan?.problems ?? [])
    recordSemantic(ctx, "modules.esm-runtime-requests", runtimeProblem.statement);

  for (const runtimeProblem of runtimeImportPlan?.problems ?? []) {
    recordUnsupported(
      runtimeProblem.statement,
      runtimeProblem.message,
      "module",
      runtimeProblem.id,
      runtimeProblem.remediation,
      runtimeProblem.forceError
    );
  }

  const imports = collectImports(sf);
  const importLines: string[] = [];
  const externalTypeAliases: string[] = [];
  for (const imp of imports) {
    if (isRelativeModuleSpecifier(imp.moduleSpecifier)) {
      const target = moduleTargetFromImport(
        { projectDir: opts.projectDir, rootDir: opts.rootDir, fromFile: absFile, basePackage: opts.basePackage },
        imp.moduleSpecifier
      );

      const moduleBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;

      if (imp.defaultImport) {
        importLines.push(`import ${moduleBase}.__default as ${imp.defaultImport};`);
      }
      if (imp.namespaceImport) {
        ctx.identifierRewrites.set(imp.namespaceImport, moduleBase);
      }

      for (const { name, alias } of imp.named) {
        const effectiveName = alias ?? name;
        if (isLikelyTypeName(effectiveName)) {
          const typeImport =
            effectiveName === target.moduleName
              ? target.packagePath.length > 0
                ? `${target.packagePath}.${effectiveName}`
                : effectiveName
              : `${moduleBase}.${effectiveName}`;
          importLines.push(alias ? `import ${typeImport} as ${name};` : `import ${typeImport};`);
        } else {
          importLines.push(alias ? `import ${moduleBase}.${effectiveName} as ${name};` : `import ${moduleBase}.${effectiveName};`);
        }
      }
      continue;
    }

    // Non-relative module specifiers: rewrite identifiers to generated extern modules.
    const externPackage = toHaxePackagePath([opts.basePackage, "extern"]);
    const externModuleName = externModuleNameFromSpecifier(imp.moduleSpecifier);
    const moduleBase = `${externPackage}.${externModuleName}`;

    if (imp.moduleSpecifier === "react") {
      for (const { name, alias, isTypeOnly } of imp.named) {
        if (!imp.isTypeOnly && !isTypeOnly) continue;
        const localName = alias ?? name;
        if (name === "ReactElement")
          externalTypeAliases.push(`typedef ${localName} = genes.react.Element;`);
        else if (name === "MouseEvent")
          externalTypeAliases.push(`typedef ${localName}<T> = genes.react.MouseEvent<T>;`);
      }
    }

    if (imp.isTypeOnly) continue;

    if (imp.namespaceImport) ctx.identifierRewrites.set(imp.namespaceImport, moduleBase);
    if (imp.defaultImport) ctx.identifierRewrites.set(imp.defaultImport, `${moduleBase}.__default`);
    for (const { name, alias, isTypeOnly } of imp.named) {
      if (isTypeOnly) continue;
      const exportedName = alias ?? name;
      const field = externFieldForExportName(exportedName);
      ctx.identifierRewrites.set(name, `${moduleBase}.${field.hxName}`);
    }
  }

  if (importLines.length > 0) {
    out.push(...importLines);
    out.push("");
  }
  if (externalTypeAliases.length > 0) {
    out.push(...externalTypeAliases);
    out.push("");
  }

  if (runtimeTargetPlan) {
    out.push("/**");
    out.push(" * Compiler-internal converted-module retention target.");
    out.push(" * Importing request carriers type this field under full Haxe DCE; Genes");
    out.push(" * resolves its module identity and erases the field from all outputs.");
    out.push(" */");
    out.push("@:keep");
    out.push("@:noCompletion");
    out.push("@:genes.compilerInternal");
    out.push(`final ${runtimeTargetPlan.markerName} = true;`);
    out.push("");
  }

  if (runtimeImportPlan && runtimeImportPlan.requests.length > 0) {
    const usedNames = new Set(collectLocalDeclarationKinds(sf).keys());
    for (const imp of imports) {
      if (imp.defaultImport) usedNames.add(imp.defaultImport);
      if (imp.namespaceImport) usedNames.add(imp.namespaceImport);
      for (const named of imp.named) usedNames.add(named.name);
    }
    let carrierName = "__ts2hx_requests";
    let suffix = 2;
    while (usedNames.has(carrierName)) {
      carrierName = `__ts2hx_requests${suffix}`;
      suffix++;
    }

    out.push("/**");
    out.push(" * Compiler-internal ordered ESM request carrier.");
    out.push(" * @:keep retains typed anchors through full Haxe DCE; the Genes planner");
    out.push(" * consumes every marker and erases this field from JS, TS, and declarations.");
    out.push(" */");
    out.push("@:keep");
    out.push("@:noCompletion");
    out.push("@:genes.compilerInternal");
    out.push(`final ${carrierName} = {`);
    for (const request of runtimeImportPlan.requests) {
      if (request.kind === "external") {
        const attribute = request.importType === null ? "null" : JSON.stringify(request.importType);
        out.push(
          `  genes.internal.EsmRequestFact.external(${JSON.stringify(request.runtimeSpecifier)}, ${attribute});`
        );
      } else {
        out.push(`  genes.internal.EsmRequestFact.internal(${request.anchor});`);
      }
    }
    out.push("  true;");
    out.push("};");
    out.push("");
  }

  const exportFroms = collectExportFroms(sf);
  const reexported = new Set<string>();
  for (const exp of exportFroms) {
    if (!isRelativeModuleSpecifier(exp.moduleSpecifier)) continue;

    const target = moduleTargetFromImport(
      { projectDir: opts.projectDir, rootDir: opts.rootDir, fromFile: absFile, basePackage: opts.basePackage },
      exp.moduleSpecifier
    );
    const moduleBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;
    const srcFile = resolveRelativeSourceFile(opts.program, absFile, exp.moduleSpecifier);
    const kinds = srcFile ? collectExportKinds(srcFile) : null;

    if (exp.kind === "named") {
      for (const { exported, source } of exp.elements) {
        const hxSource = source === "default" ? "__default" : source;
        const ref = `${moduleBase}.${hxSource}`;
        const kind =
          hxSource === "__default"
            ? "value"
            : (kinds?.get(source) ?? (isLikelyTypeName(exported) ? "type" : "value"));
        if (kind === "type") out.push(`typedef ${exported} = ${ref};`);
        else out.push(`final ${exported} = ${ref};`);
        reexported.add(exported);
      }
      out.push("");
      continue;
    }

    // export * from "./x"
    if (!srcFile) {
      const exportNode = sf.statements.find((stmt) =>
        ts.isExportDeclaration(stmt)
        && stmt.moduleSpecifier !== undefined
        && ts.isStringLiteral(stmt.moduleSpecifier)
        && stmt.moduleSpecifier.text === exp.moduleSpecifier
      ) ?? sf;
      return unsupported(
        exportNode,
        `Cannot resolve re-exported source module ${JSON.stringify(exp.moduleSpecifier)}.`,
        "module"
      );
    }

    for (const [name, kind] of collectExportKinds(srcFile).entries()) {
      if (reexported.has(name)) continue;
      const ref = `${moduleBase}.${name}`;
      if (kind === "type") out.push(`typedef ${name} = ${ref};`);
      else out.push(`final ${name} = ${ref};`);
      reexported.add(name);
    }
    out.push("");
  }

  const localExports = collectLocalExports(sf);
  const localDeclKinds = collectLocalDeclarationKinds(sf);
  const localClassNames = new Set(
    sf.statements
      .filter((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && !!s.name)
      .map((s) => (s.name as ts.Identifier).text)
  );
  const generatedTopLevelTypeNames = new Set(localDeclKinds.keys());
  for (const imp of imports) {
    if (imp.defaultImport) generatedTopLevelTypeNames.add(imp.defaultImport);
    if (imp.namespaceImport) generatedTopLevelTypeNames.add(imp.namespaceImport);
    for (const named of imp.named) generatedTopLevelTypeNames.add(named.name);
  }

  function uniqueTopLevelTypeName(base: string): string {
    let name = base;
    let i = 2;
    while (generatedTopLevelTypeNames.has(name)) {
      name = `${base}${i}`;
      i++;
    }
    generatedTopLevelTypeNames.add(name);
    return name;
  }

  if (sourceNeedsCompletionType(ctx.completionPlan)) {
    const abruptType = uniqueTopLevelTypeName("__Ts2hxFinallyAbrupt");
    ctx.completionAbruptTypeName = abruptType;
    out.push("/**");
    out.push(" * Compiler-internal abrupt completion for translated try/finally.");
    out.push(" *");
    out.push(" * Why: a source return, break, or continue cannot directly leave the");
    out.push(" * synthetic callbacks used to run a finalizer exactly once.");
    out.push(" * What: null represents normal callback completion; enum values carry only");
    out.push(" * the typed transfer that still belongs to an enclosing source target.");
    out.push(" * How: genes.js.FinallyCompletion applies finalizer precedence, then ts2hx");
    out.push(" * statically dispatches or propagates the result. Host throws stay throws.");
    out.push(" * Genes keeps this type local to implementation and omits declarations,");
    out.push(" * runtime registration, public exports, and source mappings.");
    out.push(" */");
    out.push("@:genes.compilerInternal");
    out.push(`private enum ${abruptType}<T> {`);
    out.push("  ReturnValue(value:T);");
    out.push("  ReturnVoid;");
    out.push("  BreakTo(target:Int);");
    out.push("  ContinueTo(target:Int);");
    out.push("}");
    out.push("");
  }

  const asyncHelperFields: string[] = [];
  let asyncHelperName: string | null = null;
  function ensureAsyncHelper(): string {
    if (asyncHelperName) return asyncHelperName;
    asyncHelperName = uniqueTopLevelTypeName("__Ts2hxAsync");
    return asyncHelperName;
  }

  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = emitExpression(ctx, stmt.expression);
      if (!expr)
        return unsupported(stmt, "Default export expression cannot be preserved.", "expression");
      if (runtimeTargetPlan) out.push("@:keep");
      out.push(`final __default = ${expr};`);
      out.push("");
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      // TS module-private declarations can be dependencies of exported code.
      // Haxe module-level fields retain that source-file ownership boundary, so
      // preserve them instead of leaving dangling identifiers in exported bodies.

      const declKeyword = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "final" : "var";
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name))
          return unsupported(stmt, "Top-level destructuring declarations are not supported.");
        if (!decl.initializer)
          return unsupported(stmt, "Uninitialized top-level declarations are not supported.");
        const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
        const isAsyncInit =
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          (decl.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false);

        if (isAsyncInit) {
          return unsupported(
            stmt,
            "Async function-valued variables need call-time forwarding and are not yet supported; use a function declaration.",
            "declaration"
          );
        } else {
          const init = emitExpression(ctx, decl.initializer);
          if (!init)
            return unsupported(stmt, "Top-level initializer cannot be preserved.", "expression");
          // A target marker types this Haxe module but a pure read from that
          // marker does not retain sibling fields under `-dce full`. Explicitly
          // keep translated initializers because they are the supported
          // top-level statements whose evaluation a bare ESM request observes.
          if (runtimeTargetPlan) out.push("@:keep");
          out.push(`${declKeyword} ${decl.name.text}${typeSuffix} = ${init};`);
        }
      }
      out.push("");
      continue;
    }

    if (ts.isFunctionDeclaration(stmt)) {
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      // Preserve module-private helpers referenced by exported declarations.

      const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

      if (isAsync) {
        recordSemantic(ctx, "async.await", stmt);
        const helper = ensureAsyncHelper();
        if (isDefault && !stmt.name) {
          const fnExpr = emitAnonFunctionLike({
            node: stmt,
            parameters: stmt.parameters,
            returnType: stmt.type,
            body: stmt.body,
            ctx
          });
          if (!fnExpr)
            return unsupported(stmt, "Anonymous default async function cannot be preserved.");
          asyncHelperFields.push(`  public static final __default = @:async ${fnExpr};`);
          const forwarder = emitAsyncForwarder({
            name: "__default",
            helperName: helper,
            helperField: "__default",
            parameters: stmt.parameters,
            returnType: stmt.type
          });
          if (!forwarder)
            return unsupported(stmt, "Anonymous default async forwarding signature cannot be preserved.");
          out.push(forwarder);
        } else {
          if (!stmt.name)
            return unsupported(stmt, "Async function declaration has no usable name.");
          const name = stmt.name.text;
          const fnExpr = emitAnonFunctionLike({
            node: stmt,
            parameters: stmt.parameters,
            returnType: stmt.type,
            body: stmt.body,
            ctx
          });
          if (!fnExpr)
            return unsupported(stmt, "Async function body cannot be preserved.", "control-flow");
          asyncHelperFields.push(`  public static final ${name} = @:async ${fnExpr};`);
          const forwarder = emitAsyncForwarder({
            name,
            helperName: helper,
            helperField: name,
            parameters: stmt.parameters,
            returnType: stmt.type
          });
          if (!forwarder)
            return unsupported(stmt, "Async forwarding signature cannot be preserved.");
          out.push(forwarder);
          if (isDefault) out.push(`final __default = ${name};`);
        }
      } else if (isDefault && !stmt.name) {
        const params = stmt.parameters.map((p) => {
          const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
          const isOptional = !!p.questionToken;
          const type = emitType(p.type);
          return `${isOptional ? "?" : ""}${id}: ${type}`;
        });

        if (!stmt.body)
          return unsupported(stmt, "Ambient default function has no implementation.");
        type DefaultFunctionResult = {
          fn: string | null;
          message: string;
          category: TranslationDiagnostic["semanticCategory"];
        };
        const defaultFunction = withFunctionEmitState<DefaultFunctionResult>(ctx, stmt, () => {
          if (!validateCompletionFunction(ctx)) {
            return {
              fn: null,
              message: "Default function completion cannot be preserved.",
              category: "control-flow"
            };
          }
          if (stmt.body?.statements.length === 1
            && ts.isReturnStatement(stmt.body.statements[0])) {
            const ret = stmt.body.statements[0] as ts.ReturnStatement;
            if (!ret.expression) {
              return {
                fn: null,
                message: "Default function's bare return cannot be preserved.",
                category: "control-flow"
              };
            }
            const retExpr = emitExpression(ctx, ret.expression);
            if (!retExpr) {
              return {
                fn: null,
                message: "Default function return expression cannot be preserved.",
                category: "expression"
              };
            }
            return {
              fn: `function(${params.join(", ")}) return ${retExpr}`,
              message: "",
              category: "declaration"
            };
          }
          const body = emitStatements(ctx, stmt.body?.statements ?? [], "  ");
          if (body == null) {
            return {
              fn: null,
              message: "Default function control flow cannot be preserved.",
              category: "control-flow"
            };
          }
          return {
            fn: `function(${params.join(", ")}) {\n${body}\n}`,
            message: "",
            category: "declaration"
          };
        });
        if (!defaultFunction.fn) {
          return unsupported(
            stmt,
            defaultFunction.message,
            defaultFunction.category
          );
        }

        out.push(`final __default = ${defaultFunction.fn};`);
      } else {
        const emitted = emitFunction(ctx, stmt);
        if (!emitted)
          return unsupported(stmt, "Function signature or body cannot be preserved.", "control-flow");
        out.push(emitted);
        if (isDefault) {
          if (!stmt.name)
            return unsupported(stmt, "Default function declaration has no usable name.");
          out.push(`final __default = ${stmt.name.text};`);
        }
      }
      out.push("");
      continue;
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      out.push(emitTypeAlias(stmt));
      out.push("");
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      out.push(emitInterface(stmt));
      out.push("");
      continue;
    }

    if (ts.isEnumDeclaration(stmt)) {
      out.push(emitEnum(stmt));
      out.push("");
      continue;
    }

    if (ts.isClassDeclaration(stmt)) {
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      if (isDefault && !stmt.name) {
        const generatedName = uniqueTopLevelTypeName("DefaultExport");
        const emitted = emitClass(ctx, stmt, generatedName);
        if (!emitted)
          return unsupported(stmt, "Anonymous default class cannot be preserved.");
        out.push(emitted);
        out.push(`final __default = ${generatedName};`);
      } else {
        const emitted = emitClass(ctx, stmt);
        if (!emitted)
          return unsupported(stmt, "Class declaration cannot be preserved.");
        out.push(emitted);
        if (isDefault) {
          if (!stmt.name)
            return unsupported(stmt, "Default class declaration has no usable name.");
          out.push(`final __default = ${stmt.name.text};`);
        }
      }
      out.push("");
      continue;
    }

    // Import/export declarations were already converted into Haxe imports,
    // aliases, or re-exports above. Empty statements are semantically inert.
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt) || ts.isEmptyStatement(stmt))
      continue;

    recordUnsupported(
      stmt,
      `Unsupported top-level ${ts.SyntaxKind[stmt.kind] ?? `SyntaxKind(${stmt.kind})`} would otherwise be omitted.`,
      ts.isExpressionStatement(stmt) ? "expression" : "module"
    );
  }

  if (asyncHelperFields.length > 0) {
    const helper = ensureAsyncHelper();
    out.push(`private class ${helper} {`);
    out.push(...asyncHelperFields);
    out.push(`}`);
    out.push("");
  }

  if (localExports.length > 0) {
    const emitted = new Set<string>();
    for (const exp of localExports) {
      const exportedHx = exp.exported === "default" ? "__default" : exp.exported;
      const sourceHx = exp.source === "default" ? "__default" : exp.source;

      if (exportedHx === "__default" && sourceHx === "__default") continue;
      if (exportedHx === sourceHx && exportedHx !== "__default") continue;
      if (emitted.has(exportedHx)) continue;
      emitted.add(exportedHx);

      const kind: ExportKind =
        exp.isTypeOnly ? "type" : (localDeclKinds.get(exp.source) ?? (isLikelyTypeName(exp.exported) ? "type" : "value"));

      if (exportedHx === "__default") {
        out.push(`final __default = ${sourceHx};`);
        out.push("");
        continue;
      }

      if (kind === "type") out.push(`typedef ${exportedHx} = ${sourceHx};`);
      else if (kind === "both") {
        // Haxe does not allow emitting a type alias and a value alias with the same identifier in a module.
        // For local classes, approximate TS' "type+value" export by generating a thin subclass.
        // (This preserves a usable type and a usable runtime value, but is not a perfect alias.)
        if (localClassNames.has(exp.source)) out.push(`class ${exportedHx} extends ${sourceHx} {}`);
        else out.push(`final ${exportedHx} = ${sourceHx};`);
      } else out.push(`final ${exportedHx} = ${sourceHx};`);
      out.push("");
    }
  }

  const emitted = { filePath: outAbsFile, content: out.join("\n").trimEnd() + "\n" };
  return fileDiagnostics.length > 0
    ? { kind: "unsupported", emitted, diagnostics: fileDiagnostics }
    : { kind: "emitted", emitted };
}

let outputTransactionId = 0;

function removeTree(absPath: string): void {
  if (fs.existsSync(absPath))
    fs.rmSync(absPath, { recursive: true, force: true });
}

/**
 * Commits a complete generated tree with a same-directory rename transaction.
 *
 * Planning and rendering happen before this function is called. Files are first
 * written to a sibling staging directory; the prior tree is moved to a backup,
 * the stage is renamed into place, and any failed swap restores the backup.
 * Thus strict translation failures and mid-write exceptions cannot leave a mix
 * of stale and newly generated modules behind.
 */
function commitOutputTree(opts: EmitHaxeOptions, files: EmittedFile[]): string[] {
  const outDir = path.resolve(opts.outDir);
  const parent = path.dirname(outDir);
  const name = path.basename(outDir);
  const transaction = `${process.pid}-${outputTransactionId++}`;
  const stageDir = path.join(parent, `.${name}.ts2hx-stage-${transaction}`);
  const backupDir = path.join(parent, `.${name}.ts2hx-backup-${transaction}`);

  removeTree(stageDir);
  removeTree(backupDir);
  fs.mkdirSync(parent, { recursive: true });

  try {
    if (!opts.cleanOutDir && fs.existsSync(outDir))
      fs.cpSync(outDir, stageDir, { recursive: true });
    else
      fs.mkdirSync(stageDir, { recursive: true });

    for (const emitted of files) {
      const relative = path.relative(outDir, emitted.filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error(`Refusing to emit outside output directory: ${emitted.filePath}`);
      const stagedPath = path.join(stageDir, relative);
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.writeFileSync(stagedPath, emitted.content);
    }

    const hadPriorTree = fs.existsSync(outDir);
    if (hadPriorTree)
      fs.renameSync(outDir, backupDir);
    try {
      fs.renameSync(stageDir, outDir);
    } catch (error) {
      if (hadPriorTree && fs.existsSync(backupDir))
        fs.renameSync(backupDir, outDir);
      throw error;
    }
    removeTree(backupDir);
  } catch (error) {
    removeTree(stageDir);
    if (!fs.existsSync(outDir) && fs.existsSync(backupDir))
      fs.renameSync(backupDir, outDir);
    throw error;
  }

  return files.map((emitted) => path.resolve(emitted.filePath));
}

function compareDiagnostics(a: TranslationDiagnostic, b: TranslationDiagnostic): number {
  return a.source.file.localeCompare(b.source.file)
    || a.source.start - b.source.start
    || a.id.localeCompare(b.id);
}

/**
 * Plans, validates, and transactionally emits a TypeScript project as Haxe.
 *
 * Strict mode is fail closed: any unsupported file or declaration produces a
 * deterministic manifest, writes no files, and preserves the previous output
 * tree byte-for-byte. Assisted mode may commit partial scaffolding, but every
 * loss is marked in both the generated source and `ts2hx-manifest.json`.
 *
 * Before source rendering, the configured TypeScript transform supplies the
 * effective request inventory and exact compiler facts stored in schema v3.
 * `genes-esm` records the runtime capability required by retained requests;
 * `standard-haxe-js` rejects the first such request before the transaction can
 * commit. This plan-first order keeps diagnostics, manifests, Haxe, and staged
 * runtime resources one atomic contract.
 */
export function emitProjectToHaxe(rawOpts: EmitHaxeOptions): EmitHaxeResult {
  const opts: EmitHaxeOptions = { ...rawOpts, mode: rawOpts.mode ?? "strict-js" };
  const mode = opts.mode ?? "strict-js";
  const files: EmittedFile[] = [];
  const diagnostics: TranslationDiagnostic[] = [];
  const dispositions: TranslationFileDisposition[] = [];
  const semanticRecorder = new SemanticRecorder();
  const effectiveRequests = inspectEffectiveModuleRequests(opts.program, opts.sourceFiles);
  const compiler = typeScriptCompilerFacts(opts.program, opts.projectDir);
  const moduleRequests = manifestModuleRequests(opts, effectiveRequests);
  const requiredCompilerCapabilities: RequiredCompilerCapability[] = moduleRequests.some(
    request => request.disposition === "runtime-request"
  ) ? ["genes.esm-runtime-requests"] : [];
  const runtimeImportProjectPlan = applyRuntimeProfileBoundary(
    opts,
    effectiveRequests,
    buildProjectRuntimeImportPlan(opts, effectiveRequests)
  );

  files.push(...runtimeImportProjectPlan.stagedFiles);

  const externs = buildExternModules(
    opts,
    runtimeImportProjectPlan.packageBindingsByStatement,
    runtimeImportProjectPlan.packageExternStatements
  );
  for (const ex of Array.from(externs.values()).sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier)))
    files.push(emitExternModuleFile(opts, ex));

  for (const sf of opts.sourceFiles.slice().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    const outcome = emitHaxeSourceFile(
      opts,
      sf,
      semanticRecorder,
      runtimeImportProjectPlan.bySourceFile.get(path.resolve(sf.fileName)) ?? null,
      runtimeImportProjectPlan.targetBySourceFile.get(path.resolve(sf.fileName)) ?? null
    );
    const sourceFile = portablePath(path.relative(opts.rootDir, sf.fileName));
    if (outcome.kind === "declaration-only") {
      dispositions.push({ sourceFile, status: "declaration-only", outputFile: null, diagnosticIds: [] });
      continue;
    }
    if (outcome.kind === "emitted") {
      files.push(outcome.emitted);
      dispositions.push({
        sourceFile,
        status: "emitted",
        outputFile: portablePath(path.relative(opts.outDir, outcome.emitted.filePath)),
        diagnosticIds: []
      });
      continue;
    }

    diagnostics.push(...outcome.diagnostics);
    if (mode === "assisted" && outcome.emitted)
      files.push(outcome.emitted);
    dispositions.push({
      sourceFile,
      status: "unsupported",
      outputFile: outcome.emitted
        ? portablePath(path.relative(opts.outDir, outcome.emitted.filePath))
        : null,
      diagnosticIds: Array.from(new Set(outcome.diagnostics.map((diagnostic) => diagnostic.id))).sort()
    });
  }

  diagnostics.sort(compareDiagnostics);
  dispositions.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));
  // Assisted mode may publish only diagnostics explicitly graded as losses.
  // A planner marks non-scaffoldable boundaries as errors with `forceError`;
  // checking severity here keeps that contract generic instead of hard-coding
  // the first target-capability diagnostic that needed it.
  const hasForcedFailure = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const status: TranslationManifest["status"] = hasForcedFailure
    ? "failed"
    : diagnostics.length === 0
      ? "success"
      : mode === "assisted" ? "assisted" : "failed";
  const plannedFiles = files
    .map((emitted) => portablePath(path.relative(opts.outDir, emitted.filePath)))
    .sort((a, b) => a.localeCompare(b));
  const manifest: TranslationManifest = {
    schemaVersion: 3,
    mode,
    status,
    basePackage: opts.basePackage,
    targetProfile: opts.runtimeProfile,
    compiler,
    requiredCompilerCapabilities,
    moduleRequests,
    plannedFiles,
    files: dispositions,
    diagnostics,
    runtimeModules: runtimeImportProjectPlan.dispositions.slice(),
    features: semanticRecorder.dispositions()
  };

  if (status === "failed") {
    return { status, writtenFiles: [], diagnostics, dispositions, manifest };
  }

  // A successful translation still needs evidence of which semantic contracts
  // it exercised. Keep the manifest beside every committed output tree; strict
  // failures remain transactional and are returned/written only on request.
  files.push({
    filePath: path.join(opts.outDir, "ts2hx-manifest.json"),
    content: `${JSON.stringify(manifest, null, 2)}\n`
  });

  const writtenFiles = commitOutputTree(opts, files);
  return { status, writtenFiles, diagnostics, dispositions, manifest };
}
