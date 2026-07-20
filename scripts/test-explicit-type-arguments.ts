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
rejectText(
  generatedTs,
  "Cell<string> = makeCell",
  "a redundant erased local annotation must not widen the explicit call result"
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
for (const unsafe of ["<any>", "<unknown>", " as "]) {
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
rejectText(
  generatedJs,
  "TypeArguments",
  "the compile-time type witness helper must have no classic-JS runtime"
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
