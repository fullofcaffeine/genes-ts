import { deepStrictEqual, ok } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/side-effect-import");
const outputRoot = path.join(fixtureRoot, "out");
const runtimeRoot = path.join(fixtureRoot, "runtime");

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

/** Copies fixture-owned host modules beside one generated Haxe module. */
function stageRuntime(relativeDirectory: string): void {
  const destination = path.join(outputRoot, relativeDirectory, "runtime");
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(runtimeRoot)) {
    copyFileSync(path.join(runtimeRoot, file), path.join(destination, file));
  }
}

/** Finds one exact source token using source-map line/column conventions. */
function sourcePosition(relativeFile: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const source = readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
  const offset = source.indexOf(needle);
  ok(offset !== -1, `${relativeFile} contains ${needle}`);
  const before = source.slice(0, offset).split("\n");
  return {
    line: before.length,
    column: before.at(-1)?.length ?? 0
  };
}

/** Requires one bare request token to map to its exact Haxe producer call. */
function assertBareImportMapping(
  relativeFile: string,
  generatedToken: string,
  sourceFile: string,
  sourceNeedle: string
): void {
  const generatedPath = path.join(outputRoot, relativeFile);
  const generated = readFileSync(generatedPath, "utf8");
  const offset = generated.indexOf(generatedToken);
  ok(offset !== -1, `${relativeFile} contains ${generatedToken}`);
  const before = generated.slice(0, offset).split("\n");
  const original = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap).originalPositionFor({
    line: before.length,
    column: before.at(-1)?.length ?? 0,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(original.source?.endsWith(sourceFile),
    `${relativeFile} bare request maps to ${sourceFile}`);
  deepStrictEqual(
    { line: original.line, column: original.column },
    sourcePosition(sourceFile, sourceNeedle),
    `${relativeFile} bare request maps to its exact producer call`
  );
}

/** Runs a failing compiler probe and returns its complete diagnostic stream. */
function compileFailure(args: ReadonlyArray<string>, diagnostic: string): string {
  const result = spawnSync("haxe", [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  ok(result.status !== null && result.status !== 0,
    `haxe must reject ${diagnostic}`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  ok(output.includes(diagnostic), `missing ${diagnostic}\n${output}`);
  ok(/sideeffectinvalid\/Main\.hx:\d+:/.test(output),
    `${diagnostic} must carry a source position\n${output}`);
  return output;
}

/** Proves a planning failure leaves an existing Genes output byte-identical. */
function genesCompileFailure(define: string, diagnostic: string): void {
  const output = path.join(outputRoot, `invalid-${define}.js`);
  const sentinel = `preserved:${define}\n`;
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, sentinel);
  compileFailure([
    "-lib", "genes-ts",
    "-cp", "tests/side-effect-import/src",
    "--main", "sideeffectinvalid.Main",
    "-js", path.relative(repoRoot, output),
    "-D", define,
    "-D", "no-deprecation-warnings",
    "-dce", "full"
  ], diagnostic);
  deepStrictEqual(readFileSync(output, "utf8"), sentinel,
    `${define} preserves the previously published output`);
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/side-effect-import/build-classic.hxml"]);
run("haxe", ["tests/side-effect-import/build-ts.hxml"]);
run("haxe", ["tests/side-effect-import/build-projection-classic.hxml"]);
run("haxe", ["tests/side-effect-import/build-projection-ts.hxml"]);
stageRuntime("classic/sideeffectevidence");
stageRuntime("ts/src-gen/sideeffectevidence");
runGeneratedTypeScriptMatrix("tests/side-effect-import/tsconfig.json");
stageRuntime("ts/dist/sideeffectevidence");

genesCompileFailure("side_effect_nonliteral",
  "GENES-SIDE-EFFECT-IMPORT-LITERAL-001");
genesCompileFailure("side_effect_empty_attribute",
  "GENES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001");
genesCompileFailure("side_effect_nested",
  "GENES-SIDE-EFFECT-IMPORT-CONTEXT-001");
genesCompileFailure("side_effect_wrong_method",
  "GENES-SIDE-EFFECT-IMPORT-CONTEXT-001");

const disabledOutput = path.join(outputRoot, "invalid-disabled.js");
compileFailure([
  "-lib", "genes-ts",
  "-cp", "tests/side-effect-import/src",
  "--main", "sideeffectinvalid.Main",
  "-js", path.relative(repoRoot, disabledOutput),
  "-D", "genes.disable",
  "-D", "side_effect_target",
  "-D", "no-deprecation-warnings"
], "GENES-SIDE-EFFECT-IMPORT-TARGET-001");
ok(!existsSync(disabledOutput), "disabled standard Haxe publishes no output");

const nonJsOutput = path.join(outputRoot, "invalid-target.n");
compileFailure([
  "-cp", "src",
  "-cp", "tests/side-effect-import/src",
  "--main", "sideeffectinvalid.Main",
  "-neko", path.relative(repoRoot, nonJsOutput),
  "-D", "side_effect_target",
  "-D", "no-deprecation-warnings"
], "GENES-SIDE-EFFECT-IMPORT-TARGET-001");
ok(!existsSync(nonJsOutput), "non-JS Haxe publishes no output");

// The compile-time probe proves the same First -> Second typed encounter order
// consumed by the ordered runtime-request projection. Both output profiles must
// now preserve that order at execution time.
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/classic/index.js"), [
  "external:first",
  "external:second",
  "first,second"
]);
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/ts/dist/index.js"), [
  "external:first",
  "external:second",
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

  const publicRequests = source.split(/\r?\n/)
    .filter((line) => line.includes('"./runtime/'));
  deepStrictEqual(publicRequests, [
    'import "./runtime/First.js"',
    'import "./runtime/config.json" with { type: "json" }',
    'import "./runtime/Second.js"'
  ], "public helpers preserve order, attributes, and duplicate coalescing");
}
for (const relativeFile of [
  "classic/sideeffectevidence/Main.js",
  "ts/src-gen/sideeffectevidence/Main.ts"
]) {
  assertBareImportMapping(
    relativeFile,
    '"./runtime/First.js"',
    "src/sideeffectevidence/Main.hx",
    'Imports.sideEffect("./runtime/First.js")'
  );
  assertBareImportMapping(
    relativeFile,
    '"./Second.js"',
    "src/sideeffectevidence/Main.hx",
    "SideEffectImportMarker.internal(Second.__ts2hxInit)"
  );
}

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
  `side-effect-import-evidence:ok (${generatedFiles.length} artifacts; public helpers, diagnostics, and ordered requests in both profiles)\n`
);
