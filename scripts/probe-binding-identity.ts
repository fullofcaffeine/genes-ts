import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  dropdownMenuBinding: "dropdown-menu"
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
}

deepStrictEqual(tsTranscript, expected, "genes-ts collapsed two import forms");
deepStrictEqual(classicTranscript, expected, "classic Genes collapsed two import forms");
console.log("binding-identity:ok (TS + classic + both declaration surfaces + TS 5/6/7)");
