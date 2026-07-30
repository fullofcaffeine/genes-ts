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

function sourcePoint(source: string, needle: string): { line: number; column: number } {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
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

  const presentReturn = profile === "classic"
    ? "return (value);"
    : "return ((value)! as string | null);";
  const presentPoint = generatedPoint(source, presentReturn);
  const presentValuePoint = {
    line: presentPoint.line,
    column: presentPoint.column
      + (profile === "classic" ? "return (".length : "return ((".length)
  };
  const presentOriginal = map.originalPositionFor(presentValuePoint);
  const expectedPresent = sourcePoint(haxeSource, "value.assumePresent()");
  strictEqual(presentOriginal.line, expectedPresent.line,
    `${profile} relocated presence proof keeps its exact Haxe source line`);
  strictEqual(presentOriginal.column, expectedPresent.column,
    `${profile} relocated presence proof keeps its exact Haxe source column`);

  const publicPoint = generatedPoint(source, "function publicIdentity");
  const publicOriginal = map.originalPositionFor(publicPoint);
  strictEqual(publicOriginal.line,
    sourceLine(haxeSource, "public static function publicIdentity"),
    `${profile} public module function maps to its Haxe method declaration`);
}

function assertModuleValueSourceMap(profile: "classic" | "ts" | "tsx",
  extension: "js" | "ts" | "tsx"): void {
  const generated = path.join(outputRoot, profile,
    ...(profile === "classic" ? [] : ["src-gen"]),
    `module_functions/TopLevel.${extension}`);
  const source = readFileSync(generated, "utf8");
  const haxePath = path.join(fixtureRoot,
    "src/module_functions/TopLevel.hx");
  const haxeSource = readFileSync(haxePath, "utf8");
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generated}.map`, "utf8")) as RawSourceMap);

  const declaration = map.originalPositionFor(
    generatedPoint(source, "export const metadata"));
  ok(declaration.source?.endsWith("src/module_functions/TopLevel.hx"),
    `${profile} module value maps to TopLevel.hx`);
  strictEqual(declaration.line,
    sourceLine(haxeSource, "final metadata: ModuleMetadata"),
    `${profile} module value binding maps to its Haxe declaration`);

  const initializer = map.originalPositionFor(
    generatedPoint(source, '"direct module value"'));
  strictEqual(initializer.line,
    sourceLine(haxeSource, 'title: "direct module value"'),
    `${profile} module value initializer keeps its exact Haxe source line`);

  const asyncDeclaration = map.originalPositionFor(
    generatedPoint(source, "async function topLevelAsync"));
  strictEqual(asyncDeclaration.line,
    sourceLine(haxeSource, "function topLevelAsync"),
    `${profile} async module function maps to its Haxe declaration`);

  const awaitedValue = map.originalPositionFor(
    generatedPoint(source, profile === "classic"
      ? "await Promise.resolve"
      : "await globalThis.Promise.resolve"));
  strictEqual(awaitedValue.line,
    sourceLine(haxeSource, "final resolved = await"),
    `${profile} relocated await keeps its Haxe source line`);
}

function assertImplementationShape(relative: string): void {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let assertionFreeCode = code;
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
  ok(source.includes("export function publicIdentity"),
    `${relative} publishes the selected public module function directly`);
  ok(source.includes("Selected.publicIdentity = publicIdentity"),
    `${relative} keeps one exact Haxe/native public function identity`);
  ok(source.includes("export function publicByFieldName"),
    `${relative} supports zero-argument @:expose by field name`);
  ok(source.includes("function sameName")
    && source.includes("Selected.sameName = sameName"),
    `${relative} accepts an exact module name equal to its Haxe field`);
  ok(source.indexOf("function secondaryModuleFunction")
    < source.indexOf("class SecondarySelected")
    && source.indexOf("SecondarySelected.selected = secondaryModuleFunction")
      > source.indexOf("class SecondarySelected"),
    `${relative} plans a second retained owner in stable module order`);
  ok(source.includes("function Ready")
    && source.includes("Selected.enumConstructorName = Ready"),
    `${relative} allows a module binding that matches an enum member`);
  if (!relative.startsWith("classic/")) {
    ok(source.includes(
      "function nullableDefaultModuleFunction(value: string | null = null)"),
    `${relative} keeps the nullable default on the real module function`);
    ok(source.includes(
      "static nullableDefault(value?: string | null): string;"),
    `${relative} emits a type-only descriptor overload`);
    ok(source.includes(
      "return ((value)! as string | null);"),
    `${relative} preserves nested null in the presence assertion`);
    assertionFreeCode = assertionFreeCode.replace(
      "((value)! as string | null)",
      "value"
    );
  } else {
    ok(
      source.includes("return (value);"),
      `${relative} erases the presence proof to a classic identity`);
  }
  ok(!/\b(?:any|unknown|Dynamic|untyped)\b|unsafeCast|\sas\s/.test(
    assertionFreeCode
  ),
    `${relative} introduces no broad type or target assertion`);
  ok(!source.includes("DeadSelected"),
    `${relative} proves metadata does not root dead code`);
  ok(!source.includes("UndefinablePresentMarker"),
    `${relative} leaked the compiler-owned presence marker`);
  ok(!source.includes("module-function-import"),
    `${relative} proves a dead selected body adds no runtime import edge`);
}

function assertTopLevelImplementationShape(relative: string): void {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  const sibling = relative.includes("TopLevelSibling");
  ok(source.includes(relative.endsWith(".js")
    ? "export function topLevelIdentity(value)"
    : "export function topLevelIdentity<T>(value: T): T"),
    `${relative} emits the Haxe module function as one direct ESM function`);
  ok(!source.includes("TopLevel_Fields_"),
    `${relative} omits the compiler-synthetic module-fields class`);
  ok(!source.includes("genes/Register"),
    `${relative} does not retain registration machinery`);
  ok(source.includes("export const metadata")
    && source.includes(" = {"),
    `${relative} emits the immutable Haxe value as one direct ESM const`);
  ok(source.includes(sibling
    ? '"title": "sibling module value"'
    : '"title": "direct module value"')
    && (sibling || source.includes('"tags": ["typed", "esm"]')),
    `${relative} preserves the closed object initializer directly`);
  if (!sibling) {
    ok(!source.includes("deadMetadata")
      && !source.includes("must not reach output"),
      `${relative} proves module-value metadata does not create a DCE root`);
    if (relative.endsWith(".js")) {
      ok(source.includes("export async function topLevelAsync(value)")
        && source.includes("const resolved = await Promise.resolve(value)"),
        `${relative} emits one direct native async/await module function`);
    } else {
      ok(source.includes(
        "export async function topLevelAsync(value: number): globalThis.Promise<number>")
        && source.includes(
          "const resolved: number = await globalThis.Promise.resolve(value)"),
        `${relative} emits one direct typed native async/await module function`);
    }
  }
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
  readonly enumConstructorCall: number;
  readonly nullableDefault: string;
  readonly safeAbsent: null;
  readonly safePresent: string;
  readonly provedNull: null;
  readonly provedPresent: string;
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
    && typeof record.enumConstructorCall === "number"
    && typeof record.nullableDefault === "string"
    && record.safeAbsent === null
    && typeof record.safePresent === "string"
    && record.provedNull === null
    && typeof record.provedPresent === "string"
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
  enumConstructorCall: Selected.enumConstructorName(2),
  nullableDefault: Selected.nullableDefault(),
  safeAbsent: Selected.safeOptional(undefined),
  safePresent: Selected.safeOptional("present"),
  provedNull: Selected.safePresent(null),
  provedPresent: Selected.safePresent("proved"),
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

function exactPublicRuntimeIdentity(): boolean {
  const program = `
import {Selected, publicIdentity as ownerPublicIdentity} from "./tests/module-functions/out/classic/module_functions/Selected.js";
import {publicIdentity as rootPublicIdentity} from "./tests/module-functions/out/classic/index.js";
const value = {label: "public", detail: 42};
console.log(
  Selected.publicIdentity === ownerPublicIdentity
  && ownerPublicIdentity === rootPublicIdentity
  && rootPublicIdentity(value) === value
  ? "true"
  : "false"
);`;
  return execFileSync(process.execPath,
    ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim().split(/\r?\n/).at(-1) === "true";
}

function asyncModuleRuntime(): number {
  const program = `
import {topLevelAsync} from "./tests/module-functions/out/classic/module_functions/TopLevel.js";
console.log(await topLevelAsync(41));`;
  return Number(execFileSync(process.execPath,
    ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim());
}

function directModuleRegressionRuntime(): string {
  const program = `
import {firstMatchIndex} from "./tests/module-functions/out/classic/module_functions/TopLevel.js";
import {appendWithBoundMethod} from "./tests/module-functions/out/classic/module_functions/RegisterHelpers.js";
import {readMetadata} from "./tests/module-functions/out/classic/module_functions/ShadowedBindings.js";
import {foreignTitle, identityPair} from "./tests/module-functions/out/classic/module_functions/LocalBindingImportCollision.js";
import {positive} from "./tests/module-functions/out/classic/module_functions/TsRegisterHelpers.js";
import {exposedValue} from "./tests/module-functions/out/classic/module_functions/ExposedValue.js";
import {moduleInitValue} from "./tests/module-functions/out/classic/module_functions/ModuleInit.js";
import {branchCallbackValue, callbackArgumentValue, calledClosureMutationValue, constructorHelperValue, loopCallbackValue, staticHelperValue} from "./tests/module-functions/out/classic/module_functions/ModuleValueHelpers.js";
console.log([
  firstMatchIndex(["first", "match"]),
  appendWithBoundMethod([1, 2, 3]),
  readMetadata("parameter"),
  foreignTitle(),
  identityPair(),
  positive(null),
  exposedValue,
  moduleInitValue(),
  staticHelperValue,
  constructorHelperValue,
  callbackArgumentValue,
  calledClosureMutationValue,
  branchCallbackValue,
  loopCallbackValue
].join("|"));`;
  return execFileSync(process.execPath,
    ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim();
}

const negativeCases = [
  ["module_function_arity", "GENES-MODULE-FUNCTION-ARITY-001"],
  ["module_function_arity_multiple", "GENES-MODULE-FUNCTION-ARITY-001"],
  ["module_function_nonliteral", "GENES-MODULE-FUNCTION-LITERAL-002"],
  ["module_function_empty", "GENES-MODULE-FUNCTION-EMPTY-003"],
  ["module_function_identifier", "GENES-MODULE-FUNCTION-IDENTIFIER-004"],
  ["module_function_object_global", "GENES-MODULE-FUNCTION-IDENTIFIER-004"],
  ["module_function_undefined_global", "GENES-MODULE-FUNCTION-IDENTIFIER-004"],
  ["module_function_collision", "GENES-MODULE-FUNCTION-COLLISION-005"],
  ["module_function_duplicate", "GENES-MODULE-FUNCTION-COLLISION-005"],
  ["module_function_instance", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_inline", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_dynamic", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_generic_owner", "GENES-MODULE-FUNCTION-OWNER-007"],
  ["module_function_overload", "GENES-MODULE-FUNCTION-OVERLOAD-009"],
  ["module_function_raw_syntax", "GENES-MODULE-FUNCTION-LEXICAL-010"],
  [
    "module_function_non_async_await_syntax",
    "GENES-MODULE-FUNCTION-LEXICAL-010"
  ],
  ["module_function_property", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_prototype", "GENES-MODULE-FUNCTION-SHAPE-006"],
  ["module_function_duplicate_native", "GENES-MODULE-FUNCTION-SHAPE-006"],
  [
    "module_function_module_field_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ],
  [
    "module_function_global_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ],
  [
    "module_function_expose_mismatch",
    "GENES-MODULE-FUNCTION-EXPOSE-NAME-016"
  ],
  [
    "module_function_expose_arity",
    "GENES-MODULE-FUNCTION-EXPOSE-ARITY-011"
  ],
  [
    "module_function_expose_nonliteral",
    "GENES-MODULE-FUNCTION-EXPOSE-LITERAL-012"
  ],
  [
    "module_function_expose_empty",
    "GENES-MODULE-FUNCTION-EXPOSE-EMPTY-013"
  ],
  [
    "module_function_expose_identifier",
    "GENES-MODULE-FUNCTION-EXPOSE-IDENTIFIER-014"
  ],
  ["module_value_arity", "GENES-MODULE-VALUE-ARITY-001"],
  ["module_value_arity_multiple", "GENES-MODULE-VALUE-ARITY-001"],
  ["module_value_nonliteral", "GENES-MODULE-VALUE-LITERAL-002"],
  ["module_value_empty", "GENES-MODULE-VALUE-EMPTY-003"],
  ["module_value_identifier", "GENES-MODULE-VALUE-IDENTIFIER-004"],
  [
    "module_value_dual_marker",
    "GENES-DIRECT-MODULE-BINDING-CONFLICT-001"
  ],
  [
    "module_value_function_collision",
    "GENES-MODULE-FUNCTION-COLLISION-005"
  ],
  ["module_value_class_static", "GENES-MODULE-VALUE-OWNER-006"],
  ["module_value_function", "GENES-MODULE-VALUE-SHAPE-007"],
  ["module_value_mutable", "GENES-MODULE-VALUE-MUTABLE-009"],
  ["module_value_public_name", "GENES-MODULE-VALUE-PUBLIC-NAME-010"],
  ["module_value_native_name", "GENES-MODULE-VALUE-NATIVE-NAME-011"],
  ["module_value_mixed", "GENES-MODULE-VALUE-MIXED-OWNER-013"],
  ["module_value_cycle", "GENES-MODULE-VALUE-CYCLE-014"],
  ["module_value_forward_read", "GENES-MODULE-VALUE-FORWARD-015"],
  ["module_value_iife_forward_read", "GENES-MODULE-VALUE-FORWARD-015"],
  [
    "module_value_local_closure_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_reassigned_closure_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_called_closure_mutation_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_zero_iteration_closure_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_switch_closure_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_try_closure_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_function_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_class_static_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_callback_argument_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_instance_method_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
  ],
  [
    "module_value_constructor_forward_read",
    "GENES-MODULE-VALUE-FORWARD-015"
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
  ok(/module_function_invalid\/(?:Main|ModuleValueInvalid|ModuleValueCycleA|ModuleValueCycleB)\.hx:\d+:/.test(diagnostics),
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

run("haxe", ["tests/module-functions/build-global-classic.hxml"]);
run("haxe", ["tests/module-functions/build-global-ts.hxml"]);

runGeneratedTypeScriptMatrix("tests/module-functions/tsconfig.json");

assertImplementationShape("classic/module_functions/Selected.js");
assertImplementationShape("ts/src-gen/module_functions/Selected.ts");
assertImplementationShape("tsx/src-gen/module_functions/Selected.tsx");
assertTopLevelImplementationShape(
  "classic/module_functions/TopLevel.js");
assertTopLevelImplementationShape(
  "ts/src-gen/module_functions/TopLevel.ts");
assertTopLevelImplementationShape(
  "tsx/src-gen/module_functions/TopLevel.tsx");
assertTopLevelImplementationShape(
  "classic/module_functions/TopLevelSibling.js");
assertTopLevelImplementationShape(
  "ts/src-gen/module_functions/TopLevelSibling.ts");
assertTopLevelImplementationShape(
  "tsx/src-gen/module_functions/TopLevelSibling.tsx");
for (const relative of [
  "classic/module_functions/RegisterHelpers.js",
  "ts/src-gen/module_functions/RegisterHelpers.ts",
  "tsx/src-gen/module_functions/RegisterHelpers.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("genes/Register")
    && source.includes("Register.bind(output, output.push)"),
    `${relative} retains Register only for the method-closure helper`);
  ok(!source.includes("RegisterHelpers_Fields_"),
    `${relative} still omits the compiler-synthetic owner`);
}
for (const relative of [
  "classic/module_functions/ModuleInit.js",
  "ts/src-gen/module_functions/ModuleInit.ts",
  "tsx/src-gen/module_functions/ModuleInit.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  const owner = relative.startsWith("classic/")
    ? "class ModuleInit_Fields_"
    : "export class ModuleInit_Fields_";
  ok(source.includes("export function moduleInitValue")
    && source.includes(owner)
    && source.includes('ModuleInitState.value = "module-init"')
    && source.indexOf(owner)
      < source.lastIndexOf('ModuleInitState.value = "module-init"'),
    `${relative} retains the compiler-created owner and its module initializer`);
}
for (const relative of [
  "classic/module_functions/ModuleValueHelpers.js",
  "ts/src-gen/module_functions/ModuleValueHelpers.ts",
  "tsx/src-gen/module_functions/ModuleValueHelpers.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("class DirectValueHelper")
    && source.includes("export const staticHelperValue")
    && source.includes("export const constructorHelperValue")
    && source.includes("export const callbackArgumentValue")
    && source.includes("export const calledClosureMutationValue")
    && source.includes("export const branchCallbackValue")
    && source.includes("export const loopCallbackValue"),
    `${relative} accepts safe exact methods, constructors, and callable joins`);
  ok(!source.includes("ModuleValueHelpers_Fields_"),
    `${relative} omits only the compiler-created module-fields owner`);
}
for (const relative of [
  "global-classic/module_functions/TopLevel.js",
  "global-ts/src-gen/module_functions/TopLevel.ts"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("genes/Register")
    && source.includes("const $global = Register.$global")
    && source.includes("export function topLevelIdentity"),
    `${relative} imports Register for the compiler-generated global prologue`);
}
for (const relative of [
  "classic/module_functions/ShadowedBindings.js",
  "ts/src-gen/module_functions/ShadowedBindings.ts",
  "tsx/src-gen/module_functions/ShadowedBindings.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("function readMetadata(metadata_1")
    && source.includes('const metadata_1_1')
    && source.includes('metadata.title + ":" + metadata_1 + ":" + metadata_1_1'),
    `${relative} keeps the module binding, shifted parameter, and source-suffixed local distinct`);
}
for (const relative of [
  "classic/module_functions/LocalBindingImportCollision.js",
  "ts/src-gen/module_functions/LocalBindingImportCollision.ts",
  "tsx/src-gen/module_functions/LocalBindingImportCollision.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("metadata as metadata__1")
    && source.includes("topLevelIdentity as topLevelIdentity__1")
    && source.includes("export const metadata")
    && source.includes("export function topLevelIdentity")
    && source.includes("metadata__1.title")
    && source.includes('topLevelIdentity__1("foreign")'),
    `${relative} aliases foreign value/function bindings around local exports`);
}
for (const relative of [
  "ts/src-gen/module_functions/TsRegisterHelpers.ts",
  "tsx/src-gen/module_functions/TsRegisterHelpers.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("genes/Register")
    && source.includes("Register.unsafeCast<number>(value)")
    && source.includes("Register.unsafeCast<string>(value)"),
    `${relative} retains Register for every planned TypeScript-only assertion`);
  ok(!source.includes("TsRegisterHelpers_Fields_"),
    `${relative} still omits the compiler-synthetic owner`);
}
{
  const relative = "classic/module_functions/TsRegisterHelpers.js";
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("return value > 0")
    && source.includes("return value")
    && !source.includes("genes/Register")
    && !source.includes("TsRegisterHelpers_Fields_"),
    `${relative} keeps the native operator without a TypeScript-only helper`);
}
for (const relative of [
  "ts/src-gen/module_functions/TsNullHelper.ts",
  "tsx/src-gen/module_functions/TsNullHelper.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("genes/Register")
    && source.includes("Register.unsafeCast<string>(null)"),
    `${relative} retains Register for a non-null destination assertion`);
}
{
  const relative = "classic/module_functions/TsNullHelper.js";
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes("return null")
    && !source.includes("genes/Register")
    && !source.includes("TsNullHelper_Fields_"),
    `${relative} returns null without adding a TypeScript-only helper`);
}
for (const relative of [
  "classic/index.js",
  "ts/src-gen/index.ts",
  "tsx/src-gen/index.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes('exposedOnly'),
    `${relative} re-exports the expose-only class module function`);
}
for (const relative of [
  "classic/index.js",
  "ts/src-gen/index.ts",
  "tsx/src-gen/index.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(!source.includes("exposedValue"),
    `${relative} does not broaden a direct value into the root barrel`);
}
for (const relative of [
  "classic/module_functions/Main.js",
  "ts/src-gen/module_functions/Main.ts",
  "tsx/src-gen/module_functions/Main.tsx"
]) {
  const source = readFileSync(path.join(outputRoot, relative), "utf8");
  ok(source.includes('from "./TopLevel.js"')
    && source.includes("topLevelIdentity"),
    `${relative} imports the direct module bindings`);
  ok(source.includes('from "./TopLevelSibling.js"')
    && source.includes("topLevelIdentity as topLevelIdentity__1"),
    `${relative} preserves same-named module-local ESM identity`);
  ok(source.includes('topLevelIdentity, metadata')
    || source.includes('topLevelIdentity,metadata')
    || source.includes('topLevelAsync, topLevelIdentity, metadata'),
    `${relative} imports the direct module value with its sibling function`);
  ok(source.includes('metadata as metadata__1'),
    `${relative} aliases the sibling module value collision safely`);
  ok(source.includes('topLevelIdentity("top-level")'),
    `${relative} calls the direct module binding`);
  ok(source.includes('topLevelIdentity__1("top-level-sibling")'),
    `${relative} calls the aliased sibling module binding`);
  ok(source.includes('metadata.title + ":" + metadata.tags.length'),
    `${relative} reads the direct typed module value`);
  ok(source.includes("metadata__1.title"),
    `${relative} reads the aliased sibling module value`);
  ok(!source.includes("TopLevel_Fields_"),
    `${relative} does not expose a synthetic owner to callers`);
}
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
assertModuleValueSourceMap("classic", "js");
assertModuleValueSourceMap("ts", "ts");
assertModuleValueSourceMap("tsx", "tsx");

const runtime = runtimeEvidence();
strictEqual(exactRuntimeIdentity(), true,
  "the final class property is the exact module-function object");
strictEqual(exactPublicRuntimeIdentity(), true,
  "owner, public binding, and root re-export share one function identity");
strictEqual(asyncModuleRuntime(), 42,
  "the direct classic module function preserves native async/await runtime behavior");
strictEqual(directModuleRegressionRuntime(),
  "1|3|module:parameter:local|local:direct module value|local-own:foreign|false|owned-module-only|module-init|4|5|6|8|2|4",
  "direct helpers, shadowed bindings, initialization, exact call targets, branch/loop joins, findIndex, and owner-only exports run natively");
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
strictEqual(runtime.enumConstructorCall, 7,
  "an enum member name does not block the same top-level module binding");
strictEqual(runtime.nullableDefault, "missing",
  "the real module function retains nullable default-argument behavior");
strictEqual(runtime.safeAbsent, null,
  "a proved undefined helper retains its absence semantics after relocation");
strictEqual(runtime.safePresent, "present",
  "a proved undefined helper retains its present value after relocation");
strictEqual(runtime.provedNull, null,
  "the relocated presence marker retains a nested Haxe null");
strictEqual(runtime.provedPresent, "proved",
  "the relocated presence marker retains an ordinary present value");
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
ok(classicDeclaration.includes(
  "export declare const publicIdentity: typeof Selected.publicIdentity"),
  "classic declarations publish the generic binding from the class contract");
const classicRootDeclaration = readFileSync(path.join(outputRoot,
  "classic/index.d.ts"), "utf8");
ok(classicRootDeclaration.includes(
  'export {publicIdentity} from "./module_functions/Selected.js"'),
  "classic root declarations re-export the stable public binding");
const classicTopLevelDeclaration = readFileSync(path.join(outputRoot,
  "classic/module_functions/TopLevel.d.ts"), "utf8");
ok(classicTopLevelDeclaration.includes(
  "export const topLevelIdentity: <T>(value: T) => T"),
  "classic declarations preserve the direct generic module field");
ok(classicTopLevelDeclaration.includes(
  "export const metadata: ModuleMetadata"),
  "classic declarations preserve the direct typed module value");
ok(classicTopLevelDeclaration.includes(
  "export const topLevelAsync: (value: number) => globalThis.Promise<number>"),
  "classic declarations preserve the direct async module function");
const tsDeclaration = readFileSync(path.join(outputRoot,
  "ts/dist/out/ts/src-gen/module_functions/Selected.d.ts"), "utf8");
ok(tsDeclaration.includes("static selected"));
ok(tsDeclaration.includes("static sameName(value: number): number"));
ok(tsDeclaration.includes("static renamedSelected(value: number): number"));
ok(tsDeclaration.includes("export declare class SecondarySelected"));
ok(!/(?:declare\s+)?function\s+useSemantic/.test(tsDeclaration),
  "tsc declarations do not publish the private module function");
ok(tsDeclaration.includes("export declare function publicIdentity"),
  "tsc declarations publish the direct generic module function");
const tsRootDeclaration = readFileSync(path.join(outputRoot,
  "ts/dist/out/ts/src-gen/index.d.ts"), "utf8");
ok(tsRootDeclaration.includes(
  'export { publicIdentity } from "./module_functions/Selected.js"'),
  "tsc root declarations re-export the stable public binding");
const tsTopLevelDeclaration = readFileSync(path.join(outputRoot,
  "ts/dist/out/ts/src-gen/module_functions/TopLevel.d.ts"), "utf8");
ok(tsTopLevelDeclaration.includes(
  "export declare function topLevelIdentity<T>(value: T): T"),
  "tsc declarations preserve the direct generic module function");
ok(tsTopLevelDeclaration.includes(
  "export declare const metadata: ModuleMetadata"),
  "tsc declarations preserve the direct typed module value");
ok(tsTopLevelDeclaration.includes(
  "export declare function topLevelAsync(value: number): globalThis.Promise<number>"),
  "tsc declarations preserve the direct async module function");
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
