import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runTypeScript } from "./toolchains.js";

/**
 * Proves the opt-in generic-call contract in both output profiles.
 *
 * The positive fixture checks the exact TypeScript syntax, strict type checking,
 * and classic-JavaScript erasure. Each negative fixture must report its stable
 * diagnostic and leave no generated files behind, because validation failures
 * are part of the compiler's transactional publication boundary.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repoRoot, "tests/explicit-type-arguments");
const negativeOutputRoot = path.join(fixtureRoot, "out/negative");

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function requireText(source: string, fragment: string, reason: string): void {
  if (!source.includes(fragment)) {
    throw new Error(`${reason}\nMissing: ${fragment}`);
  }
}

function rejectText(source: string, fragment: string, reason: string): void {
  if (source.includes(fragment)) {
    throw new Error(`${reason}\nUnexpected: ${fragment}`);
  }
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

run("haxe", ["tests/explicit-type-arguments/build-ts.hxml"]);
const tsSourceRoot = path.join(fixtureRoot, "out/ts/src-gen");
mkdirSync(tsSourceRoot, { recursive: true });
cpSync(
  path.join(fixtureRoot, "resources/generic-cell.d.ts"),
  path.join(tsSourceRoot, "generic-cell.d.ts")
);

const generatedTs = readFileSync(path.join(tsSourceRoot, "Main.ts"), "utf8");
requireText(
  generatedTs,
  "makeCell<string | null>(null)",
  "nullable extern calls must preserve Haxe's exact generic result"
);
requireText(
  generatedTs,
  "makeCell<undefined>()",
  "zero-argument extern calls must preserve Haxe's exact generic result"
);
requireText(
  generatedTs,
  "makePair<string | null, boolean>(null, true)",
  "multiple type arguments must retain declaration order"
);
requireText(
  generatedTs,
  "makeCell<Value>(value)",
  "an enclosing checked type parameter is a precise explicit argument"
);
requireText(
  generatedTs,
  'let phase = makeCell<"pending" | "ready">("pending")',
  "a call-site witness must preserve a closed enum abstract after Haxe erasure"
);
requireText(
  generatedTs,
  'let mutablePhase: import("./generic-cell.js").Cell<string> = makeCell<"pending" | "ready">("pending")',
  "a reassigned local must keep the wider Haxe type accepted by later writes"
);
requireText(
  generatedTs,
  'mutablePhase = makeCell<string>("other")',
  "a later valid Haxe assignment must remain valid TypeScript"
);
requireText(
  generatedTs,
  'let generatedPhases_0 = makeCell<"pending" | "ready">("pending")',
  "the first library-macro expansion must retain its precise witness"
);
requireText(
  generatedTs,
  'let generatedPhases_1 = makeCell<"pending" | "ready">("pending")',
  "a second expansion at the same source span must share an equivalent witness"
);
requireText(
  generatedTs,
  'let fluentPhase = makeCell<"pending" | "ready">("pending").seal()',
  "a fluent outer call sharing the macro span must not claim the inner generic witness"
);
requireText(
  generatedTs,
  'makeCell<"pending" | "ready">("ready")',
  "an unused reviewed call must retain its runtime evaluation and exact argument"
);
requireText(
  generatedTs,
  'makeCell<import("./generic-cell.js").Cell<string>>(makeCell<string>("pending"))',
  "one reviewed call must not specialize a nested call to the same extern field"
);
rejectText(
  generatedTs,
  'makeCell<import("./generic-cell.js").Cell<string>>(makeCell<import("./generic-cell.js").Cell<string>>',
  "the compiler-only registration must be consumed by exactly one call"
);
rejectText(
  generatedTs,
  'let phase: import("./generic-cell.js").Cell<string>',
  "an unmodified local must infer the preserved narrow call result"
);
requireText(
  generatedTs,
  "inferCell(42)",
  "ordinary generic extern calls must retain TypeScript inference"
);
rejectText(
  generatedTs,
  "inferCell<number>(42)",
  "the opt-in contract must not specialize neighboring ordinary calls"
);
for (const unsafe of [
  "<any>",
  "<unknown>",
  " as ",
  "ExplicitTypeArgumentCallSite",
  "TypeArguments"
]) {
  rejectText(generatedTs, unsafe, "the generated fixture must remain fully typed");
}

runTypeScript("legacyFloor", [
  "-p",
  "tests/explicit-type-arguments/tsconfig.json"
]);

run("haxe", ["tests/explicit-type-arguments/build-classic.hxml"]);
const generatedJs = readFileSync(
  path.join(fixtureRoot, "out/classic/src-gen/Main.js"),
  "utf8"
);
requireText(generatedJs, "makeCell(null)", "classic JS must preserve the nullable call");
requireText(generatedJs, "makeCell()", "classic JS must preserve the no-argument call");
requireText(generatedJs, "makePair(null, true)", "classic JS must preserve argument order");
requireText(
  generatedJs,
  'makeCell("pending")',
  "classic JS must erase the enum-abstract type witness"
);
requireText(
  generatedJs,
  'mutablePhase = makeCell("other")',
  "classic JS must preserve the later mutable-local assignment"
);
requireText(
  generatedJs,
  'generatedPhases_0 = makeCell("pending")',
  "classic JS must preserve the first macro-generated call"
);
requireText(
  generatedJs,
  'generatedPhases_1 = makeCell("pending")',
  "classic JS must preserve the second macro-generated call"
);
requireText(
  generatedJs,
  'fluentPhase = makeCell("pending").seal()',
  "classic JS must preserve the fluent call without a type helper"
);
requireText(
  generatedJs,
  'makeCell("ready")',
  "classic JS must preserve an unused reviewed call exactly once"
);
requireText(
  generatedJs,
  'makeCell(makeCell("pending"))',
  "classic JS must preserve nested calls after erasing the outer type witness"
);
rejectText(
  generatedJs,
  "TypeArguments",
  "the compile-time type witness helper must have no classic-JS runtime"
);
rejectText(
  generatedJs,
  "ExplicitTypeArgumentCallSite",
  "the compiler-owned identity carrier must have no classic-JS runtime"
);
rejectText(generatedJs, "<undefined>", "TS-only type arguments must erase in classic JS");

const negativeCases = [
  {
    hxml: "tests/explicit-type-arguments/build-invalid-argument.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: @:ts.explicitTypeArguments does not take arguments"
  },
  {
    hxml: "tests/explicit-type-arguments/build-non-extern.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: @:ts.explicitTypeArguments is only valid on extern callables"
  },
  {
    hxml: "tests/explicit-type-arguments/build-non-generic.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: @:ts.explicitTypeArguments requires a generic extern callable"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-unmarked.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) requires a generic extern callable annotated with @:ts.explicitTypeArguments"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-wrong-arity.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) requires exactly 2 type witnesses, received 1"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-unresolved.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) witness 1 is unresolved or broad; explicit TypeScript type arguments must remain precise"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-alias.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) requires a direct extern callable"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-not-call.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) expects a direct call expression"
  },
  {
    hxml: "tests/explicit-type-arguments/build-call-site-conflicting-span.hxml",
    expected: "GENES-TS-EXPLICIT-TYPE-ARGS-001: TypeArguments.call(...) found different type witnesses for calls that share one generated source span; the generating macro must give those callees distinct source positions"
  }
] as const;

for (const testCase of negativeCases) {
  rmSync(negativeOutputRoot, { recursive: true, force: true });
  const result = spawnSync("haxe", [testCase.hxml], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    throw new Error(`negative fixture unexpectedly compiled: ${testCase.hxml}`);
  }
  requireText(output, testCase.expected, `negative fixture changed: ${testCase.hxml}`);
  if (existsSync(negativeOutputRoot) && readdirSync(negativeOutputRoot).length > 0) {
    throw new Error(
      `failed compilation published output instead of rolling back: ${testCase.hxml}`
    );
  }
}

console.log("explicit generic-call argument fixture passed");
