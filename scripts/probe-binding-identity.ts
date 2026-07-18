import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/genes-ts/package-shapes");
const outputRoot = path.join(fixtureRoot, "out/binding-identity");
const packageName = "genes-binding-identity-fixture";
const expected = {
  defaultBinding: "default",
  namedBinding: "named",
  duplicateNamedBinding: "named",
  firstAliasBinding: "named",
  secondAliasBinding: "named",
  namespaceBinding: "namespace",
  collisionDefaultBinding: "default",
  dropdownRootBinding: "dropdown-root",
  dropdownMenuBinding: "dropdown-menu",
  localNativeNamedBinding: "local-named",
  localNativeRootBinding: "local-root",
  nativeNamedBinding: "native-named",
  nativeStringBinding: "native-string",
  nativeDottedBinding: "native-dotted",
  nativeOnlyYear: 1970,
  abstractBinding: "abstract-alpha",
  abstractNamespaceBinding: "abstract-namespace-alpha",
  defaultFieldBinding: "field-default",
  namedFieldBinding: "field-named"
};

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function installPackage(profileRoot: string): void {
  const destination = path.join(profileRoot, "node_modules", packageName);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(fixtureRoot, "packages", packageName), destination, {
    recursive: true
  });
}

function runtimeTranscript(entrypoint: string): unknown {
  const output = execFileSync("node", [entrypoint], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const line = output.trim().split(/\r?\n/).at(-1);
  if (line === undefined)
    throw new Error(`Binding-identity probe produced no transcript:\n${output}`);
  return JSON.parse(line);
}

function assertContains(source: string, expectedText: string, label: string): void {
  ok(
    source.includes(expectedText),
    `${label} did not contain the exact expected text:\n${expectedText}\n\nActual source:\n${source}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the generated JSON before giving it to the older source-map library.
 *
 * Why: `JSON.parse` cannot prove a file's shape at compile time, while
 * `source-map` 0.6 expects a fully typed object. Keeping the unknown value in
 * this small decoder avoids a type assertion and prevents malformed test data
 * from reaching the consumer.
 */
function parseSourceMap(file: string): RawSourceMap {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  ok(isRecord(parsed), `${file}: expected a source-map object`);
  ok(parsed.version === 3, `${file}: expected source-map version 3`);
  ok(typeof parsed.file === "string", `${file}: expected file`);
  ok(typeof parsed.sourceRoot === "string", `${file}: expected sourceRoot`);
  ok(Array.isArray(parsed.sources) && parsed.sources.every(
    value => typeof value === "string"
  ), `${file}: expected string sources`);
  ok(Array.isArray(parsed.names) && parsed.names.every(
    value => typeof value === "string"
  ), `${file}: expected string names`);
  ok(typeof parsed.mappings === "string", `${file}: expected mappings`);
  return {
    // source-map@0.6 models this JSON field as a string even though source-map
    // v3 writes the number 3. The value was checked above before conversion.
    version: "3",
    file: parsed.file,
    sourceRoot: parsed.sourceRoot,
    sources: parsed.sources,
    names: parsed.names,
    mappings: parsed.mappings
  };
}

/** Requires one generated token to retain the Haxe file that introduced it. */
function assertMappedTo(
  generatedPath: string,
  generatedToken: string,
  expectedSourceSuffix: string
): void {
  const generated = readFileSync(generatedPath, "utf8");
  const offset = generated.indexOf(generatedToken);
  ok(offset !== -1, `${generatedPath} contains ${generatedToken}`);
  const before = generated.slice(0, offset).split("\n");
  const consumer = new SourceMapConsumer(parseSourceMap(`${generatedPath}.map`));
  const original = consumer.originalPositionFor({
    line: before.length,
    column: before.at(-1)?.length ?? 0,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(original.source?.endsWith(expectedSourceSuffix),
    `${generatedToken} maps to ${expectedSourceSuffix}; got ${original.source}`);
}

/**
 * Proves exact default-versus-named binding identity in every public surface.
 *
 * The command compiles both first-class output profiles, checks genes-ts and
 * classic declaration typing with the pinned TypeScript versions, executes
 * both results, and prints a compact transcript for review. It covers distinct
 * export forms, repeated origins, explicit aliases, and dotted members whose
 * imported root had to be renamed after a collision.
 */
rmSync(outputRoot, { recursive: true, force: true });

run("haxe", ["tests/genes-ts/package-shapes/build-binding-identity-standard.hxml"]);
const standardSource = readFileSync(
  path.join(outputRoot, "standard/index.js"),
  "utf8"
);
assertContains(
  standardSource,
  'require("genes-binding-identity-fixture").NativeNamed',
  "standard Haxe named native binding"
);
assertContains(
  standardSource,
  'require("genes-binding-identity-fixture").String',
  "standard Haxe built-in-name package binding"
);
assertContains(
  standardSource,
  'require("genes-binding-identity-fixture").Component',
  "standard Haxe dotted native binding"
);
assertContains(
  standardSource,
  'require("genes-binding-identity-fixture").AbstractCodes',
  "standard Haxe named extern-abstract binding"
);
assertContains(
  standardSource,
  ".NamespaceAlpha",
  "standard Haxe namespace extern-abstract value"
);
ok(!standardSource.includes("new NativeRoot.Component()"),
  "standard Haxe bypassed the package import through raw native text");

run("haxe", ["tests/genes-ts/package-shapes/build-binding-identity-ts.hxml"]);
const tsRoot = path.join(outputRoot, "ts");
installPackage(tsRoot);
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/package-shapes/tsconfig.binding-identity.json"
);
const tsTranscript = runtimeTranscript(
  "tests/genes-ts/package-shapes/out/binding-identity/ts/dist/index.js"
);

run("haxe", ["tests/genes-ts/package-shapes/build-binding-identity-classic.hxml"]);
const classicRoot = path.join(outputRoot, "classic");
installPackage(classicRoot);
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/package-shapes/tsconfig.binding-identity-classic.json",
  { emit: false }
);
const classicTranscript = runtimeTranscript(
  "tests/genes-ts/package-shapes/out/binding-identity/classic/src-gen/index.js"
);

const tsSource = readFileSync(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "utf8"
);
const classicSource = readFileSync(
  path.join(classicRoot, "src-gen/package_shapes/BindingIdentityProbe.js"),
  "utf8"
);
const generatedDeclaration = readFileSync(
  path.join(tsRoot, "dist/package_shapes/BindingIdentityProbe.d.ts"),
  "utf8"
);
const classicDeclaration = readFileSync(
  path.join(classicRoot, "src-gen/package_shapes/BindingIdentityProbe.d.ts"),
  "utf8"
);
console.log(JSON.stringify({
  tsImports: tsSource.split(/\r?\n/).filter(line => line.startsWith("import ")),
  classicImports: classicSource.split(/\r?\n/).filter(line => line.startsWith("import ")),
  generatedDeclarationImports: generatedDeclaration
    .split(/\r?\n/)
    .filter(line => line.startsWith("import ")),
  classicDeclarationImports: classicDeclaration
    .split(/\r?\n/)
    .filter(line => line.startsWith("import ")),
  tsTranscript,
  classicTranscript
}, null, 2));

for (const [label, source] of [
  ["genes-ts source", tsSource],
  ["classic JavaScript", classicSource],
  ["TypeScript-emitted declaration", generatedDeclaration],
  ["classic declaration", classicDeclaration]
] as const) {
  assertContains(
    source,
    'import Foo from "genes-binding-identity-fixture"',
    label
  );
  assertContains(source, "Foo as Foo__1", label);
  assertContains(source, "Foo as FirstFoo", label);
  assertContains(source, "Foo as SecondFoo", label);
  assertContains(
    source,
    'import Dropdown from "genes-binding-identity-fixture"',
    label
  );
  assertContains(source, "Dropdown as Dropdown__1", label);
  assertContains(source, "NativeNamed as NativeNamed__1", label);
  assertContains(
    source,
    'import NativeRoot__1 from "genes-binding-identity-fixture"',
    label
  );
  ok(!source.includes("Foo__3"), `${label} allocated an unnecessary Foo__3 binding`);
}

for (const [label, source] of [
  ["genes-ts source", tsSource],
  ["classic JavaScript", classicSource]
] as const) {
  assertContains(
    source,
    'import * as Foo__2 from "genes-binding-identity-fixture"',
    label
  );
  assertContains(source, "return new Foo();", `${label} default constructor`);
  assertContains(source, "return new Foo__1();", `${label} named constructor`);
  assertContains(source, "return new FirstFoo();", `${label} first explicit alias`);
  assertContains(source, "return new SecondFoo();", `${label} second explicit alias`);
  assertContains(source, "return Foo__2.namespaceMarker();", `${label} namespace binding`);
  assertContains(source, "return new Dropdown();", `${label} colliding default binding`);
  assertContains(source, "return Dropdown__1.rootMarker();", `${label} named root binding`);
  assertContains(source, "return new Dropdown__1.Menu();", `${label} dotted member binding`);
  assertContains(
    source,
    "return new NativeNamed__1();",
    `${label} native named binding`
  );
  assertContains(source, "String as String__1", `${label} native String import`);
  assertContains(
    source,
    "return new String__1().marker();",
    `${label} native String binding`
  );
  assertContains(
    source,
    "return new NativeRoot__1.Component();",
    `${label} native dotted binding`
  );
  assertContains(source, "return new Date(0);", `${label} native-only host binding`);
  assertContains(source, "AbstractCodes", `${label} imported abstract binding`);
  assertContains(
    source,
    'import * as NamespaceCode from "genes-binding-identity-fixture"',
    `${label} abstract namespace binding`
  );
  assertContains(
    source,
    'import fieldValue from "genes-binding-identity-fixture/fields"',
    `${label} default field binding`
  );
  assertContains(
    source,
    "fieldValue as fieldValue__1",
    `${label} named field binding`
  );
  assertContains(source, "return AbstractCodes.Alpha;", `${label} abstract value`);
  assertContains(
    source,
    "return NamespaceCode.NamespaceAlpha;",
    `${label} abstract namespace value`
  );
  assertContains(source, "return fieldValue();", `${label} default field call`);
  assertContains(source, "return fieldValue__1();", `${label} named field call`);
}

for (const [label, source] of [
  ["genes-ts source", tsSource],
  ["TypeScript-emitted declaration", generatedDeclaration],
  ["classic declaration", classicDeclaration]
] as const) {
  ok(!/\b(?:any|unknown)\b/.test(source), `${label} weakened the public binding types`);
  assertContains(source, "static defaultValue(): Foo", label);
  assertContains(source, "static namedValue(): Foo__1", label);
  assertContains(source, "static duplicateNamedValue(): Foo__1", label);
  assertContains(source, "static firstAliasValue(): FirstFoo", label);
  assertContains(source, "static secondAliasValue(): SecondFoo", label);
  assertContains(source, "static collisionDefaultValue(): Dropdown", label);
  assertContains(source, "static dropdownMenuValue(): Dropdown__1.Menu", label);
  assertContains(source, "static nativeNamedValue(): NativeNamed__1", label);
  assertContains(source, "static nativeDottedValue(): NativeRoot__1.Component", label);
  assertContains(source, "static nativeOnlyValue(): Date", label);
  assertContains(source, "static abstractValue(): string", label);
  assertContains(source, "static abstractNamespaceValue(): string", label);
}

assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "new NativeNamed__1()",
  "BindingIdentityProbe.hx"
);
assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "new String__1()",
  "BindingIdentityProbe.hx"
);
assertMappedTo(
  path.join(classicRoot, "src-gen/package_shapes/BindingIdentityProbe.js"),
  "new NativeRoot__1.Component()",
  "BindingIdentityProbe.hx"
);
assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "AbstractCodes",
  "ImportedCode.hx"
);
assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "NamespaceCode",
  "NamespaceCode.hx"
);
assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  'fieldValue from "genes-binding-identity-fixture/fields"',
  "DefaultField.hx"
);
assertMappedTo(
  path.join(tsRoot, "src-gen/package_shapes/BindingIdentityProbe.ts"),
  "fieldValue as fieldValue__1",
  "NamedField.hx"
);

deepStrictEqual(tsTranscript, expected, "genes-ts collapsed two import forms");
deepStrictEqual(classicTranscript, expected, "classic Genes collapsed two import forms");
console.log("binding-identity:ok (declarations + abstracts + static fields + TS/classic runtime + source maps + TS 5/6/7)");
