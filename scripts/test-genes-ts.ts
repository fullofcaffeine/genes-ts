import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

rmrf("tests/genes-ts/snapshot/basic/out");

run("haxe", ["tests/genes-ts/snapshot/basic/build.hxml"]);
cpSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/basic/src/resources"),
  path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/resources"),
  { recursive: true }
);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/basic/out/src-gen",
  fileExts: [".ts"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink"],
  allowUnsafeTypeFiles: [
    // Dedicated boundary fixture proving genes.ts.Unknown emits TS `unknown`.
    "foo/BoundaryTypes.ts"
  ]
});

// Use a pinned TypeScript version for consistent behavior.
// Note: `npx typescript@X tsc -p ...` is ambiguous in some npm versions.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/basic/tsconfig.json"
]);

run("node", ["tests/genes-ts/snapshot/basic/out/dist/index.js"]);

rmrf("tests/genes-ts/snapshot/resource-imports/out");
run("haxe", ["tests/genes-ts/snapshot/resource-imports/build.hxml"]);
cpSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/resource-imports/src/resources"),
  path.join(repoRoot, "tests/genes-ts/snapshot/resource-imports/out/src-gen/resources"),
  { recursive: true }
);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/resource-imports/out/src-gen",
  fileExts: [".ts"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink"],
  allowUnsafeTypeFiles: []
});
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/resource-imports/tsconfig.json"
]);

rmrf("tests/genes-ts/no-js-es/out");
run("haxe", ["tests/genes-ts/no-js-es/build.hxml"]);

const noJsEsMain = readFileSync(
  path.join(repoRoot, "tests/genes-ts/no-js-es/out/src-gen/Main.ts"),
  "utf8"
);
if (!noJsEsMain.includes("let value: string") || noJsEsMain.includes("var value: string")) {
  throw new Error("genes.ts mode must emit block-scoped `let` locals without relying on js-es=6");
}
if (!/\bvar value_1:/.test(noJsEsMain)) {
  throw new Error("inline-expanded same-named locals must be suffixed after the first emitted local");
}
const inlineValueNames = [...noJsEsMain.matchAll(/\bvar (value(?:_\d+)?):/g)].map(
  match => match[1]
);
if (inlineValueNames.filter(name => name === "value").length > 1) {
  throw new Error("inline-expanded same-named locals must not emit duplicate function-scoped `var value` declarations");
}
const mapFacadeBlock = noJsEsMain.match(/\bstatic buildMapHolder\(names: string\[\]\): MapHolder \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapFacadeBlock.includes("named.set(name, Main.namedItem(name))") || !mapFacadeBlock.includes("ranked.set(\"first\", Main.rankedItem(1))")) {
  throw new Error("map facade fixture must emit public set calls");
}
if (mapFacadeBlock.includes(".inst.")) {
  throw new Error("map facade fixture must not expose backing `.inst` access in user modules");
}
const mapGetContinueBlock = noJsEsMain.match(/\bstatic mapGetAfterContinue\(ids: string\[\]\): string\[\] \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapGetContinueBlock.includes("if (item == null)") || !mapGetContinueBlock.includes("continue;")) {
  throw new Error("map get narrowing fixture must keep an exiting null guard");
}
if (mapGetContinueBlock.includes("Register.unsafeCast") || mapGetContinueBlock.includes("item!")) {
  throw new Error("null-guarded map get locals should flow without unsafe casts or non-null assertions");
}
const closureGuardBlock = noJsEsMain.match(/\bstatic closureAfterOuterGuard\(id: string\): NamedCallback \| null \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!closureGuardBlock.includes("(item!).name")) {
  throw new Error("outer null guards must not erase receiver assertions inside returned closures");
}
if (!/\bmapAfterResultParameter\(result: MessageBatch\): number\[\] \{[\s\S]*\bvar result_1: number\[\]/.test(noJsEsMain)) {
  throw new Error("array-map helper temporaries must be suffixed when an enclosing parameter is named `result`");
}
if (/\bmapAfterResultParameter\(result: MessageBatch\): number\[\] \{[\s\S]*\bvar result: number\[\]/.test(noJsEsMain)) {
  throw new Error("array-map helper temporaries must not redeclare a `result` parameter");
}

run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/no-js-es/tsconfig.json"
]);
