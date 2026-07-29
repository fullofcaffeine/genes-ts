import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/array-index-strict");
const expectedTranscript =
  "typed|null|undefined|3,5|missing|void-once|secondary-array-once|named-shift|named-pop|discarded";

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

/** Captures the one-line transcript produced by a generated profile. */
function transcript(relativeFile: string): string {
  return execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
run("haxe", ["tests/array-index-strict/build-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/array-index-strict/tsconfig.generated.json");
run("haxe", ["tests/array-index-strict/build-classic.hxml"]);
run("haxe", ["tests/array-index-strict/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/array-index-strict/out/ts/dist/index.js"),
    transcript("tests/array-index-strict/out/classic/index.js"),
    transcript("tests/array-index-strict/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript, expectedTranscript]
);

const typescript = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/arrayindexstrict/Main.ts"),
  "utf8"
);
ok(typescript.includes("return values[index]!;"),
  "ordinary typed array reads assert the Haxe result type");
ok(typescript.includes("return (values[index] ?? null);"),
  "nullable array reads normalize JavaScript absence to Haxe null");
ok(typescript.includes("return values[index];"),
  "explicit Undefinable array reads retain undefined without an assertion");
ok(typescript.includes("values[0] = first;"));
ok(typescript.includes("values[1] = second;"));
ok(!typescript.includes("values[0]! ="),
  "assignment targets do not receive read-only assertions");
ok(!typescript.includes("values[1]! ="),
  "assignment targets do not receive read-only assertions");
ok(typescript.includes("return (values.shift() ?? null);"),
  "built-in Array.shift value reads normalize undefined to Haxe null");
ok(typescript.includes("namedVoid.shift();"));
ok(typescript.includes("namedVoid.pop();"));
ok(!typescript.includes("(namedVoid.shift() ?? null)"),
  "a user shift():Void statement is not treated as Array.shift");
ok(!typescript.includes("(namedVoid.pop() ?? null)"),
  "a user pop():Void statement is not treated as Array.pop");
ok(typescript.includes("secondaryArray.shift();"));
ok(typescript.includes("secondaryArray.pop();"));
ok(!typescript.includes("(secondaryArray.shift() ?? null)"),
  "a root-module secondary class named Array is not the built-in Array");
ok(!typescript.includes("(secondaryArray.pop() ?? null)"),
  "canonical module identity protects a secondary Array.pop statement");
ok(typescript.includes("namedValues.shift()"));
ok(typescript.includes("namedValues.pop()"));
ok(!typescript.includes("(namedValues.shift() ?? null)"),
  "a value-returning user shift method keeps its declared result");
ok(!typescript.includes("(namedValues.pop() ?? null)"),
  "a value-returning user pop method keeps its declared result");
ok(typescript.includes("discarded.shift();"));
ok(!typescript.includes("(discarded.shift() ?? null)"),
  "a discarded native Array result does not need value normalization");

for (const relativeFile of [
  "out/ts/src-gen/genes/Register.ts",
  "out/ts/src-gen/haxe/iterators/ArrayIterator.ts"
]) {
  const generated = readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
  ok(generated.includes("return this.array[this.current++]!;"),
    `${relativeFile} preserves Iterator<T>.next(): T under strict indexing`);
}

for (const relativeFile of [
  "out/classic/arrayindexstrict/Main.js",
  "out/standard/index.cjs"
]) {
  const generated = readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
  ok(!generated.includes("values[index]!"),
    `${relativeFile} keeps JavaScript output free of TS-only assertions`);
}

process.stdout.write(
  "array-index-strict:ok (TS noUncheckedIndexedAccess + classic + standard)\n"
);
