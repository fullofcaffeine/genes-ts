/**
 * Gates for the keep rule of the passes after typing (task genes-d5uv, step
 * 3, slice 1) on a warm Haxe compilation server.
 *
 * Why: with `-D genes.dev_incremental`, Genes stamps each typed declaration
 * and the React audit keeps one plain record for each class that it found
 * clean. In a later request the audit can skip a class when the keep rule
 * holds for its record (`genes.incremental.GenerationChangeSet`). A skipped
 * audit must never change output or hide a diagnostic.
 *
 * What: two source trees get a scripted list of edits, the same lists that
 * `yarn test:compiler-server` and `yarn test:compiler-server:kept-types`
 * use, plus an audit error. After each step the same request runs in a new
 * Haxe process without the define (the cold oracle) and on four warm
 * servers:
 *
 * - `plain`: no define. Warm must equal cold; a failure here is a defect of
 *   today, not of the keep rule.
 * - `measure`: the define is on and no pass skips work (reuse off). Warm
 *   must equal cold.
 * - `reuse`: the audit skips each class whose record the keep rule keeps.
 *   The warm tree and the diagnostics must equal cold.
 * - `compare`: the audit runs for every class; a class with a kept record
 *   that fails is reported. The gate requires zero such failures.
 *
 * The gate cannot pass empty: in each request with no edit, the kept
 * records must be above 0, and in `reuse` the skipped audits too.
 *
 * A third lane checks diagnostics without and with the define. Haxe ends a
 * callback at its first `Context.error` but still runs the next callback, so
 * one build can report an error of a pass and an error of the
 * module-directive capture. The lane requires both, in Haxe's callback
 * order, for three orders of the init macros.
 *
 * Three more checks run once each: `KeepRuleProbe` proves each condition of
 * the keep rule on its own; a program with an `@:rtti` class leaves the
 * incremental path and still equals cold; and a report file that cannot be
 * written gives a warning, never a failed build.
 *
 * Each edit moves the file time to a later whole second, because Haxe 4.3.7
 * compares file times at one-second precision. The timings are printed, not
 * judged: the fixtures are small, and a timing claim needs a quiet machine.
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
import { loadavg } from "node:os";
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
const tempRoot = path.join(fixtureRoot, ".tmp/after-typing");
const timeoutMs = 180_000;
const genesVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")) as {
    readonly version: string;
  }
).version;

const allWarmModes = ["plain", "measure", "reuse", "compare"] as const;
type WarmMode = (typeof allWarmModes)[number];

/**
 * The warm modes of this run: all four, or the ones that `--modes=a,b`
 * names. A developer uses the option to repeat one mode, for example after a
 * deliberate break of the keep rule.
 */
const warmModes: ReadonlyArray<WarmMode> = (() => {
  const option = process.argv.find((value) => value.startsWith("--modes="));
  if (option === undefined) return allWarmModes;
  const names = option.slice("--modes=".length).split(",");
  const selected = allWarmModes.filter((mode) => names.includes(mode));
  ok(selected.length === names.length && selected.length > 0,
    `--modes accepts ${allWarmModes.join(", ")}`);
  return selected;
})();
type Mode = "cold" | WarmMode;

/** The parts of one pass report that this gate reads. */
type PassReport = {
  readonly pass: string;
  readonly records: number;
  readonly kept: number;
  readonly rejected: number;
  readonly rejectedByReason: {
    readonly noRecord: number;
    readonly typedAgain: number;
    readonly stampNamesOtherDeclaration: number;
    readonly stampDiffers: number;
    readonly membersChanged: number;
  };
  readonly rejectExamples: ReadonlyArray<{
    readonly key: string;
    readonly reason: string;
  }>;
  readonly skipped: number;
  readonly worked: number;
  readonly written: number;
  readonly compareFailures: ReadonlyArray<string>;
  readonly sameObjectTested: number;
  readonly decisionMs: number;
  readonly workMs: number;
};

/** The report that `GenerationChangeSet` writes beside the descriptor. */
type AfterTypingReport = {
  readonly format: number;
  readonly request: number;
  readonly mode: string;
  readonly reason: string | null;
  readonly session: string;
  readonly droppedRecords: number;
  readonly declarations: number;
  readonly classes: number;
  readonly typedAgain: number;
  readonly arrivedStamped: number;
  readonly foreignStamps: number;
  readonly typedAgainModules: ReadonlyArray<string>;
  readonly stampMs: number;
  readonly sessionKeyMs: number;
  readonly memberListMs: number;
  readonly walkMs: number;
  readonly passesComplete: boolean;
  readonly passes: ReadonlyArray<PassReport>;
};

/** One scripted step and what the gate expects from it. */
type Step = {
  readonly id: string;
  readonly apply?: (lane: Lane) => void;
  /**
   * Texts that the diagnostics of a failing request must contain, in this
   * order.
   */
  readonly fails?: ReadonlyArray<string>;
  /** Text that the diagnostics of a failing request must not contain. */
  readonly failsWithout?: string;
  /**
   * Text of the reason for which the request must leave the incremental
   * path. Such a request adds no stamp and reads no record.
   */
  readonly off?: string;
  /**
   * True for a request with no edit after a successful one: Haxe must type
   * nothing again, every class record must be kept, and in `reuse` every
   * audit must be skipped. The request is repeated up to four times until
   * Haxe types nothing again, as the other compiler-server tests do.
   */
  readonly settled?: boolean;
  /**
   * True when the `-D` values of the request changed. Haxe 4.3.7 then starts
   * the macro state again, so no record exists.
   */
  readonly restarts?: boolean;
  /** True when only the session's program digest changed: every record is dropped. */
  readonly dropsSession?: boolean;
  /** Rejects that the React audit report must list, as `key` and `reason`. */
  readonly rejects?: ReadonlyArray<readonly [string, string]>;
  /** The exact fixture modules that Haxe must type again, without the package. */
  readonly typesAgain?: ReadonlyArray<string>;
};

/** One fixture: its source template, its program, and its edit list. */
type LaneConfig = {
  readonly name: string;
  readonly template: string;
  readonly main: string;
  readonly pack: string;
  readonly modules: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<Step>;
};

/** One number row of the summary. */
type Measurement = {
  readonly lane: string;
  readonly mode: WarmMode;
  readonly step: string;
  /** True for an edit that made Haxe type exactly one fixture module again. */
  readonly oneModuleEdit: boolean;
  readonly report: AfterTypingReport;
};

const measurements: Array<Measurement> = [];
let requestCount = 0;
let coldCount = 0;
let offRequests = 0;
let clock = Math.floor(Date.now() / 1000);

/** The mutable state of one fixture while its steps run. */
class Lane {
  public defines: Array<string> = [];
  /**
   * The order of the init macros. `double` calls `Generator.use()` twice;
   * `reactFirst` installs the React audit before `Generator.use()`. Haxe
   * runs after-typing callbacks in reverse order of registration, so each
   * order gives another order of the Genes callbacks.
   */
  public macroOrder: "default" | "double" | "reactFirst" = "default";
  public modules: Array<string>;
  public programSalt = 0;
  public readonly root: string;
  public readonly workspace: string;

  public constructor(public readonly config: LaneConfig) {
    this.modules = [...config.modules];
    this.root = path.join(tempRoot, config.name);
    this.workspace = path.join(this.root, "workspace");
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
    cpSync(config.template, this.workspace, { recursive: true });
  }

  public sourceFile(relative: string): string {
    return path.join(this.workspace, "src", relative);
  }

  /** Moves a file time to a later whole second than any earlier edit. */
  public touch(file: string): void {
    clock = Math.max(
      clock,
      Math.floor(Date.now() / 1000),
      Math.floor(statSync(file).mtimeMs / 1000)
    ) + 2;
    utimesSync(file, clock, clock);
  }

  /** Replaces one exact text in a fixture file and moves its time. */
  public edit(relative: string, from: string, to: string): void {
    const file = this.sourceFile(relative);
    const text = readFileSync(file, "utf8");
    ok(
      text.split(from).length === 2,
      `${relative} must contain ${JSON.stringify(from)} exactly once`
    );
    writeFileSync(file, text.replace(from, to));
    this.touch(file);
  }

  /** Copies one file of the template back and moves its time. */
  public restore(relative: string): void {
    const file = this.sourceFile(relative);
    cpSync(path.join(this.config.template, "src", relative), file);
    this.touch(file);
  }

  public remove(relative: string): void {
    rmSync(this.sourceFile(relative), { force: true });
  }

  public outputRoot(mode: Mode): string {
    return path.join(this.root, "out", mode, "tree");
  }

  public descriptor(mode: WarmMode): string {
    return path.join(this.root, "session", mode, "request.json");
  }

  public reportFile(mode: WarmMode): string {
    return `${this.descriptor(mode)}.after-typing.json`;
  }

  /** The program arguments that are the same for every mode. */
  private program(): string[] {
    return [
      "-cp",
      path.join(repoRoot, "src"),
      "-lib",
      "helder.set",
      "-D",
      `genes-ts=${genesVersion}`,
      "--macro",
      'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
      ...(this.macroOrder === "reactFirst"
        ? ["--macro", "genes.react.ReactDiagnosticsMacro.install()"]
        : []),
      "--macro",
      "genes.Generator.use()",
      ...(this.macroOrder === "double"
        ? ["--macro", "genes.Generator.use()"]
        : []),
      "--macro",
      "genes.js.Async.enable()",
      "--macro",
      "genes.react.InlineMarkup.enable()",
      ...(this.macroOrder === "reactFirst"
        ? []
        : ["--macro", "genes.react.ReactDiagnosticsMacro.install()"]),
      "--macro",
      "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
      "-cp",
      path.join(this.workspace, "src"),
      "--main",
      this.config.main,
      ...this.modules,
      "-D",
      "js-es=6",
      "-D",
      "no-deprecation-warnings",
      "-D",
      "genes.ts",
      "-dce",
      "full",
      "-debug",
      ...this.defines.flatMap((define) => ["-D", define])
    ];
  }

  /**
   * Writes the request descriptor of one warm mode, as a development session
   * does before each request. The digest names the program arguments.
   */
  private writeDescriptor(mode: WarmMode): void {
    const file = this.descriptor(mode);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({
      format: 1,
      programDigest: createHash("sha256")
        .update(JSON.stringify([this.program(), this.programSalt]))
        .digest("hex"),
      kind: "full",
      afterTyping: mode
    })}\n`);
  }

  public arguments(mode: Mode): string[] {
    const output = ["-js", path.join(this.outputRoot(mode), "index.ts")];
    if (mode === "cold" || mode === "plain") {
      return [...this.program(), ...output];
    }
    this.writeDescriptor(mode);
    return [
      ...this.program(),
      ...output,
      "-D",
      `genes.dev_incremental=${this.descriptor(mode)}`
    ];
  }

  public fixtureModules(modules: ReadonlyArray<string>): ReadonlyArray<string> {
    return modules
      .filter((module) => module.startsWith(`${this.config.pack}.`))
      .map((module) => module.slice(this.config.pack.length + 1))
      .sort();
  }
}

function resultText(result: ProcessResult): string {
  return `${result.stdout}${result.stderr}`;
}

/**
 * Requires that a failing request reports the texts of the step in order,
 * and does not report the text that the step excludes.
 */
function assertDiagnostics(where: string, step: Step, result: ProcessResult): void {
  const text = resultText(result);
  let from = 0;
  for (const expected of step.fails ?? []) {
    const at = text.indexOf(expected, from);
    ok(at !== -1,
      `${where}: the diagnostics do not contain ${JSON.stringify(expected)} `
      + `after the earlier expected texts\n${text}`);
    from = at + expected.length;
  }
  if (step.failsWithout !== undefined) {
    ok(!text.includes(step.failsWithout),
      `${where}: the diagnostics contain ${JSON.stringify(step.failsWithout)}`
      + `\n${text}`);
  }
}

/** Returns the report of the React audit pass, or fails. */
function auditOf(report: AfterTypingReport, where: string): PassReport {
  const pass = report.passes.find((entry) => entry.pass === "reactAudit");
  ok(pass !== undefined, `${where}: the report has no React audit pass`);
  return pass;
}

/** Checks one warm report against the mode and the step. */
function assertReport(
  lane: Lane,
  mode: Exclude<WarmMode, "plain">,
  step: Step,
  report: AfterTypingReport,
  settledNow: boolean
): void {
  const where = `${lane.config.name} ${mode} "${step.id}"`;
  strictEqual(report.mode, mode, `${where}: ${report.reason ?? "wrong mode"}`);
  strictEqual(report.passesComplete, true, `${where}: the passes did not end`);
  const audit = auditOf(report, where);
  strictEqual(audit.kept + audit.rejected, report.classes,
    `${where}: not every class got a keep decision`);
  deepStrictEqual(audit.compareFailures, [],
    `${where}: a class with a kept record failed a new audit`);
  strictEqual(audit.sameObjectTested, 0,
    `${where}: a plain record claims a same-object test`);
  if (mode === "reuse") {
    strictEqual(audit.skipped, audit.kept,
      `${where}: reuse did not skip exactly the kept classes`);
    strictEqual(audit.worked, audit.rejected,
      `${where}: reuse did not audit exactly the rejected classes`);
  } else {
    strictEqual(audit.skipped, 0, `${where}: ${mode} skipped an audit`);
    strictEqual(audit.worked, report.classes,
      `${where}: ${mode} did not audit every class`);
  }
  strictEqual(audit.written, audit.worked,
    `${where}: a clean audit wrote no record, or a record had no audit`);
  if (step.restarts === true) {
    strictEqual(report.session, "first",
      `${where}: the macro state survived other -D values. Then the session `
      + "key is the only guard for the kept records; check that it dropped them");
    strictEqual(audit.kept, 0, `${where}: a record survived other -D values`);
  }
  if (step.dropsSession === true) {
    strictEqual(report.session, "changed",
      `${where}: another program digest did not change the session key`);
    ok(report.droppedRecords > 0, `${where}: no record was dropped`);
    strictEqual(audit.kept, 0,
      `${where}: a record was kept across another session key`);
  }
  if (settledNow) {
    strictEqual(report.typedAgain, 0, `${where}: Haxe typed a module again`);
    strictEqual(report.foreignStamps, 0, `${where}: a stamp names another declaration`);
    ok(audit.kept > 0, `${where}: the gate would pass empty: no record was kept`);
    strictEqual(audit.kept, report.classes, `${where}: not every class record was kept`);
    if (mode === "reuse") {
      ok(audit.skipped > 0, `${where}: the gate would pass empty: no audit was skipped`);
    }
  }
  if (step.typesAgain !== undefined) {
    deepStrictEqual(
      lane.fixtureModules(report.typedAgainModules),
      [...step.typesAgain].sort(),
      `${where}: Haxe typed other fixture modules again than expected`
    );
    ok(audit.kept > 0, `${where}: an edit of some modules kept no record`);
  }
  for (const [key, reason] of step.rejects ?? []) {
    ok(
      audit.rejectExamples.some((entry) =>
        entry.key === key && entry.reason === reason),
      `${where}: the keep rule did not reject ${key} for ${reason}: `
      + JSON.stringify(audit.rejectExamples)
    );
  }
}

/** Runs every step of one fixture in the cold oracle and on the warm servers. */
async function runLane(
  config: LaneConfig,
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<void> {
  const lane = new Lane(config);
  const servers = new Map<WarmMode, OwnedHaxeCompilerServer>();
  for (const mode of warmModes) {
    const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
    server.installSignalCleanup();
    servers.set(mode, server);
  }
  try {
    let coldTree: ReadonlyArray<TreeEntry> = [];
    let coldDiagnostics = "";
    for (const [index, step] of config.steps.entries()) {
      step.apply?.(lane);
      // A step with no edit has the cold result of the step before it.
      if (index === 0 || step.apply !== undefined) {
        coldCount += 1;
        const cold = await runBoundedProcess(
          compiler.binary,
          lane.arguments("cold"),
          {
            cwd: lane.workspace,
            timeoutMs,
            label: `after-typing ${config.name} cold "${step.id}"`,
            reportProgress: true
          }
        );
        if (step.fails === undefined) {
          ok(cold.code === 0, `Cold "${step.id}" failed\n${resultText(cold)}`);
          coldDiagnostics = "";
        } else {
          ok(cold.code !== 0, `Cold "${step.id}" did not fail`);
          assertDiagnostics(`${config.name} cold "${step.id}"`, step, cold);
          coldDiagnostics = cold.stderr;
        }
        coldTree = hashTree(lane.outputRoot("cold"));
        ok(coldTree.length > 0, `Cold "${step.id}" published no file`);
      }
      for (const mode of warmModes) {
        const server = servers.get(mode);
        ok(server !== undefined);
        const where = `${config.name} ${mode} "${step.id}"`;
        const attempts = step.settled === true ? 4 : 1;
        let settledNow = false;
        for (let attempt = 1; attempt <= attempts && !settledNow; attempt += 1) {
          if (mode !== "plain") rmSync(lane.reportFile(mode), { force: true });
          requestCount += 1;
          const warm: ProcessResult = await server.compile(
            lane.arguments(mode),
            `after-typing ${where}${attempts > 1 ? `, ${attempt}` : ""}`,
            timeoutMs,
            lane.workspace
          );
          ok(!resultText(warm).includes("GENES-INCREMENTAL-AUDIT-001"),
            `${where}: compare mode found a wrong record\n${resultText(warm)}`);
          if (step.fails === undefined) {
            ok(warm.code === 0,
              `${where} failed\n${resultText(warm)}\nserver:\n${server.logs}`);
          } else {
            ok(warm.code !== 0, `${where} did not fail`);
            strictEqual(warm.stderr, coldDiagnostics,
              `${where}: the diagnostics differ from the cold build`);
          }
          deepStrictEqual(hashTree(lane.outputRoot(mode)), coldTree,
            `${where}: the warm tree differs from the cold tree`);
          if (mode === "plain") {
            settledNow = true;
            continue;
          }
          ok(existsSync(lane.reportFile(mode)), `${where} wrote no report`);
          const report = JSON.parse(
            readFileSync(lane.reportFile(mode), "utf8")
          ) as AfterTypingReport;
          if (step.off !== undefined) {
            strictEqual(report.mode, "off",
              `${where}: the request stayed on the incremental path`);
            ok(report.reason !== null && report.reason.includes(step.off),
              `${where}: off for another reason: ${report.reason ?? ""}`);
            strictEqual(report.typedAgain + report.arrivedStamped
              + report.foreignStamps, 0,
              `${where}: a request that left the incremental path read stamps`);
            deepStrictEqual(report.passes, [],
              `${where}: a request that left the incremental path used records`);
            offRequests += 1;
            settledNow = true;
            continue;
          }
          if (step.fails !== undefined) {
            // A request that stops with a diagnostic leaves the report of
            // the last step that it reached. It must not be a wrong record.
            strictEqual(report.mode, mode, `${where}: ${report.reason ?? ""}`);
            for (const pass of report.passes) {
              deepStrictEqual(pass.compareFailures, [], `${where}: wrong record`);
            }
            settledNow = true;
            continue;
          }
          settledNow = step.settled !== true
            || (report.typedAgain === 0 && report.foreignStamps === 0);
          if (settledNow || attempt === attempts) {
            assertReport(lane, mode, step, report, step.settled === true);
            measurements.push({
              lane: config.name,
              mode,
              step: step.id,
              oneModuleEdit: step.typesAgain?.length === 1,
              report
            });
          }
        }
      }
    }
  } finally {
    for (const server of servers.values()) await server.stop();
  }
}

const hookCall = "    state.set(dog);";
const conditionalHook = "    if (dog.bark)\n      useStateLazy(() -> makeCat());\n"
  + hookCall;

/**
 * Project A of `yarn test:compiler-server`, with its edit list (edit of two
 * modules, restore, a module that joins and leaves the program) and one
 * React audit error.
 */
const projectA: LaneConfig = {
  name: "project-a",
  template: path.join(fixtureRoot, "templates/project-a"),
  main: "servercase.Main",
  pack: "servercase",
  modules: ["servercase.UnimportedLeaf"],
  steps: [
    { id: "first request" },
    { id: "no edit", settled: true },
    { id: "no edit again", settled: true },
    {
      id: "edit of a module that nothing imports",
      apply: (lane) => lane.edit("servercase/UnimportedLeaf.hx", "leaf-v1", "leaf-v2"),
      typesAgain: ["UnimportedLeaf"]
    },
    { id: "no edit after the leaf edit", settled: true },
    {
      id: "edit of Main and Extra",
      apply: (lane) => {
        lane.edit("servercase/Main.hx", "server-project-a-v1", "server-project-a-v2");
        lane.edit("servercase/Main.hx", "serverTransformA", "serverTransformZ");
        lane.edit("servercase/Main.hx", 'REVISION = "a1"', 'REVISION = "a2"');
        lane.edit("servercase/Extra.hx", "extra-a-v1", "extra-a-v2");
      },
      typesAgain: ["Extra", "Main"]
    },
    { id: "no edit after the edit of Main and Extra", settled: true },
    {
      id: "a Hook call inside a condition (audit error)",
      apply: (lane) => lane.edit("servercase/Main.hx", hookCall, conditionalHook),
      fails: ["GTS-REACT-HOOK-002"]
    },
    { id: "no edit after the audit error", fails: ["GTS-REACT-HOOK-002"] },
    {
      id: "audit error repaired",
      apply: (lane) => lane.edit("servercase/Main.hx", conditionalHook, hookCall),
      typesAgain: ["Main"]
    },
    { id: "no edit after the repair", settled: true },
    {
      id: "another program digest",
      apply: (lane) => {
        lane.programSalt += 1;
      },
      dropsSession: true
    },
    { id: "no edit after the session key change", settled: true },
    {
      id: "project restored",
      apply: (lane) => {
        lane.restore("servercase/Main.hx");
        lane.restore("servercase/Extra.hx");
        lane.restore("servercase/UnimportedLeaf.hx");
      }
    },
    { id: "no edit after the restore", settled: true },
    // Haxe prints the metadata of an `@:rtti` class into `__rtti`, so a
    // stamp would reach output. The request must leave the incremental path.
    {
      id: "an @:rtti class joins the program (-D server_rtti)",
      apply: (lane) => {
        lane.defines = ["server_rtti"];
      },
      off: "@:rtti"
    },
    { id: "no edit with the @:rtti class", off: "@:rtti" },
    {
      id: "a module joins the program (-D server_removed)",
      apply: (lane) => {
        lane.defines = ["server_removed"];
      },
      restarts: true
    },
    { id: "no edit with the joined module", settled: true },
    {
      id: "the joined module is deleted",
      apply: (lane) => {
        lane.remove("servercase/Removed.hx");
        lane.defines = [];
      },
      restarts: true
    },
    { id: "no edit after the delete", settled: true }
  ]
};

const genericOwner = "class:kepttypes.GenericOwner.GenericOwner";
const clone = "class:kepttypes.Clone.Clone";

/**
 * The fixture of `yarn test:compiler-server:kept-types`, with its edit list:
 * a leaf, a dependency, a file and a class that a build macro reads, a type
 * error, and the two cases that an equal stamp value alone keeps wrongly.
 */
const keptTypes: LaneConfig = {
  name: "kept-types",
  template: path.join(fixtureRoot, "templates/kept-types"),
  main: "kepttypes.Main",
  pack: "kepttypes",
  modules: [
    "kepttypes.Lone",
    "kepttypes.MacroBuilt",
    "kepttypes.GenericUser",
    "kepttypes.Cloner",
    "kepttypes.RetypeUser"
  ],
  steps: [
    { id: "first request" },
    { id: "no edit", settled: true },
    {
      id: "E1: first use of a @:generic method",
      apply: (lane) => lane.edit(
        "kepttypes/GenericUser.hx",
        "return GenericOwner.plain(); // generic-user-body",
        "return GenericOwner.plain() + GenericOwner.make(2)[0]; // generic-user-body"
      ),
      typesAgain: ["GenericUser"],
      rejects: [[genericOwner, "membersChanged"]]
    },
    { id: "no edit after E1", settled: true },
    {
      id: "E2: a macro-defined type with a copied stamp",
      apply: (lane) => lane.edit(
        "kepttypes/Cloner.hx",
        "return 7; // cloner-body",
        "return 8; // cloner-body"
      ),
      typesAgain: ["Clone", "Cloner"],
      rejects: [[clone, "stampNamesOtherDeclaration"]]
    },
    { id: "no edit after E2", settled: true },
    {
      id: "edit of a module that nothing imports (Lone)",
      apply: (lane) => lane.edit("kepttypes/Lone.hx", '"lone-v1"', '"lone-v2"'),
      typesAgain: ["Lone"]
    },
    { id: "no edit after the edit of Lone", settled: true },
    {
      id: "a dependency edited (Dep, read by Dependent)",
      apply: (lane) => lane.edit(
        "kepttypes/Dep.hx",
        "return 1; // dep-value",
        'return "one"; // dep-value'
      ),
      typesAgain: ["Dep", "Dependent", "Main"]
    },
    {
      id: "a file that a build macro reads (shape.txt)",
      apply: (lane) => lane.edit("kepttypes/shape.txt", "number", "text"),
      typesAgain: ["MacroBuilt"]
    },
    {
      id: "a class that a build macro looks up (MacroDep)",
      apply: (lane) => lane.edit(
        "kepttypes/MacroDep.hx",
        "seed: Int = 3;",
        'seed: String = "three";'
      ),
      typesAgain: ["MacroBuilt", "MacroDep"]
    },
    { id: "no edit after the macro edits", settled: true },
    // The module list is a part of the argument list, so the session writes
    // another program digest and every record is dropped, in both directions.
    {
      id: "modules leave the program",
      apply: (lane) => {
        lane.modules = lane.modules.filter((module) =>
          module !== "kepttypes.Lone" && module !== "kepttypes.MacroBuilt");
      },
      dropsSession: true
    },
    {
      id: "modules return",
      apply: (lane) => {
        lane.modules = [...keptTypes.modules];
      },
      dropsSession: true
    },
    { id: "no edit after the modules return", settled: true },
    {
      id: "type error in Lone",
      apply: (lane) => lane.edit("kepttypes/Lone.hx", '"lone-v2"', "(1 : Int)"),
      fails: ["Int should be String"]
    },
    {
      id: "Lone repaired",
      apply: (lane) => lane.edit("kepttypes/Lone.hx", "(1 : Int)", '"lone-v3"'),
      typesAgain: ["Lone"]
    },
    { id: "last request, no edit", settled: true }
  ]
};

const goodDirective = '@:genes.moduleDirective("server-project-a-v1")\nclass Main {';
const bareDirective = "@:genes.moduleDirective\nclass Main {";
const bareDirectiveWithLibrary =
  '@:genes.moduleDirective\n@:genes.library("x")\nclass Main {';
const directiveError = "GENES-MODULE-DIRECTIVE-ARITY-001";
const auditError = "GTS-REACT-HOOK-002";

/**
 * Diagnostics of more than one Genes callback in one build, in project A.
 *
 * `Context.error` ends the callback that calls it; Haxe still runs the next
 * callback. The passes, the module-directive capture and the module
 * inventory are separate callbacks, so a recoverable error of one does not
 * hide an error of the next. A fatal error (the React audit) stops the
 * build. Every row compares the warm diagnostics with the cold build, also
 * without the define.
 */
const diagnosticOrder: LaneConfig = {
  name: "diagnostic-order",
  template: path.join(fixtureRoot, "templates/project-a"),
  main: "servercase.Main",
  pack: "servercase",
  modules: ["servercase.UnimportedLeaf"],
  steps: [
    { id: "first request" },
    {
      id: "two recoverable errors: a pass, then the directive capture",
      apply: (lane) => {
        lane.edit("servercase/Main.hx", goodDirective, bareDirectiveWithLibrary);
        lane.defines = ["genes.library"];
      },
      fails: ["@:genes.library does not accept arguments", directiveError]
    },
    {
      id: "Generator.use() twice: the directive error, then the audit error",
      apply: (lane) => {
        lane.edit("servercase/Main.hx", bareDirectiveWithLibrary, bareDirective);
        lane.edit("servercase/Main.hx", hookCall, conditionalHook);
        lane.defines = [];
        lane.macroOrder = "double";
      },
      fails: [directiveError, auditError]
    },
    {
      id: "React audit installed first: the directive error, then the audit error",
      apply: (lane) => {
        lane.macroOrder = "reactFirst";
      },
      fails: [directiveError, auditError]
    },
    {
      id: "usual order: the fatal audit error stops the build first",
      apply: (lane) => {
        lane.macroOrder = "default";
      },
      fails: [auditError],
      failsWithout: directiveError
    },
    {
      id: "repaired",
      apply: (lane) => lane.restore("servercase/Main.hx")
    },
    { id: "no edit after the repair", settled: true }
  ]
};

/**
 * Runs `KeepRuleProbe` in one cold compile: each condition of the keep rule
 * on its own, with made-up inputs.
 */
async function assertKeepRuleProbe(
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<string> {
  const lane = new Lane({ ...keptTypes, name: "keep-rule-probe", steps: [] });
  coldCount += 1;
  const result = await runBoundedProcess(
    compiler.binary,
    [
      ...lane.arguments("cold"),
      "-cp",
      path.join(fixtureRoot, "probes"),
      "--macro",
      "KeepRuleProbe.check()",
      "--no-output"
    ],
    {
      cwd: lane.workspace,
      timeoutMs,
      label: "after-typing keep-rule probe",
      reportProgress: true
    }
  );
  ok(result.code === 0, `KeepRuleProbe failed\n${resultText(result)}`);
  const line = /keep-rule-probe:ok \(\d+ cases\)/.exec(result.stdout);
  ok(line !== null, `KeepRuleProbe printed no result\n${resultText(result)}`);
  return line[0];
}

/**
 * Requires that a report file that cannot be written gives one warning and
 * the same tree as a build without the define, in the off mode (the folder
 * of the descriptor does not exist) and in the on mode (a folder has the
 * name of the report file).
 */
async function assertReportNeverFailsBuild(
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<void> {
  const lane = new Lane({ ...keptTypes, name: "report-path", steps: [] });
  const compile = async (
    label: string,
    extra: ReadonlyArray<string>
  ): Promise<ProcessResult> => {
    coldCount += 1;
    return await runBoundedProcess(
      compiler.binary,
      [...lane.arguments("cold"), ...extra],
      {
        cwd: lane.workspace,
        timeoutMs,
        label: `after-typing report path, ${label}`,
        reportProgress: true
      }
    );
  };
  const plain = await compile("no define", []);
  ok(plain.code === 0, `report path: the plain build failed\n${resultText(plain)}`);
  const tree = hashTree(lane.outputRoot("cold"));
  const missing = path.join(lane.root, "no-such-folder", "request.json");
  const descriptor = lane.descriptor("measure");
  mkdirSync(path.dirname(descriptor), { recursive: true });
  writeFileSync(descriptor, `${JSON.stringify({
    format: 1,
    programDigest: "report-path",
    kind: "full"
  })}\n`);
  mkdirSync(lane.reportFile("measure"));
  for (const [label, file] of [["off", missing], ["on", descriptor]] as const) {
    const result = await compile(label, ["-D", `genes.dev_incremental=${file}`]);
    ok(result.code === 0,
      `report path, ${label}: a report that cannot be written failed the `
      + `build\n${resultText(result)}`);
    ok(resultText(result).includes("GENES-INCREMENTAL-REPORT-001"),
      `report path, ${label}: no warning for the report\n${resultText(result)}`);
    deepStrictEqual(hashTree(lane.outputRoot("cold")), tree,
      `report path, ${label}: the tree differs from the build without the define`);
  }
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Prints the numbers of the gate: counts are exact, times are diagnostic. */
function printSummary(): void {
  for (const lane of [projectA.name, keptTypes.name]) {
    for (const mode of warmModes) {
      if (mode === "plain") continue;
      const rows = measurements.filter((row) =>
        row.lane === lane && row.mode === mode);
      const audits = rows.map((row) => auditOf(row.report, `${lane} ${mode}`));
      const reasons = {
        noRecord: sum(audits.map((audit) => audit.rejectedByReason.noRecord)),
        typedAgain: sum(audits.map((audit) => audit.rejectedByReason.typedAgain)),
        stampNamesOtherDeclaration: sum(audits.map((audit) =>
          audit.rejectedByReason.stampNamesOtherDeclaration)),
        stampDiffers: sum(audits.map((audit) => audit.rejectedByReason.stampDiffers)),
        membersChanged: sum(audits.map((audit) =>
          audit.rejectedByReason.membersChanged))
      };
      process.stdout.write(
        `after-typing | ${lane} | ${mode} | ${rows.length} successful requests | `
        + `kept ${sum(audits.map((audit) => audit.kept))} | `
        + `rejected ${sum(audits.map((audit) => audit.rejected))} `
        + `${JSON.stringify(reasons)} | `
        + `skipped audits ${sum(audits.map((audit) => audit.skipped))} | `
        + `audited ${sum(audits.map((audit) => audit.worked))} | `
        + `compare failures ${sum(audits.map((audit) =>
          audit.compareFailures.length))}\n`
      );
    }
    // The share that stays kept after an edit of one module.
    for (const row of measurements) {
      if (row.lane !== lane || row.mode !== "reuse" || !row.oneModuleEdit) continue;
      const audit = auditOf(row.report, `${lane} reuse`);
      process.stdout.write(
        `after-typing | ${lane} | reuse | one-module edit "${row.step}" | `
        + `${row.report.arrivedStamped} of ${row.report.declarations} `
        + `declarations arrived with their stamp | kept ${audit.kept} of `
        + `${row.report.classes} class records `
        + `(${round(100 * audit.kept / row.report.classes)}%) | audited `
        + `${audit.worked}\n`
      );
    }
    // The cost of the keep decision beside the cost of the passes, for the
    // last request with no edit of each mode.
    for (const mode of warmModes) {
      if (mode === "plain") continue;
      const rows = measurements.filter((row) =>
        row.lane === lane && row.mode === mode
        && row.report.typedAgain === 0);
      const row = rows[rows.length - 1];
      if (row === undefined) continue;
      const audit = auditOf(row.report, `${lane} ${mode}`);
      const decision = row.report.stampMs + row.report.sessionKeyMs
        + row.report.memberListMs + audit.decisionMs;
      process.stdout.write(
        `after-typing | ${lane} | ${mode} | no-edit request "${row.step}" | `
        + `${row.report.declarations} declarations, ${row.report.classes} `
        + `classes | kept ${audit.kept} | skipped ${audit.skipped} | `
        + `stamps ${row.report.stampMs} ms + session key `
        + `${row.report.sessionKeyMs} ms + member lists `
        + `${row.report.memberListMs} ms + decisions ${audit.decisionMs} ms = `
        + `${round(decision)} ms | audit ${audit.workMs} ms | walk of all `
        + `passes ${row.report.walkMs} ms\n`
      );
    }
  }
}

async function main(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  const compiler = selectedHaxeCompiler(repoRoot);
  for (const config of [projectA, keptTypes, diagnosticOrder]) {
    await runLane(config, compiler);
  }
  const keepRule = await assertKeepRuleProbe(compiler);
  await assertReportNeverFailsBuild(compiler);
  printSummary();
  process.stdout.write(
    `after-typing | ${diagnosticOrder.name} | `
    + `${diagnosticOrder.steps.filter((step) => step.fails !== undefined).length} `
    + `failing steps, each in cold and in ${warmModes.join(", ")}: the `
    + "diagnostics of every Genes callback, in Haxe's callback order, equal "
    + "cold\n"
  );
  process.stdout.write(
    `after-typing | checks | ${keepRule} | @:rtti requests that left the `
    + `incremental path: ${offRequests} | a report that cannot be written `
    + "gives a warning in the off and the on mode, never a failed build\n"
  );
  const load = loadavg()[0] ?? 0;
  process.stdout.write(
    `compiler-server-after-typing:ok (Haxe ${compiler.version}; `
    + `${coldCount} cold builds, ${requestCount} warm requests; `
    + `${warmModes.join(", ")}; load ${round(load)}, times are `
    + `${load <= 2 ? "from a quiet host" : "diagnostic only"})\n`
  );
}

await main();
