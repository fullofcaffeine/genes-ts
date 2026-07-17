import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
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
const fixtureRoot = path.join(repoRoot, "tests/module-directives");
const outputRoot = path.join(fixtureRoot, "out");

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function generatedFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...generatedFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function runtimeTranscript(relativeFile: string): string[] {
  return execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim().split(/\r?\n/).filter((line) => line.length > 0);
}

function assertDirectiveShape(relativeFile: string): void {
  const source = readFileSync(path.join(outputRoot, relativeFile), "utf8");
  const lines = source.split(/\r?\n/).filter((line) => line.length > 0);
  deepStrictEqual(lines.slice(0, 3), [
    '"alpha-mode"',
    '"beta-mode"',
    "/*module-directive-banner*/"
  ], `${relativeFile} starts with the ordered directive plan before the banner`);
  strictEqual(source.match(/"alpha-mode"/g)?.length, 1,
    `${relativeFile} exact-deduplicates repeated directives`);
  strictEqual(source.match(/"beta-mode"/g)?.length, 1,
    `${relativeFile} retains the second distinct directive`);
  const firstImport = lines.findIndex((line) => line.startsWith("import "));
  ok(firstImport > 2, `${relativeFile} places every import after the prologue`);
  ok(source.includes('from "./Support.js"'),
    `${relativeFile} keeps a real dependency import`);
  ok(!source.includes("DirectiveOwner"),
    `${relativeFile} does not retain the metadata owner`);
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function assertDirectiveMapping(relativeFile: string): void {
  const generatedPath = path.join(outputRoot, relativeFile);
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap);
  const original = map.originalPositionFor({ line: 1, column: 0 });
  ok(original.source?.endsWith("src/module_directives/Main.hx"),
    `${relativeFile} directive maps to its Haxe metadata owner`);
  const haxeSource = readFileSync(path.join(
    fixtureRoot, "src/module_directives/Main.hx"), "utf8");
  strictEqual(original.line,
    sourceLine(haxeSource, '@:genes.moduleDirective("alpha-mode")'),
    `${relativeFile} first directive maps to the first duplicate occurrence`);
}

const negativeCases = [
  ["module_directive_arity", "GENES-MODULE-DIRECTIVE-ARITY-001"],
  ["module_directive_nonliteral", "GENES-MODULE-DIRECTIVE-LITERAL-001"],
  ["module_directive_empty", "GENES-MODULE-DIRECTIVE-EMPTY-001"],
  ["module_directive_conflict", "GENES-MODULE-DIRECTIVE-CONFLICT-001"]
] as const;

function assertCompileFailure(
  profile: "classic" | "ts",
  define: string,
  diagnostic: string
): void {
  const extension = profile === "ts" ? "ts" : "js";
  const output = path.join(outputRoot, "invalid", `${profile}-${define}`,
    `index.${extension}`);
  const sentinel = `preserved:${profile}:${define}\n`;
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, sentinel, "utf8");
  const args = [
    "-lib", "genes-ts",
    "-cp", "tests/module-directives/src",
    "--main", "directiveinvalid.Main",
    "-js", path.relative(repoRoot, output),
    "-D", define,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    ...(profile === "ts" ? ["-D", "genes.ts"] : ["-D", "dts"])
  ];
  const result = spawnSync("haxe", args, { cwd: repoRoot, encoding: "utf8" });
  ok(result.status !== null && result.status !== 0,
    `${profile}/${define} must fail compilation`);
  const diagnostics = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  ok(diagnostics.includes(diagnostic),
    `${profile}/${define} reports ${diagnostic}\n${diagnostics}`);
  ok(/directiveinvalid\/Main\.hx:\d+:/.test(diagnostics),
    `${profile}/${define} reports a source position\n${diagnostics}`);
  strictEqual(readFileSync(output, "utf8"), sentinel,
    `${profile}/${define} preserves prior public output`);
  deepStrictEqual(generatedFiles(path.dirname(output)), [output],
    `${profile}/${define} publishes no partial artifacts`);
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/module-directives/build-classic.hxml"]);
run("haxe", ["tests/module-directives/build-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/module-directives/tsconfig.json");

assertDirectiveShape("classic/module_directives/Main.js");
assertDirectiveShape("ts/src-gen/module_directives/Main.ts");
assertDirectiveMapping("classic/module_directives/Main.js");
assertDirectiveMapping("ts/src-gen/module_directives/Main.ts");

deepStrictEqual(runtimeTranscript("tests/module-directives/out/classic/index.js"),
  ["module-directives:ok"]);
deepStrictEqual(runtimeTranscript("tests/module-directives/out/ts/dist/index.js"),
  ["module-directives:ok"]);

const files = generatedFiles(outputRoot).map((file) =>
  path.relative(outputRoot, file).replaceAll("\\", "/"));
ok(!files.some((file) => file.includes("Pruned")),
  "module directive metadata does not create a DCE root or output module");
const classicDeclaration = readFileSync(path.join(
  outputRoot, "classic/module_directives/Main.d.ts"), "utf8");
for (const token of ["alpha-mode", "beta-mode", "module-directive-banner"]) {
  ok(!classicDeclaration.includes(token),
    `classic declarations omit runtime-only token ${token}`);
}

for (const profile of ["classic", "ts"] as const) {
  for (const [define, diagnostic] of negativeCases) {
    assertCompileFailure(profile, define, diagnostic);
  }
}

process.stdout.write(
  "module-directives:ok (ordered TS/classic prologues, DCE neutrality, runtime, mappings, diagnostics)\n"
);
