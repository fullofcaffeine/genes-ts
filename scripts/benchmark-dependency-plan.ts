import { ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { cpus, getPriority, loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  runBoundedProcess,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import { parseHaxeTimes, type HaxeTimingRow } from "./haxe-times.js";
import { toolchains } from "./toolchains.js";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const repoRoot = path.resolve(scriptDir, "../..");
const defaultWorkspace = path.join(repoRoot, ".tmp/dependency-plan-benchmark");
const edgeCounts = [128, 256, 512] as const;
const defaultRounds = 5;
const defaultSeed = 20260905;
const defaultSensitivityMultiplier = 8;
const defaultSensitivitySamples = 3;
const compileTimeoutMs = 15 * 60_000;
const typeEdgeSubownerIds = [
  "genes.plan.reachability.typeCollection.boundaryPlanReferences",
  "genes.plan.reachability.typeCollection.memberSignatures",
  "genes.plan.reachability.typeCollection.expressionLocals",
  "genes.plan.reachability.typeCollection.recursiveExpansion",
  "genes.plan.reachability.typeCollection.importNormalization"
] as const;
const selectedTimingIds = new Set([
  "total",
  "parsing",
  "typing",
  "filters",
  "analyzer",
  "generate",
  "genes.plan.inventory",
  "genes.plan.reachability",
  "genes.plan.reachability.roots",
  "genes.plan.reachability.expand",
  "genes.plan.reachability.runtimeEdges",
  "genes.plan.reachability.typeEdges",
  ...typeEdgeSubownerIds,
  "genes.validate.modules",
  "genes.emit.implementation",
  "genes.publish.transaction"
]);

export type EdgeCount = typeof edgeCounts[number];
export type SampleKind =
  | "anchor-before"
  | "scale"
  | "anchor-after"
  | "sensitivity-baseline"
  | "sensitivity-inflated";

export interface ScheduledCase {
  readonly kind: SampleKind;
  readonly edges: EdgeCount;
  readonly referenceMultiplier: number;
}

export interface BenchmarkOptions {
  readonly rounds: number;
  readonly seed: number;
  readonly sensitivityMultiplier: number;
  readonly sensitivitySamples: number;
  readonly keepWorkspace: boolean;
  readonly outputPath: string | null;
}

interface Fixture {
  readonly key: string;
  readonly edges: EdgeCount;
  readonly runtimeEdges: number;
  readonly typeEdges: number;
  readonly referenceMultiplier: number;
  readonly authoredLines: number;
  readonly expectedRuntimeReferences: number;
  readonly expectedTypeReferences: number;
  readonly sourceRoot: string;
  readonly outputRoot: string;
}

export interface TimingObservation {
  readonly id: string;
  readonly path: string;
  readonly reportedSeconds: number;
  readonly percentOfTotal: number;
  readonly percentOfParent: number;
  readonly count: number;
}

export interface BenchmarkSample {
  readonly round: number | null;
  readonly sequenceIndex: number;
  readonly kind: SampleKind;
  readonly edges: EdgeCount;
  readonly runtimeEdges: number;
  readonly typeEdges: number;
  readonly referenceMultiplier: number;
  readonly expectedRuntimeReferences: number;
  readonly expectedTypeReferences: number;
  readonly authoredLines: number;
  readonly wallMilliseconds: number;
  readonly loadAverageBefore: ReadonlyArray<number>;
  readonly loadAverageAfter: ReadonlyArray<number>;
  readonly outputHash: string;
  readonly timings: ReadonlyArray<TimingObservation>;
}

export interface Distribution {
  readonly sampleCount: number;
  readonly minimum: number;
  readonly median: number;
  readonly maximum: number;
  readonly samples: ReadonlyArray<number>;
}

interface CaseAggregate {
  readonly kind: SampleKind;
  readonly edges: EdgeCount;
  readonly referenceMultiplier: number;
  readonly wallMilliseconds: Distribution;
  readonly plannerReportedSeconds: Distribution;
  readonly plannerPercentOfTotal: Distribution;
  readonly typeEdgeSubowners: ReadonlyArray<{
    readonly id: typeof typeEdgeSubownerIds[number];
    readonly reportedSeconds: Distribution;
    readonly invocationCount: Distribution;
  }>;
}

interface DependencyPlanBenchmarkReport {
  readonly schemaVersion: 2;
  readonly classification: "report-only";
  readonly environment: {
    readonly commit: string;
    readonly workingTreeDirty: boolean;
    readonly workingTreeStatus: ReadonlyArray<string>;
    readonly node: string;
    readonly haxe: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly logicalCpuCount: number;
    readonly processPriority: number;
    readonly loadAverageBefore: ReadonlyArray<number>;
    readonly loadAverageAfter: ReadonlyArray<number>;
  };
  readonly protocol: {
    readonly rounds: number;
    readonly seed: number;
    readonly order: "seeded-shuffle-with-bracketing-256-edge-anchors";
    readonly compilerConcurrency: 1;
    readonly warmupsPerFixture: 1;
    readonly priority: "inherited";
    readonly absoluteTimingAuthority: "process-wall-clock";
    readonly ownerTimingInterpretation: "within-run-relative-shares";
    readonly sensitivityMultiplier: number;
    readonly sensitivitySamples: number;
    readonly command: ReadonlyArray<string>;
  };
  readonly samples: ReadonlyArray<BenchmarkSample>;
  readonly aggregates: ReadonlyArray<CaseAggregate>;
  readonly sensitivity: {
    readonly baselinePlannerReportedSeconds: Distribution;
    readonly inflatedPlannerReportedSeconds: Distribution;
    readonly detectedRatio: number;
  };
}

function padded(value: number): string {
  return value.toString().padStart(3, "0");
}

/** Builds an ordinary import graph or a source-only repeated-reference control. */
export function sourceFor(edgeCount: number, referenceMultiplier = 1): string {
  ok(edgeCount > 0 && edgeCount % 2 === 0, "edge count must be a positive even number");
  ok(Number.isInteger(referenceMultiplier) && referenceMultiplier > 0,
    "reference multiplier must be a positive integer");
  const runtimeEdges = edgeCount / 2;
  const typeEdges = edgeCount - runtimeEdges;
  const lines = [
    "package dependencyplanbenchmark;",
    "",
    "/** Test-only entrypoint generated by benchmark-dependency-plan.ts. */",
    "@:keep",
    "class Main {",
    "  static function main():Void {",
    "    var total = 0;"
  ];

  for (let repeat = 0; repeat < referenceMultiplier; repeat++) {
    for (let index = 0; index < runtimeEdges; index++) {
      lines.push(`    total += RuntimeEdge${padded(index)}.read();`);
    }
  }
  lines.push("    if (total == -1)", "      trace(total);", "  }", "");
  for (let repeat = 0; repeat < referenceMultiplier; repeat++) {
    for (let index = 0; index < typeEdges; index++) {
      lines.push(
        `  public static function keepType${padded(index)}_${padded(repeat)}(`
        + `value:TypeEdge${padded(index)}):TypeEdge${padded(index)} {`,
        "    return value;",
        "  }",
        ""
      );
    }
  }
  lines.push("}", "");

  for (let index = 0; index < runtimeEdges; index++) {
    lines.push(
      `@:jsRequire("dependency-plan-runtime-${padded(index)}", "RuntimeEdge${padded(index)}")`,
      `extern class RuntimeEdge${padded(index)} {`,
      "  public static function read():Int;",
      "}",
      ""
    );
  }
  for (let index = 0; index < typeEdges; index++) {
    lines.push(
      `@:jsRequire("dependency-plan-type-${padded(index)}", "TypeEdge${padded(index)}")`,
      `extern class TypeEdge${padded(index)} {}`,
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

/** Returns a reproducible order while fixed-size anchors bracket every round. */
export function scheduleForRound(round: number, seed: number): ReadonlyArray<ScheduledCase> {
  ok(Number.isInteger(round) && round > 0, "round must be a positive integer");
  const random = seededRandom(seed + round - 1);
  const shuffled = [...edgeCounts];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return [
    { kind: "anchor-before", edges: 256, referenceMultiplier: 1 },
    ...shuffled.map((edges): ScheduledCase => ({
      kind: "scale", edges, referenceMultiplier: 1
    })),
    { kind: "anchor-after", edges: 256, referenceMultiplier: 1 }
  ];
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files.sort();
}

function treeHash(root: string): string {
  const hash = createHash("sha256");
  for (const file of filesUnder(root)) {
    hash.update(path.relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readGenesVersion(sourceSnapshotRoot: string): string {
  const parsed = JSON.parse(
    readFileSync(path.join(sourceSnapshotRoot, "haxelib.json"), "utf8")
  ) as {
    readonly version?: unknown;
  };
  ok(typeof parsed.version === "string", "haxelib.json version is missing");
  return parsed.version;
}

function buildArguments(
  fixture: Fixture,
  sourceSnapshotRoot: string
): ReadonlyArray<string> {
  return [
    "-D", "genes.compile_stage_profile",
    "-cp", path.join(sourceSnapshotRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${readGenesVersion(sourceSnapshotRoot)}`,
    "--macro", 'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "genes.react.ReactDiagnosticsMacro.install()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "-cp", fixture.sourceRoot,
    "--main", "dependencyplanbenchmark.Main",
    "-js", path.join(fixture.outputRoot, "index.ts"),
    "-D", "genes.ts",
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    "--times"
  ];
}

function verifyEdgeInventory(outputRoot: string, expected: number): void {
  const output = filesUnder(outputRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const matches = output.match(/dependency-plan-(?:runtime|type)-\d{3}/g) ?? [];
  strictEqual(matches.length, expected,
    `expected ${expected} dependency declarations in generated output`);
  strictEqual(new Set(matches).size, expected,
    `expected ${expected} distinct dependency requests in generated output`);
  const expectedPerKind = expected / 2;
  strictEqual((output.match(/^import (?!type ).*dependency-plan-runtime-\d{3}.*$/gm) ?? []).length,
    expectedPerKind, `expected ${expectedPerKind} executable imports`);
  strictEqual((output.match(/^import type .*dependency-plan-type-\d{3}.*$/gm) ?? []).length,
    expectedPerKind, `expected ${expectedPerKind} TypeScript-only imports`);
}

function selectedTimings(rows: ReadonlyArray<HaxeTimingRow>): ReadonlyArray<TimingObservation> {
  return rows.filter((row) => selectedTimingIds.has(row.id)).map((row) => ({
    id: row.id,
    path: row.path,
    reportedSeconds: row.reportedSeconds,
    percentOfTotal: row.percentOfTotal,
    percentOfParent: row.percentOfParent,
    count: row.count
  }));
}

export function plannerReportedSeconds(sample: Pick<BenchmarkSample, "timings">): number {
  return sample.timings
    .filter((row) => row.id === "genes.plan.reachability.runtimeEdges"
      || row.id === "genes.plan.reachability.typeEdges")
    .reduce((sum, row) => sum + row.reportedSeconds, 0);
}

export function plannerPercentOfTotal(sample: Pick<BenchmarkSample, "timings">): number {
  return sample.timings
    .filter((row) => row.id === "genes.plan.reachability.runtimeEdges"
      || row.id === "genes.plan.reachability.typeEdges")
    .reduce((sum, row) => sum + row.percentOfTotal, 0);
}

export function typeEdgeSubownerReportedSeconds(
  sample: Pick<BenchmarkSample, "timings">,
  id: typeof typeEdgeSubownerIds[number]
): number {
  return sample.timings
    .filter((row) => row.id === id)
    .reduce((sum, row) => sum + row.reportedSeconds, 0);
}

export function distribution(values: ReadonlyArray<number>): Distribution {
  ok(values.length > 0, "cannot summarize an empty distribution");
  const samples = [...values];
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    minimum: ordered[0] ?? 0,
    median: ordered.length % 2 === 0
      ? ((ordered[ordered.length / 2 - 1] ?? 0) + (ordered[ordered.length / 2] ?? 0)) / 2
      : ordered[Math.floor(ordered.length / 2)] ?? 0,
    maximum: ordered.at(-1) ?? 0,
    samples
  };
}

function createFixture(
  workspace: string,
  edges: EdgeCount,
  referenceMultiplier: number
): Fixture {
  const key = `${String(edges)}-edges-${String(referenceMultiplier)}x-references`;
  const root = path.join(workspace, key);
  const sourceRoot = path.join(root, "src");
  const outputRoot = path.join(root, "out");
  const sourceDirectory = path.join(sourceRoot, "dependencyplanbenchmark");
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  const source = sourceFor(edges, referenceMultiplier);
  writeFileSync(path.join(sourceDirectory, "Main.hx"), source);
  return {
    key,
    edges,
    runtimeEdges: edges / 2,
    typeEdges: edges / 2,
    referenceMultiplier,
    authoredLines: source.split("\n").length - 1,
    expectedRuntimeReferences: edges / 2 * referenceMultiplier,
    expectedTypeReferences: edges * referenceMultiplier,
    sourceRoot,
    outputRoot
  };
}

async function compile(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  fixture: Fixture,
  sourceSnapshotRoot: string
): Promise<{
  readonly wallMilliseconds: number;
  readonly timings: ReadonlyArray<TimingObservation>;
}> {
  const started = performance.now();
  const result = await runBoundedProcess(compiler.binary,
    buildArguments(fixture, sourceSnapshotRoot), {
      cwd: repoRoot,
      timeoutMs: compileTimeoutMs,
      label: fixture.key,
      reportProgress: true
    }
  );
  const wallMilliseconds = performance.now() - started;
  if (result.code !== 0) {
    throw new Error(
      `${fixture.key} failed with code ${String(result.code)} and signal ${String(result.signal)}`
      + `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  const rows = parseHaxeTimes(`${result.stdout}\n${result.stderr}`);
  const timings = selectedTimings(rows);
  for (const id of [
    "total",
    "genes.plan.reachability",
    "genes.plan.reachability.runtimeEdges",
    "genes.plan.reachability.typeEdges",
    "genes.emit.implementation",
    "genes.publish.transaction"
  ]) {
    ok(timings.some((row) => row.id === id), `${fixture.key} is missing timing row ${id}`);
  }
  return { wallMilliseconds, timings };
}

async function measure(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  sourceSnapshotRoot: string,
  fixture: Fixture,
  scheduled: ScheduledCase,
  round: number | null,
  sequenceIndex: number,
  expectedHash: string
): Promise<BenchmarkSample> {
  const loadAverageBefore = loadavg();
  const result = await compile(compiler, fixture, sourceSnapshotRoot);
  const loadAverageAfter = loadavg();
  verifyEdgeInventory(fixture.outputRoot, fixture.edges);
  const outputHash = treeHash(fixture.outputRoot);
  strictEqual(outputHash, expectedHash, `${fixture.key} output changed between identical builds`);
  return {
    round,
    sequenceIndex,
    kind: scheduled.kind,
    edges: fixture.edges,
    runtimeEdges: fixture.runtimeEdges,
    typeEdges: fixture.typeEdges,
    referenceMultiplier: fixture.referenceMultiplier,
    expectedRuntimeReferences: fixture.expectedRuntimeReferences,
    expectedTypeReferences: fixture.expectedTypeReferences,
    authoredLines: fixture.authoredLines,
    wallMilliseconds: result.wallMilliseconds,
    loadAverageBefore,
    loadAverageAfter,
    outputHash,
    timings: result.timings
  };
}

function aggregateSamples(samples: ReadonlyArray<BenchmarkSample>): ReadonlyArray<CaseAggregate> {
  const keys = new Map<string, BenchmarkSample[]>();
  for (const sample of samples) {
    const key = `${sample.kind}:${String(sample.edges)}:${String(sample.referenceMultiplier)}`;
    const group = keys.get(key) ?? [];
    group.push(sample);
    keys.set(key, group);
  }
  return [...keys.values()].map((group) => {
    const first = group[0];
    ok(first !== undefined);
    return {
      kind: first.kind,
      edges: first.edges,
      referenceMultiplier: first.referenceMultiplier,
      wallMilliseconds: distribution(group.map((sample) => sample.wallMilliseconds)),
      plannerReportedSeconds: distribution(group.map(plannerReportedSeconds)),
      plannerPercentOfTotal: distribution(group.map(plannerPercentOfTotal)),
      typeEdgeSubowners: typeEdgeSubownerIds.map((id) => ({
        id,
        reportedSeconds: distribution(group.map((sample) =>
          typeEdgeSubownerReportedSeconds(sample, id))),
        invocationCount: distribution(group.map((sample) => sample.timings
          .filter((row) => row.id === id)
          .reduce((sum, row) => sum + row.count, 0)))
      }))
    };
  });
}

function gitStatus(): ReadonlyArray<string> {
  const text = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
  return text.length === 0 ? [] : text.split(/\r?\n/);
}

interface GitProvenance {
  readonly commit: string;
  readonly status: ReadonlyArray<string>;
}

export function requireCleanStatus(status: ReadonlyArray<string>): void {
  strictEqual(status.length, 0,
    "benchmark requires a clean working tree so every sample has one exact source revision");
}

function gitProvenance(): GitProvenance {
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim(),
    status: gitStatus()
  };
}

/** Copies compiler inputs from Git objects so live-checkout edits cannot alter samples. */
export function materializeSourceSnapshot(commit: string, destination: string): void {
  const tracked = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", commit, "--", "src", "haxelib.json"],
    { cwd: repoRoot, encoding: "utf8" }
  ).split("\0").filter((entry) => entry.length > 0);
  ok(tracked.includes("haxelib.json"), "source snapshot is missing haxelib.json");
  ok(tracked.some((entry) => entry.startsWith("src/")), "source snapshot is missing src files");
  for (const relative of tracked) {
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", `${commit}:${relative}`], {
      cwd: repoRoot,
      encoding: null
    }));
  }
}

async function runBenchmark(options: BenchmarkOptions): Promise<DependencyPlanBenchmarkReport> {
  strictEqual(process.versions.node, toolchains.node.minimumRuntime,
    `benchmark requires pinned Node ${toolchains.node.minimumRuntime}`);
  const compiler = selectedHaxeCompiler(repoRoot);
  strictEqual(compiler.version, toolchains.haxe.stable,
    `benchmark requires pinned Haxe ${toolchains.haxe.stable}`);
  const initialProvenance = gitProvenance();
  requireCleanStatus(initialProvenance.status);
  const sourceSnapshotRoot = path.join(defaultWorkspace, "revision");
  materializeSourceSnapshot(initialProvenance.commit, sourceSnapshotRoot);
  const loadAverageBefore = loadavg();
  const fixtures = new Map<string, Fixture>();
  for (const [edges, multiplier] of [
    [128, 1], [256, 1], [512, 1], [128, options.sensitivityMultiplier]
  ] as const) {
    const fixture = createFixture(defaultWorkspace, edges, multiplier);
    fixtures.set(fixture.key, fixture);
  }
  const fixtureFor = (edges: EdgeCount, multiplier: number): Fixture => {
    const fixture = fixtures.get(`${String(edges)}-edges-${String(multiplier)}x-references`);
    ok(fixture !== undefined, `missing fixture for ${String(edges)} edges at ${String(multiplier)}x`);
    return fixture;
  };

  const hashes = new Map<string, string>();
  for (const fixture of fixtures.values()) {
    await compile(compiler, fixture, sourceSnapshotRoot);
    verifyEdgeInventory(fixture.outputRoot, fixture.edges);
    hashes.set(fixture.key, treeHash(fixture.outputRoot));
  }

  const samples: BenchmarkSample[] = [];
  let sequenceIndex = 0;
  for (let round = 1; round <= options.rounds; round++) {
    for (const scheduled of scheduleForRound(round, options.seed)) {
      const fixture = fixtureFor(scheduled.edges, scheduled.referenceMultiplier);
      const expectedHash = hashes.get(fixture.key);
      ok(expectedHash !== undefined);
      samples.push(await measure(
        compiler, sourceSnapshotRoot, fixture, scheduled, round, sequenceIndex++, expectedHash
      ));
    }
  }

  for (let pair = 0; pair < options.sensitivitySamples; pair++) {
    const pairOrder: ReadonlyArray<ScheduledCase> = pair % 2 === 0
      ? [
          { kind: "sensitivity-baseline", edges: 128, referenceMultiplier: 1 },
          { kind: "sensitivity-inflated", edges: 128,
            referenceMultiplier: options.sensitivityMultiplier }
        ]
      : [
          { kind: "sensitivity-inflated", edges: 128,
            referenceMultiplier: options.sensitivityMultiplier },
          { kind: "sensitivity-baseline", edges: 128, referenceMultiplier: 1 }
        ];
    for (const scheduled of pairOrder) {
      const fixture = fixtureFor(scheduled.edges, scheduled.referenceMultiplier);
      const expectedHash = hashes.get(fixture.key);
      ok(expectedHash !== undefined);
      samples.push(await measure(
        compiler, sourceSnapshotRoot, fixture, scheduled, null, sequenceIndex++, expectedHash
      ));
    }
  }

  const sensitivityBaseline = samples.filter((sample) =>
    sample.kind === "sensitivity-baseline");
  const sensitivityInflated = samples.filter((sample) =>
    sample.kind === "sensitivity-inflated");
  const baselineDistribution = distribution(sensitivityBaseline.map(plannerReportedSeconds));
  const inflatedDistribution = distribution(sensitivityInflated.map(plannerReportedSeconds));
  const detectedRatio = inflatedDistribution.median / baselineDistribution.median;
  ok(Number.isFinite(detectedRatio) && detectedRatio > 1,
    `planner observer did not detect ${String(options.sensitivityMultiplier)}x repeated references`);

  return {
    schemaVersion: 2,
    classification: "report-only",
    environment: {
      commit: initialProvenance.commit,
      workingTreeDirty: initialProvenance.status.length > 0,
      workingTreeStatus: initialProvenance.status,
      node: process.versions.node,
      haxe: compiler.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      processPriority: getPriority(),
      loadAverageBefore,
      loadAverageAfter: loadavg()
    },
    protocol: {
      rounds: options.rounds,
      seed: options.seed,
      order: "seeded-shuffle-with-bracketing-256-edge-anchors",
      compilerConcurrency: 1,
      warmupsPerFixture: 1,
      priority: "inherited",
      absoluteTimingAuthority: "process-wall-clock",
      ownerTimingInterpretation: "within-run-relative-shares",
      sensitivityMultiplier: options.sensitivityMultiplier,
      sensitivitySamples: options.sensitivitySamples,
      command: [process.execPath, scriptFile, ...process.argv.slice(2)]
    },
    samples,
    aggregates: aggregateSamples(samples),
    sensitivity: {
      baselinePlannerReportedSeconds: baselineDistribution,
      inflatedPlannerReportedSeconds: inflatedDistribution,
      detectedRatio
    }
  };
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  ok(Number.isInteger(parsed) && parsed > 0, `${label} must be a positive integer`);
  return parsed;
}

function isStrictDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function validateOutputPath(outputPath: string): string {
  const resolved = path.resolve(outputPath);
  let existing = resolved;
  const missingSegments: string[] = [];
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      ok(parent !== existing, `--out has no existing ancestor: ${resolved}`);
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const canonical = path.join(realpathSync(existing), ...missingSegments);
  ok(canonical !== defaultWorkspace
    && !isStrictDescendant(defaultWorkspace, canonical)
    && !isStrictDescendant(canonical, defaultWorkspace),
  "--out must not overlap the repository-owned benchmark workspace");
  return canonical;
}

export function parseOptions(args: ReadonlyArray<string>): BenchmarkOptions {
  let rounds = defaultRounds;
  let seed = defaultSeed;
  let sensitivityMultiplier = defaultSensitivityMultiplier;
  let sensitivitySamples = defaultSensitivitySamples;
  let keepWorkspace = false;
  let outputPath: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--rounds") rounds = positiveInteger(args[++index], "rounds");
    else if (argument === "--seed") seed = positiveInteger(args[++index], "seed");
    else if (argument === "--sensitivity-multiplier") {
      sensitivityMultiplier = positiveInteger(args[++index], "sensitivity multiplier");
      ok(sensitivityMultiplier > 1, "sensitivity multiplier must be greater than 1");
    } else if (argument === "--sensitivity-samples") {
      sensitivitySamples = positiveInteger(args[++index], "sensitivity samples");
    } else if (argument === "--out") {
      const value = args[++index];
      ok(value !== undefined, "--out requires a path");
      outputPath = value;
    } else if (argument === "--keep-workspace") keepWorkspace = true;
    else throw new Error(`Unknown argument: ${String(argument)}`);
  }
  return {
    rounds,
    seed,
    sensitivityMultiplier,
    sensitivitySamples,
    keepWorkspace,
    outputPath: outputPath === null ? null : validateOutputPath(outputPath)
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  rmSync(defaultWorkspace, { recursive: true, force: true });
  const report = await (async (): Promise<DependencyPlanBenchmarkReport> => {
    try {
      return await runBenchmark(options);
    } finally {
      if (!options.keepWorkspace) {
        rmSync(defaultWorkspace, { recursive: true, force: true });
      }
    }
  })();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath !== null) {
    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, json);
  }
  process.stdout.write(
      "dependency-plan-benchmark:report-only\n"
      + `commit=${report.environment.commit}; Node ${report.environment.node}; `
      + `Haxe ${report.environment.haxe}; priority=${String(report.environment.processPriority)}\n`
      + `rounds=${String(report.protocol.rounds)}; seed=${String(report.protocol.seed)}; `
      + `samples=${String(report.samples.length)}\n`
    );
    for (const aggregate of report.aggregates) {
      process.stdout.write(
        `${aggregate.kind} ${String(aggregate.edges)} edges `
        + `${String(aggregate.referenceMultiplier)}x references: `
        + `wall median=${aggregate.wallMilliseconds.median.toFixed(1)}ms; `
        + `planner share median=${aggregate.plannerPercentOfTotal.median.toFixed(1)}%\n`
      );
      process.stdout.write(`${aggregate.typeEdgeSubowners.map((owner) =>
        `${owner.id.split(".").at(-1)}=${owner.reportedSeconds.median.toFixed(3)}s`
      ).join("; ")}\n`);
    }
    process.stdout.write(
      `sensitivity planner ratio=${report.sensitivity.detectedRatio.toFixed(2)}x\n`
      + (options.outputPath === null ? json : `report=${options.outputPath}\n`)
  );
}

if (process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(scriptFile)) {
  await main();
}
