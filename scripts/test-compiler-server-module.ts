/**
 * Gate for G3 module requests (genes-f8vc.14.2): a warm Haxe compilation
 * server types only the edited module, and Genes prints only that module.
 *
 * Why: a full request plans and prints every reachable module, so an edit
 * shows up only after the whole program was generated again. A module
 * request (`"kind": "module"` in the request descriptor) prints one module
 * and publishes it only when `genes.incremental.ModuleRequest` proves that
 * its files equal the files of a full build. This gate checks that claim on
 * real edits, and that the full path stays as it was.
 *
 * How: one source tree (`tests/compiler-server/templates/module-request`)
 * gets a fixed list of edits. One warm server serves the session:
 *
 * 1. a full request (`--main mr.Main`) with `"moduleRecords": true` stores
 *    the records;
 * 2. after each edit, a module request (the edited module as the only root,
 *    no `--main`, its own sibling output folder) runs; its report must have
 *    the expected result. A `preview` must hold only the module's files,
 *    and each of them must be byte-identical to the same file of a cold
 *    build (a new Haxe process, no define) of the edited program;
 * 3. a full request then runs as the authority; its tree must equal the
 *    cold tree, so a module request leaves nothing behind in the server's
 *    cache (no `--macro keep(...)` metadata).
 *
 * At the end, a full request that reads a module descriptor (a session that
 * rewrote the one descriptor file while a request was queued) must be
 * refused with `has-main` and publish nothing.
 *
 * `--keep-control` also runs the older way to root a module request,
 * `--macro keep(<module>)`, on a second server, and prints whether the next
 * full request then differs from cold (the measured cache pollution of
 * genes-f8vc.14.1). It is an observation, not a pass condition.
 *
 * Times are printed with the 1-minute load; they are diagnostic only.
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashTree,
  OwnedHaxeCompilerServer,
  runBoundedProcess,
  selectedHaxeCompiler,
  type ProcessResult,
  type TreeEntry
} from "./compiler-server-lifecycle.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/compiler-server");
const template = path.join(fixtureRoot, "templates/module-request");
const tempRoot = path.join(fixtureRoot, ".tmp/module-request");
const workspace = path.join(tempRoot, "workspace");
const descriptorFile = path.join(tempRoot, "request.json");
const reportFile = `${descriptorFile}.report.json`;
const timeoutMs = 180_000;
const keepControl = process.argv.includes("--keep-control");
const genesVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")) as {
    readonly version: string;
  }
).version;

/** The parts of the module request report that this gate reads. */
type ModuleReport = {
  readonly kind: string;
  readonly module: string;
  readonly result: string;
  readonly refusal: string | null;
  readonly reason: string | null;
  readonly typedAgainModules: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
  readonly generationMs: number;
  readonly checkMs: number;
};

/** One scripted edit, the module that the session previews, and the expected answer. */
type Step = {
  readonly id: string;
  readonly apply: () => void;
  readonly module: string;
  /** `preview`, or the expected refusal code. */
  readonly expect: string;
  /** Write the preview into the full request's output folder (a session mistake). */
  readonly sameFolder?: boolean;
  /** Skip the full request after this step (the next step depends on it). */
  readonly skipProgram?: boolean;
};

let clock = Math.floor(Date.now() / 1000);

/** Moves a file time to a later whole second than any earlier edit. */
function touch(file: string): void {
  clock = Math.max(clock, Math.floor(Date.now() / 1000),
    Math.floor(statSync(file).mtimeMs / 1000)) + 2;
  utimesSync(file, clock, clock);
}

/** Replaces one exact text in a fixture file and moves its time. */
function edit(relative: string, from: string, to: string): void {
  const file = path.join(workspace, "src/mr", relative);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  writeFileSync(file, text.replace(from, to));
  touch(file);
}

const steps: ReadonlyArray<Step> = [
  {
    id: "no edit",
    apply: () => {},
    module: "mr.Button",
    expect: "preview"
  },
  {
    id: "body edit of a private function",
    apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
    module: "mr.Button",
    expect: "preview"
  },
  {
    id: "new unused private function (a full build drops it too)",
    apply: () => edit("Button.hx", "  static function unused(): String {",
      "  static function unusedToo(): Int {\n    return 7;\n  }\n\n"
      + "  static function unused(): String {"),
    module: "mr.Button",
    expect: "preview"
  },
  {
    id: "body edit in a class with a parent class and an interface",
    apply: () => edit("Panel.hx", "return 'panel ' + name",
      "return 'panel: ' + name"),
    module: "mr.Panel",
    expect: "preview"
  },
  {
    id: "body edit of the module with main",
    apply: () => edit("Main.hx", "trace(Theme.size());",
      "trace(Theme.size() + 1);"),
    module: "mr.Main",
    expect: "preview"
  },
  {
    id: "new use of a field of another module",
    apply: () => edit("Button.hx", "return label() + ':' + helper();",
      "return label() + ':' + helper() + Theme.spacing();"),
    module: "mr.Button",
    expect: "foreign-references-changed"
  },
  {
    id: "the only call of a private helper is removed",
    apply: () => edit("Button.hx",
      "return label() + ':' + helper() + Theme.spacing();",
      "return label() + ':' + Theme.spacing();"),
    module: "mr.Button",
    expect: "reference-lost"
  },
  {
    id: "inline constant changed",
    apply: () => edit("Consts.hx", "LIMIT = 3;", "LIMIT = 4;"),
    module: "mr.Consts",
    expect: "public-shape-changed"
  },
  {
    id: "public signature changed",
    apply: () => edit("Theme.hx", "public static function color(): String {",
      "public static function color(?dark: Bool): String {"),
    module: "mr.Theme",
    expect: "public-shape-changed"
  },
  {
    id: "enum constructor added",
    apply: () => {
      edit("Leaf.hx", "  Large;", "  Large;\n  Huge;");
      edit("Leaf.hx", "case Large: 'large';",
        "case Large: 'large';\n      case Huge: 'huge';");
    },
    module: "mr.Leaf",
    expect: "public-shape-changed"
  },
  {
    id: "body edit inside an import cycle",
    apply: () => edit("Cycle.hx", "return 'back';", "return 'back!';"),
    module: "mr.Cycle",
    expect: "other-modules-typed"
  },
  {
    id: "two files edited, preview of one",
    apply: () => {
      edit("Button.hx", "return 'Store';", "return 'Keep';");
      edit("Theme.hx", "return 'blue';", "return 'green';");
    },
    module: "mr.Button",
    expect: "other-modules-typed"
  },
  {
    id: "preview into the full request's output folder",
    apply: () => edit("Button.hx", "return 'Keep';", "return 'Hold';"),
    module: "mr.Button",
    expect: "same-folder",
    sameFolder: true
  },
  {
    id: "first of two previews without a full request between them",
    apply: () => edit("Theme.hx", "return 'green';", "return 'red';"),
    module: "mr.Theme",
    expect: "preview",
    skipProgram: true
  },
  {
    id: "second preview after another module request",
    apply: () => edit("Button.hx", "return 'Hold';", "return 'Push';"),
    module: "mr.Button",
    expect: "other-modules-changed"
  },
  {
    id: "no edit after the full request",
    apply: () => {},
    module: "mr.Button",
    expect: "preview"
  }
];

function folder(name: string): string {
  return path.join(tempRoot, "out", name);
}

/** Arguments shared by every request: the defines of the session. */
function commonArguments(): string[] {
  return [
    "-cp", path.join(repoRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    "--macro", "genes.Generator.use()",
    "-cp", path.join(workspace, "src"),
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    "-D", "genes.ts",
    "-D", `genes.source_map_root=${tempRoot}`
  ];
}

function programArguments(out: string): string[] {
  return [...commonArguments(), "--main", "mr.Main", "-js",
    path.join(out, "index.ts")];
}

/**
 * Arguments of a module request: the session's arguments without `--main`,
 * with the module as the only root. `keepRoot` adds the older
 * `--macro keep(...)` root (only for `--keep-control`).
 */
function moduleArguments(module: string, out: string,
    keepRoot = false): string[] {
  return [...commonArguments(), module,
    ...(keepRoot ? ["--macro", `keep('${module}')`] : []),
    "-js", path.join(out, "index.ts")];
}

/** The digest of the full request's arguments, without the output path. */
function programDigest(): string {
  return createHash("sha256")
    .update(programArguments("<output>").join("\0"))
    .digest("hex");
}

function writeDescriptor(fields: Record<string, unknown>): void {
  writeFileSync(descriptorFile, JSON.stringify({
    format: 1,
    programDigest: programDigest(),
    afterTyping: "reuse",
    generation: "reuse",
    ...fields
  }));
}

function incremental(args: string[]): string[] {
  return [...args, "-D", `genes.dev_incremental=${descriptorFile}`];
}

function describe(result: ProcessResult): string {
  return `code ${String(result.code)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

/** Returns the paths whose bytes differ between two hashed trees. */
function treeDifference(left: ReadonlyArray<TreeEntry>,
    right: ReadonlyArray<TreeEntry>): ReadonlyArray<string> {
  const rightByPath = new Map(right.map((entry) => [entry.path, entry.sha256]));
  const leftPaths = new Set(left.map((entry) => entry.path));
  return [
    ...left.filter((entry) => rightByPath.get(entry.path) !== entry.sha256)
      .map((entry) => entry.path),
    ...right.filter((entry) => !leftPaths.has(entry.path))
      .map((entry) => entry.path)
  ].sort();
}

function readReport(): ModuleReport {
  ok(existsSync(reportFile), "the module request wrote no report");
  return JSON.parse(readFileSync(reportFile, "utf8")) as ModuleReport;
}

function loadPerCpu(): number {
  return (loadavg()[0] ?? 0) / Math.max(1, cpus().length);
}

type Row = {
  readonly id: string;
  readonly result: string;
  readonly typedAgain: string;
  readonly moduleMs: number;
  readonly genesMs: number;
  readonly programMs: number;
  readonly load: number;
};

/** Builds the current sources in a new Haxe process, without any define of the session. */
async function coldBuild(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  label: string
): Promise<ReadonlyArray<TreeEntry>> {
  rmSync(folder("cold"), { recursive: true, force: true });
  const cold = await runBoundedProcess(compiler.binary,
    programArguments(folder("cold")), {
      cwd: workspace,
      timeoutMs,
      label: `Cold ${label}`,
      reportProgress: true
    });
  ok(cold.code === 0, `${label}: cold build failed\n${describe(cold)}`);
  return hashTree(folder("cold"));
}

async function programRequest(server: OwnedHaxeCompilerServer,
    label: string): Promise<number> {
  writeDescriptor({ kind: "full", moduleRecords: true });
  const started = performance.now();
  const result = await server.compile(incremental(programArguments(folder("program"))),
    `Program ${label}`, timeoutMs, workspace);
  const elapsed = performance.now() - started;
  ok(result.code === 0, `${label}: full request failed\n${describe(result)}`);
  const records = `${descriptorFile}.module-records.json`;
  ok(existsSync(records), `${label}: the full request stored no module records`);
  strictEqual((JSON.parse(readFileSync(records, "utf8")) as { stored: boolean })
    .stored, true, `${label}: the full request did not store its module records`);
  return elapsed;
}

async function main(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(template, workspace, { recursive: true });
  const compiler = selectedHaxeCompiler(repoRoot);
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  const rows: Row[] = [];
  let previews = 0;
  let refusals = 0;
  try {
    await programRequest(server, "first");
    for (const [index, step] of steps.entries()) {
      const label = `[${index + 1}/${steps.length}] ${step.id}`;
      step.apply();
      const previewFolder = step.sameFolder === true ? folder("program") : folder("preview");
      const programBefore = hashTree(folder("program"));
      if (step.sameFolder !== true)
        rmSync(previewFolder, { recursive: true, force: true });
      rmSync(reportFile, { force: true });
      writeDescriptor({ kind: "module", module: step.module });
      const load = loadPerCpu();
      const started = performance.now();
      const result = await server.compile(
        incremental(moduleArguments(step.module, previewFolder)),
        `Module ${label}`, timeoutMs, workspace);
      const moduleMs = performance.now() - started;
      ok(result.code === 0, `${label}: module request failed\n${describe(result)}`);
      const report = readReport();
      strictEqual(report.kind, "module", `${label}: report kind`);
      strictEqual(report.module, step.module, `${label}: report module`);
      const outcome = report.result === "preview" ? "preview" : report.refusal ?? report.result;
      strictEqual(outcome, step.expect,
        `${label}: expected ${step.expect}, got ${outcome} (${String(report.reason)})`);
      const coldTree = await coldBuild(compiler, label);
      if (report.result === "preview") {
        previews++;
        // The preview holds the module's files and the manifest, nothing else.
        const previewTree = hashTree(previewFolder);
        const published = previewTree.map((entry) => entry.path)
          .filter((file) => !file.startsWith(".genes-output-")).sort();
        deepStrictEqual(published, [...report.files].sort(),
          `${label}: the preview folder holds other files than the report names`);
        ok(published.length > 0, `${label}: the preview published no file`);
        const prefix = step.module.split(".").join("/");
        for (const file of published) {
          ok(file === `${prefix}.ts` || file.startsWith(`${prefix}.`),
            `${label}: ${file} is not a file of ${step.module}`);
          const previewBytes = readFileSync(path.join(previewFolder, file));
          const coldFile = path.join(folder("cold"), file);
          ok(existsSync(coldFile), `${label}: the cold build has no ${file}`);
          ok(previewBytes.equals(readFileSync(coldFile)),
            `${label}: ${file} of the preview differs from the cold build`);
        }
      } else {
        refusals++;
        if (step.sameFolder === true) {
          deepStrictEqual(hashTree(folder("program")), programBefore,
            `${label}: a refused module request changed the full request's tree`);
        } else {
          deepStrictEqual(hashTree(previewFolder), [],
            `${label}: a refused module request published files`);
        }
      }
      let programMs = 0;
      if (step.skipProgram !== true) {
        programMs = await programRequest(server, label);
        const difference = treeDifference(hashTree(folder("program")), coldTree);
        deepStrictEqual(difference, [],
          `${label}: the full request after the module request differs from `
          + `the cold build:\n${difference.join("\n")}`);
      }
      rows.push({
        id: step.id,
        result: outcome,
        typedAgain: report.typedAgainModules.join(" "),
        moduleMs: Math.round(moduleMs),
        genesMs: report.generationMs,
        programMs: Math.round(programMs),
        load: Number(load.toFixed(2))
      });
    }
    // A queued full request that reads a module descriptor (the session
    // rewrote the one descriptor file too early) publishes nothing.
    rmSync(reportFile, { force: true });
    rmSync(folder("race"), { recursive: true, force: true });
    writeDescriptor({ kind: "module", module: "mr.Button" });
    const raced = await server.compile(incremental(programArguments(folder("race"))),
      "Full request with a module descriptor", timeoutMs, workspace);
    ok(raced.code === 0, `full request with a module descriptor failed\n${describe(raced)}`);
    strictEqual(readReport().refusal, "has-main",
      "a full request that reads a module descriptor must be refused");
    deepStrictEqual(hashTree(folder("race")), [],
      "a refused full request with a module descriptor published files");
    refusals++;
  } finally {
    await server.stop();
  }
  process.stdout.write("step | result | typed again | module request ms | "
    + "Genes ms | full request ms | load per CPU\n");
  for (const row of rows)
    process.stdout.write(`${row.id} | ${row.result} | ${row.typedAgain} | `
      + `${row.moduleMs} | ${row.genesMs} | ${row.programMs} | ${row.load}\n`);
  let control = "keep control skipped";
  if (keepControl)
    control = await runKeepControl(compiler);
  process.stdout.write(`compiler-server-module:ok (Haxe ${compiler.version}; `
    + `${previews} previews byte-identical to cold, ${refusals} refusals as `
    + `expected, every full request after a module request equal to cold; `
    + `${control})\n`);
}

/**
 * Observation for `--keep-control`: roots a module request with
 * `--macro keep(<module>)` instead of the Genes roots, then runs a full
 * request and compares it with cold. Returns a summary line.
 */
async function runKeepControl(
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<string> {
  rmSync(workspace, { recursive: true, force: true });
  cpSync(template, workspace, { recursive: true });
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  try {
    await programRequest(server, "keep control first");
    edit("Button.hx", "return 'Save';", "return 'Store';");
    // A full request of the module's program, as genes-f8vc.14.1 measured
    // it: Genes adds no roots, keep() does. Same define, so the same Haxe
    // cache as the session.
    writeDescriptor({ kind: "full", generation: undefined });
    rmSync(folder("keep"), { recursive: true, force: true });
    const result = await server.compile(
      incremental(moduleArguments("mr.Button", folder("keep"), true)),
      "Keep control module request", timeoutMs, workspace);
    ok(result.code === 0, `keep control request failed\n${describe(result)}`);
    await programRequest(server, "keep control after");
    const coldTree = await coldBuild(compiler, "keep control");
    const difference = treeDifference(hashTree(folder("program")), coldTree);
    return difference.length === 0
      ? "keep control: the full request after keep() equals cold"
      : `keep control: the full request after keep() differs from cold in ${difference.join(", ")}`;
  } finally {
    await server.stop();
  }
}

await main();
