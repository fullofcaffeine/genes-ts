import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/array-index-strict");
const expectedTranscript =
  "typed|7|generic|generic-null|generic-undefined|effects-once|assigned|compound-bitwise|compound-effects-once|compound-null-coercion|compound-nullish|compound-nested|updates|null|undefined|3,5|missing|void-once|secondary-array-once|named-shift|named-pop|discarded|native-find-index";

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

type CommandResult = {
  status: number | null;
  output: string;
};

/** Captures one Haxe result without hiding expected negative diagnostics. */
function captureHaxe(args: ReadonlyArray<string>): CommandResult {
  const result = spawnSync("haxe", [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`
  };
}

/** Removes file/line prefixes while retaining exact planned decisions. */
function inventoryMessages(output: string): ReadonlyArray<string> {
  return [...output.matchAll(
    /\[GTS-INDEX-(?:INVENTORY|PROBE)\] ([^\r\n]+)/g
  )].map((match) => match[1]);
}

/** Captures exact bytes and modes for transactional negative checks. */
function treeSnapshot(root: string): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute);
      const state = lstatSync(absolute);
      if (state.isDirectory()) {
        visit(absolute);
      } else {
        snapshot[relative] = `${state.mode & 0o777}:${readFileSync(absolute).toString("base64")}`;
      }
    }
  }
  visit(root);
  return snapshot;
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

const firstInventory = captureHaxe([
  "tests/array-index-strict/build-inventory.hxml"
]);
strictEqual(firstInventory.status, 0, firstInventory.output);
const firstInventoryMessages = inventoryMessages(firstInventory.output);
ok(firstInventoryMessages.length > 0, "plan build reports indexed decisions");

const secondInventory = captureHaxe([
  "tests/array-index-strict/build-inventory.hxml"
]);
strictEqual(secondInventory.status, 0, secondInventory.output);
deepStrictEqual(
  inventoryMessages(secondInventory.output),
  firstInventoryMessages,
  "two cold builds produce byte-identical indexed decision inventories"
);

for (const expected of [
  "target:logical-and:direct:direct-rmw:wrappers=none:result=used",
  "target:logical-or:direct:direct-rmw:wrappers=none:result=used",
  "target:write:direct:write-only:wrappers=parenthesis:result=used",
  "target:write:direct:write-only:wrappers=metadata(:indexedInventory):result=used",
  "target:write:direct:write-only:wrappers=implicit-cast:result=used",
  "target:write:direct:write-only:wrappers=none:result=used",
  "read:direct:normalize-null"
]) {
  ok(firstInventoryMessages.includes(expected),
    `typed probe records ${expected}`);
}

for (const expected of [
  "target:arithmetic-OpAdd:direct:coerce-string:wrappers=none:result=discarded",
  "target:bitwise-OpOr:direct:coerce-number:wrappers=none:result=discarded",
  "target:prefix-increment:direct:assert-slot:wrappers=none:result=used",
  "target:postfix-increment:direct:assert-slot:wrappers=none:result=used",
  "target:prefix-decrement:direct:assert-slot:wrappers=none:result=used",
  "target:postfix-decrement:direct:assert-slot:wrappers=none:result=used",
  "target:prefix-increment:direct:assert-slot:wrappers=none:result=discarded",
  "target:postfix-increment:direct:assert-slot:wrappers=none:result=discarded",
  "target:prefix-decrement:direct:assert-slot:wrappers=none:result=discarded",
  "target:postfix-decrement:direct:assert-slot:wrappers=none:result=discarded",
  "target:write:direct:write-only:wrappers=none:result=discarded",
  "target:arithmetic-OpAdd:assert-nullable:assert-slot:wrappers=none:result=discarded",
  "target:arithmetic-OpAdd:flow-present:assert-slot:wrappers=none:result=discarded",
  "read:direct:assert-type-parameter",
  "read:direct:normalize-null"
]) {
  ok(firstInventoryMessages.some((message) => message.endsWith(expected)),
    `real typed module inventory records ${expected}`);
}

const inventoryRoot = path.join(fixtureRoot, "out/inventory");
const acceptedInventoryTree = treeSnapshot(inventoryRoot);
const rejectedProbes = new Map<string, string>([
  ["undefined-arithmetic", "GTS-INDEX-BOUNDARY-001"],
  ["unknown-arithmetic", "GTS-INDEX-BOUNDARY-001"],
  ["generic-arithmetic", "GTS-INDEX-DOMAIN-001"],
  ["unresolved-write", "GTS-INDEX-BOUNDARY-001"],
  ["unresolved-target", "GTS-INDEX-BOUNDARY-001"],
  ["unresolved-read", "GTS-INDEX-BOUNDARY-001"],
  ["undefined-receiver", "GTS-INDEX-BOUNDARY-001"],
  ["unknown-receiver", "GTS-INDEX-BOUNDARY-001"],
  ["syntax-metadata", "GTS-INDEX-WRAP-001"],
  ["explicit-cast", "GTS-INDEX-WRAP-001"],
  ["unsupported-operator", "GTS-INDEX-PLAN-001"],
  ["emission-logical-and", "GTS-INDEX-PLAN-001"],
  ["emission-logical-or", "GTS-INDEX-PLAN-001"],
  ["emission-nullish", "GTS-INDEX-PLAN-001"],
  ["emission-parenthesis", "GTS-INDEX-WRAP-001"],
  ["emission-metadata", "GTS-INDEX-WRAP-001"],
  ["emission-implicit-cast", "GTS-INDEX-WRAP-001"],
  ["registry-compound", "GTS-INDEX-BOUNDARY-001"],
  ["registry-nested", "GTS-INDEX-BOUNDARY-001"],
  ["registry-read-explicit-cast", "GTS-INDEX-BOUNDARY-001"],
  ["registry-write-syntax-metadata", "GTS-INDEX-BOUNDARY-001"],
  ["registry-read-syntax-metadata", "GTS-INDEX-BOUNDARY-001"],
  ["registry-read-alias", "GTS-INDEX-BOUNDARY-001"],
  ["registry-read-call", "GTS-INDEX-BOUNDARY-001"],
  ["enum-parameter-other-read", "GTS-INDEX-BOUNDARY-001"],
  ["enum-parameter-noncanonical-owner", "GTS-INDEX-BOUNDARY-001"]
]);
for (const [mode, diagnostic] of rejectedProbes) {
  const rejected = captureHaxe([
    "tests/array-index-strict/build-inventory.hxml",
    "-D", `genes.ts.indexed_access_probe=${mode}`
  ]);
  ok(rejected.status !== 0, `${mode} must fail closed`);
  ok(rejected.output.includes(`[${diagnostic}]`),
    `${mode} reports ${diagnostic}`);
  deepStrictEqual(treeSnapshot(inventoryRoot), acceptedInventoryTree,
    `${mode} leaves the previously accepted output tree unchanged`);
}

runGeneratedTypeScriptMatrix(
  "tests/array-index-strict/tsconfig.inventory-generated.json",
  { emit: false }
);
runGeneratedTypeScriptMatrix(
  "tests/array-index-strict/tsconfig.inventory-logical.json",
  { emit: false }
);

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
ok(/values\d*\[tmp\]! \|= mask;/.test(typescript),
  "a lowered bitwise compound target receives its planned read-side assertion");
ok(/return values\d*\[tmp\]!;/.test(typescript),
  "the lowered compound result read receives its own planned slot assertion");
ok(typescript.includes(
  "Main.effectCompoundValues(Main.observedArray(values))[Main.effectCompoundIndex()]! += Main.effectCompoundIncrement();"
), "an effectful indexed target remains one native read-modify-write operation");
ok(typescript.includes("values1[tmp]! += suffix;"),
  "nullable string compound targets keep their planned coercion projection");
ok(typescript.includes("values1[tmp]! |= bit;"),
  "nullable numeric compound targets keep their planned coercion projection");
ok(typescript.includes(
  "return values[0] = ((values[0] ?? null) != null)"
), "Haxe's lowered nullish assignment preserves nullable reads and writes");
ok(!typescript.includes("values[0]! ??="),
  "a nullish writable target never receives a non-null assertion");
ok(typescript.includes("const base: number[] = matrix[row]!;"),
  "the nested receiver receives its own planned indexed-read assertion");
ok(typescript.includes("base[column1]! += increment;"),
  "the outer nested target receives its separate planned assertion");
ok(typescript.includes("const prefix: number = ++values[0]!;"));
ok(typescript.includes("const postfix: number = values[0]!++;"));
ok(typescript.includes("--values[0]!;"));
ok(typescript.includes("values[0]!--;"),
  "prefix, postfix, used, and discarded updates retain native syntax");
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
  ok(!generated.includes("]!"),
    `${relativeFile} does not consume the TypeScript-only indexed plan`);
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
const compoundTargetOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "values1[tmp]! |=")
);
ok(
  compoundTargetOrigin.source?.endsWith("src/arrayindexstrict/Main.hx"),
  "the compound target maps back to Main.hx"
);
strictEqual(
  compoundTargetOrigin.line,
  sourceLine(source, "return values[0] |= mask;"),
  "the compound target preserves the authored operation line"
);
const nestedTargetOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "base[column1]! +=")
);
strictEqual(
  nestedTargetOrigin.line,
  sourceLine(source, "return matrix[row][column] += increment;"),
  "the nested target preserves the authored operation line"
);
const prefixTargetOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "++values[0]!")
);
strictEqual(
  prefixTargetOrigin.line,
  sourceLine(source, "final prefix = ++values[0];"),
  "the prefix update preserves the authored update line"
);
const postfixTargetOrigin = sourceMap.originalPositionFor(
  generatedPoint(typescript, "values[0]!++")
);
strictEqual(
  postfixTargetOrigin.line,
  sourceLine(source, "final postfix = values[0]++;"),
  "the postfix update preserves the authored update line"
);

process.stdout.write(
  "array-index-strict:ok "
    + "(TS noUncheckedIndexedAccess + native findIndex + wrappers + classic + standard + maps)\n"
);
