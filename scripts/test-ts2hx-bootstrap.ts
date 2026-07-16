import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "./typescript-api.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Evidence runner for the long-term Haxe-authored ts2hx feasibility question.
 *
 * This is intentionally a small compiler-API canary, not a second translator.
 * It compares one authoritative Program/TypeChecker/diagnostic query across a
 * direct TypeScript implementation and all three Haxe-to-JavaScript profiles.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/ts2hx-bootstrap");
const outputRoot = path.join(fixtureRoot, "out");
const markerPrefix = "TS2HX_HAXE_BOOTSTRAP_OK:";

type ProgramFacts = Readonly<{
  version: string;
  roots: number;
  renderedType: string;
  line: number;
  column: number;
  diagnostics: number;
  error: number;
  errorLine: number;
  errorColumn: number;
}>;

type BuildTimings = Readonly<{
  standardHaxeMs: number;
  classicHaxeMs: number;
  genesTsHaxeMs: number;
  typeScriptMatrixMs: number;
}>;

type Ts2hxInventory = Readonly<{
  productionFiles: number;
  productionLines: number;
  apiReferences: number;
  uniqueApiMembers: number;
}>;

/** Measures one action without turning report-only timings into a flaky gate. */
function timed<T>(action: () => T): { readonly value: T; readonly ms: number } {
  const start = performance.now();
  const value = action();
  return { value, ms: performance.now() - start };
}

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): number {
  return timed(() => execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit"
  })).ms;
}

/** Captures one Node runtime without shell interpolation. */
function captureNode(file: string, args: ReadonlyArray<string> = []): string {
  return execFileSync(process.execPath, [file, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

/** Extracts the stable fact line from either Haxe trace or direct TS output. */
function markerFrom(transcript: string): string {
  const marker = transcript.split(/\r?\n/)
    .map((line) => line.slice(line.indexOf(markerPrefix)))
    .find((line) => line.startsWith(markerPrefix));
  if (!marker) throw new Error(`Missing ${markerPrefix} in:\n${transcript}`);
  return marker;
}

/** Finds one AST kind using only operations also modeled by the Haxe extern. */
function findFirst(node: ts.Node, source: ts.SourceFile,
    wanted: ts.SyntaxKind): ts.Node | null {
  if (node.kind === wanted) return node;
  for (const child of node.getChildren(source)) {
    const found = findFirst(child, source, wanted);
    if (found) return found;
  }
  return null;
}

/** Direct TypeScript implementation used as the authoritative fact oracle. */
function typescriptFacts(): ProgramFacts {
  const sourcePath = "tests/ts2hx-bootstrap/input.ts";
  const invalidSourcePath = "tests/ts2hx-bootstrap/invalid.ts";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext
  };
  const program = ts.createProgram([sourcePath], options);
  const source = program.getSourceFile(sourcePath);
  if (!source) throw new Error("Direct TypeScript Program lost its valid root.");
  const declaration = findFirst(source, source, ts.SyntaxKind.VariableDeclaration);
  if (!declaration) throw new Error("Direct TypeScript AST walk lost the declaration.");
  const checker = program.getTypeChecker();
  const location = source.getLineAndCharacterOfPosition(declaration.getStart(source));

  const invalidProgram = ts.createProgram([invalidSourcePath], options);
  const invalidSource = invalidProgram.getSourceFile(invalidSourcePath);
  if (!invalidSource) throw new Error("Direct TypeScript Program lost its invalid root.");
  const diagnostic = invalidProgram.getSemanticDiagnostics(invalidSource)[0];
  if (!diagnostic || diagnostic.start === undefined || !diagnostic.file)
    throw new Error("Direct TypeScript diagnostic lost its source position.");
  const diagnosticLocation = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start
  );
  return {
    version: ts.version,
    roots: program.getRootFileNames().length,
    renderedType: checker.typeToString(checker.getTypeAtLocation(declaration)),
    line: location.line + 1,
    column: location.character + 1,
    diagnostics: program.getSyntacticDiagnostics(source).length
      + program.getSemanticDiagnostics(source).length,
    error: diagnostic.code,
    errorLine: diagnosticLocation.line + 1,
    errorColumn: diagnosticLocation.character + 1
  };
}

/** Uses the exact field order printed by the Haxe canary. */
function markerFor(facts: ProgramFacts): string {
  return markerPrefix + [
    `version=${facts.version}`,
    `roots=${facts.roots}`,
    `type=${facts.renderedType}`,
    `line=${facts.line}`,
    `column=${facts.column}`,
    `diagnostics=${facts.diagnostics}`,
    `error=${facts.error}`,
    `errorLine=${facts.errorLine}`,
    `errorColumn=${facts.errorColumn}`
  ].join(";");
}

/** Recursively returns stable, sorted file paths for one generated tree. */
function filesUnder(root: string): string[] {
  const files: string[] = [];
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/** Hashes paths and bytes so two clean builds must own the same exact tree. */
function outputSnapshot(): ReadonlyArray<readonly [string, string]> {
  return filesUnder(outputRoot).map((absolute) => [
    path.relative(outputRoot, absolute),
    createHash("sha256").update(readFileSync(absolute)).digest("hex")
  ] as const);
}

/** Total bytes are evidence only; no threshold is inferred from one canary. */
function treeBytes(root: string): number {
  return filesUnder(root).reduce((total, file) => total + statSync(file).size, 0);
}

/** Reports current migration size without converting the measurement to policy. */
function ts2hxInventory(): Ts2hxInventory {
  const productionFiles = filesUnder(path.join(repoRoot, "tools/ts2hx/src"))
    .filter((file) => file.endsWith(".ts")
      && !path.basename(file).startsWith("test-"));
  let productionLines = 0;
  let apiReferences = 0;
  const apiMembers = new Set<string>();
  for (const file of productionFiles) {
    const source = readFileSync(file, "utf8");
    productionLines += source.split(/\r?\n/).length - 1;
    for (const match of source.matchAll(/\bts\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const member = match[1];
      if (!member) continue;
      apiReferences++;
      apiMembers.add(member);
    }
  }
  return {
    productionFiles: productionFiles.length,
    productionLines,
    apiReferences,
    uniqueApiMembers: apiMembers.size
  };
}

/** Builds every profile once and emits genes-ts through the pinned TS matrix. */
function buildOnce(): BuildTimings {
  rmSync(outputRoot, { recursive: true, force: true });
  for (const relative of ["standard", "classic", "ts/src-gen"])
    mkdirSync(path.join(outputRoot, relative), { recursive: true });
  const standardHaxeMs = run("haxe", ["tests/ts2hx-bootstrap/build-standard.hxml"]);
  const classicHaxeMs = run("haxe", ["tests/ts2hx-bootstrap/build-classic.hxml"]);
  const genesTsHaxeMs = run("haxe", ["tests/ts2hx-bootstrap/build-ts.hxml"]);
  const typeScriptMatrixMs = timed(() => runGeneratedTypeScriptMatrix(
    "tests/ts2hx-bootstrap/tsconfig.generated.json"
  )).ms;
  return { standardHaxeMs, classicHaxeMs, genesTsHaxeMs, typeScriptMatrixMs };
}

/** Removes comments before enforcing the no-escape-hatch fixture policy. */
function executableHaxe(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Proves the curated seam remains strongly typed in Haxe and generated TS. */
function assertStrongBoundary(): void {
  const haxeSources = filesUnder(path.join(fixtureRoot, "src"))
    .map((file) => executableHaxe(readFileSync(file, "utf8")))
    .join("\n");
  for (const forbidden of [/\bDynamic\b/, /\buntyped\b/, /\bcast\b/, /js\.Syntax\.code/])
    ok(!forbidden.test(haxeSources), `Haxe compiler boundary contains ${forbidden}`);

  const generatedRoot = path.join(outputRoot, "ts/src-gen/ts2hxbootstrap");
  const generated = filesUnder(generatedRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  ok(!/\bany\b/.test(generated), "generated compiler boundary contains any");
  ok(!/\bunknown\b/.test(generated), "generated compiler boundary contains unknown");
  ok(generated.includes("import('typescript').Program"),
    "genes-ts lost the canonical Program import type");
  ok(generated.includes("ReadonlyArray<import('typescript').Node>"),
    "genes-ts weakened TypeScript's readonly AST collection");
  ok(generated.includes("?? null"),
    "genes-ts lost explicit undefined-to-null normalization");

  const standard = readFileSync(path.join(outputRoot, "standard/index.cjs"), "utf8");
  const classic = readFileSync(
    path.join(outputRoot, "classic/ts2hxbootstrap/Main.js"),
    "utf8"
  );
  const quotedTypeScriptSpecifier = '"typescript"';
  ok(standard.includes('require("typescript")'),
    "standard Haxe is not an independent CommonJS stage-0 path");
  ok(classic.includes("from " + quotedTypeScriptSpecifier),
    "classic Genes lost the real TypeScript module request");
}

/** Median process runtime over three runs, reported but deliberately unbudgeted. */
function medianRuntime(file: string, args: ReadonlyArray<string> = []): number {
  const samples = Array.from({ length: 3 }, () => timed(() =>
    captureNode(file, args)
  ).ms).sort((left, right) => left - right);
  return samples[1] ?? 0;
}

function rounded(ms: number): string {
  return ms.toFixed(1);
}

function main(): void {
  const expectedMarker = markerFor(typescriptFacts());
  const firstTimings = buildOnce();
  const firstSnapshot = outputSnapshot();
  const profiles = [
    path.join(outputRoot, "standard/index.cjs"),
    path.join(outputRoot, "classic/index.js"),
    path.join(outputRoot, "ts/dist/index.js")
  ];
  for (const profile of profiles)
    deepStrictEqual(markerFrom(captureNode(profile)), expectedMarker);
  assertStrongBoundary();

  const secondTimings = buildOnce();
  deepStrictEqual(outputSnapshot(), firstSnapshot,
    "two clean Haxe/Genes/TypeScript builds produced different trees");
  for (const profile of profiles)
    deepStrictEqual(markerFrom(captureNode(profile)), expectedMarker);
  assertStrongBoundary();

  const baselineRuntimeMs = medianRuntime(__filename, ["--baseline"]);
  const standardRuntimeMs = medianRuntime(profiles[0] ?? "");
  const classicRuntimeMs = medianRuntime(profiles[1] ?? "");
  const genesTsRuntimeMs = medianRuntime(profiles[2] ?? "");
  const bytes = {
    standard: treeBytes(path.join(outputRoot, "standard")),
    classic: treeBytes(path.join(outputRoot, "classic")),
    genesTs: treeBytes(path.join(outputRoot, "ts/src-gen"))
  };
  const inventory = ts2hxInventory();

  process.stdout.write(
    "ts2hx-bootstrap:ok "
    + `(runtime-ms median direct-ts=${rounded(baselineRuntimeMs)},`
    + `standard=${rounded(standardRuntimeMs)},classic=${rounded(classicRuntimeMs)},`
    + `genes-ts=${rounded(genesTsRuntimeMs)}; `
    + `build-ms first=${rounded(firstTimings.standardHaxeMs)}/`
    + `${rounded(firstTimings.classicHaxeMs)}/${rounded(firstTimings.genesTsHaxeMs)}`
    + `+${rounded(firstTimings.typeScriptMatrixMs)}, second=`
    + `${rounded(secondTimings.standardHaxeMs)}/${rounded(secondTimings.classicHaxeMs)}/`
    + `${rounded(secondTimings.genesTsHaxeMs)}+${rounded(secondTimings.typeScriptMatrixMs)}; `
    + `bytes=${bytes.standard}/${bytes.classic}/${bytes.genesTs}; `
    + `inventory=${inventory.productionFiles} files/${inventory.productionLines} lines/`
    + `${inventory.apiReferences} API refs/${inventory.uniqueApiMembers} members)\n`
  );
}

if (process.argv[2] === "--baseline")
  process.stdout.write(`${markerFor(typescriptFacts())}\n`);
else
  main();
