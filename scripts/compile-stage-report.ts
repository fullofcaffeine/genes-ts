import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  execFileSync,
  spawn,
  type ChildProcess
} from "node:child_process";
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
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  compilerOutputSentinel,
  hashTree,
  leakedOutputStages,
  OwnedHaxeCompilerServer,
  runBoundedProcess,
  selectedHaxeCompiler,
  terminateOwnedChild,
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
type GenerationFloorMode = "callback-noop" | "structure-scan";
type FloorMode = GenerationFloorMode | "end-to-end" | "publication-only";
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
  readonly unit: "milliseconds" | "bytes" | "haxe-reported-seconds";
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
  readonly processCpuMs: number | null;
  readonly maxSampledRssBytes: number | null;
}

interface GenerationFloorCounters {
  readonly scanPasses: number;
  readonly apiTypeEntries: number;
  readonly mainExpressionRoots: number;
  readonly classDeclarations: number;
  readonly enumDeclarations: number;
  readonly typedefDeclarations: number;
  readonly abstractDeclarations: number;
  readonly otherTypeEntries: number;
  readonly fieldDeclarations: number;
  readonly expressionRoots: number;
  readonly expressionNodes: number;
  readonly typeRoots: number;
  readonly typeNodes: number;
}

interface GenerationFloorReport {
  readonly schemaVersion: 1;
  readonly mode: GenerationFloorMode;
  readonly counters: GenerationFloorCounters;
}

interface FloorMeasurement {
  readonly mode: FloorMode;
  readonly sample: number;
  readonly edit: "a" | "b";
  readonly wallMs: number;
  readonly processCpuMs: number | null;
  readonly maxSampledRssBytes: number | null;
  readonly counters: GenerationFloorCounters | null;
  readonly output: OutputInventory;
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
  readonly schemaVersion: 3;
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
      readonly callbackNoopHaxe: ReadonlyArray<string>;
      readonly structureScanHaxe: ReadonlyArray<string>;
      readonly publicationProbe: ReadonlyArray<string>;
      readonly typescript: ReadonlyArray<string>;
    };
    readonly floorModeDefinitions: Readonly<Record<FloorMode, string>>;
    readonly generationFloorSourceIsolation: "identical-independent-source-clones";
    readonly processMetrics: {
      readonly generationCpu: {
        readonly source: "linux-proc-clock-ticks" | "fractional-ps" | "unavailable";
        readonly clockTicksPerSecond: number | null;
      };
      readonly publicationCpu: "probe-Sys.cpuTime";
      readonly maxSampledMemory: "exact-process-rss-snapshots-where-ps-is-available";
      readonly rssSamplingIntervalMs: 250;
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
  readonly floorMeasurements: ReadonlyArray<FloorMeasurement>;
  readonly aggregate: {
    readonly coldWall: Distribution;
    readonly warmEditWall: Distribution;
    readonly coldHaxeReported: Distribution;
    readonly warmEditHaxeReported: Distribution;
    readonly typescript: Distribution;
    readonly coldStages: ReadonlyArray<StageDistribution>;
    readonly warmEditStages: ReadonlyArray<StageDistribution>;
    readonly floorWall: Readonly<Record<FloorMode, Distribution>>;
    readonly floorCpu: Readonly<Record<FloorMode, Distribution | null>>;
    readonly floorMaxSampledRss: Readonly<Record<FloorMode, Distribution | null>>;
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

function emptyInventory(): OutputInventory {
  return { files: 0, modules: 0, sourceMaps: 0, bytes: 0, sha256: hashEntries([]) };
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
  genesVersion: string,
  floor?: {
    readonly mode: GenerationFloorMode;
    readonly reportPath: string;
  }
): ReadonlyArray<string> {
  const extension = profile === "genes-ts" ? "ts" : "js";
  return [
    "-cp", path.join(repoRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    ...(withTimes ? ["-D", "genes.compile_stage_profile"] : []),
    ...(floor === undefined ? [] : [
      "-D", "genes_generation_floor",
      "-D", `genes_generation_floor_mode=${floor.mode}`,
      "-D", `genes_generation_floor_report=${floor.reportPath}`
    ]),
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

interface ProcessSnapshot {
  readonly cpuMs: number | null;
  readonly rssBytes: number;
}

interface ProcessObservation {
  readonly processCpuMs: number | null;
  readonly maxSampledRssBytes: number | null;
}

/** Parses the portable [[dd-]hh:]mm:ss fraction emitted by POSIX ps. */
export function parseProcessCpuTime(value: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(
    value.trim()
  );
  ok(match !== null, `Unsupported process CPU time: ${value}`);
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

/** Reads utime + stime ticks from a Linux /proc process stat record. */
export function parseLinuxProcessCpuTicks(value: string): number {
  // The command name in field 2 can contain spaces and closing parentheses.
  // Splitting after the final ')' makes the state field the first token and
  // keeps utime/stime at offsets 11 and 12 in the remaining fields.
  const commandEnd = value.lastIndexOf(")");
  ok(commandEnd >= 0, "Linux process stat is missing its command terminator");
  const fields = value.slice(commandEnd + 1).trim().split(/\s+/);
  ok(fields.length > 12, "Linux process stat is missing CPU fields");
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  ok(Number.isInteger(userTicks) && userTicks >= 0,
    "Linux process stat has invalid user CPU ticks");
  ok(Number.isInteger(systemTicks) && systemTicks >= 0,
    "Linux process stat has invalid system CPU ticks");
  return userTicks + systemTicks;
}

let cachedLinuxClockTicksPerSecond: number | null | undefined;

function linuxClockTicksPerSecond(): number | null {
  if (cachedLinuxClockTicksPerSecond !== undefined)
    return cachedLinuxClockTicksPerSecond;
  try {
    const ticks = Number(execFileSync("getconf", ["CLK_TCK"], {
      encoding: "utf8"
    }).trim());
    cachedLinuxClockTicksPerSecond = Number.isFinite(ticks) && ticks > 0
      ? ticks
      : null;
  } catch {
    cachedLinuxClockTicksPerSecond = null;
  }
  return cachedLinuxClockTicksPerSecond;
}

function linuxProcessCpuMs(pid: number): number | null {
  const ticksPerSecond = linuxClockTicksPerSecond();
  if (ticksPerSecond === null) return null;
  try {
    const ticks = parseLinuxProcessCpuTicks(
      readFileSync(`/proc/${String(pid)}/stat`, "utf8")
    );
    return ticks * 1000 / ticksPerSecond;
  } catch {
    return null;
  }
}

function processSnapshot(pid: number): ProcessSnapshot | null {
  if (process.platform === "win32") return null;
  try {
    const output = execFileSync(
      "ps",
      ["-o", "time=", "-o", "rss=", "-p", String(pid)],
      { encoding: "utf8" }
    ).trim();
    const match = /^(\S+)\s+(\d+)$/.exec(output);
    if (match === null) return null;
    const psCpuTime = match[1] ?? "";
    let cpuMs: number | null = null;
    if (process.platform === "linux") cpuMs = linuxProcessCpuMs(pid);
    else if (psCpuTime.includes(".")) cpuMs = parseProcessCpuTime(psCpuTime);
    return {
      cpuMs,
      rssBytes: Number(match[2]) * 1024
    };
  } catch {
    return null;
  }
}

function generationCpuSource(): {
  readonly source: "linux-proc-clock-ticks" | "fractional-ps" | "unavailable";
  readonly clockTicksPerSecond: number | null;
} {
  if (process.platform === "linux") {
    const clockTicksPerSecond = linuxClockTicksPerSecond();
    return {
      source: clockTicksPerSecond === null
        ? "unavailable"
        : "linux-proc-clock-ticks",
      clockTicksPerSecond
    };
  }
  const snapshot = processSnapshot(process.pid);
  return {
    source: snapshot?.cpuMs === null || snapshot?.cpuMs === undefined
      ? "unavailable"
      : "fractional-ps",
    clockTicksPerSecond: null
  };
}

async function observeProcess<T>(
  pid: number | undefined,
  action: () => Promise<T>
): Promise<{ readonly value: T; readonly observation: ProcessObservation }> {
  if (pid === undefined) {
    return {
      value: await action(),
      observation: { processCpuMs: null, maxSampledRssBytes: null }
    };
  }
  const before = processSnapshot(pid);
  let maxSampledRssBytes = before?.rssBytes ?? null;
  const interval = setInterval(() => {
    const sample = processSnapshot(pid);
    if (sample !== null) {
      maxSampledRssBytes = Math.max(
        maxSampledRssBytes ?? 0,
        sample.rssBytes
      );
    }
  }, 250);
  try {
    const value = await action();
    const after = processSnapshot(pid);
    if (after !== null) {
      maxSampledRssBytes = Math.max(
        maxSampledRssBytes ?? 0,
        after.rssBytes
      );
    }
    return {
      value,
      observation: {
        processCpuMs: before?.cpuMs === null || before?.cpuMs === undefined
          || after?.cpuMs === null || after?.cpuMs === undefined
          ? null
          : Math.max(0, after.cpuMs - before.cpuMs),
        maxSampledRssBytes
      }
    };
  } finally {
    clearInterval(interval);
  }
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

async function compileWarmObserved(
  server: OwnedHaxeCompilerServer,
  args: ReadonlyArray<string>,
  cwd: string,
  label: string
): Promise<{
  readonly result: ProcessResult;
  readonly wallMs: number;
  readonly processCpuMs: number | null;
  readonly maxSampledRssBytes: number | null;
}> {
  const observed = await observeProcess(
    server.process.pid,
    () => compileWarm(server, args, cwd, label)
  );
  return { ...observed.value, ...observed.observation };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGenerationFloorReport(
  reportPath: string,
  expectedMode: GenerationFloorMode
): GenerationFloorReport {
  const parsed: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
  ok(isRecord(parsed), `${expectedMode} report is not an object`);
  strictEqual(parsed.schemaVersion, 1);
  strictEqual(parsed.mode, expectedMode);
  ok(isRecord(parsed.counters), `${expectedMode} counters are not an object`);
  const counterNames: ReadonlyArray<keyof GenerationFloorCounters> = [
    "scanPasses",
    "apiTypeEntries",
    "mainExpressionRoots",
    "classDeclarations",
    "enumDeclarations",
    "typedefDeclarations",
    "abstractDeclarations",
    "otherTypeEntries",
    "fieldDeclarations",
    "expressionRoots",
    "expressionNodes",
    "typeRoots",
    "typeNodes"
  ];
  const counters = new Map<keyof GenerationFloorCounters, number>();
  for (const name of counterNames) {
    const value = parsed.counters[name];
    ok(
      typeof value === "number" && Number.isInteger(value) && value >= 0,
      `${expectedMode} counter ${name} is not a non-negative integer`
    );
    counters.set(name, value);
  }
  const counter = (name: keyof GenerationFloorCounters): number => {
    const value = counters.get(name);
    ok(value !== undefined, `${expectedMode} counter ${name} is missing`);
    return value;
  };
  return {
    schemaVersion: 1,
    mode: expectedMode,
    counters: {
      scanPasses: counter("scanPasses"),
      apiTypeEntries: counter("apiTypeEntries"),
      mainExpressionRoots: counter("mainExpressionRoots"),
      classDeclarations: counter("classDeclarations"),
      enumDeclarations: counter("enumDeclarations"),
      typedefDeclarations: counter("typedefDeclarations"),
      abstractDeclarations: counter("abstractDeclarations"),
      otherTypeEntries: counter("otherTypeEntries"),
      fieldDeclarations: counter("fieldDeclarations"),
      expressionRoots: counter("expressionRoots"),
      expressionNodes: counter("expressionNodes"),
      typeRoots: counter("typeRoots"),
      typeNodes: counter("typeNodes")
    }
  };
}

async function nextLine(
  iterator: AsyncIterator<string>,
  label: string,
  timeoutMs: number
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    void iterator.next().then((result) => {
      clearTimeout(timeout);
      if (result.done === true) {
        reject(new Error(`${label} exited before writing its protocol line`));
      } else {
        resolve(result.value);
      }
    }, (error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForClose(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    ok(child.exitCode === 0, `${label} exited with ${String(child.exitCode)}`);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `${label} exited with code ${String(code)} and signal ${String(signal)}`
      ));
    });
  });
}

interface PublicationProbeResult {
  readonly wallMs: number;
  readonly processCpuMs: number;
  readonly maxSampledRssBytes: number | null;
  readonly files: number;
  readonly bytes: number;
}

async function measurePublication(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  fixtureRoot: string,
  candidateRoot: string,
  targetRoot: string,
  label: string
): Promise<PublicationProbeResult> {
  const command = [
    "-cp", path.join(repoRoot, "src"),
    "-cp", path.join(repoRoot, "tests/compile-stage-report/src"),
    "--run", "compilestage.PublicationFloorProbe",
    candidateRoot,
    targetRoot,
    "index.ts"
  ];
  const child = spawn(compiler.binary, command, {
    cwd: fixtureRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-64_000);
  });
  ok(child.stdout !== null && child.stdin !== null,
    `${label} did not open protocol pipes`);
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  try {
    strictEqual(
      await nextLine(iterator, `${label} readiness`, haxeTimeoutMs),
      "publication-floor-ready"
    );
    const observed = await observeProcess(child.pid, async () => {
      const started = performance.now();
      child.stdin?.write("go\n");
      const response = await nextLine(
        iterator,
        `${label} completion`,
        haxeTimeoutMs
      );
      return { response, wallMs: performance.now() - started };
    });
    await waitForClose(child, label);
    const parsed: unknown = JSON.parse(observed.value.response);
    ok(isRecord(parsed), `${label} result is not an object`);
    strictEqual(parsed.status, "committed");
    for (const key of ["processCpuMs", "files", "bytes"] as const) {
      ok(typeof parsed[key] === "number" && parsed[key] >= 0,
        `${label} result ${key} is invalid`);
    }
    const processCpuMs = parsed.processCpuMs;
    const files = parsed.files;
    const bytes = parsed.bytes;
    ok(typeof processCpuMs === "number");
    ok(typeof files === "number");
    ok(typeof bytes === "number");
    deepStrictEqual(
      hashTree(targetRoot),
      hashTree(candidateRoot),
      `${label} changed the prepared candidate tree`
    );
    return {
      wallMs: observed.value.wallMs,
      processCpuMs,
      maxSampledRssBytes: observed.observation.maxSampledRssBytes,
      files,
      bytes
    };
  } catch (error) {
    throw new Error(`${label} failed: ${String(error)}\nstderr:\n${stderr}`);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null)
      await terminateOwnedChild(child, label);
  }
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
  const floorFixtures: Readonly<Record<GenerationFloorMode, ReturnType<
    typeof createFixture
  >>> = {
    "callback-noop": createFixture(
      path.join(fixtureRoot, "floor-fixtures/callback-noop"),
      shape
    ),
    "structure-scan": createFixture(
      path.join(fixtureRoot, "floor-fixtures/structure-scan"),
      shape
    )
  };
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
  const publicationRoot = path.join(fixtureRoot, "out/publication");
  const floorRoot = path.join(fixtureRoot, "floors");
  rmSync(publicationRoot, { recursive: true, force: true });
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  const measurements: CompileMeasurement[] = [];
  const floorMeasurements: FloorMeasurement[] = [];
  async function compileGenerationFloor(
    mode: GenerationFloorMode,
    label: string
  ): Promise<{
    readonly wallMs: number;
    readonly processCpuMs: number | null;
    readonly maxSampledRssBytes: number | null;
    readonly counters: GenerationFloorCounters;
  }> {
    const modeRoot = path.join(floorRoot, mode);
    const modeFixture = floorFixtures[mode];
    const outputRoot = path.join(modeRoot, "out");
    const reportPath = path.join(modeRoot, "report.json");
    rmSync(reportPath, { force: true });
    writeEdit(modeFixture.editFile, currentEdit);
    const result = await compileWarmObserved(
      server,
      buildArguments(
        modeFixture.sourceRoot,
        outputRoot,
        "genes-ts",
        true,
        genesVersion,
        { mode, reportPath }
      ),
      fixtureRoot,
      label
    );
    parseHaxeTimes(resultText(result.result));
    const report = readGenerationFloorReport(reportPath, mode);
    assertNoPrivateOutput(outputRoot, "genes-ts");
    deepStrictEqual(hashTree(outputRoot), [], `${mode} published output`);
    return { ...result, counters: report.counters };
  }
  let currentEdit: "a" | "b" = "b";
  try {
    for (let warmup = 0; warmup < options.warmups; warmup += 1) {
      currentEdit = currentEdit === "a" ? "b" : "a";
      writeEdit(fixture.editFile, currentEdit);
      const floorOrder: ReadonlyArray<GenerationFloorMode> = warmup % 2 === 0
        ? ["callback-noop", "structure-scan"]
        : ["structure-scan", "callback-noop"];
      for (const mode of floorOrder) {
        await compileGenerationFloor(
          mode,
          `${mode} warmup ${String(warmup + 1)}`
        );
      }
      const warmupResult = await compileWarmObserved(
        server,
        buildArguments(
          fixture.sourceRoot, warmRoot, "genes-ts", true, genesVersion
        ),
        fixtureRoot,
        `warmup ${String(warmup + 1)}`
      );
      parseHaxeTimes(resultText(warmupResult.result));
      assertNoPrivateOutput(warmRoot, "genes-ts");
      await measurePublication(
        compiler,
        fixtureRoot,
        warmRoot,
        publicationRoot,
        `publication warmup ${String(warmup + 1)}`
      );
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
      const warmAction = () => compileWarmObserved(
        server,
        buildArguments(
          fixture.sourceRoot, warmRoot, "genes-ts", true, genesVersion
        ),
        fixtureRoot,
        `warm edit sample ${String(sample + 1)}`
      );
      const floorResults = new Map<GenerationFloorMode, Awaited<
        ReturnType<typeof compileGenerationFloor>
      >>();
      const runGenerationFloors = async (reverse: boolean): Promise<void> => {
        const order: ReadonlyArray<GenerationFloorMode> = reverse
          ? ["structure-scan", "callback-noop"]
          : ["callback-noop", "structure-scan"];
        for (const mode of order) {
          floorResults.set(mode, await compileGenerationFloor(
            mode,
            `${mode} sample ${String(sample + 1)}`
          ));
        }
      };
      let cold: Awaited<ReturnType<typeof coldAction>>;
      let warm: Awaited<ReturnType<typeof warmAction>>;
      if (sample % 2 === 0) {
        await runGenerationFloors(false);
        cold = await coldAction();
        warm = await warmAction();
      } else {
        warm = await warmAction();
        cold = await coldAction();
        await runGenerationFloors(true);
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
      const callbackNoop = floorResults.get("callback-noop");
      const structureScan = floorResults.get("structure-scan");
      ok(callbackNoop !== undefined && structureScan !== undefined,
        `sample ${String(sample + 1)} is missing generation floor results`);
      strictEqual(callbackNoop.counters.scanPasses, 0);
      strictEqual(structureScan.counters.scanPasses, 1);
      strictEqual(
        callbackNoop.counters.apiTypeEntries,
        structureScan.counters.apiTypeEntries
      );
      ok(structureScan.counters.expressionNodes > 0,
        "structure scan did not visit typed expressions");
      const publication = await measurePublication(
        compiler,
        fixtureRoot,
        warmRoot,
        publicationRoot,
        `publication sample ${String(sample + 1)}`
      );
      const publicationOutput = inventory(publicationRoot, ".ts");
      const candidateArtifacts = filesUnder(warmRoot).filter((file) =>
        !path.basename(file).startsWith(".genes-output-")
      );
      strictEqual(publication.files, candidateArtifacts.length,
        "publication staged the wrong artifact count");
      strictEqual(
        publication.bytes,
        candidateArtifacts.reduce((sum, file) => sum + statSync(file).size, 0),
        "publication staged the wrong artifact byte count"
      );
      strictEqual(publicationOutput.sha256, output.sha256,
        "publication output hash differs from end-to-end output");
      measurements.push({
        kind: "cold",
        sample: sample + 1,
        edit,
        wallMs: cold.wallMs,
        haxeReportedSeconds: coldHaxeReportedSeconds,
        wallMsPerHaxeReportedSecond: cold.wallMs / coldHaxeReportedSeconds,
        haxeTimes: coldTimes,
        output,
        typescriptMs: null,
        processCpuMs: null,
        maxSampledRssBytes: null
      }, {
        kind: "warm-edit",
        sample: sample + 1,
        edit,
        wallMs: warm.wallMs,
        haxeReportedSeconds: warmHaxeReportedSeconds,
        wallMsPerHaxeReportedSecond: warm.wallMs / warmHaxeReportedSeconds,
        haxeTimes: warmTimes,
        output,
        typescriptMs,
        processCpuMs: warm.processCpuMs,
        maxSampledRssBytes: warm.maxSampledRssBytes
      });
      floorMeasurements.push({
        mode: "callback-noop",
        sample: sample + 1,
        edit,
        wallMs: callbackNoop.wallMs,
        processCpuMs: callbackNoop.processCpuMs,
        maxSampledRssBytes: callbackNoop.maxSampledRssBytes,
        counters: callbackNoop.counters,
        output: emptyInventory()
      }, {
        mode: "structure-scan",
        sample: sample + 1,
        edit,
        wallMs: structureScan.wallMs,
        processCpuMs: structureScan.processCpuMs,
        maxSampledRssBytes: structureScan.maxSampledRssBytes,
        counters: structureScan.counters,
        output: emptyInventory()
      }, {
        mode: "end-to-end",
        sample: sample + 1,
        edit,
        wallMs: warm.wallMs,
        processCpuMs: warm.processCpuMs,
        maxSampledRssBytes: warm.maxSampledRssBytes,
        counters: null,
        output
      }, {
        mode: "publication-only",
        sample: sample + 1,
        edit,
        wallMs: publication.wallMs,
        processCpuMs: publication.processCpuMs,
        maxSampledRssBytes: publication.maxSampledRssBytes,
        counters: null,
        output: publicationOutput
      });
    }
  } finally {
    await server.stop();
  }

  const cold = measurements.filter((sample) => sample.kind === "cold");
  const warm = measurements.filter((sample) => sample.kind === "warm-edit");
  const floorModes: ReadonlyArray<FloorMode> = [
    "callback-noop",
    "structure-scan",
    "end-to-end",
    "publication-only"
  ];
  const floorByMode = (mode: FloorMode): ReadonlyArray<FloorMeasurement> =>
    floorMeasurements.filter((sample) => sample.mode === mode);
  const optionalDistribution = (
    values: ReadonlyArray<number | null>,
    unit: Distribution["unit"]
  ): Distribution | null => {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0 ? null : distribution(present, unit);
  };
  const workingTreeStatusText = execFileSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
  const workingTreeStatus = workingTreeStatusText.length === 0
    ? []
    : workingTreeStatusText.split(/\r?\n/);
  const report: CompileStageReport = {
    schemaVersion: 3,
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
        callbackNoopHaxe: [
          compiler.binary,
          "--connect",
          `127.0.0.1:${String(server.port)}`,
          ...buildArguments(
            floorFixtures["callback-noop"].sourceRoot,
            path.join(floorRoot, "callback-noop/out"),
            "genes-ts",
            true,
            genesVersion,
            {
              mode: "callback-noop",
              reportPath: path.join(floorRoot, "callback-noop/report.json")
            }
          )
        ],
        structureScanHaxe: [
          compiler.binary,
          "--connect",
          `127.0.0.1:${String(server.port)}`,
          ...buildArguments(
            floorFixtures["structure-scan"].sourceRoot,
            path.join(floorRoot, "structure-scan/out"),
            "genes-ts",
            true,
            genesVersion,
            {
              mode: "structure-scan",
              reportPath: path.join(floorRoot, "structure-scan/report.json")
            }
          )
        ],
        publicationProbe: [
          compiler.binary,
          "-cp", path.join(repoRoot, "src"),
          "-cp", path.join(repoRoot, "tests/compile-stage-report/src"),
          "--run", "compilestage.PublicationFloorProbe",
          warmRoot,
          publicationRoot,
          "index.ts"
        ],
        typescript: [
          process.execPath,
          path.join(repoRoot, "scripts/run-typescript.mjs"),
          "current",
          "-p",
          path.join(fixtureRoot, "tsconfig.generated.json")
        ]
      },
      floorModeDefinitions: {
        "callback-noop": "Warm Haxe request through custom-generator entry; records O(1) API counts, removes the private sentinel, and returns before transaction setup.",
        "structure-scan": "The callback-noop path plus one read-only declaration, field, type-component, and typed-expression-tree pass; no semantic plans, emitters, or transaction.",
        "end-to-end": "Current warm Genes generation with stage profiling, complete-tree publication, and exact cold-output comparison.",
        "publication-only": "Real OutputTransaction.commit in a Haxe probe after an unchanged end-to-end candidate has been fully staged and the probe has signalled ready."
      },
      generationFloorSourceIsolation: "identical-independent-source-clones",
      processMetrics: {
        generationCpu: generationCpuSource(),
        publicationCpu: "probe-Sys.cpuTime",
        maxSampledMemory: "exact-process-rss-snapshots-where-ps-is-available",
        rssSamplingIntervalMs: 250
      }
    },
    outputNeutrality,
    measurements,
    floorMeasurements,
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
      warmEditStages: stageDistributions(warm),
      floorWall: Object.fromEntries(floorModes.map((mode) => [
        mode,
        distribution(floorByMode(mode).map((sample) => sample.wallMs),
          "milliseconds")
      ])) as Record<FloorMode, Distribution>,
      floorCpu: Object.fromEntries(floorModes.map((mode) => [
        mode,
        optionalDistribution(
          floorByMode(mode).map((sample) => sample.processCpuMs),
          "milliseconds"
        )
      ])) as Record<FloorMode, Distribution | null>,
      floorMaxSampledRss: Object.fromEntries(floorModes.map((mode) => [
        mode,
        optionalDistribution(
          floorByMode(mode).map((sample) => sample.maxSampledRssBytes),
          "bytes"
        )
      ])) as Record<FloorMode, Distribution | null>
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
