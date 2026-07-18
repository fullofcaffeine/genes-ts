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
 * Reproduces two places where the current TypeScript emitter keeps a proof
 * after the value that proof described has changed.
 *
 * Why: a null check can safely remove TypeScript casts only while the checked
 * local, field receiver, map, and map key still refer to the same values.
 * Reassigning the receiver or removing map entries must end that proof.
 *
 * What: this remains a `probe`, rather than a normal passing gate, while the
 * legacy emitter is authoritative. It deliberately fails on the reviewed
 * v1.36.7 behavior and prints each stale fact it observes.
 *
 * How: compile the existing focused Haxe fixture, type-check the generated
 * source on every supported TypeScript lane, run it once, and inspect both the
 * generated expressions and the runtime null/undefined distinction. Once a
 * typed narrowing plan owns invalidation and this command passes, promote it
 * into the generated test matrix.
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

  if (staleFacts.length > 0) {
    throw new Error(
      [
        "TypeScript narrowing invalidation probe reproduced stale facts:",
        ...staleFacts.map(fact => `- ${fact}`),
        "",
        "This is expected on the recorded v1.36.7 baseline. See docs/TS_NARROWING_OWNERSHIP.md."
      ].join("\n")
    );
  }

  process.stdout.write("ts-narrowing-invalidation:ok\n");
}

main();
