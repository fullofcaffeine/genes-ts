/**
 * Paired measurement of Genes requests on one warm Haxe server: is B
 * cheaper than A, measured in units that stay valid on a busy host?
 *
 * Why: on a loaded machine the wall time of one request varies by 160% or
 * more, so "B is 10% faster" from milliseconds is noise. Three units repeat:
 * the work counts and allocated words that Genes reports
 * (`genes.incremental.RequestMeasure`, the `measure` field of the request
 * report), and the retired instructions of the Haxe server process, read
 * from outside before and after each request (`readProcessCounters` of
 * `@genes-ts/tooling`). CPU time repeats only in pairs. Wall time is printed
 * as a report line, never as the result.
 *
 * What: A and B are two Genes source folders (`--a`, `--b`), or one folder
 * with and without a define (`--define-b=name[=value]`). On a copy of
 * `tests/compiler-server/templates/module-request`, the runner starts one
 * Haxe server and sends, for each sample, a full request that keeps module
 * records, then the measured request: a module request of `--module`
 * (default) or the full request itself (`--kind=program`). Samples run in
 * pairs A B B A (`--pairs`, default 20). For each pair it computes the
 * ratio (B1 + B2) / (A1 + A2) of words, instructions and CPU time, and it
 * prints the median pair ratio with the lowest and highest.
 *
 * Why a full request before each sample: Haxe 4.3.7 keeps one macro state.
 * A and B differ in their arguments, so each switch starts a new macro
 * state, which forgets the module records that a module request checks.
 *
 * `--repeat=N` sends N equal module requests on side A instead (after one
 * full request and one warm-up module request) and prints one row per
 * repeat and the spread of each unit: the exit check of genes-f8vc.14.33
 * wants equal counts, words within 0.5% and instructions within 3%.
 *
 * Without `--edit` each measured module request repeats a request with no
 * change, so Haxe types nothing again: the numbers compare A with B on a
 * no-edit request, not the cost of a save. `--edit=literal` edits one
 * string literal of the requested module before each measured request.
 *
 * Haxe's periodic collection (genes-f8vc.14.40): Haxe 4.3.7 queues a full
 * collection (`Tasks.gc_task`) after every tenth connection to a server
 * and runs it right after it closes that connection. A measured request
 * near a tenth connection paid for part of it (up to 344 ms of CPU time
 * before Genes, or 26 ms after the report). The runner counts the
 * connections of each server and sends cheap `-version` requests until a
 * measured request is neither a tenth connection nor the one right after
 * it. Both modes do this.
 *
 * Retired instructions need `node --experimental-ffi` on macOS (the yarn
 * script passes it) and a built `tooling/dist`; otherwise they are printed
 * as unavailable, with the reason, and the other units still count.
 *
 * Example: `nice -n 10 yarn compiler-server:pair --b=../genes-old/src` or
 * `nice -n 10 yarn compiler-server:pair --repeat=3`. The JSON of every
 * sample goes to `tests/compiler-server/.tmp/pair/result.json`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OwnedHaxeCompilerServer } from "./compiler-server-lifecycle.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const template = path.join(repoRoot, "tests/compiler-server/templates/module-request");
const tempRoot = path.join(repoRoot, "tests/compiler-server/.tmp/pair");
const workspace = path.join(tempRoot, "workspace");
const timeoutMs = 300_000;

/** The value of `--name=value`, or `fallback`. */
function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

const sourceA = path.resolve(option("a", path.join(repoRoot, "src")));
const sourceB = path.resolve(option("b", sourceA));
const defineB = option("define-b", "");
const pairs = Number(option("pairs", "20"));
const repeat = Number(option("repeat", "0"));
const target = option("module", "mr.Button");
const warmupPairs = Number(option("warmup-pairs", "1"));
/**
 * `--swap`: the B configuration runs on the first server and in the A
 * positions of each pair (B A A B), and A on the second. Ratios stay
 * B over A. Each side has its own server process, and an offset between
 * two processes looks like an A-B difference that one run cannot tell from
 * a real one; a small effect counts only when the interval of a `--swap`
 * run also leaves out 1 on the same side. The warm-up is mirrored too.
 */
const swap = process.argv.includes("--swap");
/** `--measure-off-b`: side B asks for no request measure, to measure the cost of the measure. */
const measureOffB = process.argv.includes("--measure-off-b");
/**
 * `--edit=literal`: before each measured module request, change one string
 * literal of the requested module's source to the other of two values of
 * the same length, and send Haxe's `server/invalidate` for the file to each
 * server, so that Haxe types the module again and Genes reads it anew, as
 * after a save. Every sample makes the same edit, so A and B do equal work.
 */
const edit = option("edit", "");
if (edit !== "" && edit !== "literal") throw new Error("--edit is literal");
if (edit !== "" && option("kind", "module") !== "module") throw new Error("--edit needs --kind=module");
/** The two values of `--edit=literal` in `mr/Button.hx` of the fixture. */
const EDIT_VALUES = ["return 'Save';", "return 'Sava';"] as const;
/** Haxe 4.3.7 queues a full collection after every this many connections (`Ring.create 10` in `server.ml`). */
const HAXE_COLLECTION_PERIOD = 10;
/** The default minor heap of Haxe 4.3.7 in words, for the uncertainty of `words`. */
const MINOR_HEAP_WORDS = 262_144;
const servers = Number(option("servers", "2"));
if (!Number.isInteger(warmupPairs) || warmupPairs < 0) throw new Error("--warmup-pairs needs a whole number");
if (servers !== 1 && servers !== 2) throw new Error("--servers is 1 or 2");
const kindOption = option("kind", "module");
if (!Number.isInteger(pairs) || pairs < 1) throw new Error("--pairs needs a whole number of 1 or more");
if (!Number.isInteger(repeat) || repeat < 0) throw new Error("--repeat needs a whole number");
if (kindOption !== "module" && kindOption !== "program") throw new Error("--kind is module or program");
const kind: "module" | "program" = kindOption;
if (repeat === 0 && sourceA === sourceB && defineB === "" && !measureOffB) {
  throw new Error("A and B are the same: give --b=<genes src> or --define-b=<name>");
}

/** The work counts of `RequestMeasure` (`RequestWorkCounts`). */
type Work = Readonly<Record<string, number>>;

/** The parts of a report's `measure` field that the runner reads. */
interface Measure {
  readonly cpuMs: number;
  readonly processCpuStartMs: number;
  readonly processCpuEndMs: number;
  readonly words: number;
  readonly unnamedCpuMs: number;
  readonly minorCollections: number;
  readonly work: Work;
  readonly phases: ReadonlyArray<{
    readonly name: string;
    readonly calls: number;
    readonly cpuMs: number;
    readonly words: number;
    readonly work: Work;
  }>;
}

/** The counters of `@genes-ts/tooling` `readProcessCounters`. */
interface ProcessCounters {
  readonly instructions: number | null;
  readonly cpuNs: number | null;
  readonly unavailable: string | null;
}

/** The two functions of `tooling/dist/session/process-counters.js` that the runner calls. */
interface CounterModule {
  readonly readProcessCounters: (pid: number) => Promise<ProcessCounters | null>;
}

/** One measured request. */
interface Sample {
  readonly side: "A" | "B";
  readonly result: string;
  /** Null when that Genes source writes no measure (one before genes-f8vc.14.33). */
  readonly measure: Measure | null;
  readonly instructions: number | null;
  readonly cpuMs: number | null;
  readonly wallMs: number;
  /** The share of the process CPU time that falls in a named phase. */
  readonly named: number | null;
  /** Process CPU time before the measure began and after the report (`haxe.before-genes`, `haxe.after-genes`). */
  readonly beforeGenesMs: number | null;
  readonly afterGenesMs: number | null;
  /** The connections that the server had answered before this request (`connections`). */
  readonly connectionsBefore: number;
  /** Resident memory of the server after the request (`ps -o rss`), in MB; a report line. */
  readonly serverRssMb: number | null;
  readonly load: number;
}

/**
 * Loads the counter reader of the tooling package, or returns the reason
 * why it cannot.
 *
 * BOUNDARY_DYNAMIC: the module is the built tooling output, outside this
 * TypeScript project; its one function is checked before use.
 */
async function loadCounters(): Promise<CounterModule | string> {
  const file = path.join(repoRoot, "tooling/dist/session/process-counters.js");
  if (!existsSync(file)) return "tooling/dist is not built (cd tooling && yarn build)";
  const loaded: unknown = await import(pathToFileURL(file).href);
  const reader = (loaded as { readonly readProcessCounters?: unknown }).readProcessCounters;
  if (typeof reader !== "function") return "tooling/dist has no readProcessCounters";
  return { readProcessCounters: reader as CounterModule["readProcessCounters"] };
}

/** One side of the comparison: its Genes source, its extra defines and its own files. */
interface Side {
  readonly name: "A" | "B";
  readonly source: string;
  readonly defines: ReadonlyArray<string>;
  readonly descriptor: string;
  readonly out: string;
}

function side(name: "A" | "B", source: string, define: string): Side {
  const root = path.join(tempRoot, name);
  mkdirSync(root, { recursive: true });
  return {
    name,
    source,
    defines: define === "" ? [] : ["-D", define],
    descriptor: path.join(root, "request.json"),
    out: path.join(root, "out")
  };
}

function common(s: Side): string[] {
  const version = (JSON.parse(readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")) as {
    readonly version: string;
  }).version;
  return [
    "-cp", s.source,
    "-lib", "helder.set",
    "-D", `genes-ts=${version}`,
    "--macro", "genes.Generator.use()",
    "-cp", path.join(workspace, "src"),
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    "-D", "genes.ts",
    "-D", `genes.source_map_root=${tempRoot}`,
    ...s.defines,
    "-D", `genes.dev_incremental=${s.descriptor}`
  ];
}

function programArgs(s: Side): string[] {
  return [...common(s), "--main", "mr.Main", "-js", path.join(s.out, "program", "index.ts")];
}

function moduleArgs(s: Side): string[] {
  return [...common(s), target, "-js", path.join(s.out, "module", "index.ts")];
}

function descriptor(s: Side, fields: Record<string, unknown>): void {
  writeFileSync(s.descriptor, JSON.stringify({
    format: 1,
    programDigest: "pair",
    afterTyping: "reuse",
    generation: "reuse",
    requestMeasure: !(measureOffB && s.name === "B"),
    ...fields
  }));
}

/**
 * Reads the result and the `measure` of the report that a request of
 * `requestKind` wrote last. The measure is null for a Genes source that
 * writes none (an older commit); `--repeat` needs one.
 */
function readMeasure(s: Side, requestKind: "module" | "program"): { result: string; measure: Measure | null } {
  const file = requestKind === "program"
    ? `${s.descriptor}.module-records.json`
    : `${s.descriptor}.report.json`;
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    readonly result?: string;
    readonly stored?: boolean;
    readonly measure?: Measure | null;
  };
  const measure = report.measure ?? null;
  if (measure === null && repeat > 0) throw new Error(`${file} has no measure`);
  const result = report.result ?? (report.stored === true ? "stored" : "not-stored");
  return { result, measure };
}

async function main(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(template, workspace, { recursive: true });
  const counters = await loadCounters();
  const a = side("A", sourceA, "");
  const b = side("B", sourceB, defineB);
  const serverA = await OwnedHaxeCompilerServer.start(repoRoot);
  serverA.installSignalCleanup();
  const serverB = servers === 2 && repeat === 0 ? await OwnedHaxeCompilerServer.start(repoRoot) : serverA;
  if (serverB !== serverA) serverB.installSignalCleanup();
  const serverOf = (s: Side): OwnedHaxeCompilerServer =>
    (s.name === "A") !== swap ? serverA : serverB;
  let unavailable = typeof counters === "string" ? counters : null;
  const read = async (s: Side): Promise<ProcessCounters | null> => {
    const pid = serverOf(s).process.pid;
    if (typeof counters === "string" || pid === undefined) return null;
    const value = await counters.readProcessCounters(pid);
    if (value !== null && value.unavailable !== null) unavailable = value.unavailable;
    return value;
  };
  // The connections that each server has answered, as Haxe counts them for
  // its periodic collection: every `--connect` request, of any kind.
  const connections = new Map<OwnedHaxeCompilerServer, number>([[serverA, 0], [serverB, 0]]);
  const sendTo = async (server: OwnedHaxeCompilerServer, args: string[], label: string): Promise<void> => {
    const result = await server.compile(args, label, timeoutMs, workspace);
    connections.set(server, connections.get(server)! + 1);
    if (result.code !== 0) {
      throw new Error(`${label} failed\n${result.stdout}\n${result.stderr}\n${server.logs}`);
    }
  };
  const send = async (s: Side, args: string[], label: string): Promise<void> =>
    await sendTo(serverOf(s), args, label);
  /**
   * Keeps Haxe's periodic full collection out of the next measured request.
   * Haxe 4.3.7 runs it right after it closes every tenth connection, while
   * the client has its answer already. A measured request that is a tenth
   * connection would count part of it after its answer, and one sent right
   * after a tenth connection would count the rest of it before its own
   * work. So this sends cheap `-version` requests until neither holds; a
   * request that comes after a collection waits for it to end.
   */
  const absorb = async (s: Side): Promise<void> => {
    const server = serverOf(s);
    const tenth = (count: number): boolean => count % HAXE_COLLECTION_PERIOD === 0;
    while (tenth(connections.get(server)!) || tenth(connections.get(server)! + 1))
      await sendTo(server, ["-version"], `${s.name} absorb collection`);
  };
  const prime = async (s: Side): Promise<void> => {
    descriptor(s, { kind: "full", moduleRecords: true });
    await send(s, programArgs(s), `${s.name} full request`);
  };
  // `--edit=literal`: the file of the requested module and the next value.
  const editedFile = path.join(workspace, "src", ...target.split(".")) + ".hx";
  let edits = 0;
  const applyEdit = async (): Promise<void> => {
    const text = readFileSync(editedFile, "utf8");
    const from = EDIT_VALUES[edits % 2]!;
    const to = EDIT_VALUES[(edits + 1) % 2]!;
    if (!text.includes(from)) throw new Error(`--edit=literal: ${editedFile} has no ${from}`);
    writeFileSync(editedFile, text.replace(from, to));
    edits += 1;
    // Haxe 4.3.7 compares file times in whole seconds; a session sends
    // this for each saved file before the next request. Both servers read
    // the shared workspace, so both must forget the old text.
    for (const server of serverA === serverB ? [serverA] : [serverA, serverB]) {
      await sendTo(server, ["--display", JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "server/invalidate", params: { file: editedFile }
      })], "invalidate");
    }
  };
  const measured = async (s: Side): Promise<Sample> => {
    if (edit === "literal") await applyEdit();
    await absorb(s);
    const connectionsBefore = connections.get(serverOf(s))!;
    const args = kind === "program" ? programArgs(s) : moduleArgs(s);
    // The rolling replay audit prints other modules in each request; off,
    // so that equal program requests do equal work.
    descriptor(s, kind === "program"
      ? { kind: "full", moduleRecords: true, audit: { modules: 0, seed: 0 } }
      : { kind: "module", module: target });
    const load = loadavg()[0] ?? 0;
    const before = await read(s);
    const started = performance.now();
    await send(s, args, `${s.name} ${kind} request`);
    const wallMs = performance.now() - started;
    const after = await read(s);
    const { result, measure } = readMeasure(s, kind);
    if (edit === "literal" && result !== "preview")
      throw new Error(`--edit=literal: the ${s.name} module request gave ${result}, not a preview`);
    const instructions = before?.instructions == null || after?.instructions == null
      ? null : after.instructions - before.instructions;
    const cpuMs = before?.cpuNs == null || after?.cpuNs == null
      ? null : (after.cpuNs - before.cpuNs) / 1e6;
    const beforeGenesMs = before?.cpuNs == null || measure === null
      ? null : measure.processCpuStartMs - before.cpuNs / 1e6;
    const afterGenesMs = after?.cpuNs == null || measure === null
      ? null : after.cpuNs / 1e6 - measure.processCpuEndMs;
    // Named: every phase of the measure except the self time of its
    // catch-all phases, plus the two Haxe spans outside it.
    const namedMs = measure === null
      ? null : measure.cpuMs - measure.unnamedCpuMs + (beforeGenesMs ?? 0) + (afterGenesMs ?? 0);
    return {
      side: s.name,
      result,
      measure,
      instructions,
      cpuMs,
      wallMs,
      named: cpuMs === null || cpuMs <= 0 || namedMs === null ? null : namedMs / cpuMs,
      beforeGenesMs,
      afterGenesMs,
      connectionsBefore,
      serverRssMb: residentMb(serverOf(s).process.pid),
      load
    };
  };
  const samples: Sample[] = [];
  try {
    if (repeat > 0) {
      await prime(a);
      if (kind === "module") await measured(a);
      for (let index = 0; index < repeat; index += 1) samples.push(await measured(a));
      printRepeats(samples, unavailable);
    } else {
      // One warm-up of each side, then `--warmup-pairs` pairs whose samples
      // are dropped (the first pair of a run is the most biased one), then
      // the pairs. With one server for both sides, each switch starts a new
      // macro state without module records, so each module sample needs a
      // full request first; with one server per side nothing switches.
      // With `--swap` the warm-up is mirrored too: B first, then A.
      for (const s of swap ? [b, a] : [a, b]) {
        await prime(s);
        await measured(s);
      }
      const primeEach = kind === "module" && serverA === serverB;
      for (let index = 0; index < warmupPairs + pairs; index += 1) {
        for (const s of swap ? [b, a, a, b] : [a, b, b, a]) {
          if (primeEach) await prime(s);
          const sample = await measured(s);
          if (index >= warmupPairs) samples.push(sample);
        }
      }
      printPairs(samples, unavailable);
    }
  } finally {
    await serverA.stop();
    if (serverB !== serverA) await serverB.stop();
    writeFileSync(path.join(tempRoot, "result.json"), `${JSON.stringify({
      a: sourceA,
      b: sourceB,
      defineB,
      kind,
      edit,
      swap,
      module: target,
      servers: serverA === serverB ? 1 : 2,
      warmupPairs,
      instructionsUnavailable: unavailable,
      samples
    }, null, 2)}\n`);
  }
}

/** The resident memory of `pid` in MB (`ps -o rss=`), or null when `ps` cannot tell. */
function residentMb(pid: number | undefined): number | null {
  if (pid === undefined) return null;
  try {
    const kilobytes = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
    return Number.isFinite(kilobytes) ? Math.round(kilobytes / 1024) : null;
  } catch {
    return null;
  }
}

/** The relative spread (highest minus lowest, over lowest) of `values`, or null. */
function spread(values: ReadonlyArray<number | null>): number | null {
  if (values.some((value) => value === null) || values.length === 0) return null;
  const numbers = values as ReadonlyArray<number>;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  return low <= 0 ? null : (high - low) / low;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The order-statistic interval of the median of `values` with at least 95%
 * coverage, or null with fewer than 6 values: the k-th lowest and k-th
 * highest value, where k is the largest index with
 * P(Binomial(n, 1/2) < k) <= 2.5%. For 20 values it is the 6th to the 15th.
 */
function medianInterval(values: ReadonlyArray<number>): { low: number; high: number } | null {
  const n = values.length;
  const sorted = [...values].sort((left, right) => left - right);
  let cumulative = 0;
  let k = 0;
  let choose = 1;
  for (let i = 0; i < n; i += 1) {
    cumulative += choose / 2 ** n;
    if (cumulative > 0.025) break;
    k = i + 1;
    choose = (choose * (n - i)) / (i + 1);
  }
  return k < 1 ? null : { low: sorted[k - 1]!, high: sorted[n - k]! };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function printRepeats(all: ReadonlyArray<Sample>, unavailable: string | null): void {
  // `readMeasure` refuses a missing measure in this mode.
  const samples = all.map((sample) => ({ ...sample, measure: sample.measure! }));
  const workNames = Object.keys(samples[0]?.measure.work ?? {});
  process.stdout.write(`| repeat | result | ${workNames.join(" | ")} | words | minor collections | instructions | cpu ms | named | wall ms | load |\n`);
  process.stdout.write(`|${" --- |".repeat(workNames.length + 10)}\n`);
  samples.forEach((sample, index) => {
    process.stdout.write(`| ${index + 1} | ${sample.result} | `
      + `${workNames.map((name) => sample.measure.work[name]).join(" | ")} | `
      + `${sample.measure.words} | ${sample.measure.minorCollections} | ${sample.instructions ?? "n/a"} | `
      + `${sample.cpuMs?.toFixed(1) ?? "n/a"} | ${percent(sample.named)} | `
      + `${sample.wallMs.toFixed(0)} | ${sample.load.toFixed(1)} |\n`);
  });
  const equalWork = samples.every((sample) =>
    JSON.stringify(sample.measure.work) === JSON.stringify(samples[0]!.measure.work));
  process.stdout.write(`work counts equal: ${equalWork}\n`);
  process.stdout.write(`words spread: ${percent(spread(samples.map((sample) => sample.measure.words)))}\n`);
  process.stdout.write(`instructions spread: ${percent(spread(samples.map((sample) => sample.instructions)))}`
    + `${unavailable === null ? "" : ` (unavailable: ${unavailable})`}\n`);
  process.stdout.write(`cpu spread: ${percent(spread(samples.map((sample) => sample.cpuMs)))}\n`);
  process.stdout.write(`wall spread (report line, not a gate): ${percent(spread(samples.map((sample) => sample.wallMs)))}\n`);
  const named = samples.map((sample) => sample.named).filter((value): value is number => value !== null);
  process.stdout.write(`named share of request cpu: lowest ${percent(named.length === 0 ? null : Math.min(...named))}\n`);
  const outside = (pick: (sample: Sample & { readonly measure: Measure }) => number | null): string =>
    samples.map((sample) => pick(sample)?.toFixed(1) ?? "n/a").join(", ");
  process.stdout.write(`haxe.before-genes cpu ms: ${outside((sample) => sample.beforeGenesMs)}\n`);
  process.stdout.write(`haxe.after-genes cpu ms: ${outside((sample) => sample.afterGenesMs)}\n`);
  process.stdout.write(`measure cpu ms (genes.init to report): ${outside((sample) => sample.measure.cpuMs)}`
    + `, unnamed: ${outside((sample) => sample.measure.unnamedCpuMs)}\n`);
  const last = samples[samples.length - 1]!.measure;
  const span = last.phases.filter((phase) => phase.name === "genes.after-typing"
    || phase.name.startsWith("genes.after-typing."));
  const haxeWork = last.phases.filter((phase) => phase.name.startsWith("haxe.")
    && Object.values(phase.work).some((value) => value !== 0)).map((phase) => phase.name);
  process.stdout.write(`genes.after-typing span: ${span.reduce((sum, phase) => sum + (phase.work.afterTypingDeclarations ?? 0), 0)} `
    + `of ${last.work.afterTypingDeclarations} after-typing declarations, `
    + `${span.reduce((sum, phase) => sum + phase.cpuMs, 0).toFixed(2)} ms; `
    + `haxe.* phases with Genes work: ${haxeWork.length === 0 ? "none" : haxeWork.join(", ")}\n`);
  const phases = last.phases;
  process.stdout.write("phases of the last repeat (self cpu ms, words):\n");
  for (const phase of [...phases].sort((left, right) => right.cpuMs - left.cpuMs)) {
    process.stdout.write(`  ${phase.name} x${phase.calls}: ${phase.cpuMs} ms, ${phase.words} words\n`);
  }
}

function printPairs(samples: ReadonlyArray<Sample>, unavailable: string | null): void {
  const ratios = { words: [] as number[], instructions: [] as number[], cpu: [] as number[], wall: [] as number[] };
  // Words move in steps of up to one minor heap per minor collection, so
  // they compare only when both sides of every pair collected equally often.
  let collectionsDiffer = false;
  let collectionGap = 0;
  const collectionsA: number[] = [];
  const collectionsB: number[] = [];
  for (let index = 0; index + 3 < samples.length; index += 4) {
    // Each group of four holds two samples of each side, in A B B A order,
    // or B A A B with `--swap`.
    const group = samples.slice(index, index + 4);
    const [a1, a2] = group.filter((sample) => sample.side === "A") as [Sample, Sample];
    const [b1, b2] = group.filter((sample) => sample.side === "B") as [Sample, Sample];
    const ratio = (pick: (sample: Sample) => number | null): number | null => {
      const values = [a1, b1, b2, a2].map(pick);
      if (values.some((value) => value === null)) return null;
      const [va1, vb1, vb2, va2] = values as number[];
      return va1! + va2! <= 0 ? null : (vb1! + vb2!) / (va1! + va2!);
    };
    const words = ratio((sample) => sample.measure?.words ?? null);
    const minorOf = (sample: Sample): number | null => sample.measure?.minorCollections ?? null;
    if ([a1, a2, b1, b2].every((sample) => minorOf(sample) !== null)) {
      collectionsA.push(minorOf(a1)!, minorOf(a2)!);
      collectionsB.push(minorOf(b1)!, minorOf(b2)!);
      const gap = Math.abs(minorOf(a1)! + minorOf(a2)! - minorOf(b1)! - minorOf(b2)!);
      if (gap > 0) collectionsDiffer = true;
      collectionGap = Math.max(collectionGap, gap);
    }
    const instructions = ratio((sample) => sample.instructions);
    const cpu = ratio((sample) => sample.cpuMs);
    const wall = ratio((sample) => sample.wallMs);
    if (words !== null) ratios.words.push(words);
    if (instructions !== null) ratios.instructions.push(instructions);
    if (cpu !== null) ratios.cpu.push(cpu);
    if (wall !== null) ratios.wall.push(wall);
  }
  const results = new Set(samples.map((sample) => `${sample.side}:${sample.result}`));
  process.stdout.write(`samples: ${samples.length} (${[...results].sort().join(", ")})\n`);
  const line = (name: string, values: number[], note = ""): void => {
    const interval = medianInterval(values);
    process.stdout.write(values.length === 0
      ? `${name}: unavailable${note}\n`
      : `${name}: median B/A ${median(values).toFixed(4)}, 95% interval of the median `
        + `${interval === null ? "n/a (fewer than 6 pairs)" : `${interval.low.toFixed(4)} to ${interval.high.toFixed(4)}`} `
        + `(lowest ${Math.min(...values).toFixed(4)}, highest ${Math.max(...values).toFixed(4)}, `
        + `${values.length} pairs)${note}\n`);
  };
  process.stdout.write("B differs from A only where the 95% interval leaves out 1. The interval covers the "
    + "noise between pairs of this run only; each side has its own server process, and an offset between "
    + "the two processes counts as a difference (same-source medians fell between 0.998 and 1.006). "
    + "A difference under about 1% is unproven until a second run with --swap also gives an interval "
    + "that leaves out 1 on the same side.\n");
  if (swap) process.stdout.write("sides swapped: B ran on the first server, in the A positions; ratios are B/A.\n");
  const span = (values: number[]): string =>
    values.length === 0 ? "n/a" : `${Math.min(...values)} to ${Math.max(...values)}`;
  const collections = `minor collections A ${span(collectionsA)}, B ${span(collectionsB)}`;
  if (collectionsDiffer) {
    // One collection moves words by up to one minor heap, so the ratio is
    // uncertain by that much for each collection of difference in a pair.
    const pairWords = samples.length === 0 ? 0 : 2 * median(samples.flatMap((sample) =>
      sample.measure === null ? [] : [sample.measure.words]));
    const uncertainty = pairWords <= 0 ? null : (collectionGap * MINOR_HEAP_WORDS) / pairWords;
    line("words (uncertain: collection counts differ)", ratios.words, ` (${collections}; up to ${collectionGap} `
      + `collections of difference in a pair, so uncertain by up to `
      + `${uncertainty === null ? "n/a" : `${(uncertainty * 100).toFixed(1)}%`} with Haxe's default minor heap; `
      + `the interval rule does not apply)`);
  } else {
    line("words", ratios.words, ` (${collections})`);
  }
  line("instructions", ratios.instructions, unavailable === null ? "" : ` (${unavailable})`);
  line("cpu", ratios.cpu);
  line("wall (report line, not a gate)", ratios.wall);
  // CPU time outside Genes (before the init macro or after the report). A
  // periodic collection would show here; the collection guard keeps it out.
  // Some remains, larger where the server waited through two requests of
  // the other side (position 2 and 4 of A B B A).
  const outside = (sample: Sample): number | null =>
    sample.beforeGenesMs === null || sample.afterGenesMs === null
      ? null : sample.beforeGenesMs + sample.afterGenesMs;
  const threshold = 12;
  const order = swap ? ["B", "A", "A", "B"] : ["A", "B", "B", "A"];
  const byPosition = [0, 1, 2, 3].map((position) => samples.filter((_, index) =>
    index % 4 === position && (outside(samples[index]!) ?? 0) > threshold).length);
  const highest = (position: number): string => {
    const values = samples.filter((_, index) => index % 4 === position)
      .map((sample) => outside(sample)).filter((value): value is number => value !== null);
    return values.length === 0 ? "n/a" : Math.max(...values).toFixed(1);
  };
  process.stdout.write(`samples with more than ${threshold} ms of CPU outside Genes, by position `
    + `${order.join(" ")}: ${byPosition.join(", ")} of ${samples.length / 4} each `
    + `(highest ms ${[0, 1, 2, 3].map(highest).join(", ")})\n`);
  const memory = samples.map((sample) => sample.serverRssMb).filter((value): value is number => value !== null);
  if (memory.length > 0)
    process.stdout.write(`server resident memory: first ${memory[0]} MB, last ${memory[memory.length - 1]} MB, `
      + `highest ${Math.max(...memory)} MB (report line)\n`);
}

await main();
