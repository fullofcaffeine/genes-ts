import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/array-index-strict");
const expectedTranscript =
  "typed|7|generic|generic-null|generic-undefined|effects-once|assigned|compound-bitwise|compound-effects-once|compound-null-coercion|compound-nullish|compound-nested|compound-nullable-nested|null|undefined|3,5|missing|void-once|secondary-array-once|named-shift|named-pop|discarded";

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

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function generatedPoint(
  source: string,
  needle: string
): { line: number; column: number } {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `generated source contains ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
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
ok(typescript.includes("return (values[index] as T);"),
  "generic array reads assert the exact Haxe parameter without removing null");
ok(!typescript.includes("return values[index]!;"),
  "generic array reads do not leak TypeScript NonNullable<T>");
ok(typescript.includes("return numbers[index]!;"),
  "concrete non-null array reads retain the established postfix assertion");
ok(typescript.includes(
  "return (Main.effectValues(value)[Main.effectIndex()] as T);"
), "the exact generic assertion contains one receiver and one index evaluation");
ok(typescript.includes(
  "InvariantFactory.single((values[0] as T))"
), "nested generic inference receives Haxe's exact indexed element type");
ok(!typescript.includes("InvariantFactory.single(values[0]!)"),
  "nested generic inference does not receive NonNullable<T>");
ok(typescript.includes("return (values[index] ?? null);"),
  "nullable array reads normalize JavaScript absence to Haxe null");
ok(typescript.includes("return values[index];"),
  "explicit Undefinable array reads retain undefined without an assertion");
ok(typescript.includes("return values[0] = value;"),
  "generic assignment targets remain writable and assertion-free");
ok(!typescript.includes("(values[0] as T) = value"),
  "the exact generic read assertion is never applied to an assignment target");
ok(typescript.includes("values1[tmp]! |= mask;"),
  "indexed compound assignment retains the Haxe read contract");
ok(typescript.includes("base[index]! += increment;"),
  "compound assignment keeps one native read-modify-write operation");
ok(typescript.includes("values1[tmp]! += suffix;"),
  "nullable string compound targets retain runtime null coercion");
ok(typescript.includes("values1[tmp]! |= bit;"),
  "nullable numeric compound targets retain runtime null coercion");
ok(typescript.includes(
  "return values[0] = ((values[0] ?? null) != null)"
), "lowered nullish assignment preserves the authored nullable target");
ok(!typescript.includes("values[0]! ??="),
  "nullish compound targets never erase an authored null contract");
ok(typescript.includes(
  "const base: number[] = matrix[row]!;"
), "nested indexed receivers retain their strict read proof");
ok(typescript.includes(
  "base[index]! += increment;"
), "nested indexed receivers retain their strict read proof");
ok(typescript.includes(
  "(base!)[column1]! += increment;"
), "nullable nested indexed receivers receive a receiver-position proof");
ok(typescript.includes(
  "return (base!)[column1]!;"
), "nullable nested indexed reads retain the same receiver-position proof");
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
  ok(generated.includes("return (this.array[this.current++] as T);"),
    `${relativeFile} preserves exact Iterator<T>.next(): T under strict indexing`);
}

for (const relativeFile of [
  "out/classic/arrayindexstrict/Main.js",
  "out/standard/index.cjs"
]) {
  const generated = readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
  ok(!generated.includes("values[index]!"),
    `${relativeFile} keeps JavaScript output free of TS-only assertions`);
}

const source = readFileSync(
  path.join(fixtureRoot, "src/arrayindexstrict/Main.hx"),
  "utf8"
);
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    readFileSync(
      path.join(fixtureRoot, "out/ts/src-gen/arrayindexstrict/Main.ts.map"),
      "utf8"
    )
  ) as RawSourceMap
);
const assertionOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "as T")
);
ok(
  assertionOrigin.source?.endsWith(
    "src/arrayindexstrict/Main.hx"
  ),
  "the generic assertion maps back to Main.hx"
);
strictEqual(
  assertionOrigin.line,
  sourceLine(source, "return values[index];"),
  "the generic assertion preserves the authored indexed-read line"
);
const compoundTargetOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "values1[tmp]! |=")
);
ok(
  compoundTargetOrigin.source?.endsWith(
    "src/arrayindexstrict/Main.hx"
  ),
  "the compound target maps back to Main.hx"
);
strictEqual(
  compoundTargetOrigin.line,
  sourceLine(source, "return values[0] |= mask;"),
  "the compound target preserves the authored indexed-operation line"
);

process.stdout.write(
  "array-index-strict:ok "
    + "(TS noUncheckedIndexedAccess + wrappers + classic + standard + maps)\n"
);
