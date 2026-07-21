import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/genes-ts/snapshot/basic");
const overlappingFixtureRoot = path.join(repoRoot, "tests/source-map-paths/overlap");
const reactFixtureRoot = path.join(repoRoot, "tests/genes-ts/snapshot/react");

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

function compileSourceMap(
  compilerSourceRoot: string,
  withSourcesContent: boolean,
  cwd = fixtureRoot,
  configuredProjectRoot?: string
): void {
  const args = [
    "-lib", "helder.set",
    "-cp", path.dirname(compilerSourceRoot),
    "-cp", compilerSourceRoot,
    "-cp", path.join(fixtureRoot, "src"),
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "--main", "Main",
    "-js", path.join(fixtureRoot, "out/src-gen/index.ts"),
    "-D", "js-es=6",
    "-D", "genes.ts",
    "-D", "genes.ts.lower_private_helpers",
    "-debug"
  ];
  if (withSourcesContent) args.push("-D", "source_map_content");
  if (configuredProjectRoot !== undefined) {
    args.push("-D", `genes.source_map_root=${configuredProjectRoot}`);
  }
  run("haxe", args, { cwd });
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`)
    && relative !== ".." && !path.isAbsolute(relative));
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
  expectSourcesContent: boolean,
  mapPath: string
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
  ok(externalSources.includes("haxe://classpath/genes/Register.hx"),
    "Expected the most specific classpath to identify the external Genes runtime source");
  ok(externalSources.includes("haxe://classpath/StdTypes.hx"),
    "Expected the external Haxe standard-library source to use a portable classpath URI");
  strictEqual(new Set(externalSources).size, externalSources.length,
    "Two different source files collapsed to one portable classpath identity");
  ok(sources.every((source) => source === null
    || source.startsWith("haxe://classpath/")
    || isWithin(fixtureRoot, path.resolve(path.dirname(mapPath), source))),
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
  // JSON is a runtime boundary: the file can contain any shape. Keeping the
  // parsed value unknown forces assertSourceMapSchema to prove every field
  // before the test reads it as a source map.
  return { text, value: JSON.parse(text) as unknown };
}

function assertOverlappingClassPathIdentities(): void {
  const outputPath = path.join(overlappingFixtureRoot, "out/index.ts");
  rmSync(path.dirname(outputPath), { recursive: true, force: true });
  run("haxe", [
    "-lib", "helder.set",
    "-cp", path.join(repoRoot, "src"),
    "-cp", path.join(overlappingFixtureRoot, "vendor/a"),
    // Haxe gives later -cp arguments higher lookup priority. Putting the broad
    // root last lets it own `a.foo.Util`, while the nested root remains a valid
    // alternate spelling that the source-map allocator must not choose blindly.
    "-cp", path.join(overlappingFixtureRoot, "vendor"),
    "-cp", path.join(overlappingFixtureRoot, "app"),
    "--macro", "genes.Generator.use()",
    "--main", "OverlapMain",
    "-js", outputPath,
    "-D", "js-es=6",
    "-D", "genes.ts",
    "-D", `genes.source_map_root=${path.join(overlappingFixtureRoot, "app")}`,
    "-debug"
  ], { cwd: repoRoot });

  const map = readSourceMap(path.join(overlappingFixtureRoot, "out/OverlapMain.ts.map"));
  ok(isRecord(map.value), "Expected overlapping-classpath source-map JSON object");
  const sources = map.value.sources;
  ok(Array.isArray(sources)
    && sources.every((source) => source === null || typeof source === "string"),
    "Expected overlapping-classpath source-map sources to contain strings or null");
  ok(sources.includes("haxe://classpath/foo/Util.hx"),
    "Expected the root classpath source to keep its concise portable identity");
  ok(sources.includes("haxe://classpath/a/foo/Util.hx"),
    "Expected the nested source to use a distinct portable identity");
  const namedSources = sources.filter((source): source is string => source !== null);
  strictEqual(new Set(namedSources).size, namedSources.length,
    "Two different overlapping-classpath sources received the same source-map identity");
}

function tokenPosition(source: string, token: string): { line: number; column: number } {
  const index = source.indexOf(token);
  ok(index >= 0, `Expected source token ${token}`);
  const preceding = source.slice(0, index).split(/\r?\n/);
  return {
    line: preceding.length,
    column: preceding.at(-1)?.length ?? 0
  };
}

/** Decodes only the closed fields consumed by SourceMapConsumer. */
function decodeRawSourceMap(text: string): RawSourceMap {
  // JSON is the unavoidable untyped file boundary. Validate every consumed
  // field here, then construct the closed library contract before use.
  const value: unknown = JSON.parse(text);
  ok(isRecord(value), "Expected inlined-child source-map JSON object");
  ok(value.version === 3 || value.version === "3",
    "Expected inlined-child source-map version 3");
  ok(Array.isArray(value.sources)
    && value.sources.every((source) => typeof source === "string"),
  "Expected inlined-child source-map sources to be strings");
  ok(Array.isArray(value.names)
    && value.names.every((name) => typeof name === "string"),
  "Expected inlined-child source-map names to be strings");
  ok(typeof value.mappings === "string",
    "Expected inlined-child source-map mappings string");
  ok(value.file === undefined || typeof value.file === "string",
    "Expected optional inlined-child source-map file to be a string");
  ok(value.sourceRoot === undefined || typeof value.sourceRoot === "string",
    "Expected optional inlined-child source-map root to be a string");

  return {
    version: String(value.version),
    sources: value.sources.filter((source): source is string =>
      typeof source === "string"),
    names: value.names.filter((name): name is string => typeof name === "string"),
    mappings: value.mappings,
    ...(value.file === undefined ? {} : { file: value.file }),
    ...(value.sourceRoot === undefined ? {} : { sourceRoot: value.sourceRoot })
  };
}

/** Proves an inlined JSX child still maps to its exact authored HXX token. */
function assertInlinedJsxChildMapping(): void {
  rmrf("tests/genes-ts/snapshot/react/out/tsx");
  run("haxe", [
    "tests/genes-ts/snapshot/react/build-tsx.hxml",
    "-debug"
  ]);

  const generatedPath = path.join(
    reactFixtureRoot,
    "out/tsx/src-gen/Main.tsx"
  );
  const originalPath = path.join(reactFixtureRoot, "src/Main.hx");
  const token = "<strong>{second}</strong>";
  const generatedPosition = tokenPosition(readFileSync(generatedPath, "utf8"), token);
  const originalPosition = tokenPosition(readFileSync(originalPath, "utf8"), token);
  const consumer = new SourceMapConsumer(decodeRawSourceMap(
    readFileSync(`${generatedPath}.map`, "utf8")
  ));
  const mapped = consumer.originalPositionFor(generatedPosition);

  ok(mapped.source?.endsWith("/src/Main.hx") === true,
    "Inlined JSX child mapped to the authored HXX module");
  strictEqual(mapped.line, originalPosition.line,
    "Inlined JSX child changed its authored source line");
  strictEqual(mapped.column, originalPosition.column,
    "Inlined JSX child changed its authored source column");
}

run("haxe", [
  "-cp", path.join(repoRoot, "src"),
  "-cp", path.join(repoRoot, "tests/source-map-paths/src"),
  "--main", "source_map_paths.PathUtilProbe",
  "--interp"
]);

const firstExternalRoot = mkdtempSync(path.join(tmpdir(), "genes-source-map-a-"));
const secondExternalRoot = mkdtempSync(path.join(tmpdir(), "genes-source-map-b-"));
const firstCompilerSource = path.join(firstExternalRoot, "src");
const secondCompilerSource = path.join(secondExternalRoot, "src");

try {
  cpSync(path.join(repoRoot, "src"), firstCompilerSource, { recursive: true });
  cpSync(path.join(repoRoot, "src"), secondCompilerSource, { recursive: true });

  rmrf("tests/genes-ts/snapshot/basic/out");
  compileSourceMap(firstCompilerSource, false);

  const tsPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts");
  const mapPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts.map");

  if (!existsSync(tsPath)) {
    throw new Error(`Expected generated TS at ${tsPath}`);
  }
  if (!existsSync(mapPath)) {
    throw new Error(`Expected Haxe→TS sourcemap at ${mapPath}`);
  }

  const firstMap = readSourceMap(mapPath);
  assertSourceMapSchema(firstMap.value, false, mapPath);

  const ts = readFileSync(tsPath, "utf8");
  if (!ts.includes("//# sourceMappingURL=Main.ts.map")) {
    throw new Error(`Expected generated TS to reference Main.ts.map`);
  }

  rmrf("tests/genes-ts/snapshot/basic/out");
  compileSourceMap(firstCompilerSource, true);
  const contentMap = readSourceMap(mapPath);
  assertSourceMapSchema(contentMap.value, true, mapPath);

  // Rebuild from a different absolute compiler classpath. Matching bytes prove
  // neither the optional content profile nor a machine-local cache directory
  // leaks into a later source map.
  rmrf("tests/genes-ts/snapshot/basic/out");
  compileSourceMap(secondCompilerSource, false);
  const rebuiltMap = readSourceMap(mapPath);
  assertSourceMapSchema(rebuiltMap.value, false, mapPath);
  strictEqual(rebuiltMap.text, firstMap.text,
    "Moving an external classpath changed otherwise identical source-map bytes");

  // Build once from an orchestration directory above the application. The
  // documented relative define must restore the same application ownership
  // and therefore the same source-map bytes.
  rmrf("tests/genes-ts/snapshot/basic/out");
  compileSourceMap(
    secondCompilerSource,
    false,
    repoRoot,
    path.relative(repoRoot, fixtureRoot)
  );
  const configuredRootMap = readSourceMap(mapPath);
  assertSourceMapSchema(configuredRootMap.value, false, mapPath);
  strictEqual(configuredRootMap.text, firstMap.text,
    "A relative genes.source_map_root changed the application source identities");

  assertOverlappingClassPathIdentities();
  assertInlinedJsxChildMapping();

  console.log("ok");
} finally {
  rmSync(firstExternalRoot, { recursive: true, force: true });
  rmSync(secondExternalRoot, { recursive: true, force: true });
  rmSync(path.join(overlappingFixtureRoot, "out"), { recursive: true, force: true });
}
