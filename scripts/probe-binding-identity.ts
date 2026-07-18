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
  namedBinding: "named"
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
 * Runs the known-failing reduction without enrolling it as a release gate.
 *
 * This is intentionally a `probe`, not a passing test: genes-ntz requires a
 * narrow architecture review before production identity changes. The command
 * compiles both first-class output profiles, shows their generated import
 * lines and runtime results, then asserts the correct JavaScript behavior. It
 * will exit nonzero on the reviewed baseline because both profiles collapse
 * the named binding into the default binding.
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
  assertContains(
    source,
    'import {Foo as Foo__1} from "genes-binding-identity-fixture"',
    label
  );
}

assertContains(tsSource, "static defaultValue(): Foo", "genes-ts source");
assertContains(tsSource, "static namedValue(): Foo__1", "genes-ts source");
assertContains(tsSource, "return new Foo();", "genes-ts default constructor");
assertContains(tsSource, "return new Foo__1();", "genes-ts named constructor");
assertContains(classicSource, "return new Foo();", "classic default constructor");
assertContains(classicSource, "return new Foo__1();", "classic named constructor");
assertContains(
  generatedDeclaration,
  "static defaultValue(): Foo",
  "TypeScript-emitted default return type"
);
assertContains(
  generatedDeclaration,
  "static namedValue(): Foo__1",
  "TypeScript-emitted named return type"
);
assertContains(
  classicDeclaration,
  "static defaultValue(): Foo",
  "classic default return type"
);
assertContains(
  classicDeclaration,
  "static namedValue(): Foo__1",
  "classic named return type"
);

deepStrictEqual(tsTranscript, expected, "genes-ts collapsed two import forms");
deepStrictEqual(classicTranscript, expected, "classic Genes collapsed two import forms");
