import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

function methodBlock(source: string, signature: RegExp, label: string): string {
  const block = source.match(signature)?.[0];
  if (!block) {
    throw new Error(`Could not find generated ${label} method`);
  }
  return block;
}

/**
 * Reproduces the bounded places where a TypeScript non-null proof can outlive
 * the local, receiver, map entry, or loop iteration that made it true.
 *
 * Why: a null check can safely remove TypeScript casts only while the checked
 * local, field receiver, map, and map key still refer to the same values.
 * Reassigning the receiver or removing map entries must end that proof.
 *
 * What: this is the normal owner gate for function-local TypeScript narrowing.
 * It checks every supported TypeScript lane and prints each stale or lost fact
 * separately. Nearby return, throw, break, continue, callback, and nullable-map
 * cases protect behavior that was already correct before the plan landed.
 *
 * How: compile the existing focused Haxe fixture, type-check the generated
 * source on every supported TypeScript lane, run it once, and inspect both the
 * generated expressions and the runtime null/undefined distinction. The
 * `TsNarrowingPlan` now owns invalidation, so this command is part of the
 * generated test matrix and the full acceptance gate.
 */
function main(): void {
  const outputRoot = path.join(repoRoot, "tests/genes-ts/no-js-es/out");
  rmSync(outputRoot, { recursive: true, force: true });
  run("haxe", ["tests/genes-ts/no-js-es/build.hxml"]);

  runGeneratedTypeScriptMatrix("tests/genes-ts/no-js-es/tsconfig.json");

  const generated = readFileSync(
    path.join(outputRoot, "src-gen/Main.ts"),
    "utf8"
  );
  const receiverReassignment = methodBlock(
    generated,
    /\bstatic optionalAfterReceiverReassignment\(\): string \| null \{[\s\S]*?\n\t\}/,
    "receiver-reassignment"
  );
  const mapRemove = methodBlock(
    generated,
    /\bstatic mapGetAfterRemove\(id: string\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "map-remove"
  );
  const mapClear = methodBlock(
    generated,
    /\bstatic mapGetAfterClear\(id: string\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "map-clear"
  );
  const branchReassignment = methodBlock(
    generated,
    /\bstatic optionalInsideNarrowedBranch\(\): string \| null \{[\s\S]*?\n\t\}/,
    "branch-reassignment"
  );
  const nestedReceiverReassignment = methodBlock(
    generated,
    /\bstatic optionalAfterNestedReceiverReassignment\(\): string \| null \{[\s\S]*?\n\t\}/,
    "nested-receiver-reassignment"
  );
  const mapReceiverReassignment = methodBlock(
    generated,
    /\bstatic mapGetAfterReceiverReassignment\(id: string\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "map-receiver-reassignment"
  );
  const mapKeyReassignment = methodBlock(
    generated,
    /\bstatic mapGetAfterKeyReassignment\(id: string\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "map-key-reassignment"
  );
  const delayedMapKey = methodBlock(
    generated,
    /\bstatic mapKeyCallbackAfterClear\(\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "delayed-map-key"
  );
  const nestedReturnOrThrow = methodBlock(
    generated,
    /\bstatic nestedReturnOrThrow\(id: string, throwMissing: boolean\): string \{[\s\S]*?\n\t\}/,
    "nested-return-throw"
  );
  const nestedBreakOrContinue = methodBlock(
    generated,
    /\bstatic nestedBreakOrContinue\(ids: string\[\]\): string\[\] \{[\s\S]*?\n\t\}/,
    "nested-break-continue"
  );
  const nullableMapValue = methodBlock(
    generated,
    /\bstatic nullableMapValueAfterExists\(id: string\): NamedItem \| null \{[\s\S]*?\n\t\}/,
    "nullable-map-value"
  );
  const loopReassignment = methodBlock(
    generated,
    /\bstatic optionalAfterLoopReassignment\(\): string \| null \{[\s\S]*?\n\t\}/,
    "loop-reassignment"
  );

  const transcript = execFileSync(
    process.execPath,
    ["tests/genes-ts/no-js-es/out/dist/index.js"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  const staleFacts: string[] = [];
  if (receiverReassignment.includes("return (item.name!);")) {
    staleFacts.push(
      "receiver reassignment kept the old optional-field non-null assertion"
    );
  }
  if (!receiverReassignment.includes("return (item.name ?? null);")) {
    staleFacts.push(
      "receiver reassignment skipped the ordinary optional-field null normalization"
    );
  }
  if (mapRemove.includes("named.get(id)!")) {
    staleFacts.push("Map.remove kept the earlier Map.exists presence proof");
  }
  if (mapClear.includes("named.get(id)!")) {
    staleFacts.push("Map.clear kept the earlier Map.exists presence proof");
  }
  if (branchReassignment.includes("return (item.name!);")) {
    staleFacts.push(
      "receiver reassignment inside a narrowed branch kept the branch proof"
    );
  }
  if (!branchReassignment.includes("return (item.name ?? null);")) {
    staleFacts.push(
      "branch-local reassignment skipped optional-field null normalization"
    );
  }
  if (nestedReceiverReassignment.includes("return (holder_item.name!);")) {
    staleFacts.push(
      "nested receiver reassignment kept a proof about the replaced child"
    );
  }
  if (!nestedReceiverReassignment.includes("return (holder_item.name ?? null);")) {
    staleFacts.push(
      "nested receiver reassignment skipped optional-field null normalization"
    );
  }
  if (/\bnamed\.get\(id\)!/.test(mapReceiverReassignment)) {
    staleFacts.push("map-local reassignment kept the old map presence proof");
  }
  if (/\bnamed\.get\(key\)!/.test(mapKeyReassignment)) {
    staleFacts.push("map-key reassignment kept the old key presence proof");
  }
  if (/\bnamed\.get\([^)]*\)!/.test(delayedMapKey)) {
    staleFacts.push("a delayed callback inherited its loop key presence proof");
  }
  if (!nestedReturnOrThrow.includes("return item.name;")
    || nestedReturnOrThrow.includes("Register.unsafeCast")
    || nestedReturnOrThrow.includes("item!")) {
    staleFacts.push(
      "nested return/throw exits lost the valid fall-through non-null proof"
    );
  }
  if (!nestedBreakOrContinue.includes("out.push(item.name)")
    || nestedBreakOrContinue.includes("Register.unsafeCast")
    || nestedBreakOrContinue.includes("item!")) {
    staleFacts.push(
      "nested break/continue exits lost the valid same-iteration proof"
    );
  }
  if (/\bnamed\.get\(id\)!/.test(nullableMapValue)) {
    staleFacts.push(
      "Map.exists incorrectly made a map's nullable value non-null"
    );
  }
  if (loopReassignment.includes("return (item.name!);")) {
    staleFacts.push("a loop assignment leaked an old field proof past the loop");
  }
  if (!loopReassignment.includes("return (item.name ?? null);")) {
    staleFacts.push(
      "loop reassignment skipped optional-field null normalization"
    );
  }
  if (!transcript.includes("receiver-reassignment:true:false")) {
    staleFacts.push(
      "the reassigned optional field returned raw undefined instead of Haxe null"
    );
  }
  if (!transcript.includes("map-remove:true")) {
    staleFacts.push("Map.remove did not produce the expected missing-key null");
  }
  if (!transcript.includes("map-clear:true")) {
    staleFacts.push("Map.clear did not produce the expected missing-key null");
  }
  for (const expected of [
    "branch-reassignment:true:false",
    "nested-reassignment:true:false",
    "map-receiver-reassignment:true",
    "map-key-reassignment:true",
    "delayed-map-key:true",
    "nested-return-throw:alpha",
    "nested-break-continue:alpha",
    "nullable-map-value:true",
    "loop-reassignment:true:false"
  ]) {
    if (!transcript.includes(expected)) {
      staleFacts.push(`runtime transcript did not contain ${expected}`);
    }
  }

  if (staleFacts.length > 0) {
    throw new Error(
      [
        "TypeScript narrowing evidence found stale or lost facts:",
        ...staleFacts.map(fact => `- ${fact}`),
        "",
        "See docs/TS_NARROWING_OWNERSHIP.md for the plan boundary and evidence."
      ].join("\n")
    );
  }

  process.stdout.write("ts-narrowing:ok\n");
}

main();
