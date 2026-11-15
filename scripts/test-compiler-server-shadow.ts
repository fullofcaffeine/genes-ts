/**
 * Gates for Stage 3, slice 1: the byte-stability shadow of incremental
 * generation on a warm Haxe compilation server.
 *
 * Why: a later slice will reuse the stored output of modules that Genes calls
 * "clean" instead of printing them again. Before any work is skipped, two
 * things must hold on real edits:
 *
 * - G0: a warm full generation equals a cold build, with no cache. A failure
 *   here is a Genes or Haxe defect of today, not a cache defect.
 * - G1: with `-D genes.dev_incremental`, every module that the clean rules
 *   call clean has the same bytes as the full generation that the request
 *   just published (0 mismatches), and the published tree equals the cold
 *   tree.
 * - G2: without the define nothing changes: the warm tree equals cold output
 *   and no declaration carries an epoch stamp.
 *
 * How: one source tree (`tests/compiler-server/templates/incremental`) gets
 * a fixed list of scripted edits. After each edit the same request runs three
 * times: in a new Haxe process (the cold oracle), on a warm server without the
 * define (G0, G2), and on a second warm server with the define (G1). The
 * shadow writes a report beside its request descriptor; the gate reads it.
 * Each edit moves the file time to a later whole second, because Haxe 4.3.7
 * compares file times at one-second precision.
 *
 * The G3 numbers (clean share, projected generation time, overhead, cache
 * size) are printed, not judged: the fixture is small, and timing claims need
 * a quiet machine.
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
const template = path.join(fixtureRoot, "templates/incremental");
const tempRoot = path.join(fixtureRoot, ".tmp/shadow");
const workspace = path.join(tempRoot, "workspace");
const descriptorFile = path.join(tempRoot, "request.json");
const reportFile = `${descriptorFile}.report.json`;
const timeoutMs = 180_000;
const genesVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")) as {
    readonly version: string;
  }
).version;

type Mode = "cold" | "plain" | "shadow";

/** The parts of the shadow report that this gate reads. */
type ShadowReport = {
  readonly request: number;
  readonly result: string;
  readonly reason: string | null;
  readonly committed: boolean;
  readonly typedAgain: number;
  readonly emitted: number;
  readonly clean: number;
  readonly dirty: number;
  readonly dirtyReasons: ReadonlyArray<string>;
  readonly mismatches: ReadonlyArray<{
    readonly module: string;
    readonly path: string;
    readonly kind: string;
    readonly line: number;
    readonly stored: string;
    readonly staged: string;
  }>;
  readonly fallbackLookups: number;
  readonly fallbackLookupModules: ReadonlyArray<string>;
  readonly haxePrinterModules: number;
  readonly generationMs: number;
  readonly projectedGenerationMs: number;
  readonly cacheBytes: number;
  readonly reservedNamesChanged: boolean;
  /** Warnings that Genes reported while it printed the modules. */
  readonly printWarnings: number;
  readonly overhead: { readonly totalMs: number };
};

/** One scripted edit and what the gate expects from it. */
type Edit = {
  readonly id: string;
  readonly apply: () => void;
  readonly fails?: boolean;
  /** Shadow results that this edit accepts; any result when absent. */
  readonly results?: ReadonlyArray<string>;
  /**
   * True for a request with no edit: Haxe must type nothing again, and some
   * modules must be clean. This catches stamps that do not survive in
   * Haxe's cache, for example after the macro interpreter was reset.
   */
  readonly settled?: boolean;
};

/** Program arguments that an edit can change, as a session would. */
const program = {
  defines: [] as string[],
  modules: [
    "inc.Leaf", "inc.Leaf2", "inc.Clock", "inc.Embedded", "inc.Legacy"
  ] as string[]
};

/** The file that every request embeds as the resource `note`. */
const resourceFile = path.join(workspace, "res/note.txt");

function sourceFile(relative: string): string {
  return path.join(workspace, "src", relative);
}

let clock = Math.floor(Date.now() / 1000);

/** Moves a file time to a later whole second than any earlier edit. */
function touch(file: string): void {
  clock = Math.max(clock, Math.floor(Date.now() / 1000),
    Math.floor(statSync(file).mtimeMs / 1000)) + 2;
  utimesSync(file, clock, clock);
}

/** Replaces one exact text in a fixture file and moves its time. */
function edit(relative: string, from: string, to: string): void {
  const file = sourceFile(relative);
  const text = readFileSync(file, "utf8");
  ok(
    text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`
  );
  writeFileSync(file, text.replace(from, to));
  touch(file);
}

function create(relative: string, text: string): void {
  const file = sourceFile(relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  touch(file);
}

function remove(relative: string): void {
  rmSync(sourceFile(relative), { force: true });
}

function addModule(name: string): void {
  program.modules.push(name);
}

function dropModule(name: string): void {
  program.modules = program.modules.filter((module) => module !== name);
}

/**
 * The edit list: each kind of the design's section 13 at least once, plus
 * the kinds that its review added. Later edits undo earlier ones, so the
 * list also covers the reverse direction of each change.
 */
const edits: ReadonlyArray<Edit> = [
  { id: "first request", apply: () => {} },
  { id: "no edit", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "body of a module with no importer",
    apply: () => edit("inc/Leaf.hx", '"leaf-v1"', '"leaf-v2"'),
    results: ["incremental"]
  },
  {
    id: "body of a second module with no importer",
    apply: () => edit("inc/Leaf2.hx", '"leaf2-v1"', '"leaf2-v2"'),
    results: ["incremental"]
  },
  {
    id: "the same module again in the next request",
    apply: () => edit("inc/Leaf.hx", '"leaf-v2"', '"leaf-v3"'),
    results: ["incremental"]
  },
  {
    id: "body of a module with many importers",
    apply: () => edit("inc/Shared.hx", '"shared-v1:"', '"shared-v2:"')
  },
  {
    id: "public signature change",
    apply: () => edit(
      "inc/Shared.hx",
      "label(text: String): String",
      "label(text: String, ?suffix: String): String"
    )
  },
  {
    id: "inline constant change",
    apply: () => edit("inc/Consts.hx", "LIMIT = 3", "LIMIT = 4")
  },
  {
    id: "first use of a method that dead-code elimination removed",
    apply: () => edit("inc/A.hx", "/*HELPER_USE*/", "+ Helper.rare() /*HELPER_USE*/")
  },
  {
    id: "last use of that method",
    apply: () => edit("inc/A.hx", "+ Helper.rare() /*HELPER_USE*/", "/*HELPER_USE*/")
  },
  {
    id: "first use of a type in a type position only",
    apply: () => edit(
      "inc/B.hx",
      "/*TYPE_ONLY_USE*/",
      "final hint: Null<TypeOnly> = null; /*TYPE_ONLY_USE*/"
    )
  },
  {
    id: "edit of the class used in type positions only",
    apply: () => edit("inc/TypeOnly.hx", "value = 1;", "value = 2;")
  },
  {
    id: "last use of that type",
    apply: () => edit(
      "inc/B.hx",
      "final hint: Null<TypeOnly> = null; /*TYPE_ONLY_USE*/",
      "/*TYPE_ONLY_USE*/"
    )
  },
  {
    id: "type reached by inference through a third module",
    apply: () => edit("inc/Target.hx", '"target-v1"', '"target-v2"')
  },
  {
    id: "typedef chain",
    apply: () => edit("inc/Chain.hx", "final x: Int;", "final x: Int;\n  final ?y: Int;")
  },
  {
    id: "first use of a generic instance",
    apply: () => edit(
      "inc/GenericUse.hx",
      "/*GENERIC_USE*/",
      '+ new Box<String>("s").item /*GENERIC_USE*/'
    )
  },
  {
    id: "last use of that generic instance",
    apply: () => edit(
      "inc/GenericUse.hx",
      '+ new Box<String>("s").item /*GENERIC_USE*/',
      "/*GENERIC_USE*/"
    )
  },
  {
    id: "type that an expression macro loads",
    apply: () => edit(
      "inc/Loaded.hx",
      "  public static function one",
      "  public static function two(): Int {\n    return 2;\n  }\n\n  public static function one"
    )
  },
  {
    id: "type that a build macro loads",
    apply: () => edit(
      "inc/Loaded2.hx",
      "  public static function one",
      "  public static function two(): Int {\n    return 2;\n  }\n\n  public static function one"
    )
  },
  {
    id: "new import that creates an import cycle",
    apply: () => edit("inc/Second.hx", "/*CYCLE_USE*/", "+ First.own() /*CYCLE_USE*/")
  },
  {
    id: "removed import that removes the cycle",
    apply: () => edit("inc/Second.hx", "+ First.own() /*CYCLE_USE*/", "/*CYCLE_USE*/")
  },
  {
    id: "new import in a module with no importer",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/", "import inc.Consts; /*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "/*LEAF2_USE*/", "+ Consts.LIMIT /*LEAF2_USE*/");
    }
  },
  {
    id: "removed import in that module",
    apply: () => {
      edit("inc/Leaf2.hx", "import inc.Consts; /*LEAF2_IMPORT*/", "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "+ Consts.LIMIT /*LEAF2_USE*/", "/*LEAF2_USE*/");
    }
  },
  {
    id: "@:expose added",
    apply: () => edit("inc/Exposed.hx", "/*EXPOSE*/", "@:expose /*EXPOSE*/")
  },
  {
    id: "module directive added",
    apply: () => edit(
      "inc/Directive.hx",
      "/*DIRECTIVE*/",
      '@:genes.moduleDirective("use client") /*DIRECTIVE*/'
    )
  },
  {
    id: "module directive removed",
    apply: () => edit(
      "inc/Directive.hx",
      '@:genes.moduleDirective("use client") /*DIRECTIVE*/',
      "/*DIRECTIVE*/"
    )
  },
  {
    id: "HXX markup change",
    apply: () => edit("inc/Ui.hx", 'className="ui-v1"', 'className="ui-v2"')
  },
  {
    id: "props type named by a string in metadata",
    apply: () => edit(
      "inc/WidgetProps.hx",
      "final label: String;",
      "final label: String;\n  final ?tone: String;"
    )
  },
  {
    id: "first use of a dynamic iterator",
    apply: () => edit(
      "inc/Features.hx",
      "/*DYNAMIC_ITERATOR*/",
      "final dynamicValues: Dynamic = values;\n    for (value in (dynamicValues : Iterable<Int>)) total += value; /*DYNAMIC_ITERATOR*/"
    )
  },
  {
    id: "last use of the dynamic iterator",
    apply: () => edit(
      "inc/Features.hx",
      "final dynamicValues: Dynamic = values;\n    for (value in (dynamicValues : Iterable<Int>)) total += value; /*DYNAMIC_ITERATOR*/",
      "/*DYNAMIC_ITERATOR*/"
    )
  },
  {
    id: "private type that shares its name with another module's",
    apply: () => edit("inc/PrivA.hx", '"hidden-a-v1"', '"hidden-a-v2"')
  },
  {
    id: "enum abstract value",
    apply: () => edit("inc/Color.hx", '"red-v1"', '"red-v2"')
  },
  {
    id: "new module",
    apply: () => {
      create(
        "inc/Fresh.hx",
        'package inc;\n\nclass Fresh {\n  public static function value(): String {\n    return "fresh-v1";\n  }\n}\n'
      );
      edit("inc/Main.hx", "/*FRESH_USE*/", ', Fresh.value() /*FRESH_USE*/');
    }
  },
  {
    id: "edit of the new module",
    apply: () => edit("inc/Fresh.hx", '"fresh-v1"', '"fresh-v2"')
  },
  {
    id: "deleted module",
    apply: () => {
      edit("inc/Main.hx", ', Fresh.value() /*FRESH_USE*/', "/*FRESH_USE*/");
      remove("inc/Fresh.hx");
    }
  },
  {
    id: "renamed declaration",
    apply: () => {
      const file = sourceFile("inc/Extras.hx");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replaceAll("ExtraHelper", "ExtraAide")
      );
      touch(file);
    }
  },
  {
    id: "type error",
    apply: () => edit("inc/Leaf.hx", 'return "leaf-v3";', "return 3;"),
    fails: true
  },
  {
    id: "type error repaired",
    apply: () => edit("inc/Leaf.hx", "return 3;", 'return "leaf-v4";')
  },
  {
    id: "generation diagnostic (duplicate @:expose)",
    apply: () => {
      create(
        "inc/other/Exposed.hx",
        'package inc.other;\n\n@:expose\nclass Exposed {\n  public static function value(): String {\n    return "other";\n  }\n}\n'
      );
      addModule("inc.other.Exposed");
    },
    fails: true
  },
  {
    id: "generation diagnostic repaired",
    apply: () => {
      dropModule("inc.other.Exposed");
      remove("inc/other/Exposed.hx");
    }
  },
  {
    id: "@:expose removed",
    apply: () => edit("inc/Exposed.hx", "@:expose /*EXPOSE*/", "/*EXPOSE*/")
  },
  {
    id: "define added",
    apply: () => {
      program.defines.push("inc_flag");
    }
  },
  {
    id: "define removed",
    apply: () => {
      program.defines = program.defines.filter((define) => define !== "inc_flag");
    }
  },
  {
    id: "edit, and a failure after typing (React audit)",
    apply: () => {
      edit("inc/Leaf2.hx", '"leaf2-v2"', '"leaf2-v3"');
      edit("inc/Clock.hx", "/*IMPURE*/0", "Date.now().getTime()");
    },
    fails: true
  },
  {
    id: "failure after typing repaired, the earlier edit stays",
    apply: () => edit("inc/Clock.hx", "Date.now().getTime()", "/*IMPURE*/0"),
    results: ["incremental"]
  },
  {
    // F5: the resource bytes are an input of `haxe.Resource`, but Haxe types
    // no module again. Only the session key can show the change.
    id: "resource content changed, no Haxe source edit",
    apply: () => writeFileSync(resourceFile, "note-v2\n"),
    results: ["full"]
  },
  {
    id: "no edit after the resource change",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "@:rtti class added",
    apply: () => {
      create(
        "inc/RttiCase.hx",
        "package inc;\n\n@:rtti @:keep\nclass RttiCase {\n  public static function value(): Int {\n    return 1;\n  }\n}\n"
      );
      addModule("inc.RttiCase");
    },
    results: ["off"]
  },
  {
    id: "@:rtti class removed",
    apply: () => {
      dropModule("inc.RttiCase");
      remove("inc/RttiCase.hx");
    }
  },
  {
    id: "new top-level name equal to a local of another module",
    apply: () => {
      // Imported from a module, not named on the command line, so the
      // program digest and the session key stay the same.
      create(
        "item/Thing.hx",
        "package item;\n\nclass Thing {\n  public static function value(): Int {\n    return 1;\n  }\n}\n"
      );
      edit("inc/Leaf.hx", '"leaf-v4";', '"leaf-v4" + item.Thing.value();');
    }
  },
  {
    id: "that top-level name removed",
    apply: () => {
      edit("inc/Leaf.hx", '"leaf-v4" + item.Thing.value();', '"leaf-v4";');
      remove("item/Thing.hx");
    }
  },
  {
    id: "Genes compiler source file touched",
    apply: () => {
      const file = path.join(repoRoot, "src/genes/incremental/ModuleFingerprint.hx");
      const now = Math.floor(Date.now() / 1000) + 2;
      utimesSync(file, now, now);
    },
    results: ["full"]
  },
  { id: "no edit at the end", apply: () => {}, results: ["incremental"], settled: true }
];

function outputRoot(mode: Mode): string {
  return path.join(tempRoot, "out", mode);
}

function buildArguments(mode: Mode): string[] {
  return [
    "-cp", path.join(repoRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    "--macro", 'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "genes.react.ReactDiagnosticsMacro.install()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "-cp", path.join(workspace, "src"),
    "--main", "inc.Main",
    ...program.modules,
    "-resource", `${resourceFile}@note`,
    "-js", path.join(outputRoot(mode), "index.tsx"),
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    ...[
      "genes.ts",
      "genes.ts.jsx_import_source=react",
      "genes.react.inline_markup",
      ...program.defines
    ].flatMap((define) => ["-D", define])
  ];
}

/** Arguments of a warm request: the probe, and the define for the shadow server. */
function warmArguments(mode: "plain" | "shadow", probeReport: string): string[] {
  return [
    ...buildArguments(mode),
    "-cp", path.join(fixtureRoot, "probes"),
    "--macro", `EpochStampProbe.install(${JSON.stringify(probeReport)})`,
    ...(mode === "shadow"
      ? ["-D", `genes.dev_incremental=${descriptorFile}`]
      : [])
  ];
}

/**
 * Writes the request descriptor. The session owns the program digest: here it
 * is the digest of the arguments that a cold build of this request receives.
 */
function writeDescriptor(): void {
  const digest = createHash("sha256")
    .update(buildArguments("shadow").join("\0"))
    .digest("hex");
  writeFileSync(
    descriptorFile,
    JSON.stringify({
      format: 1,
      programDigest: digest,
      kind: "full",
      generation: "shadow"
    })
  );
}

function describe(result: ProcessResult): string {
  return `code ${String(result.code)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

/** Returns the paths whose bytes differ between two hashed trees. */
function treeDifference(
  left: ReadonlyArray<TreeEntry>,
  right: ReadonlyArray<TreeEntry>
): ReadonlyArray<string> {
  const rightByPath = new Map(right.map((entry) => [entry.path, entry.sha256]));
  const leftPaths = new Set(left.map((entry) => entry.path));
  return [
    ...left
      .filter((entry) => rightByPath.get(entry.path) !== entry.sha256)
      .map((entry) => entry.path),
    ...right
      .filter((entry) => !leftPaths.has(entry.path))
      .map((entry) => entry.path)
  ].sort();
}

/**
 * Returns the `__js__` deprecation warnings of one request, sorted. Genes
 * reports them when it prints a module, so they are part of what a request
 * with stored output must still give.
 */
function printWarnings(result: ProcessResult): ReadonlyArray<string> {
  return `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((line) => line.includes("__js__ is deprecated"))
    .map((line) => line.trim())
    .sort();
}

function readReport(): ShadowReport | null {
  return existsSync(reportFile)
    ? JSON.parse(readFileSync(reportFile, "utf8")) as ShadowReport
    : null;
}

function readStampCount(file: string): number {
  ok(existsSync(file), `the epoch probe wrote no report: ${file}`);
  return Number(readFileSync(file, "utf8"));
}

type Row = {
  readonly id: string;
  readonly result: string;
  readonly typedAgain: number;
  readonly emitted: number;
  readonly clean: number;
  readonly mismatches: number;
  readonly fallbackLookups: number;
  readonly generationMs: number;
  readonly projectedMs: number;
  readonly overheadMs: number;
  readonly cacheBytes: number;
  readonly reason: string;
};

async function main(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(template, workspace, { recursive: true });
  const compiler = selectedHaxeCompiler(repoRoot);
  let plain = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  let shadow = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  const rows: Row[] = [];
  const g1Failures: string[] = [];
  const plainProbe = path.join(tempRoot, "plain.stamps.txt");
  const shadowProbe = path.join(tempRoot, "shadow.stamps.txt");
  const loadAtStart = loadavg()[0] ?? 0;
  try {
    for (const [index, step] of edits.entries()) {
      const label = `[${index + 1}/${edits.length}] ${step.id}`;
      step.apply();
      writeDescriptor();
      for (const mode of ["cold", "plain", "shadow"] as const) {
        rmSync(outputRoot(mode), { recursive: true, force: true });
      }
      rmSync(reportFile, { force: true });
      rmSync(plainProbe, { force: true });
      rmSync(shadowProbe, { force: true });
      const cold = await runBoundedProcess(compiler.binary,
        buildArguments("cold"), {
          cwd: workspace,
          timeoutMs,
          label: `Cold ${label}`,
          reportProgress: true
        });
      const warm = await plain.compile(warmArguments("plain", plainProbe),
        `Plain ${label}`, timeoutMs, workspace);
      let shadowed = await shadow.compile(warmArguments("shadow", shadowProbe),
        `Shadow ${label}`, timeoutMs, workspace);
      if (step.fails === true) {
        ok(cold.code !== 0, `${label}: the cold build must fail`);
        ok(warm.code !== 0, `${label}: the plain warm request must fail`);
        ok(shadowed.code !== 0, `${label}: the shadow request must fail`);
        const report = readReport();
        ok(
          report === null || (report.result === "failed" && !report.committed),
          `${label}: a failed request must not report a committed generation`
        );
        rows.push({
          id: step.id, result: report === null ? "failed in typing" : "failed",
          typedAgain: 0, emitted: 0, clean: 0, mismatches: 0,
          fallbackLookups: 0, generationMs: 0, projectedMs: 0, overheadMs: 0,
          cacheBytes: 0, reason: ""
        });
        continue;
      }
      ok(cold.code === 0, `${label}: cold build failed\n${describe(cold)}`);
      ok(warm.code === 0, `${label}: plain warm request failed\n${describe(warm)}`);
      ok(shadowed.code === 0, `${label}: shadow request failed\n${describe(shadowed)}`);
      const coldTree = hashTree(outputRoot("cold"));
      // G0: warm full generation equals cold, with no cache.
      const plainDifference = treeDifference(hashTree(outputRoot("plain")),
        coldTree);
      deepStrictEqual(
        plainDifference,
        [],
        `G0 failed at ${label}: the warm full generation differs from the `
        + `cold build in these files:\n${plainDifference.join("\n")}`
      );
      // G2: without the define no declaration carries an epoch stamp.
      strictEqual(readStampCount(plainProbe), 0,
        `G2 failed at ${label}: a request without the define stamped declarations`);
      let report = readReport();
      ok(report !== null, `${label}: the shadow wrote no report`);
      if (report.result === "restart-required") {
        // The session's answer to this result: a new compiler process.
        await shadow.stop();
        shadow = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
        rmSync(outputRoot("shadow"), { recursive: true, force: true });
        shadowed = await shadow.compile(warmArguments("shadow", shadowProbe),
          `Shadow after restart ${label}`, timeoutMs, workspace);
        ok(shadowed.code === 0,
          `${label}: shadow request after restart failed\n${describe(shadowed)}`);
        const afterRestart = readReport();
        ok(afterRestart !== null, `${label}: no report after the restart`);
        rows.push(row(`${step.id} (restart required)`, report));
        report = afterRestart;
      }
      // G1: the shadow published the full tree, and every clean module had
      // the bytes that the full generation staged.
      const shadowDifference = treeDifference(hashTree(outputRoot("shadow")),
        coldTree);
      deepStrictEqual(
        shadowDifference,
        [],
        `G1 failed at ${label}: the shadow request published a tree that `
        + `differs from the cold build:\n${shadowDifference.join("\n")}`
      );
      // Mismatches are collected over all edits, so that one run lists every
      // cause; the gate fails at the end.
      for (const mismatch of report.mismatches) {
        g1Failures.push(`${label}: ${mismatch.module} ${mismatch.path} `
          + `${mismatch.kind} at line ${mismatch.line}\n  stored: `
          + `${mismatch.stored}\n  staged: ${mismatch.staged}`);
      }
      // Diagnostics are output too: each request reports the warnings of the
      // cold build, also for a module that Haxe did not type again, and the
      // shadow recorded each of them for the module that it belongs to.
      const coldWarnings = printWarnings(cold);
      ok(coldWarnings.length > 0,
        `${label}: the cold build reported no __js__ warning`);
      deepStrictEqual(printWarnings(warm), coldWarnings,
        `G0 failed at ${label}: the plain warm request reported other `
        + "print warnings than the cold build");
      deepStrictEqual(printWarnings(shadowed), coldWarnings,
        `G1 failed at ${label}: the shadow request reported other print `
        + "warnings than the cold build");
      if (report.result !== "off") {
        strictEqual(report.printWarnings, coldWarnings.length,
          `${label}: the shadow recorded ${report.printWarnings} print `
          + `warning(s); the request reported ${coldWarnings.length}`);
      }
      // An off request adds no stamp, but declarations that Haxe kept from
      // earlier requests still carry theirs; the tree comparison above shows
      // that no stamp reached output.
      if (report.result !== "off") {
        ok(readStampCount(shadowProbe) > 0,
          `${label}: the shadow request added no epoch stamp`);
      }
      if (step.results !== undefined) {
        ok(
          step.results.includes(report.result),
          `${label}: shadow result ${report.result} (${String(report.reason)}); `
          + `expected ${step.results.join(" or ")}`
        );
      }
      if (step.settled === true) {
        strictEqual(report.typedAgain, 0,
          `${label}: Haxe typed modules again with no edit`);
        ok(report.clean > 0, `${label}: no module was clean with no edit`);
      }
      rows.push(row(step.id, report));
      // Keep the evidence of the edits so far, also when a later edit fails.
      writeFileSync(path.join(tempRoot, "progress.json"),
        JSON.stringify({ rows, g1Failures }, null, 2));
    }
  } finally {
    await plain.stop();
    await shadow.stop();
  }
  const loadAtEnd = loadavg()[0] ?? 0;
  writeFileSync(path.join(tempRoot, "summary.json"),
    JSON.stringify({ loadAtStart, loadAtEnd, rows }, null, 2));
  const timing = Math.max(loadAtStart, loadAtEnd) <= 2
    ? "quiet machine"
    : "diagnostic: 1-minute load above 2.0";
  process.stdout.write(
    "edit | result | typed again | emitted | clean | mismatches | generation ms "
    + "| projected ms | overhead ms | cache bytes\n"
  );
  for (const entry of rows) {
    process.stdout.write(
      `${entry.id} | ${entry.result} | ${entry.typedAgain} | ${entry.emitted} `
      + `| ${entry.clean} | ${entry.mismatches} | ${entry.generationMs} `
      + `| ${entry.projectedMs} | ${entry.overheadMs} | ${entry.cacheBytes}`
      + (entry.reason.length > 0 ? ` | ${entry.reason}` : "")
      + "\n"
    );
  }
  ok(
    g1Failures.length === 0,
    `G1 failed: modules that the rules call clean changed bytes:\n`
    + g1Failures.join("\n")
  );
  process.stdout.write(
    `compiler-server-shadow:ok (Haxe ${compiler.version}; ${edits.length} `
    + `edits; G0 warm equals cold, G1 0 mismatches, G2 no stamp without the `
    + `define; times ${timing}, load ${loadAtStart.toFixed(1)} to `
    + `${loadAtEnd.toFixed(1)})\n`
  );
}

function row(id: string, report: ShadowReport): Row {
  return {
    id,
    result: report.result,
    typedAgain: report.typedAgain,
    emitted: report.emitted,
    clean: report.clean,
    mismatches: report.mismatches.length,
    fallbackLookups: report.fallbackLookups,
    generationMs: report.generationMs,
    projectedMs: report.projectedGenerationMs,
    overheadMs: report.overhead.totalMs,
    cacheBytes: report.cacheBytes,
    reason: (report.reason ?? "")
      + (report.reservedNamesChanged ? " (reserved names changed)" : "")
  };
}

await main();
