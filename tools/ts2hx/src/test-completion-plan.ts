import { deepStrictEqual, equal, ok } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "./typescript-api.js";
import {
  completionPlanMatchesLegacy,
  planSourceCompletions,
  planTry,
  type CompletionControlTargetPlan,
  type CompletionFinallyPlan,
  type CompletionTransferPlan,
  type FunctionCompletionPlan,
  type SourceCompletionPlan
} from "./semantic/ir.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");

const sourceText = `function localLoop(): void {
  try {
    while (true) {
      if (Date.now() > 0) continue;
      break;
    }
  } finally {}
}

function protectedReturn(): number {
  try {
    return 1;
  } finally {}
}

function finalizerReturn(): number {
  try {
    return 1;
  } finally {
    return 2;
  }
}

function catchReturn(): number {
  try {
    throw new Error("body");
  } catch {
    return 2;
  } finally {}
}

function nestedTarget(events: string[]): void {
  try {
    for (let i = 0; i < 2; i++) {
      try {
        if (i === 0) continue;
        break;
      } finally {
        events.push("inner");
      }
    }
    events.push("after-loop");
  } finally {
    events.push("outer");
  }
}

function outerTarget(): void {
  while (Date.now() > 0) {
    try {
      try {
        continue;
      } finally {}
    } finally {}
  }
}

function nestedFunction(): void {
  try {
    const inner = (): number => {
      return 1;
    };
    inner();
  } finally {}
}

function inferredCarrier() {
  try {
    return 1;
  } finally {}
}

function weakCarrier(): any {
  try {
    return 1;
  } finally {}
}

function undefinedCarrier(): number | undefined {
  try {
    return 1;
  } finally {}
}

export default function (): number {
  try {
    return 1;
  } finally {}
}

function switchTargets(): void {
  while (Date.now() > 0) {
    try {
      switch (Date.now()) {
        case 1:
          break;
        default:
          continue;
      }
    } finally {}
  }
}

async function asyncCarrier(): Promise<number> {
  try {
    return 1;
  } finally {}
}

function genericCarrier<T>(value: T): T {
  try {
    return value;
  } finally {}
}

class CompletionOwner {
  public constructor() {
    try {
      return;
    } finally {}
  }

  public method(): number {
    try {
      return 1;
    } finally {}
  }
}

function labeledTransfer(): void {
  outer: while (Date.now() > 0) {
    try {
      continue outer;
    } finally {}
  }
}
`;

function parseAndPlan(text: string, file = "completion-shadow.ts"): {
  sourceFile: ts.SourceFile;
  plan: SourceCompletionPlan;
} {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return { sourceFile, plan: planSourceCompletions(sourceFile, file) };
}

function namedFunction(plan: SourceCompletionPlan, name: string): FunctionCompletionPlan {
  const found = plan.functions.find((fn) => fn.name === name);
  ok(found, `completion plan contains function ${name}`);
  return found;
}

function targetForTransfer(fn: FunctionCompletionPlan,
    transfer: CompletionTransferPlan): CompletionControlTargetPlan {
  ok(transfer.targetId, `transfer ${transfer.id} has a target`);
  const target = fn.targets.find((candidate) => candidate.id === transfer.targetId);
  ok(target, `function ${fn.name} contains target ${transfer.targetId}`);
  return target;
}

function assertLegacyAgreement(plan: SourceCompletionPlan, context: string): number {
  let regions = 0;
  for (const fn of plan.functions) {
    for (const region of fn.finallyRegions) {
      regions++;
      const legacy = planTry(region.statement);
      equal(
        legacy.strategy === "unsupported-outer-transfer",
        region.legacyHasOuterTransfer,
        `${context}:${fn.name}:${region.id} records the current planTry result`
      );
      ok(region.shadowMatchesLegacy,
        `${context}:${fn.name}:${region.id} shadow crossing agrees with planTry`);
    }
  }
  ok(completionPlanMatchesLegacy(plan), `${context} has complete legacy agreement`);
  return regions;
}

/** Removes AST object identity so repeated plans can be compared exactly. */
function normalizedPlan(plan: SourceCompletionPlan): object {
  return {
    sourceFile: plan.sourceFile,
    functions: plan.functions.map((fn) => ({
      id: fn.id,
      name: fn.name,
      form: fn.form,
      returnTarget: fn.returnTarget.id,
      returnCarrier: fn.returnCarrier.kind === "unsupported"
        ? `${fn.returnCarrier.kind}:${fn.returnCarrier.reason}`
        : fn.returnCarrier.kind,
      exclusions: fn.exclusions,
      callbacks: fn.callbacks.map((callback) => ({
        id: callback.id,
        role: callback.role,
        parentPath: callback.parentPath,
        path: callback.path,
        source: callback.source
      })),
      targets: fn.targets.map((target) => ({
        id: target.id,
        kind: target.kind,
        ownerPath: target.ownerPath,
        loopKind: target.loopKind,
        continueStep: target.continueStep?.getText() ?? null,
        source: target.source
      })),
      transfers: fn.transfers.map((transfer) => ({
        id: transfer.id,
        kind: transfer.kind,
        targetId: transfer.targetId,
        sourcePath: transfer.sourcePath,
        targetPath: transfer.targetPath,
        crossedCallbacks: transfer.crossedCallbacks,
        disposition: transfer.disposition,
        unsupportedReason: transfer.unsupportedReason,
        source: transfer.source
      })),
      finallyRegions: fn.finallyRegions.map((region) => ({
        id: region.id,
        parentPath: region.parentPath,
        protectedCallback: region.protectedCallback.id,
        finalizerCallback: region.finalizerCallback.id,
        strategy: region.strategy,
        crossingTransfers: region.crossingTransfers,
        unsupportedTransfers: region.unsupportedTransfers,
        legacyHasOuterTransfer: region.legacyHasOuterTransfer,
        shadowMatchesLegacy: region.shadowMatchesLegacy,
        source: region.source
      })),
      needsModuleAbruptType: fn.needsModuleAbruptType,
      source: fn.source
    }))
  };
}

const first = parseAndPlan(sourceText);
const second = parseAndPlan(sourceText);
deepStrictEqual(normalizedPlan(first.plan), normalizedPlan(second.plan),
  "repeated same-process planning is deterministic");
assertLegacyAgreement(first.plan, "focused");

const checkerFixtureDir = path.join(toolRoot, ".tmp", "completion-plan-checker");
const checkerFixture = path.join(checkerFixtureDir, "alias.ts");
fs.rmSync(checkerFixtureDir, { recursive: true, force: true });
fs.mkdirSync(checkerFixtureDir, { recursive: true });
fs.writeFileSync(checkerFixture, `type MaybeNumber = number | undefined;
function aliasCarrier(): MaybeNumber {
  try {
    return 1;
  } finally {}
}
`, "utf8");
try {
  const checkerProgram = ts.createProgram([checkerFixture], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true
  });
  const checkerSource = checkerProgram.getSourceFile(checkerFixture);
  ok(checkerSource, "checker fixture source is available");
  const checkerPlan = planSourceCompletions(
    checkerSource,
    "completion-plan-checker/alias.ts",
    checkerProgram.getTypeChecker()
  );
  const aliasCarrier = namedFunction(checkerPlan, "aliasCarrier");
  equal(aliasCarrier.returnCarrier.kind, "unsupported");
  if (aliasCarrier.returnCarrier.kind === "unsupported")
    equal(aliasCarrier.returnCarrier.reason, "weak-return-type");
} finally {
  fs.rmSync(checkerFixtureDir, { recursive: true, force: true });
}

const localLoop = namedFunction(first.plan, "localLoop");
equal(localLoop.finallyRegions.length, 1);
equal(localLoop.finallyRegions[0]?.strategy, "finally-helper-local");
equal(localLoop.finallyRegions[0]?.crossingTransfers.length, 0);
for (const transfer of localLoop.transfers) {
  if (transfer.kind !== "break" && transfer.kind !== "continue") continue;
  equal(transfer.disposition, "direct");
  deepStrictEqual(transfer.crossedCallbacks, []);
  equal(targetForTransfer(localLoop, transfer).ownerPath.length, 1,
    "loop declared inside the protected callback owns local transfers");
}

const protectedReturn = namedFunction(first.plan, "protectedReturn");
equal(protectedReturn.returnCarrier.kind, "value");
equal(protectedReturn.finallyRegions[0]?.strategy, "finally-helper-completion");
const protectedTransfer = protectedReturn.transfers.find((transfer) =>
  transfer.kind === "return-value");
ok(protectedTransfer);
equal(protectedTransfer.disposition, "encode");
deepStrictEqual(protectedTransfer.targetPath, []);
deepStrictEqual(protectedTransfer.crossedCallbacks,
  [protectedReturn.finallyRegions[0]?.protectedCallback.id]);
equal(
  first.sourceFile.text.slice(
    protectedTransfer.source.start,
    protectedTransfer.source.end
  ),
  "return 1;",
  "transfer provenance identifies the original statement"
);

const finalizerReturn = namedFunction(first.plan, "finalizerReturn");
const finalizerRegion = finalizerReturn.finallyRegions[0];
ok(finalizerRegion);
const finalizerTransfers = finalizerReturn.transfers.filter((transfer) =>
  transfer.kind === "return-value");
equal(finalizerTransfers.length, 2);
deepStrictEqual(finalizerTransfers[0]?.crossedCallbacks,
  [finalizerRegion.protectedCallback.id]);
deepStrictEqual(finalizerTransfers[1]?.crossedCallbacks,
  [finalizerRegion.finalizerCallback.id]);

const catchReturn = namedFunction(first.plan, "catchReturn");
const catchRegion = catchReturn.finallyRegions[0];
const catchTransfer = catchReturn.transfers.find((transfer) =>
  transfer.kind === "return-value");
ok(catchRegion && catchTransfer);
deepStrictEqual(catchTransfer.sourcePath, catchRegion.protectedCallback.path,
  "catch shares the protected callback ownership path");

const nestedTarget = namedFunction(first.plan, "nestedTarget");
equal(nestedTarget.finallyRegions.length, 2);
const nestedOuter = nestedTarget.finallyRegions[0];
const nestedInner = nestedTarget.finallyRegions[1];
ok(nestedOuter && nestedInner);
equal(nestedOuter.strategy, "finally-helper-local");
equal(nestedOuter.crossingTransfers.length, 0,
  "inner transfers do not leave the outer protected callback");
equal(nestedInner.strategy, "finally-helper-completion");
equal(nestedInner.crossingTransfers.length, 2);
for (const transferId of nestedInner.crossingTransfers) {
  const transfer = nestedTarget.transfers.find((item) => item.id === transferId);
  ok(transfer);
  const target = targetForTransfer(nestedTarget, transfer);
  equal(target.loopKind, "for");
  equal(target.continueStep?.getText(), "i++",
    "lowered for target owns its exact continue increment");
  deepStrictEqual(target.ownerPath, nestedOuter.protectedCallback.path);
  deepStrictEqual(transfer.targetPath, nestedOuter.protectedCallback.path);
  deepStrictEqual(transfer.crossedCallbacks, [nestedInner.protectedCallback.id]);
}

const outerTarget = namedFunction(first.plan, "outerTarget");
equal(outerTarget.finallyRegions.length, 2);
const outerRegion = outerTarget.finallyRegions[0];
const innerRegion = outerTarget.finallyRegions[1];
ok(outerRegion && innerRegion);
const outerContinue = outerTarget.transfers.find((transfer) =>
  transfer.kind === "continue");
ok(outerContinue);
deepStrictEqual(targetForTransfer(outerTarget, outerContinue).ownerPath, []);
deepStrictEqual(outerContinue.crossedCallbacks, [
  innerRegion.protectedCallback.id,
  outerRegion.protectedCallback.id
]);
equal(innerRegion.strategy, "finally-helper-completion");
equal(outerRegion.strategy, "finally-helper-completion");

const nestedFunction = namedFunction(first.plan, "nestedFunction");
equal(nestedFunction.finallyRegions[0]?.strategy, "finally-helper-local");
equal(nestedFunction.transfers.length, 0,
  "nested arrow return is not attributed to the containing function");
const nestedArrow = first.plan.functions.find((fn) =>
  fn.form === "arrow" && fn.source.start > nestedFunction.source.start
  && fn.source.end < nestedFunction.source.end);
ok(nestedArrow);
equal(nestedArrow.transfers.length, 1);
equal(nestedArrow.transfers[0]?.disposition, "direct");
deepStrictEqual(nestedArrow.transfers[0]?.sourcePath, []);

const inferredCarrier = namedFunction(first.plan, "inferredCarrier");
equal(inferredCarrier.returnCarrier.kind, "unsupported");
if (inferredCarrier.returnCarrier.kind === "unsupported")
  equal(inferredCarrier.returnCarrier.reason, "missing-explicit-return-type");
equal(inferredCarrier.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

const weakCarrier = namedFunction(first.plan, "weakCarrier");
equal(weakCarrier.returnCarrier.kind, "unsupported");
if (weakCarrier.returnCarrier.kind === "unsupported")
  equal(weakCarrier.returnCarrier.reason, "weak-return-type");

const undefinedCarrier = namedFunction(first.plan, "undefinedCarrier");
equal(undefinedCarrier.returnCarrier.kind, "unsupported");
if (undefinedCarrier.returnCarrier.kind === "unsupported")
  equal(undefinedCarrier.returnCarrier.reason, "weak-return-type");

const anonymousDefault = first.plan.functions.find((fn) =>
  fn.form === "function-declaration" && fn.name.startsWith("<function-declaration@"));
ok(anonymousDefault);
ok(anonymousDefault.exclusions.includes("anonymous-function-form"));
equal(anonymousDefault.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

const switchTargets = namedFunction(first.plan, "switchTargets");
const switchRegion = switchTargets.finallyRegions[0];
ok(switchRegion);
equal(switchRegion.strategy, "finally-helper-completion");
const switchBreak = switchTargets.transfers.find((transfer) =>
  transfer.kind === "break");
const switchContinue = switchTargets.transfers.find((transfer) =>
  transfer.kind === "continue");
ok(switchBreak && switchContinue);
equal(switchBreak.disposition, "direct");
equal(targetForTransfer(switchTargets, switchBreak).kind, "switch");
deepStrictEqual(targetForTransfer(switchTargets, switchBreak).ownerPath,
  switchRegion.protectedCallback.path);
equal(switchContinue.disposition, "encode");
equal(targetForTransfer(switchTargets, switchContinue).kind, "loop");
deepStrictEqual(targetForTransfer(switchTargets, switchContinue).ownerPath, []);
deepStrictEqual(switchContinue.crossedCallbacks,
  [switchRegion.protectedCallback.id]);

const asyncCarrier = namedFunction(first.plan, "asyncCarrier");
ok(asyncCarrier.exclusions.includes("async"));
equal(asyncCarrier.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

const genericCarrier = namedFunction(first.plan, "genericCarrier");
ok(genericCarrier.exclusions.includes("generic-function"));
equal(genericCarrier.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

const constructor = namedFunction(first.plan, "constructor");
equal(constructor.form, "constructor");
ok(constructor.exclusions.includes("constructor"));
equal(constructor.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

const classMethod = namedFunction(first.plan, "method");
equal(classMethod.form, "class-method");
deepStrictEqual(classMethod.exclusions, []);
equal(classMethod.returnCarrier.kind, "value");
equal(classMethod.finallyRegions[0]?.strategy, "finally-helper-completion");

const labeledTransfer = namedFunction(first.plan, "labeledTransfer");
const labeledContinue = labeledTransfer.transfers.find((transfer) =>
  transfer.kind === "continue");
ok(labeledContinue);
equal(labeledContinue.disposition, "unsupported");
equal(labeledContinue.unsupportedReason, "labeled-transfer");
equal(labeledTransfer.finallyRegions[0]?.strategy, "unsupported-outer-transfer");

/** Recursively inventories TypeScript fixture files for legacy shadow checks. */
function typescriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(absolute));
    else if (entry.isFile() && /\.(?:ts|mts)$/.test(entry.name)) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

let repositoryRegions = 0;
for (const fixture of ["fixtures/semantic-diff/src", "fixtures/semantic-unsupported/src"]) {
  const root = path.join(toolRoot, fixture);
  for (const absolute of typescriptFiles(root)) {
    const relative = path.relative(toolRoot, absolute).split(path.sep).join("/");
    const text = fs.readFileSync(absolute, "utf8");
    const planned = parseAndPlan(text, relative).plan;
    repositoryRegions += assertLegacyAgreement(planned, relative);
  }
}
ok(repositoryRegions >= 2,
  "repository fixtures exercise local and outer-transfer finally plans");

process.stdout.write(
  `completion-plan:ok (${first.plan.functions.length} focused functions; ${repositoryRegions} repository finally regions)\n`
);
