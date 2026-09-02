import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { cpus, getPriority, loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  compilerOutputSentinel,
  hashTree,
  leakedOutputStages,
  OwnedHaxeCompilerServer,
  runBoundedProcess,
  selectedHaxeCompiler,
  type ProcessResult,
  type TreeEntry
} from "./compiler-server-lifecycle.js";
import { parseHaxeTimes, type HaxeTimingRow } from "./haxe-times.js";
import { toolchains } from "./toolchains.js";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const repoRoot = path.resolve(scriptDir, "../..");
const defaultWorkspace = path.join(repoRoot, ".tmp/compile-stage-report");
const haxeTimeoutMs = 15 * 60_000;
const typescriptTimeoutMs = 5 * 60_000;

type FixtureName = "control" | "scale";
type ProfileName = "genes-ts" | "classic-js";
type SampleKind = "cold" | "warm-edit";
type EditPattern = "a-b-a-b" | "b-a-b-a";

interface FixtureShape {
  readonly name: FixtureName;
  readonly moduleCount: number;
  readonly methodsPerModule: number;
}

export interface CompileStageOptions {
  readonly fixture: FixtureName;
  readonly samples: number;
  readonly warmups: number;
  readonly workspace?: string;
  readonly keepWorkspace?: boolean;
}

interface Distribution {
  readonly unit: "milliseconds" | "haxe-reported-seconds";
  readonly sampleCount: number;
  readonly minimum: number;
  readonly median: number;
  readonly p95: number;
  readonly maximum: number;
  readonly mean: number;
  readonly standardDeviation: number;
  readonly samples: ReadonlyArray<number>;
}

interface OutputInventory {
  readonly files: number;
  readonly modules: number;
  readonly sourceMaps: number;
  readonly bytes: number;
  readonly sha256: string;
}

interface CompileMeasurement {
  readonly kind: SampleKind;
  readonly sample: number;
  readonly edit: "a" | "b";
  readonly wallMs: number;
  readonly haxeReportedSeconds: number;
  readonly wallMsPerHaxeReportedSecond: number;
  readonly haxeTimes: ReadonlyArray<HaxeTimingRow>;
  readonly output: OutputInventory;
  readonly typescriptMs: number | null;
}

export interface StageDistribution {
  readonly id: string;
  readonly path: string;
  readonly distribution: Distribution;
}

export type HaxeTimingClockStatus =
  | "known-unscaled-macos-monotonic-clock"
  | "unverified";

/** Identifies the Haxe 4.3.7 macOS native timer scale defect. */
export function haxeTimingClockStatus(
  platform: NodeJS.Platform,
  version: string
): HaxeTimingClockStatus {
  return platform === "darwin" && version === "4.3.7"
    ? "known-unscaled-macos-monotonic-clock"
    : "unverified";
}

/** Describes the measured edit sequence after the configured warmups. */
export function editPatternForWarmups(warmups: number): EditPattern {
  return warmups % 2 === 0 ? "a-b-a-b" : "b-a-b-a";
}

export interface CompileStageReport {
  readonly schemaVersion: 2;
  readonly classification: "report-only";
  readonly fixture: {
    readonly name: FixtureName;
    readonly authoredHaxeLines: number;
    readonly modules: number;
    readonly methodsPerModule: number;
  };
  readonly environment: {
    readonly commit: string;
    readonly workingTreeDirty: boolean;
    readonly workingTreeStatus: ReadonlyArray<string>;
    readonly node: string;
    readonly haxe: string;
    readonly typescript: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly logicalCpuCount: number;
    readonly processPriority: number;
    readonly loadAverageBefore: ReadonlyArray<number>;
    readonly loadAverageAfter: ReadonlyArray<number>;
  };
  readonly protocol: {
    readonly measuredProfile: "genes-ts";
    readonly priority: "inherited";
    readonly compilerConcurrency: 1;
    readonly warmups: number;
    readonly samples: number;
    readonly coldWarmOrder: "alternating";
    readonly editPattern: EditPattern;
    readonly haxeTiming: {
      readonly source: "--times";
      readonly reportedUnit: "seconds";
      readonly absoluteTimingAuthority: "process-wall-clock";
      readonly safeInterpretation: "within-run-shares-and-same-toolchain-relative-comparisons";
      readonly clockStatus: HaxeTimingClockStatus;
    };
    readonly typescriptTiming: "separate-after-each-pair";
    readonly commands: {
      readonly coldHaxe: ReadonlyArray<string>;
      readonly warmHaxe: ReadonlyArray<string>;
      readonly typescript: ReadonlyArray<string>;
    };
  };
  readonly outputNeutrality: ReadonlyArray<{
    readonly fixture: "control";
    readonly profile: ProfileName;
    readonly timedHaxeTimes: ReadonlyArray<HaxeTimingRow>;
    readonly timed: OutputInventory;
    readonly untimed: OutputInventory;
  }>;
  readonly measurements: ReadonlyArray<CompileMeasurement>;
  readonly aggregate: {
    readonly coldWall: Distribution;
    readonly warmEditWall: Distribution;
    readonly coldHaxeReported: Distribution;
    readonly warmEditHaxeReported: Distribution;
    readonly typescript: Distribution;
    readonly coldStages: ReadonlyArray<StageDistribution>;
    readonly warmEditStages: ReadonlyArray<StageDistribution>;
  };
}

const fixtureShapes: Readonly<Record<FixtureName, FixtureShape>> = {
  // Keep the class and graph aggregates above Haxe's zero-row rounding boundary.
  control: { name: "control", moduleCount: 16, methodsPerModule: 16 },
  scale: { name: "scale", moduleCount: 145, methodsPerModule: 24 }
};

function padded(index: number): string {
  return index.toString().padStart(3, "0");
}

function moduleSource(index: number, shape: FixtureShape): string {
  const name = `Module${padded(index)}`;
  const lines = [
    "package compilestage;",
    "",
    "/** Generated benchmark input. It is never shipped as compiler source. */",
    "@:keep",
    `class ${name} {`,
    "  public static function run(value:Int):Int {",
    "    var result = value;"
  ];
  for (let method = 0; method < shape.methodsPerModule; method += 1) {
    lines.push(`    result = transform${padded(method)}(result);`);
  }
  if (index + 1 < shape.moduleCount) {
    lines.push(`    result += Module${padded(index + 1)}.run(value + 1);`);
  }
  lines.push("    return result;", "  }", "");
  for (let method = 0; method < shape.methodsPerModule; method += 1) {
    lines.push(
      `  public static function transform${padded(method)}(value:Int):Int {`,
      `    return value + ${String((index + method) % 17)};`,
      "  }",
      ""
    );
  }
  lines.push("}", "");
  return lines.join("\n");
}

function mainSource(): string {
  return [
    "package compilestage;",
    "",
    "class Main {",
    "  static function main():Void {",
    "    trace(EditState.value);",
    "    trace(Module000.run(1));",
    "  }",
    "}",
    ""
  ].join("\n");
}

function editSource(edit: "a" | "b"): string {
  return [
    "package compilestage;",
    "",
    "class EditState {",
    `  public static final value = ${JSON.stringify(`edit-${edit}`)};`,
    "}",
    ""
  ].join("\n");
}

function writeEdit(file: string, edit: "a" | "b"): void {
  const previousModifiedMs = statSync(file).mtimeMs;
  writeFileSync(file, editSource(edit));
  // Haxe's compiler server uses source timestamps to invalidate typed modules.
  // Some filesystems expose less timestamp precision than Node. Move the edit
  // beyond the previous whole-second value so a rapid a-b-a sequence is real.
  const modifiedMs = Math.max(Date.now(), Math.floor(previousModifiedMs) + 2_000);
  const modified = new Date(modifiedMs);
  utimesSync(file, modified, modified);
}

function createFixture(root: string, shape: FixtureShape): {
  readonly sourceRoot: string;
  readonly editFile: string;
  readonly authoredLines: number;
} {
  const sourceRoot = path.join(root, "src");
  const packageRoot = path.join(sourceRoot, "compilestage");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, "Main.hx"), mainSource());
  const editFile = path.join(packageRoot, "EditState.hx");
  writeFileSync(editFile, editSource("a"));
  for (let index = 0; index < shape.moduleCount; index += 1) {
    writeFileSync(
      path.join(packageRoot, `Module${padded(index)}.hx`),
      moduleSource(index, shape)
    );
  }
  const authoredLines = filesUnder(sourceRoot)
    .filter((file) => file.endsWith(".hx"))
    .reduce((sum, file) => sum + readFileSync(file, "utf8").split("\n").length - 1, 0);
  return { sourceRoot, editFile, authoredLines };
}

function filesUnder(root: string): ReadonlyArray<string> {
  const files: string[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function hashEntries(entries: ReadonlyArray<TreeEntry>): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function inventory(root: string, extension: ".ts" | ".js"): OutputInventory {
  const files = filesUnder(root);
  const entries = hashTree(root);
  return {
    files: files.length,
    modules: files.filter((file) => file.endsWith(extension)).length,
    sourceMaps: files.filter((file) => file.endsWith(".map")).length,
    bytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
    sha256: hashEntries(entries)
  };
}

function assertNoPrivateOutput(
  root: string,
  profile: ProfileName
): void {
  const extension = profile === "genes-ts" ? "ts" : "js";
  deepStrictEqual(
    leakedOutputStages(root),
    [],
    `${profile} left a private output transaction stage`
  );
  strictEqual(
    existsSync(compilerOutputSentinel(path.join(root, `index.${extension}`))),
    false,
    `${profile} left Haxe's private output sentinel`
  );
}

function buildArguments(
  sourceRoot: string,
  outputRoot: string,
  profile: ProfileName,
  withTimes: boolean,
  genesVersion: string
): ReadonlyArray<string> {
  const extension = profile === "genes-ts" ? "ts" : "js";
  return [
    "-cp", path.join(repoRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    ...(withTimes ? ["-D", "genes.compile_stage_profile"] : []),
    "--macro", 'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "genes.react.ReactDiagnosticsMacro.install()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "-cp", sourceRoot,
    "--main", "compilestage.Main",
    "-js", path.join(outputRoot, `index.${extension}`),
    "-D", "js-es=6",
    "-D", "no-deprecation-warnings",
    ...(profile === "genes-ts" ? ["-D", "genes.ts"] : []),
    ...(profile === "classic-js" ? ["-D", "dts"] : []),
    "-dce", "full",
    "-debug",
    ...(withTimes ? ["--times"] : [])
  ];
}

function resultText(result: ProcessResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function assertSuccess(result: ProcessResult, label: string, serverLog = ""): void {
  ok(
    result.code === 0,
    `${label} failed with code ${String(result.code)} and signal ${String(result.signal)}`
    + `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    + (serverLog.length === 0 ? "" : `\nserver:\n${serverLog}`)
  );
}

async function timed<T>(action: () => Promise<T>): Promise<{
  readonly value: T;
  readonly milliseconds: number;
}> {
  const started = performance.now();
  const value = await action();
  return { value, milliseconds: performance.now() - started };
}

async function compileCold(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  args: ReadonlyArray<string>,
  cwd: string,
  label: string
): Promise<{ readonly result: ProcessResult; readonly wallMs: number }> {
  const measured = await timed(() => runBoundedProcess(
    compiler.binary,
    args,
    { cwd, timeoutMs: haxeTimeoutMs, label }
  ));
  assertSuccess(measured.value, label);
  return { result: measured.value, wallMs: measured.milliseconds };
}

async function compileWarm(
  server: OwnedHaxeCompilerServer,
  args: ReadonlyArray<string>,
  cwd: string,
  label: string
): Promise<{ readonly result: ProcessResult; readonly wallMs: number }> {
  const started = performance.now();
  let clientCompletedAt: number | undefined;
  const result = await server.compile(
    args,
    label,
    haxeTimeoutMs,
    cwd,
    () => {
      clientCompletedAt = performance.now();
    }
  );
  assertSuccess(result, label, server.logs);
  ok(clientCompletedAt !== undefined, `${label} did not record client completion`);
  return { result, wallMs: clientCompletedAt - started };
}

async function measureTypeScript(outputRoot: string, workspace: string): Promise<number> {
  const config = path.join(workspace, "tsconfig.generated.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ["ES2022", "DOM"]
    },
    include: [path.join(outputRoot, "**/*.ts")]
  }, null, 2) + "\n");
  const measured = await timed(() => runBoundedProcess(
    process.execPath,
    [path.join(repoRoot, "scripts/run-typescript.mjs"), "current", "-p", config],
    {
      cwd: repoRoot,
      timeoutMs: typescriptTimeoutMs,
      label: "Generated TypeScript check"
    }
  ));
  assertSuccess(measured.value, "Generated TypeScript check");
  return measured.milliseconds;
}

function distribution(
  samples: ReadonlyArray<number>,
  unit: Distribution["unit"]
): Distribution {
  ok(samples.length > 0, "A timing distribution requires at least one sample");
  const ordered = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / samples.length;
  const percentile = (fraction: number): number =>
    ordered[Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1)] ?? 0;
  return {
    unit,
    sampleCount: samples.length,
    minimum: ordered[0] ?? 0,
    median: percentile(0.5),
    p95: percentile(0.95),
    maximum: ordered[ordered.length - 1] ?? 0,
    mean,
    standardDeviation: Math.sqrt(variance),
    samples
  };
}

export function stageDistributions(
  samples: ReadonlyArray<Pick<CompileMeasurement, "haxeTimes">>
): ReadonlyArray<StageDistribution> {
  const stages = new Map<string, string>();
  for (const sample of samples) {
    for (const row of sample.haxeTimes) {
      stages.set(row.path, row.id);
    }
  }
  return [...stages.entries()]
    .map(([stagePath, id]) => ({
      id,
      path: stagePath,
      distribution: distribution(samples.map((sample) =>
        sample.haxeTimes.find((row) => row.path === stagePath)
          ?.reportedSeconds ?? 0
      ), "haxe-reported-seconds")
    }))
    .sort((left, right) =>
      right.distribution.median - left.distribution.median
      || left.path.localeCompare(right.path));
}

function haxeReportedSeconds(rows: ReadonlyArray<HaxeTimingRow>): number {
  const total = rows.find((row) => row.id === "total" && row.depth === 0);
  ok(total !== undefined, "Haxe timing rows are missing the root total");
  ok(total.reportedSeconds > 0, "Haxe timing root total must be positive");
  return total.reportedSeconds;
}

async function assertOutputNeutrality(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  fixtureRoot: string,
  sourceRoot: string,
  genesVersion: string,
  profile: ProfileName
): Promise<CompileStageReport["outputNeutrality"][number]> {
  const extension = profile === "genes-ts" ? ".ts" : ".js";
  const timedRoot = path.join(fixtureRoot, "neutrality", profile, "timed");
  const untimedRoot = path.join(fixtureRoot, "neutrality", profile, "untimed");
  rmSync(timedRoot, { recursive: true, force: true });
  rmSync(untimedRoot, { recursive: true, force: true });
  const timedResult = await compileCold(
    compiler,
    buildArguments(sourceRoot, timedRoot, profile, true, genesVersion),
    fixtureRoot,
    `${profile} timed output control`
  );
  const timedHaxeTimes = parseHaxeTimes(resultText(timedResult.result));
  await compileCold(
    compiler,
    buildArguments(sourceRoot, untimedRoot, profile, false, genesVersion),
    fixtureRoot,
    `${profile} untimed output control`
  );
  assertNoPrivateOutput(timedRoot, profile);
  assertNoPrivateOutput(untimedRoot, profile);
  const timedInventory = inventory(timedRoot, extension);
  const untimedInventory = inventory(untimedRoot, extension);
  deepStrictEqual(
    hashTree(timedRoot),
    hashTree(untimedRoot),
    `${profile} --times output differs from the untimed control`
  );
  return {
    fixture: "control",
    profile,
    timedHaxeTimes,
    timed: timedInventory,
    untimed: untimedInventory
  };
}

function readGenesVersion(): string {
  const parsed = JSON.parse(
    readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")
  ) as { readonly version?: unknown };
  ok(typeof parsed.version === "string", "haxelib.json version is missing");
  return parsed.version;
}

export async function runCompileStageReport(
  options: CompileStageOptions
): Promise<CompileStageReport> {
  ok(Number.isInteger(options.samples) && options.samples > 0,
    "samples must be a positive integer");
  ok(Number.isInteger(options.warmups) && options.warmups > 0,
    "warmups must be a positive integer");
  const shape = fixtureShapes[options.fixture];
  const workspace = path.resolve(options.workspace ?? defaultWorkspace);
  const fixtureRoot = path.join(workspace, shape.name);
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
  const loadAverageBefore = loadavg();
  const fixture = createFixture(fixtureRoot, shape);
  const neutralityFixture = shape.name === "control"
    ? fixture
    : createFixture(
        path.join(fixtureRoot, "neutrality-control"),
        fixtureShapes.control
      );
  const genesVersion = readGenesVersion();
  const compiler = selectedHaxeCompiler(repoRoot);
  const outputNeutrality = [
    await assertOutputNeutrality(
      compiler,
      fixtureRoot,
      neutralityFixture.sourceRoot,
      genesVersion,
      "genes-ts"
    ),
    await assertOutputNeutrality(
      compiler,
      fixtureRoot,
      neutralityFixture.sourceRoot,
      genesVersion,
      "classic-js"
    )
  ];
  const coldRoot = path.join(fixtureRoot, "out/cold");
  const warmRoot = path.join(fixtureRoot, "out/warm");
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  const measurements: CompileMeasurement[] = [];
  let currentEdit: "a" | "b" = "b";
  try {
    for (let warmup = 0; warmup < options.warmups; warmup += 1) {
      currentEdit = currentEdit === "a" ? "b" : "a";
      writeEdit(fixture.editFile, currentEdit);
      const warmupResult = await compileWarm(
        server,
        buildArguments(
          fixture.sourceRoot, warmRoot, "genes-ts", true, genesVersion
        ),
        fixtureRoot,
        `warmup ${String(warmup + 1)}`
      );
      parseHaxeTimes(resultText(warmupResult.result));
      assertNoPrivateOutput(warmRoot, "genes-ts");
    }

    for (let sample = 0; sample < options.samples; sample += 1) {
      currentEdit = currentEdit === "a" ? "b" : "a";
      const edit = currentEdit;
      writeEdit(fixture.editFile, edit);
      rmSync(coldRoot, { recursive: true, force: true });
      const coldAction = () => compileCold(
        compiler,
        buildArguments(
          fixture.sourceRoot, coldRoot, "genes-ts", true, genesVersion
        ),
        fixtureRoot,
        `cold sample ${String(sample + 1)}`
      );
      const warmAction = () => compileWarm(
        server,
        buildArguments(
          fixture.sourceRoot, warmRoot, "genes-ts", true, genesVersion
        ),
        fixtureRoot,
        `warm edit sample ${String(sample + 1)}`
      );
      let cold: Awaited<ReturnType<typeof coldAction>>;
      let warm: Awaited<ReturnType<typeof warmAction>>;
      if (sample % 2 === 0) {
        cold = await coldAction();
        warm = await warmAction();
      } else {
        warm = await warmAction();
        cold = await coldAction();
      }
      deepStrictEqual(
        hashTree(coldRoot),
        hashTree(warmRoot),
        `warm edit sample ${String(sample + 1)} differs from its cold control`
      );
      assertNoPrivateOutput(coldRoot, "genes-ts");
      assertNoPrivateOutput(warmRoot, "genes-ts");
      const output = inventory(warmRoot, ".ts");
      const typescriptMs = await measureTypeScript(warmRoot, fixtureRoot);
      const coldTimes = parseHaxeTimes(resultText(cold.result));
      const warmTimes = parseHaxeTimes(resultText(warm.result));
      const coldHaxeReportedSeconds = haxeReportedSeconds(coldTimes);
      const warmHaxeReportedSeconds = haxeReportedSeconds(warmTimes);
      measurements.push({
        kind: "cold",
        sample: sample + 1,
        edit,
        wallMs: cold.wallMs,
        haxeReportedSeconds: coldHaxeReportedSeconds,
        wallMsPerHaxeReportedSecond: cold.wallMs / coldHaxeReportedSeconds,
        haxeTimes: coldTimes,
        output,
        typescriptMs: null
      }, {
        kind: "warm-edit",
        sample: sample + 1,
        edit,
        wallMs: warm.wallMs,
        haxeReportedSeconds: warmHaxeReportedSeconds,
        wallMsPerHaxeReportedSecond: warm.wallMs / warmHaxeReportedSeconds,
        haxeTimes: warmTimes,
        output,
        typescriptMs
      });
    }
  } finally {
    await server.stop();
  }

  const cold = measurements.filter((sample) => sample.kind === "cold");
  const warm = measurements.filter((sample) => sample.kind === "warm-edit");
  const workingTreeStatusText = execFileSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
  const workingTreeStatus = workingTreeStatusText.length === 0
    ? []
    : workingTreeStatusText.split(/\r?\n/);
  const report: CompileStageReport = {
    schemaVersion: 2,
    classification: "report-only",
    fixture: {
      name: shape.name,
      authoredHaxeLines: fixture.authoredLines,
      modules: shape.moduleCount + 2,
      methodsPerModule: shape.methodsPerModule
    },
    environment: {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim(),
      workingTreeDirty: workingTreeStatus.length > 0,
      workingTreeStatus,
      node: process.versions.node,
      haxe: compiler.version,
      typescript: toolchains.typescript.current.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      processPriority: getPriority(),
      loadAverageBefore,
      loadAverageAfter: loadavg()
    },
    protocol: {
      measuredProfile: "genes-ts",
      priority: "inherited",
      compilerConcurrency: 1,
      warmups: options.warmups,
      samples: options.samples,
      coldWarmOrder: "alternating",
      editPattern: editPatternForWarmups(options.warmups),
      haxeTiming: {
        source: "--times",
        reportedUnit: "seconds",
        absoluteTimingAuthority: "process-wall-clock",
        safeInterpretation: "within-run-shares-and-same-toolchain-relative-comparisons",
        clockStatus: haxeTimingClockStatus(process.platform, compiler.version)
      },
      typescriptTiming: "separate-after-each-pair",
      commands: {
        coldHaxe: [
          compiler.binary,
          ...buildArguments(
            fixture.sourceRoot, coldRoot, "genes-ts", true, genesVersion
          )
        ],
        warmHaxe: [
          compiler.binary,
          "--connect",
          `127.0.0.1:${String(server.port)}`,
          ...buildArguments(
            fixture.sourceRoot, warmRoot, "genes-ts", true, genesVersion
          )
        ],
        typescript: [
          process.execPath,
          path.join(repoRoot, "scripts/run-typescript.mjs"),
          "current",
          "-p",
          path.join(fixtureRoot, "tsconfig.generated.json")
        ]
      }
    },
    outputNeutrality,
    measurements,
    aggregate: {
      coldWall: distribution(
        cold.map((sample) => sample.wallMs), "milliseconds"
      ),
      warmEditWall: distribution(
        warm.map((sample) => sample.wallMs), "milliseconds"
      ),
      coldHaxeReported: distribution(
        cold.map((sample) => sample.haxeReportedSeconds),
        "haxe-reported-seconds"
      ),
      warmEditHaxeReported: distribution(
        warm.map((sample) => sample.haxeReportedSeconds),
        "haxe-reported-seconds"
      ),
      typescript: distribution(
        warm.map((sample) => sample.typescriptMs ?? 0), "milliseconds"
      ),
      coldStages: stageDistributions(cold),
      warmEditStages: stageDistributions(warm)
    }
  };
  if (options.keepWorkspace !== true) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return report;
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let fixture: FixtureName = "scale";
  let samples = 5;
  let warmups = 1;
  let outputFile: string | null = null;
  let keepWorkspace = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--fixture": {
        const value = args[++index];
        if (value !== "control" && value !== "scale") {
          throw new Error("--fixture must be control or scale");
        }
        fixture = value;
        break;
      }
      case "--samples":
        samples = positiveInteger(args[++index], "--samples");
        break;
      case "--warmups":
        warmups = positiveInteger(args[++index], "--warmups");
        break;
      case "--out":
        outputFile = args[++index] ?? null;
        if (outputFile === null) throw new Error("--out requires a path");
        break;
      case "--keep-workspace":
        keepWorkspace = true;
        break;
      default:
        throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  const report = await runCompileStageReport({
    fixture,
    samples,
    warmups,
    keepWorkspace
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputFile === null || outputFile === "-") process.stdout.write(json);
  else {
    const absolute = path.resolve(outputFile);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, json);
    process.stdout.write(`compile-stage-report:${absolute}\n`);
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptFile) {
  await main();
}
