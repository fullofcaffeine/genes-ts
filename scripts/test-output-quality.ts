import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import ts from "./typescript-api.js";
import { runTypeScript } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/output-modes");
const manifestPath = path.join(fixtureRoot, "output-quality.json");

type JsonRecord = Record<string, unknown>;

interface MetricSnapshot {
  readonly modules: number;
  readonly bytes: number;
  readonly tokens: number;
  readonly temporaryDeclarations: number;
  readonly valueImports: number;
  readonly typeImports: number;
}

interface ReviewRecord {
  readonly id: string;
  readonly reason: string;
}

interface ProfileBudget {
  readonly baseline: MetricSnapshot;
  readonly maximum: Omit<MetricSnapshot, "modules">;
  readonly review: ReviewRecord;
}

interface ProfileSpec {
  readonly root: string;
  readonly includeSuffix: string;
  readonly excludeSuffix?: string;
  readonly noTempFiles: ReadonlyArray<string>;
  readonly budget: ProfileBudget;
}

interface TreeSpec {
  readonly id: string;
  readonly root: string;
  readonly suffixes: ReadonlyArray<string>;
}

interface MappingSpec {
  readonly profile: string;
  readonly generated: string;
  readonly needle: string;
  readonly source: string;
  readonly line: number;
  readonly column: number;
}

interface StackProbeSpec {
  readonly exportName: string;
  readonly method: string;
  readonly message: string;
  readonly source: string;
  readonly line: number;
  readonly column: number;
  readonly classicModule: string;
  readonly tsModule: string;
  readonly tsGenerated: string;
  readonly tsNeedle: string;
}

interface OutputQualityManifest {
  readonly schemaVersion: 1;
  readonly trees: ReadonlyArray<TreeSpec>;
  readonly profiles: Readonly<Record<string, ProfileSpec>>;
  readonly exactMappings: ReadonlyArray<MappingSpec>;
  readonly stackProbe: StackProbeSpec;
}

interface TreeSnapshot {
  readonly id: string;
  readonly files: number;
  readonly hash: string;
}

interface BuildTiming {
  readonly tsMilliseconds: number;
  readonly classicMilliseconds: number;
}

interface ProfileMeasurement {
  readonly metrics: MetricSnapshot;
  readonly temporaryNames: ReadonlyArray<string>;
}

interface OriginalPosition {
  readonly source: string | null;
  readonly line: number | null;
  readonly column: number | null;
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer`);
  }
  return value as number;
}

/**
 * Loads the checked-in evidence contract without silently accepting weak data.
 *
 * Why: budgets are release evidence, not a best-effort report. A malformed or
 * anonymous baseline would let output growth pass merely because the harness
 * stopped understanding its manifest.
 *
 * What/How: validate the top-level shape and require every profile budget to
 * carry a stable review ID plus rationale. Detailed numeric fields are checked
 * while measuring so diagnostics can name the profile and metric precisely.
 */
function loadManifest(): OutputQualityManifest {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error("output-quality.json must use schemaVersion 1");
  }
  if (!Array.isArray(parsed.trees) || !isRecord(parsed.profiles)) {
    throw new Error("output-quality.json must define trees and profiles");
  }
  if (!Array.isArray(parsed.exactMappings) || !isRecord(parsed.stackProbe)) {
    throw new Error("output-quality.json must define exactMappings and stackProbe");
  }
  for (const [profileId, profileUnknown] of Object.entries(parsed.profiles)) {
    if (!isRecord(profileUnknown) || !isRecord(profileUnknown.budget)) {
      throw new Error(`${profileId} must define a budget`);
    }
    const review = profileUnknown.budget.review;
    if (!isRecord(review)) {
      throw new Error(`${profileId}.budget.review must be an object`);
    }
    nonEmptyString(review.id, `${profileId}.budget.review.id`);
    nonEmptyString(review.reason, `${profileId}.budget.review.reason`);
  }
  return parsed as unknown as OutputQualityManifest;
}

function cleanCompilerOutputs(): void {
  rmSync(path.join(fixtureRoot, "out/ts"), { recursive: true, force: true });
  rmSync(path.join(fixtureRoot, "out/classic"), { recursive: true, force: true });
}

function buildCompilerOutputs(): BuildTiming {
  const tsStart = performance.now();
  run("haxe", ["tests/output-modes/build-ts.hxml"]);
  const classicStart = performance.now();
  run("haxe", ["tests/output-modes/build-classic.hxml"]);
  const finished = performance.now();
  return {
    tsMilliseconds: classicStart - tsStart,
    classicMilliseconds: finished - classicStart
  };
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  if (existsSync(root) && statSync(root).isDirectory()) {
    walk(root);
  }
  return files.sort();
}

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }
  if (isRecord(value)) {
    const output: JsonRecord = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = stableJson(value[key]);
    }
    return output;
  }
  return typeof value === "string" ? normalizeLineEndings(value) : value;
}

/** Canonicalizes only machine-owned source roots; mapping order stays intact. */
function canonicalSourcePath(mapPath: string, sourceRoot: string, source: string): string {
  const absolute = path.resolve(path.dirname(mapPath), sourceRoot, source);
  const relativeToRepo = path.relative(repoRoot, absolute);
  if (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo)) {
    return `<repo>/${slash(relativeToRepo)}`;
  }

  const normalized = slash(absolute);
  const stdMarker = "/std/";
  const stdIndex = normalized.lastIndexOf(stdMarker);
  if (stdIndex !== -1) {
    return `<haxe-std>/${normalized.slice(stdIndex + stdMarker.length)}`;
  }
  const haxelibMarker = "/haxe_libraries/";
  const haxelibIndex = normalized.lastIndexOf(haxelibMarker);
  if (haxelibIndex !== -1) {
    return `<haxelib>/${normalized.slice(haxelibIndex + haxelibMarker.length)}`;
  }
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return `<external>/${parts.slice(-4).join("/")}`;
}

/**
 * Normalizes artifacts for cross-machine determinism without erasing codegen.
 *
 * Text keeps every token and space; only CRLF is normalized. Source-map JSON
 * additionally receives stable key order and canonical repo/Haxe/haxelib roots.
 * Paths, mapping strings, source order, and generated source remain part of the
 * digest, so semantic or output-shape changes still change the tree hash.
 */
function normalizedArtifact(absolutePath: string): string {
  const text = normalizeLineEndings(readFileSync(absolutePath, "utf8"));
  if (!absolutePath.endsWith(".map")) {
    return text;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${absolutePath} must contain a source-map object`);
  }
  const sourceRoot = typeof parsed.sourceRoot === "string" ? parsed.sourceRoot : "";
  if (!Array.isArray(parsed.sources) || !parsed.sources.every((source) => typeof source === "string")) {
    throw new Error(`${absolutePath} must contain string sources`);
  }
  parsed.sources = parsed.sources.map((source) =>
    canonicalSourcePath(absolutePath, sourceRoot, source)
  );
  parsed.sourceRoot = "";
  return `${JSON.stringify(stableJson(parsed))}\n`;
}

function captureTree(spec: TreeSpec): TreeSnapshot {
  const root = path.join(repoRoot, spec.root);
  const files = listFilesRecursive(root).filter((file) =>
    spec.suffixes.some((suffix) => file.endsWith(suffix))
  );
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = slash(path.relative(root, file));
    hash.update(relative);
    hash.update("\0");
    hash.update(normalizedArtifact(file));
    hash.update("\0");
  }
  return { id: spec.id, files: files.length, hash: hash.digest("hex") };
}

function rawSourceMap(mapPath: string): { readonly raw: RawSourceMap; readonly sourceRoot: string } {
  const parsed: unknown = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${mapPath} must contain a source-map object`);
  }
  if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.names)) {
    throw new Error(`${mapPath} has an invalid source-map shape`);
  }
  return {
    raw: parsed as unknown as RawSourceMap,
    sourceRoot: typeof parsed.sourceRoot === "string" ? parsed.sourceRoot : ""
  };
}

function lineAndColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

function resolveOriginalSource(mapPath: string, sourceRoot: string, source: string): string {
  return path.resolve(path.dirname(mapPath), sourceRoot, source);
}

/** Contains the older source-map package's inaccurate non-null declaration. */
function originalPosition(
  consumer: SourceMapConsumer,
  line: number,
  column: number
): OriginalPosition {
  return consumer.originalPositionFor({
    line,
    column,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  }) as unknown as OriginalPosition;
}

function sourceOwnsLocal(sourcePath: string, line: number, name: string): boolean {
  if (!existsSync(sourcePath)) {
    return false;
  }
  const sourceLine = normalizeLineEndings(readFileSync(sourcePath, "utf8"))
    .split("\n")[line - 1] ?? "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`\\b(?:final|var)\\s+${escaped}\\b`),
    new RegExp(`\\bfor\\s*\\(\\s*${escaped}\\b`),
    new RegExp(`\\bcatch\\s*\\(\\s*${escaped}\\b`)
  ].some((pattern) => pattern.test(sourceLine));
}

function primarySourceLocalNames(
  generatedPath: string,
  mapPath: string,
  map: { readonly raw: RawSourceMap; readonly sourceRoot: string }
): ReadonlySet<string> {
  const generatedBase = path.basename(generatedPath)
    .replace(/\.d\.ts$/, "")
    .replace(/\.(?:ts|js)$/, "");
  const names = new Set<string>();
  for (const source of map.raw.sources) {
    const sourcePath = resolveOriginalSource(mapPath, map.sourceRoot, source);
    if (path.basename(sourcePath) !== `${generatedBase}.hx` || !existsSync(sourcePath)) {
      continue;
    }
    const text = normalizeLineEndings(readFileSync(sourcePath, "utf8"));
    for (const pattern of [
      /\b(?:final|var)\s+([A-Za-z_$][\w$]*)/g,
      /\bfor\s*\(\s*([A-Za-z_$][\w$]*)/g,
      /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g
    ]) {
      for (const match of text.matchAll(pattern)) {
        names.add(match[1]);
      }
    }
  }
  return names;
}

function isFunctionScoped(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return true;
    }
    if (ts.isSourceFile(current)) {
      return false;
    }
  }
  return false;
}

/**
 * Counts lowered locals by following each declaration back to Haxe source.
 *
 * A function-scoped generated variable is source-authored only when its map
 * resolves to a `var`, `final`, `for`, or `catch` declaration bearing the same
 * name. Unmapped declarations also consult the primary same-named Haxe module;
 * this is required for typed catch locals whose adapter declaration has no map
 * segment. Lowering-only locals (`_g`, receiver/index captures, renamed
 * unrolled loop bindings, and catch adapters) therefore remain visible without
 * counting imports, class exports, source locals, parameters, or globals.
 */
function syntheticTemps(absolutePath: string, sourceFile: ts.SourceFile): string[] {
  const mapPath = `${absolutePath}.map`;
  if (!existsSync(mapPath)) {
    throw new Error(`Missing source map for temporary audit: ${mapPath}`);
  }
  const map = rawSourceMap(mapPath);
  const consumer = new SourceMapConsumer(map.raw);
  const authoredNames = primarySourceLocalNames(absolutePath, mapPath, map);
  const found: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isFunctionScoped(node)
    ) {
      const generated = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
      const original = originalPosition(
        consumer,
        generated.line + 1,
        generated.character
      );
      const sourcePath = original.source === null || original.source.length === 0
        ? ""
        : resolveOriginalSource(mapPath, map.sourceRoot, original.source);
      if (
        original.line === null ||
        !sourceOwnsLocal(sourcePath, original.line, node.name.text)
      ) {
        if (!authoredNames.has(node.name.text)) {
          found.push(
            `${slash(path.relative(repoRoot, absolutePath))}:${generated.line + 1}:${node.name.text}`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function tokenCount(text: string, languageVariant: ts.LanguageVariant): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    languageVariant,
    text
  );
  let count = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    count++;
  }
  return count;
}

function importCounts(sourceFile: ts.SourceFile): { readonly value: number; readonly type: number } {
  let value = 0;
  let type = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (statement.importClause?.isTypeOnly === true) {
      type++;
    } else {
      value++;
    }
  }
  return { value, type };
}

function profileFiles(spec: ProfileSpec): string[] {
  const root = path.join(repoRoot, spec.root);
  return listFilesRecursive(root).filter((file) =>
    file.endsWith(spec.includeSuffix) &&
    (spec.excludeSuffix === undefined || !file.endsWith(spec.excludeSuffix))
  );
}

function measureProfile(spec: ProfileSpec): ProfileMeasurement {
  const files = profileFiles(spec);
  let bytes = 0;
  let tokens = 0;
  let valueImports = 0;
  let typeImports = 0;
  const temporaryNames: string[] = [];

  for (const file of files) {
    const text = normalizeLineEndings(readFileSync(file, "utf8"));
    const kind = file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const variant = kind === ts.ScriptKind.JS
      ? ts.LanguageVariant.Standard
      : ts.LanguageVariant.Standard;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const imports = importCounts(sourceFile);
    bytes += Buffer.byteLength(text, "utf8");
    tokens += tokenCount(text, variant);
    valueImports += imports.value;
    typeImports += imports.type;
    if (!file.endsWith(".d.ts")) {
      temporaryNames.push(...syntheticTemps(file, sourceFile));
    }
  }

  temporaryNames.sort();
  return {
    metrics: {
      modules: files.length,
      bytes,
      tokens,
      temporaryDeclarations: temporaryNames.length,
      valueImports,
      typeImports
    },
    temporaryNames
  };
}

function assertBudget(profileId: string, spec: ProfileSpec, actual: ProfileMeasurement): void {
  const baseline = spec.budget.baseline;
  const maximum = spec.budget.maximum;
  strictEqual(
    actual.metrics.modules,
    positiveInteger(baseline.modules, `${profileId}.baseline.modules`),
    `${profileId} module count changed; update the reviewed manifest only for an intentional graph change`
  );
  for (const metric of ["bytes", "tokens"] as const) {
    const baselineValue = positiveInteger(
      baseline[metric],
      `${profileId}.baseline.${metric}`
    );
    const limit = positiveInteger(maximum[metric], `${profileId}.maximum.${metric}`);
    ok(limit >= baselineValue, `${profileId}.${metric} maximum is below its baseline`);
    ok(
      limit <= Math.ceil(baselineValue * 1.05),
      `${profileId}.${metric} maximum exceeds the documented 5% review window`
    );
  }
  for (const metric of [
    "temporaryDeclarations",
    "valueImports",
    "typeImports"
  ] as const) {
    strictEqual(
      positiveInteger(maximum[metric], `${profileId}.maximum.${metric}`),
      positiveInteger(baseline[metric], `${profileId}.baseline.${metric}`),
      `${profileId}.${metric} growth requires a new reviewed baseline`
    );
  }
  for (const metric of [
    "bytes",
    "tokens",
    "temporaryDeclarations",
    "valueImports",
    "typeImports"
  ] as const) {
    const limit = positiveInteger(maximum[metric], `${profileId}.maximum.${metric}`);
    ok(
      actual.metrics[metric] <= limit,
      `${profileId}.${metric}=${actual.metrics[metric]} exceeds reviewed maximum ${limit}`
    );
  }

  const root = path.join(repoRoot, spec.root);
  for (const relative of spec.noTempFiles) {
    const absolute = path.join(root, relative);
    const prefix = `${slash(path.relative(repoRoot, absolute))}:`;
    const offending = actual.temporaryNames.filter((entry) => entry.startsWith(prefix));
    deepStrictEqual(
      offending,
      [],
      `${profileId} no-temp fixture ${relative} gained lowering temporaries`
    );
  }
}

function assertExactMapping(spec: MappingSpec): void {
  const generatedPath = path.join(repoRoot, spec.generated);
  const mapPath = `${generatedPath}.map`;
  const generated = readFileSync(generatedPath, "utf8");
  const offset = generated.indexOf(spec.needle);
  ok(offset !== -1, `${spec.profile} mapping needle not found: ${spec.needle}`);
  const position = lineAndColumn(generated, offset);
  const map = rawSourceMap(mapPath);
  const original = originalPosition(
    new SourceMapConsumer(map.raw),
    position.line,
    position.column
  );
  ok(original.source !== null, `${spec.profile} ${spec.needle} has no mapped source`);
  ok(original.line !== null, `${spec.profile} ${spec.needle} has no mapped line`);
  ok(original.column !== null, `${spec.profile} ${spec.needle} has no mapped column`);
  const originalPath = resolveOriginalSource(mapPath, map.sourceRoot, original.source);
  strictEqual(slash(path.relative(repoRoot, originalPath)), spec.source);
  strictEqual(original.line, spec.line, `${spec.profile} ${spec.needle} source line`);
  strictEqual(original.column, spec.column, `${spec.profile} ${spec.needle} source column`);
}

function runStackProbe(moduleRelativePath: string, spec: StackProbeSpec): string {
  const moduleUrl = pathToFileURL(path.join(repoRoot, moduleRelativePath)).href;
  const script = [
    `import(${JSON.stringify(moduleUrl)})`,
    `.then((module) => module[${JSON.stringify(spec.exportName)}]`,
    `[${JSON.stringify(spec.method)}]())`
  ].join("");
  const result = spawnSync(
    process.execPath,
    ["--enable-source-maps", "--input-type=module", "-e", script],
    { cwd: repoRoot, encoding: "utf8" }
  );
  ok(result.status !== 0, `${moduleRelativePath} source-map probe unexpectedly succeeded`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  ok(output.includes(spec.message), `${moduleRelativePath} omitted the probe error message`);
  return slash(output);
}

/**
 * Verifies executable stacks without claiming automatic TS→Haxe composition.
 *
 * Classic Node consumes the Genes JS map directly and must print the exact Haxe
 * frame. TypeScript's runtime map intentionally points JS back to generated TS;
 * the harness asserts that exact frame, then follows the separate Genes map to
 * the same Haxe token. This proves both links while keeping product claims true.
 */
function assertStackProbe(spec: StackProbeSpec): void {
  const expectedHaxePath = slash(path.join(repoRoot, spec.source));
  const classic = runStackProbe(spec.classicModule, spec);
  ok(
    classic.includes(`${expectedHaxePath}:${spec.line}:${spec.column + 1}`),
    `Classic mapped stack did not reach ${spec.source}:${spec.line}:${spec.column + 1}\n${classic}`
  );

  const generatedPath = path.join(repoRoot, spec.tsGenerated);
  const generated = readFileSync(generatedPath, "utf8");
  const needleOffset = generated.indexOf(spec.tsNeedle);
  ok(needleOffset !== -1, `TS stack needle not found: ${spec.tsNeedle}`);
  const tokenOffset = needleOffset + spec.tsNeedle.indexOf("new Error");
  const generatedPosition = lineAndColumn(generated, tokenOffset);
  const tsStack = runStackProbe(spec.tsModule, spec);
  const expectedTsPath = slash(generatedPath);
  ok(
    tsStack.includes(
      `${expectedTsPath}:${generatedPosition.line}:${generatedPosition.column + 1}`
    ),
    `TypeScript runtime stack did not reach the generated TS token\n${tsStack}`
  );

  const mapPath = `${generatedPath}.map`;
  const map = rawSourceMap(mapPath);
  const original = originalPosition(
    new SourceMapConsumer(map.raw),
    generatedPosition.line,
    generatedPosition.column
  );
  ok(original.source !== null, "TS stack token has no Haxe source mapping");
  ok(original.line !== null, "TS stack token has no Haxe source line");
  ok(original.column !== null, "TS stack token has no Haxe source column");
  const originalPath = resolveOriginalSource(mapPath, map.sourceRoot, original.source);
  strictEqual(slash(path.relative(repoRoot, originalPath)), spec.source);
  strictEqual(original.line, spec.line);
  strictEqual(original.column, spec.column);
}

const manifest = loadManifest();

cleanCompilerOutputs();
const firstBuildTiming = buildCompilerOutputs();
const firstTrees = manifest.trees.map(captureTree);
const firstProfiles = Object.fromEntries(
  Object.entries(manifest.profiles).map(([id, spec]) => [id, measureProfile(spec)])
) as Record<string, ProfileMeasurement>;

cleanCompilerOutputs();
const secondBuildTiming = buildCompilerOutputs();
const secondTrees = manifest.trees.map(captureTree);
const secondProfiles = Object.fromEntries(
  Object.entries(manifest.profiles).map(([id, spec]) => [id, measureProfile(spec)])
) as Record<string, ProfileMeasurement>;

deepStrictEqual(secondTrees, firstTrees, "Two clean compiler builds produced different normalized trees");
deepStrictEqual(secondProfiles, firstProfiles, "Two clean compiler builds produced different metrics");

if (process.env.UPDATE_OUTPUT_QUALITY === "1") {
  console.log(JSON.stringify({ trees: secondTrees, profiles: secondProfiles }, null, 2));
} else {
  for (const [profileId, spec] of Object.entries(manifest.profiles)) {
    assertBudget(profileId, spec, secondProfiles[profileId]);
  }
}

for (const mapping of manifest.exactMappings) {
  assertExactMapping(mapping);
}

runTypeScript("legacyFloor", ["-p", "tests/output-modes/tsconfig.generated.json"]);
assertStackProbe(manifest.stackProbe);

console.log(
  `output-quality:ok (${secondTrees.map((tree) => `${tree.id}:${tree.files}:${tree.hash.slice(0, 12)}`).join(", ")})`
);
console.log(
  "output-performance:report-only " +
  `first(ts=${firstBuildTiming.tsMilliseconds.toFixed(1)}ms,classic=${firstBuildTiming.classicMilliseconds.toFixed(1)}ms) ` +
  `second(ts=${secondBuildTiming.tsMilliseconds.toFixed(1)}ms,classic=${secondBuildTiming.classicMilliseconds.toFixed(1)}ms)`
);
