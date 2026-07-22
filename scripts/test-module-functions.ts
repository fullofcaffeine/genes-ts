import {
  deepStrictEqual,
  ok,
  strictEqual
} from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/module-functions");
const outputRoot = path.join(fixtureRoot, "out");

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() ? files(child) : [child];
    })
    .sort((left, right) => left.localeCompare(right));
}

function digestTree(root: string): string[] {
  return files(root).map((file) => {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${relative}:${digest}`;
  });
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function generatedPoint(source: string, needle: string): { line: number; column: number } {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `generated source contains ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

function assertSourceMap(profile: "classic" | "ts" | "tsx",
  extension: "js" | "ts" | "tsx"): void {
  const generated = path.join(outputRoot, profile,
    ...(profile === "classic" ? [] : ["src-gen"]),
    `module_functions/Selected.${extension}`);
  const source = readFileSync(generated, "utf8");
  const haxePath = path.join(fixtureRoot,
    "src/module_functions/Selected.hx");
  const haxeSource = readFileSync(haxePath, "utf8");
  const functionPoint = generatedPoint(source, "function useSemantic");
  // source-map@0.6 declares a stricter constructor input than the v3 JSON
  // object it accepts at runtime. Validate JSON parsing at the file boundary,
  // then keep this assertion confined to the library's inaccurate type seam.
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generated}.map`, "utf8")) as RawSourceMap);
  const original = map.originalPositionFor(functionPoint);
  ok(original.source?.endsWith("src/module_functions/Selected.hx"),
    `${profile} module function maps to Selected.hx`);
  strictEqual(original.line,
    sourceLine(haxeSource, "public static function selected"),
    `${profile} module function name maps to the Haxe method declaration`);

  const seedLine = generatedPoint(source, "static selected()").line;
  const assignmentLine = generatedPoint(source,
    "Selected.selected = useSemantic").line;
  const mappedLines = new Set<number>();
  map.eachMapping((mapping) => mappedLines.add(mapping.generatedLine));
  ok(!mappedLines.has(assignmentLine),
    `${profile} compiler-owned assignment has no invented Haxe position`);
  ok(!mappedLines.has(seedLine),
    `${profile} compiler-owned descriptor seed has no invented Haxe position`);

  const bodyPoint = generatedPoint(source,
    "return value.label + suffix + rest.length");
  const bodyOriginal = map.originalPositionFor(bodyPoint);
  strictEqual(bodyOriginal.line,
    sourceLine(haxeSource, "return value.label + suffix + rest.length"),
    `${profile} moved body keeps its exact Haxe source line`);
}

function assertImplementationShape(relative: string): void {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const functionIndex = source.indexOf("function useSemantic");
  const classIndex = source.indexOf("class Selected");
  const assignmentIndex = source.indexOf("Selected.selected = useSemantic");
  const registrationIndex = source.indexOf(relative.startsWith("classic/")
    ? "Register.hxClasses()[\"module_functions.Selected\"]"
    : "Register.setHxClass(\"module_functions.Selected\"");
  ok(functionIndex !== -1 && functionIndex < classIndex,
    `${relative} emits the real module function before its owner`);
  ok(assignmentIndex > classIndex && assignmentIndex < registrationIndex,
    `${relative} installs the function immediately before registration`);
  strictEqual(source.split("return value.label + suffix + rest.length").length - 1, 1,
    `${relative} emits the selected body exactly once`);
  ok(source.includes("static selected(): never" ) ||
    source.includes("static selected() {"),
    `${relative} keeps a descriptor seed in the original class slot`);
  ok(!source.includes("export function useSemantic"),
    `${relative} does not broaden the ESM API`);
  ok(source.includes("function sameName")
    && source.includes("Selected.sameName = sameName"),
    `${relative} accepts an exact module name equal to its Haxe field`);
  ok(source.indexOf("function secondaryModuleFunction")
    < source.indexOf("class SecondarySelected")
    && source.indexOf("SecondarySelected.selected = secondaryModuleFunction")
      > source.indexOf("class SecondarySelected"),
    `${relative} plans a second retained owner in stable module order`);
  ok(!/\b(?:any|unknown|Dynamic|untyped)\b|unsafeCast|\sas\s/.test(code),
    `${relative} introduces no broad type or target assertion`);
  ok(!source.includes("DeadSelected"),
    `${relative} proves metadata does not root dead code`);
  ok(!source.includes("module-function-import"),
    `${relative} proves a dead selected body adds no runtime import edge`);
}

interface RuntimeEvidence {
  readonly descriptor: {
    readonly configurable: boolean;
    readonly enumerable: boolean;
    readonly writable: boolean;
  };
  readonly functionName: string;
  readonly isConstructable: boolean;
  readonly order: ReadonlyArray<string>;
  readonly recursiveAfterReassignment: number;
  readonly registered: boolean;
  readonly mappedValues: ReadonlyArray<number>;
  readonly safeAbsent: null;
  readonly safePresent: string;
  readonly staticInitialized: string;
  readonly classInitialized: string;
  readonly crossModuleInitialized: number;
  readonly crossModuleCall: number;
  readonly subclassInitialized: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function isRuntimeEvidence(value: unknown): value is RuntimeEvidence {
  if (!isRecord(value)) return false;
  const record = value;
  const descriptor = record.descriptor;
  return typeof record.functionName === "string"
    && typeof record.isConstructable === "boolean"
    && Array.isArray(record.order)
    && record.order.every((entry) => typeof entry === "string")
    && typeof record.recursiveAfterReassignment === "number"
    && typeof record.registered === "boolean"
    && Array.isArray(record.mappedValues)
    && record.mappedValues.every((entry) => typeof entry === "number")
    && record.safeAbsent === null
    && typeof record.safePresent === "string"
    && typeof record.staticInitialized === "string"
    && typeof record.classInitialized === "string"
    && typeof record.crossModuleInitialized === "number"
    && typeof record.crossModuleCall === "number"
    && typeof record.subclassInitialized === "number"
    && isRecord(descriptor)
    && typeof descriptor.configurable === "boolean"
    && typeof descriptor.enumerable === "boolean"
    && typeof descriptor.writable === "boolean";
}

function runtimeEvidence(): RuntimeEvidence {
  const program = `
import {Selected} from "./tests/module-functions/out/classic/module_functions/Selected.js";
import {CrossModule} from "./tests/module-functions/out/classic/module_functions/CrossModule.js";
import {ModuleFunctionChild} from "./tests/module-functions/out/classic/module_functions/Inheritance.js";
import {Register} from "./tests/module-functions/out/classic/genes/Register.js";
const descriptor = Object.getOwnPropertyDescriptor(Selected, "selected");
if (descriptor === undefined) throw new Error("missing selected descriptor");
const originalRecursive = Selected.recursive;
Selected.recursive = () => 100;
const recursiveAfterReassignment = originalRecursive(2);
Selected.recursive = originalRecursive;
let isConstructable = true;
try { new Selected.selected({label: "constructed"}); } catch { isConstructable = false; }
console.log(JSON.stringify({
  descriptor: {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    writable: descriptor.writable
  },
  functionName: Selected.selected.name,
  isConstructable,
  order: Object.getOwnPropertyNames(Selected),
  recursiveAfterReassignment,
  registered: Register.hxClasses()["module_functions.Selected"] === Selected,
  mappedValues: Selected.mapValues([1, 3]),
  safeAbsent: Selected.safeOptional(undefined),
  safePresent: Selected.safeOptional("present"),
  staticInitialized: Selected.initialized,
  classInitialized: Selected.classInitialized,
  crossModuleInitialized: CrossModule.initialized,
  crossModuleCall: Selected.callsCross(1),
  subclassInitialized: ModuleFunctionChild.inherited
}));`;
  const output = execFileSync(process.execPath,
    ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim();
  const parsed: unknown = JSON.parse(output);
  if (!isRuntimeEvidence(parsed)) {
    throw new Error(`invalid module-function runtime evidence: ${output}`);
  }
  return parsed;
}

function exactRuntimeIdentity(): boolean {
  const generated = path.join(outputRoot,
    "classic/module_functions/Selected.js");
  const instrumented = path.join(outputRoot,
    "classic/module_functions/Selected.instrumented.js");
  const source = readFileSync(generated, "utf8");
  writeFileSync(instrumented,
    `${source}\nexport {useSemantic as __testUseSemantic}\n`, "utf8");
  try {
    const program = `
import {Selected, __testUseSemantic} from "./tests/module-functions/out/classic/module_functions/Selected.instrumented.js";
console.log(Selected.selected === __testUseSemantic ? "true" : "false");`;
    return execFileSync(process.execPath,
      ["--input-type=module", "--eval", program], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim() === "true";
  } finally {
    rmSync(instrumented, { force: true });
  }
}

const negativeCases = [
  ["module_function_arity", "GENES-MODULE-FUNCTION-ARITY-001"],
  ["module_function_arity_multiple", "GENES-MODULE-FUNCTION-ARITY-001"],
  ["module_function_nonliteral", "GENES-MODULE-FUNCTION-LITERAL-002"],
  ["module_function_empty", "GENES-MODULE-FUNCTION-EMPTY-003"],
  ["module_function_identifier", "GENES-MODULE-FUNCTION-IDENTIFIER-004"],
  ["module_function_collision", "GENES-MODULE-FUNCTION-COLLISION-005"],
  ["module_function_duplicate", "GENES-MODULE-FUNCTION-COLLISION-005"],
  ["module_function_instance", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_inline", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_dynamic", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_generic_owner", "GENES-MODULE-FUNCTION-OWNER-007"],
  ["module_function_overload", "GENES-MODULE-FUNCTION-OVERLOAD-009"],
  ["module_function_raw_syntax", "GENES-MODULE-FUNCTION-LEXICAL-010"],
  ["module_function_property", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_prototype", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_duplicate_native", "GENES-MODULE-FUNCTION-SHAPE-006"],
  [
    "module_function_import_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ],
  [
    "module_function_module_field_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ],
  [
    "module_function_global_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ]
] as const;

function assertCompileFailure(profile: "classic" | "ts",
  define: string, diagnostic: string,
  extraDefines: ReadonlyArray<string> = []): void {
  const extension = profile === "ts" ? "ts" : "js";
  const directory = path.join(outputRoot, "invalid", `${profile}-${define}`);
  const output = path.join(directory, `index.${extension}`);
  const sentinel = `preserved:${profile}:${define}\n`;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(output, sentinel, "utf8");
  const result = spawnSync("haxe", [
    "-lib", "genes-ts",
    "-cp", "tests/module-functions/src",
    "--main", "module_function_invalid.Main",
    "-js", path.relative(repoRoot, output),
    "-D", define,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    ...extraDefines.flatMap((value) => ["-D", value]),
    ...(profile === "ts" ? ["-D", "genes.ts"] : ["-D", "dts"])
  ], { cwd: repoRoot, encoding: "utf8" });
  ok(result.status !== null && result.status !== 0,
    `${profile}/${define} must fail`);
  const diagnostics = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  ok(diagnostics.includes(diagnostic),
    `${profile}/${define} reports ${diagnostic}\n${diagnostics}`);
  ok(/module_function_invalid\/Main\.hx:\d+:/.test(diagnostics),
    `${profile}/${define} reports a Haxe source position\n${diagnostics}`);
  strictEqual(readFileSync(output, "utf8"), sentinel,
    `${profile}/${define} preserves prior public output`);
  deepStrictEqual(files(directory), [output],
    `${profile}/${define} publishes no partial artifacts`);
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/module-functions/build-classic.hxml"]);
const classicDigest = digestTree(path.join(outputRoot, "classic"));
run("haxe", ["tests/module-functions/build-classic.hxml"]);
deepStrictEqual(digestTree(path.join(outputRoot, "classic")), classicDigest,
  "classic module-function output is deterministic");

run("haxe", ["tests/module-functions/build-ts.hxml"]);
const tsDigest = digestTree(path.join(outputRoot, "ts/src-gen"));
run("haxe", ["tests/module-functions/build-ts.hxml"]);
deepStrictEqual(digestTree(path.join(outputRoot, "ts/src-gen")), tsDigest,
  "TypeScript module-function output is deterministic");

run("haxe", ["tests/module-functions/build-tsx.hxml"]);
const tsxDigest = digestTree(path.join(outputRoot, "tsx/src-gen"));
run("haxe", ["tests/module-functions/build-tsx.hxml"]);
deepStrictEqual(digestTree(path.join(outputRoot, "tsx/src-gen")), tsxDigest,
  "TSX module-function output is deterministic");

runGeneratedTypeScriptMatrix("tests/module-functions/tsconfig.json");

assertImplementationShape("classic/module_functions/Selected.js");
assertImplementationShape("ts/src-gen/module_functions/Selected.ts");
assertImplementationShape("tsx/src-gen/module_functions/Selected.tsx");
for (const relative of [
  "classic/module_functions/CrossModule.js",
  "ts/src-gen/module_functions/CrossModule.ts",
  "tsx/src-gen/module_functions/CrossModule.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.indexOf("function crossModuleFunction")
    < source.indexOf("class CrossModule"),
    `${relative} emits the cyclic body before its owner`);
  ok(source.indexOf("CrossModule.selected = crossModuleFunction")
    < source.indexOf(relative.startsWith("classic/")
      ? "Register.hxClasses()[\"module_functions.CrossModule\"]"
      : "Register.setHxClass(\"module_functions.CrossModule\""),
    `${relative} installs the selected function before registration`);
}
assertSourceMap("classic", "js");
assertSourceMap("ts", "ts");
assertSourceMap("tsx", "tsx");

const runtime = runtimeEvidence();
strictEqual(exactRuntimeIdentity(), true,
  "the final class property is the exact module-function object");
deepStrictEqual(runtime.descriptor, {
  configurable: true,
  enumerable: false,
  writable: true
});
strictEqual(runtime.functionName, "useSemantic");
strictEqual(runtime.isConstructable, true,
  "the documented module-function intrinsic carve-out is observable");
ok(runtime.order.indexOf("before") < runtime.order.indexOf("selected")
  && runtime.order.indexOf("selected") < runtime.order.indexOf("after"),
  "descriptor seeding preserves the selected member's own-key position");
strictEqual(runtime.recursiveAfterReassignment, 101,
  "recursion continues through the mutable Owner.field property");
strictEqual(runtime.registered, true);
deepStrictEqual(runtime.mappedValues, [2, 4],
  "Haxe's typed Array.map constructor intrinsic survives relocation");
strictEqual(runtime.safeAbsent, null,
  "a proved undefined helper retains its absence semantics after relocation");
strictEqual(runtime.safePresent, "present",
  "a proved undefined helper retains its present value after relocation");
strictEqual(runtime.staticInitialized, "static-init0");
strictEqual(runtime.classInitialized, "class-init0");
strictEqual(runtime.crossModuleInitialized, 13,
  "a cyclic module static initializer sees the installed selected function");
strictEqual(runtime.crossModuleCall, 13,
  "cross-module selected calls preserve the existing cyclic accessor");
strictEqual(runtime.subclassInitialized, 22,
  "a subclass initializer observes its base owner's installed function");

const classicDeclaration = readFileSync(path.join(outputRoot,
  "classic/module_functions/Selected.d.ts"), "utf8");
ok(classicDeclaration.includes("static selected"));
ok(classicDeclaration.includes("static sameName(value: number): number"));
ok(classicDeclaration.includes("static renamedSelected(value: number): number"));
ok(classicDeclaration.includes("export declare class SecondarySelected"));
ok(!/(?:declare\s+)?function\s+useSemantic/.test(classicDeclaration),
  "classic declarations expose only the existing class method");
const tsDeclaration = readFileSync(path.join(outputRoot,
  "ts/dist/out/ts/src-gen/module_functions/Selected.d.ts"), "utf8");
ok(tsDeclaration.includes("static selected"));
ok(tsDeclaration.includes("static sameName(value: number): number"));
ok(tsDeclaration.includes("static renamedSelected(value: number): number"));
ok(tsDeclaration.includes("export declare class SecondarySelected"));
ok(!/(?:declare\s+)?function\s+useSemantic/.test(tsDeclaration),
  "tsc declarations do not publish the private module function");
const tsxDeclaration = readFileSync(path.join(outputRoot,
  "ts/dist/out/tsx/src-gen/module_functions/Selected.d.ts"), "utf8");
strictEqual(tsxDeclaration, tsDeclaration,
  "TS and TSX preserve the same public declaration surface");

for (const [define, diagnostic] of negativeCases) {
  assertCompileFailure("classic", define, diagnostic);
  assertCompileFailure("ts", define, diagnostic);
}
assertCompileFailure("ts", "module_function_private_helper_collision",
  "GENES-MODULE-FUNCTION-COLLISION-005",
  ["genes.ts.lower_private_helpers"]);

console.log(
  `module-functions:ok (TS/TSX/classic deterministic output + TS 5/6/7 + runtime identity/descriptor/order/init/registration/cycles + DCE/source maps/declarations + ${negativeCases.length * 2 + 1} rollback negatives)`
);
