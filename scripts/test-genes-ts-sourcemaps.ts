import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/genes-ts/snapshot/basic");

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

function compileSourceMap(withSourcesContent: boolean): void {
  const args = [
    "-lib", "helder.set",
    "-cp", path.join(repoRoot, "src"),
    "-cp", "src",
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "--main", "Main",
    "-js", "out/src-gen/index.ts",
    "-D", "js-es=6",
    "-D", "genes.ts",
    "-D", "genes.ts.lower_private_helpers",
    "-debug"
  ];
  if (withSourcesContent) args.push("-D", "source_map_content");
  run("haxe", args, { cwd: fixtureRoot });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates the public source-map schema rather than trusting a successful
 * JSON parse. This protects the compiler's typed Haxe record and the external
 * debugger contract at the same time.
 */
function assertSourceMapSchema(
  mapUnknown: unknown,
  expectSourcesContent: boolean
): asserts mapUnknown is Record<string, unknown> {
  ok(isRecord(mapUnknown), `Expected sourcemap JSON object, got ${typeof mapUnknown}`);

  const expectedKeys = ["file", "mappings", "names", "sourceRoot", "sources", "version"];
  if (expectSourcesContent) expectedKeys.push("sourcesContent");
  deepStrictEqual(Object.keys(mapUnknown).sort(), expectedKeys.sort(),
    "Sourcemap JSON fields drifted from the owned schema");
  strictEqual(mapUnknown.version, 3, "Expected source-map version 3");
  strictEqual(mapUnknown.file, "Main.ts", "Expected source-map file to be Main.ts");
  strictEqual(mapUnknown.sourceRoot, "", "Expected an empty sourceRoot");
  ok(Array.isArray(mapUnknown.names)
    && mapUnknown.names.every((name) => typeof name === "string"),
  "Expected source-map names to be an array of strings");
  ok(typeof mapUnknown.mappings === "string" && mapUnknown.mappings.length > 0,
    "Expected a non-empty source-map mappings string");

  const sources = mapUnknown.sources;
  ok(Array.isArray(sources)
    && sources.every((source) => source === null || typeof source === "string"),
  "Expected source-map sources to contain strings or null compiler positions");
  ok(sources.includes("../../src/Main.hx"),
    "Expected source-map sources to include ../../src/Main.hx");
  ok(sources.every((source) => source === null || !path.isAbsolute(source)),
    "Source-map JSON leaked an absolute machine path");
  const externalSources = sources.filter((source): source is string =>
    typeof source === "string" && source.startsWith("haxe://classpath/"));
  ok(externalSources.some((source) => source.endsWith("genes/Register.hx")),
    "Expected the external genes compiler source to use a portable classpath URI");
  ok(externalSources.some((source) => source.endsWith("StdTypes.hx")),
    "Expected the external Haxe stdlib source to use a portable classpath URI");
  ok(sources.every((source) => source === null
    || source.startsWith("haxe://classpath/")
    || path.resolve(path.dirname(mapPath), source).startsWith(`${fixtureRoot}${path.sep}`)),
  "Source-map JSON emitted a relative source outside the owning project root");

  if (expectSourcesContent) {
    const sourcesContent = mapUnknown.sourcesContent;
    ok(Array.isArray(sourcesContent), "Expected embedded source content");
    strictEqual(sourcesContent.length, sources.length,
      "Embedded source content no longer aligns with source entries");
    ok(sourcesContent.every((content) => content === null || typeof content === "string"),
      "Expected embedded source content to contain strings or null");
    for (const source of externalSources) {
      const index = sources.indexOf(source);
      ok(typeof sourcesContent[index] === "string" && sourcesContent[index].length > 0,
        `Expected embedded content for portable external source ${source}`);
    }
  } else {
    ok(!Object.hasOwn(mapUnknown, "sourcesContent"),
      "Default source map unexpectedly embedded source content");
  }
}

function readSourceMap(mapPath: string): { readonly text: string; readonly value: unknown } {
  const text = readFileSync(mapPath, "utf8");
  return { text, value: JSON.parse(text) as unknown };
}

rmrf("tests/genes-ts/snapshot/basic/out");
compileSourceMap(false);

const tsPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts");
const mapPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts.map");

if (!existsSync(tsPath)) {
  throw new Error(`Expected generated TS at ${tsPath}`);
}
if (!existsSync(mapPath)) {
  throw new Error(`Expected Haxe→TS sourcemap at ${mapPath}`);
}

const firstMap = readSourceMap(mapPath);
assertSourceMapSchema(firstMap.value, false);

const ts = readFileSync(tsPath, "utf8");
if (!ts.includes("//# sourceMappingURL=Main.ts.map")) {
  throw new Error(`Expected generated TS to reference Main.ts.map`);
}

rmrf("tests/genes-ts/snapshot/basic/out");
compileSourceMap(true);
const contentMap = readSourceMap(mapPath);
assertSourceMapSchema(contentMap.value, true);

// Rebuild the default profile last so the fixture remains in its normal state.
// Matching bytes prove the optional content profile did not leak state into a
// later compiler invocation.
rmrf("tests/genes-ts/snapshot/basic/out");
compileSourceMap(false);
const rebuiltMap = readSourceMap(mapPath);
assertSourceMapSchema(rebuiltMap.value, false);
strictEqual(rebuiltMap.text, firstMap.text,
  "Two clean default source-map builds produced different bytes");

console.log("ok");
