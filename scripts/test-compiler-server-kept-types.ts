import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler,
  type ProcessResult
} from "./compiler-server-lifecycle.js";

/**
 * Proves, on one Haxe compilation server, when typed values that a macro
 * keeps from an earlier request are still correct in a later request.
 *
 * Why: the Genes passes that run after typing read every declaration on
 * every request. To read only the modules that Haxe typed again, they must
 * keep `Type` values, typed bodies and local variable ids between requests.
 * That is correct only when a kept value stays correct while Haxe does not
 * type its declaration again (assumption H2 of
 * `docs/INCREMENTAL_AFTER_TYPING.md`), and when the test for "typed again"
 * never keeps a value for another declaration object.
 *
 * What: this script sends a scripted list of requests through one owned
 * server and reads the report that `tests/compiler-server/probes/
 * KeptTypeValuesProbe.hx` writes for each request. It covers the cases where
 * the kept values must hold (no edit; an edit of another module; a module
 * that leaves the program and returns; a request that failed) and the cases
 * where they must be dropped (the module itself, a module that it reads, a
 * file or a class that its build macro reads, other `-D` values, a failed
 * request that typed the module). `RetypedModulesProbe` runs beside it as
 * the independent list of the modules that Haxe typed again.
 *
 * It runs two lanes. `haxe-js` uses Haxe's own JavaScript generator and no
 * Genes code, so it shows the behavior of Haxe alone. `genes-ts` adds the
 * Genes generator, its after-typing passes and the TypeScript profile, so
 * the same facts are shown in the pipeline that would reuse the values.
 *
 * Limit: this is evidence for this fixture on the selected Haxe version. It
 * implements no reuse in Genes, and it does not compare generated files.
 */
const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "../..");
const fixtureRoot = path.join(repoRoot, "tests/compiler-server");
const template = path.join(fixtureRoot, "templates/kept-types");
const tempRoot = path.join(fixtureRoot, ".tmp/kept-types");
const fixturePackage = "kepttypes";
const requestTimeoutMs = 180_000;
const genesVersion = (
  JSON.parse(
    readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")
  ) as { readonly version: string }
).version;

type Lane = "haxe-js" | "genes-ts";
type Stage = "afterTyping" | "generate" | "afterGenerate";

/** One fixture declaration of the report that the probe lists by name. */
type Detail = {
  readonly module?: string;
  readonly state?: "typedAgain" | "kept" | "stampMismatch";
  readonly hadBucket?: boolean;
  readonly keptBucketIsSameObject?: boolean;
  readonly oldBucketIsSameObject?: boolean;
  readonly staleSlots?: ReadonlyArray<string>;
  readonly oldLocalIds?: number;
  readonly oldLocalIdsStillUsed?: number;
};

/** The JSON that `KeptTypeValuesProbe` writes for one request. */
type Report = {
  readonly request: number;
  readonly nonce: string;
  readonly stages: ReadonlyArray<Stage>;
  readonly declarations: number;
  readonly first: number;
  readonly typedAgain: number;
  readonly kept: number;
  readonly stampMismatch: number;
  readonly typedAgainModules: ReadonlyArray<string>;
  readonly stampMismatchModules: ReadonlyArray<string>;
  readonly keptButOtherObject: ReadonlyArray<string>;
  readonly replacedButSameObject: ReadonlyArray<string>;
  readonly replacedLocalIds: number;
  readonly replacedLocalIdsStillUsed: number;
  readonly duplicateLocalIds: number;
  readonly keptLocalIds: number;
  readonly highestLocalIdBefore: number;
  readonly lowestNewLocalId: number | null;
  readonly definesDigest: string;
  readonly details: Readonly<Record<string, Detail>>;
  readonly [finding: string]: unknown;
};

type RequestOptions = {
  readonly label: string;
  readonly failAt?: Stage;
  readonly defines?: ReadonlyArray<string>;
  readonly initMacros?: ReadonlyArray<string>;
  readonly withoutCommandLineModules?: boolean;
  readonly withoutProbes?: boolean;
};

type Outcome = {
  readonly result: ProcessResult;
  readonly report: Report | null;
  readonly retyped: ReadonlyArray<string> | null;
};

type Row = {
  readonly lane: Lane;
  readonly scenario: string;
  readonly expected: string;
  readonly evidence: string;
};

const rows: Array<Row> = [];
let requestCount = 0;

function workspace(lane: Lane): string {
  return path.join(tempRoot, lane, "workspace");
}

function sourceFile(lane: Lane, name: string): string {
  return path.join(workspace(lane), "src", fixturePackage, name);
}

function keyOfClass(name: string): string {
  return `class ${fixturePackage}.${name}#${name}`;
}

function fixtureModules(modules: ReadonlyArray<string>): ReadonlyArray<string> {
  return modules
    .filter((module) => module.startsWith(`${fixturePackage}.`))
    .map((module) => module.slice(fixturePackage.length + 1))
    .sort();
}

function numberOf(report: Report, finding: string): number {
  const value = report[finding];
  return typeof value === "number" ? value : 0;
}

function examplesOf(report: Report, finding: string): string {
  const [head, ...rest] = finding.split(".");
  const name = [`${head}Examples`, ...rest].join(".");
  return JSON.stringify(
    [report[name], report[`${name}.other`]].filter((value) => value != null),
    null,
    1
  ).slice(0, 4_000);
}

/**
 * The findings that can differ between two requests although every kept
 * value is correct.
 *
 * Haxe changes each field body after the after-typing callbacks: it lowers
 * loops, renames locals, removes inlined objects. A declaration that Haxe
 * keeps comes back with the changed body. So a new read after typing in a
 * later request gives other text and other local ids than the first read
 * did, and a kept body prints the new names of its variables. The values in
 * the bucket did not change. The other allowed finding is a type that was an
 * open monomorph when the bucket was made and that Haxe closed later in the
 * same request, also after `onGenerate`. No finding is allowed after
 * generation, which is where Genes reads the kept values.
 */
function isAllowedFinding(finding: string): boolean {
  const [family, stage, kind] = finding.split(".");
  if (family !== "keptChanged" || kind === undefined) return false;
  if (stage !== "afterTyping" && stage !== "generate") return false;
  if (kind.endsWith("ClosedLater")) return true;
  return stage === "afterTyping"
    && ["bodies", "freshLocalIds", "freshLocals"].includes(kind);
}

/**
 * Checks what must hold in every request that reached the after-typing
 * stage, also in a request that fails afterwards.
 */
function assertKeptValuesAreCorrect(lane: Lane, label: string, report: Report): void {
  const where = `${lane} ${label}`;
  deepStrictEqual(
    report.keptButOtherObject,
    [],
    `${where}: a bucket counted as kept, but it holds another declaration `
    + "object than the one Haxe gives now. The stamp comparison is not a "
    + "sufficient test for \"typed again\"."
  );
  strictEqual(
    report.duplicateLocalIds,
    0,
    `${where}: one local variable id belongs to two declarations\n`
    + examplesOf(report, "duplicateLocalId")
  );
  for (const [finding, value] of Object.entries(report)) {
    if (typeof value !== "number" || value === 0) continue;
    const changed = finding.startsWith("keptChanged.");
    const differs = finding.startsWith("keptDiffersFromFresh.");
    if (!changed && !differs) continue;
    ok(
      isAllowedFinding(finding),
      `${where}: ${value} kept value(s) are no longer correct (${finding}). `
      + "H2 does not hold for them.\n" + examplesOf(report, finding)
    );
  }
}

/** One lane: its own project copy, its own `-D` value, its own requests. */
class LaneRun {
  private clock = 0;

  public constructor(
    private readonly server: OwnedHaxeCompilerServer,
    private readonly lane: Lane
  ) {
    rmSync(path.join(tempRoot, lane), { recursive: true, force: true });
    mkdirSync(workspace(lane), { recursive: true });
    cpSync(path.join(template, "src"), path.join(workspace(lane), "src"), {
      recursive: true
    });
  }

  /**
   * Replaces `before` with `after` in one fixture file and moves the file
   * time to a later whole second than every earlier edit. Haxe 4.3.7 keeps a
   * parsed file while its time is the same, at one-second precision, so two
   * edits in one second would look like one.
   */
  public edit(name: string, before: string, after: string): void {
    const file = sourceFile(this.lane, name);
    const source = readFileSync(file, "utf8");
    ok(source.includes(before), `${name} does not contain ${before}`);
    writeFileSync(file, source.replace(before, after));
    this.clock = Math.max(Math.floor(Date.now() / 1000), this.clock) + 2;
    utimesSync(file, this.clock, this.clock);
  }

  private arguments(options: RequestOptions, report: string, retyped: string): string[] {
    const output = path.join(tempRoot, this.lane, "out");
    const genes = this.lane === "genes-ts"
      ? [
          "-cp",
          path.join(repoRoot, "src"),
          "-lib",
          "helder.set",
          "-D",
          `genes-ts=${genesVersion}`,
          "--macro",
          'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
          "--macro",
          "genes.Generator.use()",
          "--macro",
          "genes.react.ReactDiagnosticsMacro.install()",
          "-D",
          "genes.ts",
          "-js",
          path.join(output, "index.ts")
        ]
      : ["-js", path.join(output, "index.js")];
    const probe = options.failAt === undefined
      ? `KeptTypeValuesProbe.install(${JSON.stringify(report)}, `
        + `${JSON.stringify(fixturePackage)})`
      : `KeptTypeValuesProbe.install(${JSON.stringify(report)}, `
        + `${JSON.stringify(fixturePackage)}, ${JSON.stringify(options.failAt)})`;
    return [
      ...genes,
      "-cp",
      path.join(workspace(this.lane), "src"),
      "--main",
      `${fixturePackage}.Main`,
      ...(options.withoutCommandLineModules === true
        ? []
        : [`${fixturePackage}.Lone`, `${fixturePackage}.MacroBuilt`]),
      "-D",
      "js-es=6",
      "-D",
      `kept_types_lane=${this.lane}`,
      "-dce",
      "full",
      ...(options.defines ?? []).flatMap((define) => ["-D", define]),
      ...(options.initMacros ?? []).flatMap((macro) => ["--macro", macro]),
      ...(options.withoutProbes === true
        ? []
        : [
            "-cp",
            path.join(fixtureRoot, "probes"),
            "--macro",
            probe,
            "--macro",
            `RetypedModulesProbe.install(${JSON.stringify(retyped)})`
          ])
    ];
  }

  /** Sends one request and reads what the two probes wrote. */
  public async request(options: RequestOptions): Promise<Outcome> {
    const report = path.join(tempRoot, this.lane, "report.json");
    const retyped = path.join(tempRoot, this.lane, "retyped.txt");
    rmSync(report, { force: true });
    rmSync(retyped, { force: true });
    requestCount += 1;
    const result = await this.server.compile(
      this.arguments(options, report, retyped),
      `kept-types ${this.lane} ${options.label}`,
      requestTimeoutMs,
      repoRoot
    );
    const parsed = existsSync(report)
      ? JSON.parse(readFileSync(report, "utf8")) as Report
      : null;
    if (parsed !== null) {
      assertKeptValuesAreCorrect(this.lane, options.label, parsed);
    }
    return {
      result,
      report: parsed,
      retyped: existsSync(retyped)
        ? readFileSync(retyped, "utf8").split("\n").filter(Boolean).sort()
        : null
    };
  }

  /**
   * Sends a request that must succeed, and requires that the stamp test and
   * `RetypedModulesProbe` name the same modules as typed again.
   */
  public async succeed(options: RequestOptions): Promise<Report> {
    const outcome = await this.request(options);
    const where = `${this.lane} ${options.label}`;
    ok(
      outcome.result.code === 0 && outcome.result.signal === null,
      `${where} failed\n${outcome.result.stdout}${outcome.result.stderr}`
      + `\nserver log:\n${this.server.logs}`
    );
    ok(outcome.report !== null, `${where} wrote no kept-values report`);
    deepStrictEqual(
      outcome.report.stages,
      ["afterTyping", "generate", "afterGenerate"],
      `${where} did not reach every stage`
    );
    ok(outcome.retyped !== null, `${where} wrote no retyped-modules report`);
    deepStrictEqual(
      [...outcome.report.typedAgainModules].sort(),
      outcome.retyped,
      `${where}: the stamp test and RetypedModulesProbe disagree about the `
      + "modules that Haxe typed again"
    );
    return outcome.report;
  }

  /** Sends a request that must fail with `message`. */
  public async fail(options: RequestOptions, message: string): Promise<Report> {
    const outcome = await this.request(options);
    const where = `${this.lane} ${options.label}`;
    const output = `${outcome.result.stdout}${outcome.result.stderr}`;
    ok(
      outcome.result.code !== 0 && outcome.result.signal === null,
      `${where} did not fail\n${output}`
    );
    ok(output.includes(message), `${where} failed for another reason\n${output}`);
    ok(outcome.report !== null, `${where} wrote no kept-values report`);
    return outcome.report;
  }

  public row(scenario: string, expected: Row["expected"], evidence: string): void {
    rows.push({ lane: this.lane, scenario, expected, evidence });
  }
}

/** Requires that every declaration is kept and that the checks were not empty. */
function assertAllKept(lane: Lane, label: string, report: Report): void {
  const where = `${lane} ${label}`;
  strictEqual(report.typedAgain, 0, `${where}: Haxe typed a module again`);
  strictEqual(report.stampMismatch, 0, `${where}: a stamp did not match`);
  strictEqual(report.kept, report.declarations, `${where}: not every bucket was kept`);
  ok(report.kept > 50, `${where}: the program is too small to prove anything`);
  for (const stage of ["afterTyping", "generate", "afterGenerate"] as const) {
    ok(
      numberOf(report, `keptComparedWithFresh.${stage}`) > 100,
      `${where}: too few kept types were compared with a new read (${stage})`
    );
    ok(
      numberOf(report, `keptLocalIdsFound.${stage}`) > 20,
      `${where}: too few kept local ids were found in the bodies (${stage})`
    );
  }
}

/** Requires the kept state for named fixture classes, with the same object. */
function assertKeptClasses(
  lane: Lane,
  label: string,
  report: Report,
  names: ReadonlyArray<string>
): void {
  for (const name of names) {
    const detail = report.details[keyOfClass(name)];
    ok(detail !== undefined, `${lane} ${label}: ${name} is not in the report`);
    strictEqual(detail.state, "kept", `${lane} ${label}: ${name} was not kept`);
    strictEqual(
      detail.keptBucketIsSameObject,
      true,
      `${lane} ${label}: the kept bucket of ${name} holds another object`
    );
  }
}

/**
 * Requires that Haxe typed exactly `modules` of the fixture again, that the
 * old bucket of each named class holds another object, and that none of its
 * local ids is used again.
 */
function assertTypedAgain(
  lane: Lane,
  label: string,
  report: Report,
  modules: ReadonlyArray<string>,
  classes: ReadonlyArray<string>
): void {
  const where = `${lane} ${label}`;
  deepStrictEqual(
    fixtureModules(report.typedAgainModules),
    [...modules].sort(),
    `${where}: Haxe typed other fixture modules again than expected`
  );
  deepStrictEqual(report.replacedButSameObject, [], `${where}: an old bucket `
    + "was replaced although it holds the declaration that Haxe gives now");
  strictEqual(report.replacedLocalIdsStillUsed, 0,
    `${where}: a new body uses a local id of the old bucket`);
  ok(
    report.lowestNewLocalId === null
    || report.lowestNewLocalId > report.highestLocalIdBefore,
    `${where}: a new local id (${report.lowestNewLocalId}) is not above every `
    + `earlier id (${report.highestLocalIdBefore})`
  );
  for (const name of classes) {
    const detail = report.details[keyOfClass(name)];
    ok(detail !== undefined, `${where}: ${name} is not in the report`);
    strictEqual(detail.state, "typedAgain", `${where}: ${name} was not typed again`);
    strictEqual(detail.hadBucket, true, `${where}: ${name} had no old bucket`);
    strictEqual(
      detail.oldBucketIsSameObject,
      false,
      `${where}: the old bucket of ${name} still holds the current object`
    );
  }
}

function staleSlots(report: Report, name: string): ReadonlyArray<string> {
  return report.details[keyOfClass(name)]?.staleSlots ?? [];
}

const untouched = ["Untouched", "Point", "Box"] as const;

function untouchedKey(name: string): string {
  return name === "Point"
    ? `class ${fixturePackage}.Untouched#Point`
    : keyOfClass(name);
}

function assertUntouchedKept(lane: Lane, label: string, report: Report): void {
  for (const name of untouched) {
    const detail = report.details[untouchedKey(name)];
    ok(detail !== undefined, `${lane} ${label}: ${name} is not in the report`);
    strictEqual(detail.state, "kept", `${lane} ${label}: ${name} was not kept`);
    strictEqual(detail.keptBucketIsSameObject, true,
      `${lane} ${label}: the kept bucket of ${name} holds another object`);
  }
}

async function runLane(server: OwnedHaxeCompilerServer, lane: Lane): Promise<void> {
  const run = new LaneRun(server, lane);

  // 1. First request, then no edit.
  const first = await run.succeed({ label: "first request" });
  strictEqual(first.kept, 0, `${lane}: the first request kept a bucket`);
  strictEqual(first.typedAgain, first.declarations,
    `${lane}: the first request did not type every declaration`);
  strictEqual(
    numberOf(first, "capturedLazyTypes"),
    0,
    `${lane}: a type read after typing holds a lazy type. A lazy type holds a `
    + "function of the request that made it; a kept one is not proved safe."
  );
  run.row("types when the bucket is made", "holds",
    `${numberOf(first, "capturedTypes")} types read after typing: no lazy `
    + `type; ${numberOf(first, "capturedOpenMonomorphs")} open monomorph(s); `
    + "a kept type reads what Haxe decides for them later in that request");
  let settled: Report | null = null;
  for (let attempt = 1; attempt <= 4 && settled === null; attempt += 1) {
    const repeat = await run.succeed({ label: `no edit, ${attempt}` });
    if (repeat.typedAgain === 0 && repeat.stampMismatch === 0) settled = repeat;
  }
  ok(settled !== null, `${lane} kept typing modules again with no edit`);
  assertAllKept(lane, "no edit", settled);
  assertUntouchedKept(lane, "no edit", settled);
  run.row("no edit", "holds",
    `${settled.kept} of ${settled.declarations} declarations kept; `
    + `${numberOf(settled, "keptComparedWithFresh.afterGenerate")} kept types `
    + "equal a new read after generation; "
    + `${numberOf(settled, "keptLocalIdsFound.generate")} of `
    + `${settled.keptLocalIds} kept local ids found in the bodies that `
    + "generation reads, the same ids as in the first request");

  // 2. An edit of a module that nothing imports.
  run.edit("Lone.hx", '"lone-v1"', '"lone-v2"');
  const lone = await run.succeed({ label: "edit of Lone" });
  assertTypedAgain(lane, "edit of Lone", lone, ["Lone"], ["Lone"]);
  assertUntouchedKept(lane, "edit of Lone", lone);
  assertKeptClasses(lane, "edit of Lone", lone, ["Dependent", "Dep", "Main", "MacroBuilt"]);
  strictEqual(lone.kept, lone.declarations - lone.typedAgain,
    `${lane}: the edit of Lone lost a bucket of another module`);
  run.row("edit of another module (Lone)", "holds",
    `${lone.kept} declarations kept, all the same objects; only Lone typed `
    + "again");
  run.row("the edited module itself (Lone)", "does not hold",
    "old bucket holds another object; "
    + `${lone.replacedLocalIds} old local id(s), none used again; new ids `
    + `start at ${lone.lowestNewLocalId}, above ${lone.highestLocalIdBefore}`);
  assertAllKept(lane, "after the edit of Lone",
    await run.succeed({ label: "no edit after the edit of Lone" }));

  // 3. An edit of a module that another module reads.
  run.edit("Dep.hx", "return 1; // dep-value", 'return "one"; // dep-value');
  const dependency = await run.succeed({ label: "edit of Dep" });
  assertTypedAgain(lane, "edit of Dep", dependency,
    ["Dep", "Dependent", "Main"], ["Dep", "Dependent", "Main"]);
  assertUntouchedKept(lane, "edit of Dep", dependency);
  ok(staleSlots(dependency, "Dependent").includes("static value"),
    `${lane}: the kept type of Dependent.value is not reported as stale: `
    + JSON.stringify(dependency.details[keyOfClass("Dependent")]));
  run.row("a dependency edited (Dep, read by Dependent)", "does not hold",
    "Haxe typed Dep, Dependent and Main again; the kept type of "
    + "Dependent.value says Int, the current type is String; stale places "
    + `of Dependent: ${staleSlots(dependency, "Dependent").join(", ")}`);

  // 4. A file that a build macro reads.
  run.edit("shape.txt", "number", "text");
  const shape = await run.succeed({ label: "edit of shape.txt" });
  assertTypedAgain(lane, "edit of shape.txt", shape, ["MacroBuilt"], ["MacroBuilt"]);
  assertUntouchedKept(lane, "edit of shape.txt", shape);
  ok(staleSlots(shape, "MacroBuilt").includes("static shape"),
    `${lane}: the kept type of MacroBuilt.shape is not reported as stale`);
  run.row("typed again because of a macro (file dependency)", "does not hold",
    "MacroBuilt.hx was not edited; Haxe typed MacroBuilt again; the kept "
    + "type of MacroBuilt.shape says Int, the current type is String");

  // 5. A class that a build macro looks up by name.
  run.edit("MacroDep.hx", "seed: Int = 3;", 'seed: String = "three";');
  const lookup = await run.succeed({ label: "edit of MacroDep" });
  assertTypedAgain(lane, "edit of MacroDep", lookup,
    ["MacroBuilt", "MacroDep"], ["MacroBuilt", "MacroDep"]);
  ok(staleSlots(lookup, "MacroBuilt").includes("static seedCopy"),
    `${lane}: the kept type of MacroBuilt.seedCopy is not reported as stale`);
  run.row("typed again because of a macro (lookup by name)", "does not hold",
    "Haxe typed MacroDep and MacroBuilt again; the kept type of "
    + "MacroBuilt.seedCopy says Int, the current type is String");
  assertAllKept(lane, "after the macro edits",
    await run.succeed({ label: "no edit after the macro edits" }));

  // 6. Modules leave the program and return.
  const without = await run.succeed({
    label: "without Lone and MacroBuilt",
    withoutCommandLineModules: true
  });
  strictEqual(without.typedAgain, 0, `${lane}: a smaller program typed a module again`);
  ok(without.declarations < settled.declarations,
    `${lane}: the command-line modules did not leave the program`);
  const returned = await run.succeed({ label: "Lone and MacroBuilt return" });
  assertAllKept(lane, "modules return", returned);
  assertKeptClasses(lane, "modules return", returned, ["Lone", "MacroBuilt"]);
  run.row("a module leaves the program and returns", "holds",
    "the buckets of Lone and MacroBuilt from before the absence hold the "
    + "same objects; Haxe typed nothing again");

  // 7. Other `-D` values, and back.
  const defined = await run.succeed({
    label: "another -D value",
    defines: ["kept_types_other=1"]
  });
  strictEqual(defined.kept, 0, `${lane}: a bucket was kept across other -D values`);
  strictEqual(defined.typedAgain, defined.declarations,
    `${lane}: other -D values did not type every declaration`);
  strictEqual(
    defined.request,
    1,
    `${lane}: the persistent macro state survived a change of the -D values. `
    + "That is new: until now each change gave the macro classes new static "
    + "values, so every bucket was lost. Check that a bucket of the other "
    + "Haxe cache is still rejected (stamp mismatch) before you rely on it."
  );
  const back = await run.request({ label: "the first -D values again" });
  ok(back.result.code === 0 && back.report !== null && back.retyped !== null,
    `${lane}: the return to the first -D values failed`);
  deepStrictEqual(back.retyped, [],
    `${lane}: Haxe typed modules again after the return to the first -D values`);
  strictEqual(back.report.kept, 0,
    `${lane}: a bucket was kept across a change of the -D values and back`);
  strictEqual(back.report.typedAgain, 0,
    `${lane}: the declarations of the first cache lost their stamps`);
  strictEqual(back.report.stampMismatch, back.report.declarations,
    `${lane}: not every declaration of the first cache needed a new bucket`);
  run.row("a define change", "does not hold",
    `all ${defined.declarations} declarations are new objects, and the macro `
    + "state starts again (request counter 1), so no bucket exists");
  run.row("the first defines again", "does not hold",
    "Haxe typed nothing again and every declaration still has its mark, but "
    + `no bucket exists; ${back.report.stampMismatch} of `
    + `${back.report.declarations} declarations get a new bucket. A mark `
    + "alone would have said \"keep\". The new buckets read the bodies that "
    + `Haxe changed: ${back.report.keptLocalIds} local variables, where the `
    + `first capture read ${settled.keptLocalIds}`);
  ok(back.report.keptLocalIds < settled.keptLocalIds,
    `${lane}: a capture of kept declarations read the bodies of a cold build`);
  assertAllKept(lane, "after the define changes",
    await run.succeed({ label: "no edit after the define changes" }));

  // 7b. A define that an init macro sets. Haxe then reads the modules that
  // it loads after that macro from another cache, but the macro state stays.
  const beforeLate = await run.succeed({ label: "no edit before the late define" });
  const lateDefine = ['haxe.macro.Compiler.define("kept_types_late", "1")'];
  const late = await run.succeed({
    label: "define set by an init macro",
    initMacros: lateDefine
  });
  strictEqual(late.request, beforeLate.request + 1,
    `${lane}: the macro state did not continue across the late define`);
  ok(late.definesDigest !== beforeLate.definesDigest,
    `${lane}: the late define is not visible in the defines`);
  assertTypedAgain(lane, "define set by an init macro", late,
    fixtureModules(late.typedAgainModules), ["Untouched", "Lone", "Main"]);
  ok(late.kept > 50, `${lane}: the late define kept no bucket of the first cache`);
  assertAllKept(lane, "late define again", await run.succeed({
    label: "define set by an init macro, again",
    initMacros: lateDefine
  }));
  const afterLate = await run.request({ label: "without the late define" });
  ok(
    afterLate.result.code === 0 && afterLate.report !== null
    && afterLate.retyped !== null,
    `${lane}: the request after the late define failed`
  );
  deepStrictEqual(afterLate.retyped, [],
    `${lane}: Haxe typed modules again after the late define was removed`);
  strictEqual(afterLate.report.typedAgain, 0);
  deepStrictEqual(
    fixtureModules(afterLate.report.stampMismatchModules),
    fixtureModules(late.typedAgainModules),
    `${lane}: the stamp test did not reject exactly the buckets of the other cache`
  );
  deepStrictEqual(afterLate.report.replacedButSameObject, [],
    `${lane}: a rejected bucket holds the declaration that Haxe gives now`);
  for (const name of ["Untouched", "Lone", "Main"]) {
    const detail: Detail | undefined = afterLate.report.details[keyOfClass(name)];
    strictEqual(detail?.state, "stampMismatch",
      `${lane}: ${name} was not rejected by its stamp`);
    strictEqual(detail?.oldBucketIsSameObject, false,
      `${lane}: the bucket of ${name} from the other cache holds the current object`);
  }
  run.row("a define set by an init macro (modules of the other cache)",
    "does not hold",
    `the macro state continues; Haxe gives ${late.typedAgain} new declaration `
    + "objects, and their old buckets hold other objects");
  run.row("a define set by an init macro (modules of the first cache)",
    "holds for the object, not for values that read a define",
    `${late.kept} buckets are kept and hold the same objects, in a request `
    + "with other defines; a kept value that depends on a define needs the "
    + "session key, not the stamp");
  run.row("the late define removed", "does not hold",
    "RetypedModulesProbe: no module typed again, every mark is present; the "
    + `stamp comparison rejects ${afterLate.report.stampMismatch} buckets, `
    + "each holds an object of the other cache. A mark alone would keep them");
  assertAllKept(lane, "after the late define",
    await run.succeed({ label: "no edit after the late define" }));

  // 8. A request that fails in typing.
  run.edit("Lone.hx", '"lone-v2"', "(1 : Int)");
  const typeError = await run.fail({ label: "type error in Lone" },
    "Int should be String");
  deepStrictEqual(typeError.stages, ["afterTyping"],
    `${lane}: a request with a type error reached other stages than expected`);
  deepStrictEqual(fixtureModules(typeError.typedAgainModules), ["Lone"]);
  assertUntouchedKept(lane, "type error in Lone", typeError);
  run.edit("Lone.hx", "(1 : Int)", '"lone-v3"');
  const repaired = await run.succeed({ label: "Lone repaired" });
  assertTypedAgain(lane, "Lone repaired", repaired, ["Lone"], ["Lone"]);
  assertUntouchedKept(lane, "Lone repaired", repaired);
  run.row("a request that fails in typing (other modules)", "holds",
    `the after-typing callbacks ran in the failed request; ${typeError.kept} `
    + "kept buckets were correct there and in the repaired request");
  run.row("a request that fails in typing (the module with the error)",
    "does not hold",
    "Haxe typed Lone again in the failed request and again in the repaired "
    + "one; the bucket made in the failed request holds another object");

  // 9. Requests that fail after typing: in the after-typing callbacks, in
  // `onGenerate`, and after generation.
  let version = 3;
  for (const failAt of ["afterTyping", "generate", "afterGenerate"] as const) {
    run.edit("Lone.hx", `"lone-v${version}"`, `"lone-v${version + 1}"`);
    version += 1;
    const failed = await run.fail({ label: `failure at ${failAt}`, failAt },
      `failure requested after stage ${failAt}`);
    deepStrictEqual(fixtureModules(failed.typedAgainModules), ["Lone"]);
    const next = await run.succeed({ label: `no edit after failure at ${failAt}` });
    assertTypedAgain(lane, `after failure at ${failAt}`, next, ["Lone"], ["Lone"]);
    assertUntouchedKept(lane, `after failure at ${failAt}`, next);
    assertAllKept(lane, `second request after failure at ${failAt}`,
      await run.succeed({ label: `second no edit after failure at ${failAt}` }));
    run.row(`a failed request (stopped at ${failAt}), the module it typed`,
      "does not hold",
      "the next request has no edit, but Haxe types Lone again; the bucket "
      + "made in the failed request holds another object and is replaced");
  }
  const failedWithoutEdit = await run.fail(
    { label: "failure with no edit", failAt: "afterTyping" },
    "failure requested after stage afterTyping"
  );
  strictEqual(failedWithoutEdit.typedAgain, 0);
  assertAllKept(lane, "after a failure with no edit",
    await run.succeed({ label: "no edit after a failure with no edit" }));
  run.row("a failed request, modules that it did not type", "holds",
    "every bucket is kept in the failed request and in the next one");

  // 10. A request without the probes types a module.
  run.edit("Lone.hx", `"lone-v${version}"`, `"lone-v${version + 1}"`);
  version += 1;
  const silent = await run.request({ label: "edit of Lone, no probes", withoutProbes: true });
  ok(silent.result.code === 0, `${lane}: the request without probes failed`);
  const unstamped = await run.succeed({ label: "probes return" });
  assertTypedAgain(lane, "probes return", unstamped, ["Lone"], ["Lone"]);
  const again = await run.succeed({ label: "no edit after the probes return" });
  deepStrictEqual(fixtureModules(again.typedAgainModules), ["Lone"],
    `${lane}: a class that was first typed without a stamp kept a later stamp`);
  deepStrictEqual(again.replacedButSameObject, [keyOfClass("Lone")],
    `${lane}: the bucket of Lone was replaced for another reason`);
  run.row("a class first typed by a request that added no stamp", "holds",
    "but the test cannot see it: Haxe restores the saved metadata of a kept "
    + "class in each request, so the later stamp is lost and the class "
    + "counts as typed again in every request. Safe, never fast, until the "
    + "next edit of that module");
  run.edit("Lone.hx", `"lone-v${version}"`, `"lone-v${version + 1}"`);
  assertTypedAgain(lane, "edit after the probes return",
    await run.succeed({ label: "edit of Lone with probes" }), ["Lone"], []);
  assertAllKept(lane, "end",
    await run.succeed({ label: "last request, no edit" }));
}

async function main(): Promise<void> {
  const lanes: ReadonlyArray<Lane> = process.argv.includes("--haxe-only")
    ? ["haxe-js"]
    : ["haxe-js", "genes-ts"];
  rmSync(tempRoot, { recursive: true, force: true });
  const compiler = selectedHaxeCompiler(repoRoot);
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  try {
    for (const lane of lanes) await runLane(server, lane);
  } finally {
    await server.stop();
  }
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(
    path.join(tempRoot, "results.json"),
    `${JSON.stringify({ haxe: compiler.version, requests: requestCount, rows }, null, 1)}\n`
  );
  for (const row of rows) {
    process.stdout.write(
      `kept-types | ${row.lane} | ${row.scenario} | ${row.expected} | `
      + `${row.evidence}\n`
    );
  }
  process.stdout.write(
    `compiler-server-kept-types:ok (Haxe ${compiler.version}; `
    + `${lanes.join(", ")}; ${requestCount} requests)\n`
  );
}

await main();
