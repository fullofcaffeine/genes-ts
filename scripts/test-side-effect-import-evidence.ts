import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/side-effect-import");
const outputRoot = path.join(fixtureRoot, "out");

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

/** Captures the one-line runtime transcript produced by a generated profile. */
function runtimeTranscript(relativeFile: string): string[] {
  const output = execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

/** Recursively inventories generated artifacts for exact leakage assertions. */
function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(absolute));
    else files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** Requires the bare Second request token to map to its Haxe marker call. */
function assertBareImportMapping(relativeFile: string): void {
  const generatedPath = path.join(outputRoot, relativeFile);
  const generated = readFileSync(generatedPath, "utf8");
  const offset = generated.indexOf('"./Second.js"');
  ok(offset !== -1, `${relativeFile} contains the bare Second request`);
  const before = generated.slice(0, offset).split("\n");
  const original = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap).originalPositionFor({
    line: before.length,
    column: before.at(-1)?.length ?? 0,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(original.source?.endsWith("src/sideeffectevidence/Main.hx"),
    `${relativeFile} bare request maps to Main.hx`);
  deepStrictEqual(original.line, 16,
    `${relativeFile} bare request maps to its exact marker line`);
  deepStrictEqual(original.column, 4,
    `${relativeFile} bare request maps to its exact marker column`);
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/side-effect-import/build-classic.hxml"]);
run("haxe", ["tests/side-effect-import/build-ts.hxml"]);
run("haxe", ["tests/side-effect-import/build-projection-classic.hxml"]);
run("haxe", ["tests/side-effect-import/build-projection-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/side-effect-import/tsconfig.json");

// The compile-time probe proves the same First -> Second typed encounter order
// consumed by the ordered runtime-request projection. Both output profiles must
// now preserve that order at execution time.
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/classic/index.js"), [
  "first,second"
]);
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/ts/dist/index.js"), [
  "first,second"
]);

const internalSources = [
  readFileSync(path.join(outputRoot, "classic/sideeffectevidence/Main.js"), "utf8"),
  readFileSync(path.join(outputRoot, "ts/src-gen/sideeffectevidence/Main.ts"), "utf8")
];
for (const source of internalSources) {
  const firstImports = source.match(/from "\.\/First\.js"/g) ?? [];
  const secondImports = source.match(/import "\.\/Second\.js"/g) ?? [];
  deepStrictEqual(firstImports.length, 1, "later First binding satisfies its first bare request slot");
  deepStrictEqual(secondImports.length, 1, "Second remains one binding-free request");
  ok(source.indexOf('from "./First.js"') < source.indexOf('import "./Second.js"'),
    "A/B/A request order remains A then B after duplicate coalescing");
  ok(!source.includes('import "./First.js"'), "First does not receive a redundant bare import");
}
assertBareImportMapping("classic/sideeffectevidence/Main.js");
assertBareImportMapping("ts/src-gen/sideeffectevidence/Main.ts");

const expectedExternalRequests = [
  'import {String as String__1} from "gamma-loader"',
  'import "alpha-loader" with { type: "json" }',
  'import "beta-loader"',
  'import "alpha-loader" with { type: "file" }'
];
for (const relativeFile of [
  "projection-classic/sideeffectprojection/Main.js",
  "projection-ts/sideeffectprojection/Main.ts"
]) {
  const source = readFileSync(path.join(outputRoot, relativeFile), "utf8");
  const requestLines = source.split(/\r?\n/)
    .filter((line) => line.includes("-loader"));
  deepStrictEqual(requestLines, expectedExternalRequests,
    `${relativeFile} preserves attribute-aware A/B/A request order`);
}
const projectionDeclaration = readFileSync(path.join(
  outputRoot, "projection-classic/sideeffectprojection/Main.d.ts"), "utf8");
ok(!projectionDeclaration.includes("-loader"),
  "runtime side-effect requests never enter declarations");

const generatedFiles = filesBelow(outputRoot);
const portableFiles = generatedFiles.map((file) => path.relative(outputRoot, file).split(path.sep).join("/"));
ok(portableFiles.some((file) => file.endsWith("/First.js")), "classic output retains First");
ok(portableFiles.some((file) => file.endsWith("/Second.js")), "classic output retains Second");
ok(portableFiles.some((file) => file.endsWith("/First.ts")), "TS output retains First");
ok(portableFiles.some((file) => file.endsWith("/Second.ts")), "TS output retains Second");
ok(!portableFiles.some((file) => file.includes("DeadTarget")), "unreferenced target remains outside the typed/output graph");

const forbiddenTokens = [
  "SideEffectImportMarker",
  "__ts2hxInit",
  "genes.compilerInternal",
  "sideEffectImportInternal"
];
for (const file of generatedFiles) {
  const content = readFileSync(file, "utf8");
  for (const token of forbiddenTokens) {
    ok(!content.includes(token), `${path.relative(repoRoot, file)} must not expose ${token}`);
  }
}

process.stdout.write(
  `side-effect-import-evidence:ok (${generatedFiles.length} artifacts; ordered internal/external requests in both profiles)\n`
);
