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
  "typed|7|generic|generic-null|generic-undefined|effects-once|assigned|null|undefined|3,5|missing|void-once|secondary-array-once|named-shift|named-pop|discarded|native-find-index";

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
ok(
  /\["first", "match"\]\.findIndex\(function \(value: string\)/.test(typescript),
  "the typed helper emits direct JavaScript Array.prototype.findIndex"
);
ok(
  !typescript.includes("ArrayCallbacks.findIndex"),
  "the typed helper has no runtime wrapper"
);

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
  ok(/\["first",\s*"match"\]\.findIndex\(/.test(generated),
    `${relativeFile} uses the native JavaScript findIndex operation`);
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

process.stdout.write(
  "array-index-strict:ok "
    + "(TS noUncheckedIndexedAccess + native findIndex + wrappers + classic + standard + maps)\n"
);
