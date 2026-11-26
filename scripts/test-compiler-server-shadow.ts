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
 * - G1: with `-D genes.dev_incremental` and the descriptor fields
 *   `"generation": "compare"` and `"afterTyping": "reuse"` (compare needs
 *   reuse; G2 design review, required change 3), every module that the clean
 *   rules call clean has the same bytes as the full generation that the
 *   request just published (0 mismatches), and the published tree equals the
 *   cold tree.
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
 *
 * Stage 3, slice S1 runs the same edit list a second time with
 * `"generation": "reuse"` (`--modes=compare,reuse`, the default): each module
 * that the clean rules and the checks before emission accept is not printed;
 * its stored files, maps and warnings are staged instead. After each edit the
 * published tree must equal the cold tree, and the request must report the
 * cold build's warnings. The gate counts the replayed modules, and fails when
 * a request with no edit replays nothing or leaves a clean module unreplayed,
 * so it cannot pass with an empty replay. `--only=<a|b>` runs the first
 * request and the edits whose id contains `a` or `b` (`=a` for an exact id); `--skip-plain` skips the warm server
 * without the define (G0, G2); `--skip-probe` skips `CleanRuleProbe` (for a
 * run with a guard switched off by hand, whose probe case would fail first).
 * Each of them ends with a `partial` line. `--react-refresh` runs every
 * build with `-D genes.react_refresh_modules`, so the React edits below also
 * cover modules that Genes splits into `X.tsx` and `X.fields.tsx`.
 *
 * Stage 3, slice S2 (stored edges): with a usable cache, compare and reuse
 * walk clean modules with the steps recorded for their member lists, and
 * fall back to a live walk in the same request when a stored step cannot be
 * taken as recorded. Every request reports a walk verdict; `drift` (stored
 * steps that differ from the live plan, or two walks of compare with other
 * results) fails the gate, and a request with no edit must stay on the
 * recorded path (reuse: without building the plan of a clean module). The
 * edits whose ids start with `S2` cover the order-sensitive cases of the
 * walk. `--modes=measure` runs the same edit list with `"generation":
 * "measure"` and prints how often a walk with stored edges would leave the
 * recorded path: the go/no-go number of slice S2. It is not part of the
 * default gate.
 *
 * The rolling replay audit (genes-f8vc.9.23): after a reuse request has
 * published its tree, Genes prints replayed modules again into memory and
 * compares the bytes. `--audit=<n|all|off>` sets how many replayed modules
 * each reuse request prints again (descriptor field `audit.modules`); the
 * default `all` prints every replayed module, so the reuse pass also proves
 * that the audit reports no difference on any edit of the list (no false
 * mismatch). An edit with `auditMismatch` reaches a known hole of the clean
 * rules (limit L3: metadata on a local variable of a typed body): compare
 * must report the named modules, and in reuse the audit must report them,
 * drop the cache, and the next request must equal the cold tree again.
 * `--audit=off` shows the red case: the stale replay is not seen and stays
 * in the cache for the next request.
 *
 * Before the edits, `CleanRuleProbe` checks three rules with made-up inputs:
 * the output lines of the session key (no absolute output path), the clean
 * rule for a module without a declaration stamp, and the refusal of compare
 * without afterTyping reuse. Edits near the end move the output folder (a
 * sibling keeps the cache, another depth drops it) and change the
 * descriptor fields as a session would.
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
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

/** The `generation` value that one pass over the edit list uses. */
type GenerationMode = "measure" | "compare" | "reuse";

/** Command-line options; see the file comment. */
const options = (() => {
  const value = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    return process.argv.slice(2).find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length);
  };
  const modes = (value("modes") ?? "compare,reuse").split(",")
    .map((mode) => mode.trim());
  for (const mode of modes)
    ok(mode === "measure" || mode === "compare" || mode === "reuse",
      `unknown mode ${mode}`);
  // `--only` is a list of edit ids separated by "|"; an entry matches an id
  // that contains it, or, with a leading "=", the id that equals it. Plain
  // text matching: the value never becomes a regular expression.
  const only = value("only");
  const audit = value("audit") ?? "all";
  ok(audit === "all" || audit === "off" || /^[0-9]+$/.test(audit),
    `--audit must be all, off or a whole number: ${audit}`);
  return {
    modes: modes as GenerationMode[],
    // The descriptor's `audit.modules` of the reuse pass (see the file
    // comment); `all` is more than any fixture replays.
    auditModules: audit === "all" ? 1_000_000 : audit === "off" ? 0 : Number(audit),
    only: only === undefined ? null : only.split("|").filter((part) => part.length > 0),
    skipPlain: process.argv.includes("--skip-plain"),
    skipProbe: process.argv.includes("--skip-probe"),
    reactRefresh: process.argv.includes("--react-refresh")
  };
})();

/** The parts of the shadow report that this gate reads. */
type ShadowReport = {
  readonly request: number;
  /** `measure` or `compare`; `none` when the shadow did not run. */
  readonly mode: string;
  readonly result: string;
  readonly reason: string | null;
  /** The stable code of a refused `generation` value, or `null`. */
  readonly refusal: string | null;
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
  readonly cacheAnswerBytes: number;
  readonly cacheStored: boolean;
  readonly replayable: number;
  readonly replayed: number;
  readonly replayedFiles: number;
  /**
   * Typed field bodies that Genes read for the replayed modules, outside the
   * replay audit (report format 6). It does not depend on host speed.
   */
  readonly replayedBodyReads: number;
  readonly replayMs: number;
  readonly planFallback: string | null;
  readonly haxePrinterModuleNames: ReadonlyArray<string>;
  readonly reservedNamesChanged: boolean;
  /** Warnings that Genes reported while it printed the modules. */
  readonly printWarnings: number;
  readonly overhead: { readonly totalMs: number };
  readonly typedAgainModules: ReadonlyArray<string>;
  readonly modules: ReadonlyArray<{
    readonly module: string;
    readonly state: string;
  }>;
  /** The rolling replay audit (report format 5). */
  readonly audit: {
    readonly modules: number;
    readonly seed: number;
    readonly audited: ReadonlyArray<string>;
    readonly mismatches: ShadowReport["mismatches"];
    readonly ms: number;
    readonly cacheDropped: boolean;
  };
  /** The reachability walk with stored edges (slice S2; report format 4). */
  readonly walk: {
    readonly pass: string;
    readonly verdict: string;
    readonly left: string | null;
    readonly storedVisits: number;
    readonly liveVisits: number;
    readonly checkedVisits: number;
    readonly missing: number;
    readonly differs: number;
    readonly stale: number;
    readonly walksDiffer: string | null;
    readonly storedMs: number;
    readonly liveMs: number;
  };
};

/**
 * The module that `inc.LateMacro` defines in an after-typing callback of
 * every request. Haxe gives it to the after-typing callbacks again, so it
 * arrives without a stamp each time: it is typed again in every request, and
 * it must never be clean.
 */
const lateModule = "inc.Late";

/**
 * The module that `inc.CloneMacro` defines in every request. Without its
 * flag file it is new in each request, like `inc.Late`.
 */
const cloneModule = "inc.Clone";

/** Modules that a macro defines anew in every request: never clean. */
const macroModules = [lateModule, cloneModule];

/**
 * Modules that ask for a feature that emission can add (rule 10 of
 * `GenerationCache`): never clean.
 */
const emissionFeatureModules = ["inc.CyHub"];

/** The root module of the fixture (the output file name). */
const rootModule = "index";

/** One scripted edit and what the gate expects from it. */
type Edit = {
  readonly id: string;
  readonly apply: () => void;
  readonly fails?: boolean;
  /** Shadow results that this edit accepts; any result when absent. */
  readonly results?: ReadonlyArray<string>;
  /** Text that the report's reason must contain. */
  readonly reason?: string;
  /** The report's `mode`, when the edit expects one. */
  readonly mode?: string;
  /** The report's `refusal` code, when the edit expects one. */
  readonly refusal?: string;
  /**
   * True for a request that fails after Genes published its tree and stored
   * its cache (a failure in `onAfterGenerate`): every build must fail, and
   * the published trees must be equal.
   */
  readonly failsAfterCommit?: boolean;
  /**
   * For an edit that `fails`: the shadow request (and the plain warm request)
   * must print exactly the errors of the cold build, no more and no fewer.
   */
  readonly sameErrors?: boolean;
  /** Modules that the report must list as emitted and dirty. */
  readonly dirtyModules?: ReadonlyArray<string>;
  /**
   * True for a request with no edit: Haxe must type nothing again, and some
   * modules must be clean. This catches stamps that do not survive in
   * Haxe's cache, for example after the macro interpreter was reset.
   */
  readonly settled?: boolean;
  /**
   * The verdict of the walk with stored edges (slice S2) that the edit
   * expects in every mode: `on-path` or `left` (`ShadowWalkReport`).
   */
  readonly walk?: string;
  /**
   * True for an edit whose expected result depends on compare or reuse
   * needing afterTyping reuse: the `measure` pass skips its result,
   * reason, mode and refusal checks.
   */
  readonly notMeasured?: boolean;
  /**
   * Modules whose stored output this edit makes stale through a known hole
   * of the clean rules (limit L3). Compare must report a mismatch for each
   * of them (and only for them). In reuse the published tree may differ from
   * the cold tree only in their files, and the rolling replay audit must
   * report each of them, drop the generation cache and warn with
   * `GENES-INCREMENTAL-AUDIT-001`; the next request must then equal the
   * cold tree. Needs the audit on for these modules (`--audit=all`).
   */
  readonly auditMismatch?: ReadonlyArray<string>;
  /**
   * Files (relative to the output folder) that the cold tree must hold, or
   * must not hold, after the edit; checked only with `--react-refresh`.
   */
  readonly refreshFiles?: { readonly present: ReadonlyArray<string>; readonly absent: ReadonlyArray<string> };
};

/** Program arguments that an edit can change, as a session would. */
const program = {
  defines: [] as string[],
  modules: [
    "inc.Leaf", "inc.Leaf2", "inc.Clock", "inc.Embedded", "inc.Legacy",
    "inc.OrderA", "inc.OrderZ", "inc.OrderPair", "inc.OrderTwin",
    "inc.ExclHintTail", "inc.ExclTail"
  ] as string[]
};

/**
 * The descriptor fields that an edit can change. The gate runs in compare
 * mode, which needs the passes after typing to reuse their records (G2 design
 * review, required change 3).
 */
const request = {
  afterTyping: "reuse",
  generation: "compare" as string
};

/** The `generation` value of the current pass over the edit list. */
let currentMode: GenerationMode = "compare";

/**
 * Where the three requests write their output: `<tempRoot>/<folders>/<mode>
 * <suffix>`. A development session writes each build to a new candidate
 * folder; the output edits move the folder as a session would.
 */
const output = {
  folders: ["out"] as string[],
  suffix: ""
};

/** The file that every request embeds as the resource `note`. */
const resourceFile = path.join(workspace, "res/note.txt");

function sourceFile(relative: string): string {
  return path.join(workspace, "src", relative);
}

/** A classpath inside a candidate folder (see "a source inside the parting folder"). */
const partedClassPath = path.join(tempRoot, "cand", "rev-1", "gen");

/** Creates or removes one flag file in the working folder of the fixture. */
function flag(name: string, present: boolean): void {
  const file = path.join(workspace, name);
  if (present)
    writeFileSync(file, "on\n");
  else
    rmSync(file, { force: true });
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
  {
    id: "no edit",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    dirtyModules: [lateModule]
  },
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
    // With --react-refresh, RefreshPanel is split: a component and a module
    // function. RefreshPlain has no component yet, so it stays one file.
    id: "React module with a component and a module function",
    apply: () => {
      create("inc/RefreshPanel.hx", "package inc;\n\nimport genes.react.Element;\nimport genes.react.JSX.*;\n\n@:keep\nfunction refreshLabel(): String {\n  return \"label\";\n}\n\n@:keep\n@:genes.reactComponent\nfunction RefreshPanel(): Element {\n  return <p>{\"panel-v1\" + refreshLabel()}</p>;\n}\n");
      create("inc/RefreshPlain.hx", "package inc;\n\nimport genes.react.Element;\nimport genes.react.JSX.*;\n\n@:keep\nfunction plainLabel(): String {\n  return \"plain\";\n}\n/*COMPONENT*/\n");
      addModule("inc.RefreshPanel");
      addModule("inc.RefreshPlain");
    },
    refreshFiles: {
      present: ["inc/RefreshPanel.fields.tsx"],
      absent: ["inc/RefreshPlain.fields.tsx"]
    }
  },
  {
    // Only the component file changes; the sibling has the same bytes.
    id: "component body edit in the React module",
    apply: () => edit("inc/RefreshPanel.hx", '"panel-v1"', '"panel-v2"'),
    refreshFiles: { present: ["inc/RefreshPanel.fields.tsx"], absent: [] }
  },
  {
    // RefreshPlain becomes a split module (a new X.fields.tsx).
    id: "first component in a module without one",
    apply: () => edit(
      "inc/RefreshPlain.hx",
      "/*COMPONENT*/",
      "@:keep\n@:genes.reactComponent\nfunction RefreshPlainView(): Element {\n  return <b>{plainLabel()}</b>;\n}\n/*COMPONENT*/"
    ),
    refreshFiles: { present: ["inc/RefreshPlain.fields.tsx"], absent: [] }
  },
  {
    // RefreshPanel is one file again; its old X.fields.tsx must be removed.
    id: "last component of the React module removed",
    refreshFiles: { present: [], absent: ["inc/RefreshPanel.fields.tsx"] },
    apply: () => create("inc/RefreshPanel.hx", "package inc;\n\nimport genes.react.Element;\nimport genes.react.JSX.*;\n\n@:keep\nfunction refreshLabel(): String {\n  return \"label\";\n}\n")
  },
  {
    // With --react-refresh, RefreshDce is split while RefreshDceUser uses its
    // component. RefreshDceLabel uses only its function, so it imports it
    // from RefreshDce.fields.tsx.
    id: "React split module and an importer of its function",
    apply: () => {
      create("inc/RefreshDce.hx", "package inc;\n\nimport genes.react.Element;\nimport genes.react.JSX.*;\n\n@:keep\nfunction dceLabel(): String {\n  return \"dce\";\n}\n\n@:genes.reactComponent\nfunction RefreshDceView(): Element {\n  return <i>{dceLabel()}</i>;\n}\n");
      create("inc/RefreshDceUser.hx", "package inc;\n\nimport genes.react.Element;\nimport genes.react.JSX.*;\nimport inc.RefreshDce.RefreshDceView;\n\n@:keep\nfunction dceView(): Element {\n  return <RefreshDceView />;\n}\n");
      create("inc/RefreshDceLabel.hx", "package inc;\n\n@:keep\nfunction dceShout(): String {\n  return inc.RefreshDce.dceLabel() + \"!\";\n}\n");
      addModule("inc.RefreshDce");
      addModule("inc.RefreshDceUser");
      addModule("inc.RefreshDceLabel");
    },
    refreshFiles: { present: ["inc/RefreshDce.fields.tsx"], absent: [] }
  },
  {
    // Dead-code elimination removes the component, so RefreshDce is one file
    // again. Haxe types only RefreshDceUser again. RefreshDceLabel is not
    // typed again, but its stored import names RefreshDce.fields, so it must
    // not be replayed. Today the changed fingerprint of RefreshDce already
    // makes the request generate in full; the split answer that
    // RefreshDceLabel recorded (`refreshSplit`) would stop the replay too.
    id: "React split module loses its component to dead-code elimination",
    apply: () => edit("inc/RefreshDceUser.hx", "<RefreshDceView />", "<b>none</b>"),
    refreshFiles: { present: [], absent: ["inc/RefreshDce.fields.tsx"] }
  },
  {
    id: "React modules deleted",
    apply: () => {
      dropModule("inc.RefreshPanel");
      dropModule("inc.RefreshPlain");
      dropModule("inc.RefreshDce");
      dropModule("inc.RefreshDceUser");
      dropModule("inc.RefreshDceLabel");
      remove("inc/RefreshPanel.hx");
      remove("inc/RefreshPlain.hx");
      remove("inc/RefreshDce.hx");
      remove("inc/RefreshDceUser.hx");
      remove("inc/RefreshDceLabel.hx");
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
    id: "first use of js.Lib.global in one module",
    apply: () => edit(
      "inc/GlobalUse.hx",
      '"global" /*GLOBAL_USE*/',
      '"global" + (js.Lib.global != null ? "" : "?") /*GLOBAL_USE*/'
    )
  },
  {
    id: "last use of js.Lib.global",
    apply: () => edit(
      "inc/GlobalUse.hx",
      '"global" + (js.Lib.global != null ? "" : "?") /*GLOBAL_USE*/',
      '"global" /*GLOBAL_USE*/'
    )
  },
  {
    id: "first use of js.Boot.isEnum",
    apply: () => edit(
      "inc/EnumCheck.hx",
      "text /*ENUM_CHECK*/",
      'text + (@:privateAccess js.Boot.isEnum(Shape) ? "" : "?") /*ENUM_CHECK*/'
    )
  },
  {
    id: "last use of js.Boot.isEnum",
    apply: () => edit(
      "inc/EnumCheck.hx",
      'text + (@:privateAccess js.Boot.isEnum(Shape) ? "" : "?") /*ENUM_CHECK*/',
      "text /*ENUM_CHECK*/"
    )
  },
  {
    id: "first use of a method of another module, with a subclass in a third",
    apply: () => edit("inc/BaseUser.hx", "/*BASE_RARE*/", "+ value.rare() /*BASE_RARE*/")
  },
  {
    id: "last use of that method",
    apply: () => edit("inc/BaseUser.hx", "+ value.rare() /*BASE_RARE*/", "/*BASE_RARE*/")
  },
  {
    id: "last write of a property: dead-code elimination removes its setter",
    apply: () => edit("inc/PropUser.hx", "prop.level = 2; /*PROP_WRITE*/", "/*PROP_WRITE*/")
  },
  {
    id: "first write of that property again",
    apply: () => edit("inc/PropUser.hx", "/*PROP_WRITE*/", "prop.level = 2; /*PROP_WRITE*/")
  },
  {
    id: "first use of a @:generic method",
    apply: () => edit(
      "inc/GenericMethodUse.hx",
      "/*GENERIC_METHOD*/",
      "+ GenericMethod.make(1).length /*GENERIC_METHOD*/"
    )
  },
  {
    id: "last use of the @:generic method",
    apply: () => edit(
      "inc/GenericMethodUse.hx",
      "+ GenericMethod.make(1).length /*GENERIC_METHOD*/",
      "/*GENERIC_METHOD*/"
    )
  },
  {
    // Item 1 of the review of #243: a macro gives a new object the stamp of
    // the earlier one, and its body changed (no Haxe edit). Only the
    // same-object test of the kept bucket sees it.
    id: "a macro copies the stamp of the earlier object (copied-stamp hole)",
    apply: () => {
      flag("clone-copy.flag", true);
      writeFileSync(path.join(workspace, "res/clone.txt"), "clone-v2\n");
    },
    results: ["full"],
    reason: "copied the stamp"
  },
  {
    id: "the macro stops copying the stamp",
    apply: () => flag("clone-copy.flag", false)
  },
  {
    // A module that a macro defines after typing arrives with a new stamp in
    // every request, so its epochs differ and it is never clean.
    id: "body of the module that a macro defines after typing",
    apply: () => writeFileSync(path.join(workspace, "res/clone.txt"), "clone-v3\n"),
    dirtyModules: [cloneModule]
  },
  {
    id: "a request that fails in onGenerate",
    apply: () => {
      edit("inc/Leaf2.hx", '"leaf2-v3"', '"leaf2-v4"');
      flag("fail-on-generate.flag", true);
    },
    fails: true
  },
  {
    id: "onGenerate failure repaired",
    apply: () => flag("fail-on-generate.flag", false),
    results: ["incremental"]
  },
  {
    id: "a request that fails after the commit",
    apply: () => {
      edit("inc/Leaf2.hx", '"leaf2-v4"', '"leaf2-v5"');
      flag("fail-after-generate.flag", true);
    },
    failsAfterCommit: true
  },
  {
    id: "failure after the commit repaired, no edit",
    apply: () => flag("fail-after-generate.flag", false),
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
    id: "output in a candidate folder beside a source folder",
    apply: () => {
      output.folders = ["cand", "rev-1", "out"];
    },
    results: ["full"],
    reason: "the session key changed"
  },
  {
    id: "no edit in the candidate folder",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    // Item 4 of the review of #243: the output moves to a sibling candidate
    // folder (equal output-root lines, so the cache stays), but the source
    // of `parted.Parted` lies inside the old candidate folder. Its map names
    // the source by a path through that folder, so the stored map is stale.
    id: "sibling candidate folder; a source lies inside the old one",
    apply: () => {
      output.folders = ["cand", "rev-2", "out"];
    },
    results: ["incremental"],
    dirtyModules: ["parted.Parted"]
  },
  {
    id: "output back in the first folder",
    apply: () => {
      output.folders = ["out"];
    },
    results: ["full"],
    reason: "the session key changed"
  },
  {
    // Required change 1: the session key holds the way from the output
    // folder to the project root, not the absolute output path. A new
    // candidate folder beside the old one keeps every kept record and the
    // generation cache.
    id: "output in a sibling folder (a new candidate folder)",
    apply: () => {
      output.suffix = "-candidate-2";
    },
    results: ["incremental"],
    settled: true
  },
  {
    // At another depth the relative source paths of the maps change, so the
    // key must change and the cache must not be used.
    id: "output in a folder at another depth",
    apply: () => {
      output.folders = ["out", "deeper"];
    },
    results: ["full"],
    reason: "the session key changed"
  },
  {
    id: "no edit at the new depth",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    // Required change 3: compare and reuse need afterTyping reuse. The
    // request is refused with a typed reason and still publishes the full
    // tree. The code is `<generation>-needs-after-typing-reuse`.
    id: "generation compare or reuse without afterTyping reuse",
    apply: () => {
      request.afterTyping = "measure";
    },
    results: ["off"],
    refusal: "needs-after-typing-reuse",
    notMeasured: true
  },
  {
    id: "generation measure with afterTyping measure: clean rules without a comparison",
    apply: () => {
      request.generation = "measure";
    },
    results: ["incremental"],
    mode: "measure"
  },
  {
    // Item 7 of the review of #243: the cache that the measure request just
    // wrote came from afterTyping measure, so compare and reuse do not use it.
    id: "back to afterTyping reuse: the cache of afterTyping measure is not used",
    apply: () => {
      request.afterTyping = "reuse";
      request.generation = currentMode;
    },
    results: ["full"],
    reason: "afterTyping",
    mode: "current",
    notMeasured: true
  },
  {
    id: "no edit after the measure cache",
    apply: () => {},
    results: ["incremental"],
    mode: "current",
    settled: true
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
  {
    // M1 of the review of #244: `inc.CyHub` is never clean and Haxe does not
    // type it again. A type position in another module makes the walk add
    // `CyHubExtra` to it, which closes the import cycle CyChild -> CyBase ->
    // CyHub -> CyChild. `inc.CyChild` is clean, but its emission asked
    // whether `inc.CyBase` is in a cycle with it; the answer changed.
    id: "a late member in a module that is never clean closes an import cycle",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/",
        "/*LEAF2_IMPORT*/\ntypedef Leaf2Hint = {\n  final ?extra: inc.CyHub.CyHubExtra;\n}\n");
      edit("inc/Leaf2.hx", "value(): String {",
        "value(): String {\n    final hint: Null<Leaf2Hint> = null;");
    }
  },
  {
    // Stage 3, slice S2: the same import cycle, with no edit. inc.CyChild is
    // clean and asks whether inc.CyBase is in a cycle with it; inc.CyBase is
    // clean too, so the answer reads its stored runtime requests.
    id: "S2 no edit while the import cycle through a third module stands",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "that type position removed: the import cycle opens again",
    apply: () => {
      edit("inc/Leaf2.hx",
        "/*LEAF2_IMPORT*/\ntypedef Leaf2Hint = {\n  final ?extra: inc.CyHub.CyHubExtra;\n}\n",
        "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "value(): String {\n    final hint: Null<Leaf2Hint> = null;",
        "value(): String {");
    }
  },
  {
    // Stage 3, slice S2, row 1: inc.Leaf2 names inc.Den.DenNote, which
    // dead-code elimination removed, in a type position. The walk adds it
    // to inc.Den, which stays clean; inc.Den is then visited with a
    // member list that the record does not have.
    id: "S2 first type-only use of a removed class in a clean module",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/",
        "/*LEAF2_IMPORT*/\ntypedef DenHint = {\n  final ?note: inc.Den.DenNote;\n}\n");
      edit("inc/Leaf2.hx", "value(): String {",
        "value(): String {\n    final denHint: Null<DenHint> = null;");
    },
    walk: "left"
  },
  {
    // inc.Den now has two recorded member lists. Only the visit with
    // DenNote reaches inc.DenDeep, a module that only the walk creates.
    id: "S2 no edit after that first use: two recorded member lists",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "S2 last type-only use of that removed class",
    apply: () => {
      edit("inc/Leaf2.hx",
        "/*LEAF2_IMPORT*/\ntypedef DenHint = {\n  final ?note: inc.Den.DenNote;\n}\n",
        "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "value(): String {\n    final denHint: Null<DenHint> = null;",
        "value(): String {");
    },
    walk: "left"
  },
  {
    id: "S2 no edit after that last use",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    // Row 5: inc.GhostUser starts to name inc.GhostHint, whose typedef field
    // names inc.Ghost; dead-code elimination removed that class, so only
    // the walk creates the module inc.Ghost.
    id: "S2 first use of a typedef that reaches a module only the walk creates",
    apply: () => edit("inc/GhostUser.hx", "/*GHOST_USE*/",
      "final hint: Null<GhostHint> = null; /*GHOST_USE*/")
  },
  {
    // inc.GhostUser and inc.GhostHint are clean: a stored step of
    // inc.GhostHint creates the module inc.Ghost.
    id: "S2 no edit: a stored step creates the module inc.Ghost",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "S2 last use of that typedef",
    apply: () => edit("inc/GhostUser.hx",
      "final hint: Null<GhostHint> = null; /*GHOST_USE*/", "/*GHOST_USE*/")
  },
  {
    // Row 2: inc.PairWayA and inc.PairWayB add PairA and PairB to the clean
    // module inc.Pair late, in the order of their visits. inc.Leaf2 names
    // inc.PairWayB, so the walk visits it first: the order flips.
    id: "S2 two sources add late members to one clean module; their visit order flips",
    apply: () => edit("inc/Leaf2.hx", "value(): String {",
      "value(): String {\n    final pairHint: Null<inc.PairWayB> = null;"),
    walk: "left"
  },
  {
    id: "S2 no edit after the flipped order",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "S2 the visit order flips back",
    apply: () => edit("inc/Leaf2.hx",
      "value(): String {\n    final pairHint: Null<inc.PairWayB> = null;",
      "value(): String {"),
    walk: "left"
  },
  {
    // Row 3: inc.Leaf2 uses inc.Tint at run time, so the class is concrete
    // and the generator adds the typedef inc.Tinted.TintAlias to the clean
    // module inc.Tinted.
    // Without #249 the walk with stored edges left the recorded path here.
    // Since the merge with #249, inc.Tint moves from the unlisted part of its
    // module fingerprint (`ModuleFingerprint.unlisted`) to the listed part,
    // so the fingerprint of inc.Tint changes and the request generates in
    // full, before any walk. Safe, but slower.
    id: "S2 a typedef whose class becomes concrete",
    apply: () => edit("inc/Leaf2.hx", "/*LEAF2_USE*/",
      "+ Std.string(new inc.Tint().shade) /*LEAF2_USE*/"),
    results: ["full"],
    reason: "inc.Tint"
  },
  {
    id: "S2 no edit after the typedef was added",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    // The class leaves the generator's list while Haxe does not type its
    // module again: rule 6 makes the whole request fall back.
    id: "S2 the class of the typedef stops being concrete",
    apply: () => edit("inc/Leaf2.hx",
      "+ Std.string(new inc.Tint().shade) /*LEAF2_USE*/", "/*LEAF2_USE*/")
  },
  {
    id: "S2 no edit after the typedef was removed",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  // Review of slice S2 (genes-f8vc.9.19, probes 6a to 6e; all leave the
  // recorded path or stay on it, never drift): one late member that two
  // clean typedef modules name (RV6c), two late members of one clean module
  // whose order follows the visit order (RV6b), a late member of a clean
  // module that closes an import cycle through two clean modules (RV6d), a
  // generic instance named in a type position and then used at run time
  // (RV6e), and a late member that is renamed (RV6a).
  {
    id: "RV6c Leaf2 names inc.RvWayB: the other clean source adds the shared late member",
    apply: () => edit("inc/Leaf2.hx", "value(): String {",
      "value(): String {\n    final rvWayB: Null<inc.RvWayB> = null;")
  },
  { id: "RV6c no edit after the flip", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6c the flip removed",
    apply: () => edit("inc/Leaf2.hx",
      "value(): String {\n    final rvWayB: Null<inc.RvWayB> = null;", "value(): String {")
  },
  { id: "RV6c no edit after the flip removed", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6b Leaf2 names inc.RvOrdWayY: two late members of a clean module in the other order",
    apply: () => edit("inc/Leaf2.hx", "value(): String {",
      "value(): String {\n    final rvOrdY: Null<inc.RvOrdWayY> = null;")
  },
  { id: "RV6b no edit after the order flip", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6b the order flips back",
    apply: () => edit("inc/Leaf2.hx",
      "value(): String {\n    final rvOrdY: Null<inc.RvOrdWayY> = null;", "value(): String {")
  },
  { id: "RV6b no edit after the order flips back", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6d a late member of a clean module closes an import cycle through two clean modules",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/",
        "/*LEAF2_IMPORT*/\ntypedef RvCyHint = {\n  final ?e: inc.RvCyQ.RvCyQExtra;\n}\n");
      edit("inc/Leaf2.hx", "value(): String {",
        "value(): String {\n    final rvCy: Null<RvCyHint> = null;");
    }
  },
  { id: "RV6d no edit while that cycle stands", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6d the cycle opens again",
    apply: () => {
      edit("inc/Leaf2.hx",
        "/*LEAF2_IMPORT*/\ntypedef RvCyHint = {\n  final ?e: inc.RvCyQ.RvCyQExtra;\n}\n",
        "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "value(): String {\n    final rvCy: Null<RvCyHint> = null;",
        "value(): String {");
    }
  },
  { id: "RV6d no edit after the cycle opened", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6e a dirty module first names a generic instance in a type position only",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/",
        "/*LEAF2_IMPORT*/\ntypedef RvBoxHint = {\n  final ?b: inc.RvBox<Float>;\n}\n");
      edit("inc/Leaf2.hx", "value(): String {",
        "value(): String {\n    final rvBox: Null<RvBoxHint> = null;");
    }
  },
  { id: "RV6e no edit after that first use", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6e a second dirty module uses the generic instance at run time",
    apply: () => edit("inc/RvBoxUser.hx", "/*RVBOX_USE*/",
      "+ new RvBox<Float>(1.5).item /*RVBOX_USE*/")
  },
  { id: "RV6e no edit after the run-time use", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6e the run-time use removed",
    apply: () => edit("inc/RvBoxUser.hx", "+ new RvBox<Float>(1.5).item /*RVBOX_USE*/",
      "/*RVBOX_USE*/")
  },
  { id: "RV6e no edit after the run-time use removed", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6e the type-only use removed",
    apply: () => {
      edit("inc/Leaf2.hx",
        "/*LEAF2_IMPORT*/\ntypedef RvBoxHint = {\n  final ?b: inc.RvBox<Float>;\n}\n",
        "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "value(): String {\n    final rvBox: Null<RvBoxHint> = null;",
        "value(): String {");
    }
  },
  { id: "RV6e no edit after the type-only use removed", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6a the late member named by a clean typedef module is renamed",
    apply: () => {
      for (const relative of ["inc/RvName.hx", "inc/RvNameWay.hx"]) {
        const file = sourceFile(relative);
        writeFileSync(file, readFileSync(file, "utf8").replaceAll("RvNameOld", "RvNameNew"));
        touch(file);
      }
    }
  },
  { id: "RV6a no edit after the rename", apply: () => {}, results: ["incremental"], settled: true },
  {
    id: "RV6a the rename reverted",
    apply: () => {
      for (const relative of ["inc/RvName.hx", "inc/RvNameWay.hx"]) {
        const file = sourceFile(relative);
        writeFileSync(file, readFileSync(file, "utf8").replaceAll("RvNameNew", "RvNameOld"));
        touch(file);
      }
    }
  },
  { id: "RV6a no edit after the rename reverted", apply: () => {}, results: ["incremental"], settled: true },
  {
    // Review of slice S2 (cross-model), FB3: the only dirty module, inc.Ui,
    // gets an error while every other module is clean, so the error comes
    // inside a request whose walk takes stored edges. The request must fail
    // with the errors of the cold build, once, and leave the cache as it
    // was; the repaired request and the request after it stay on the
    // recorded path.
    id: "FB3 a dirty module gets an unknown attribute on an intrinsic element",
    apply: () => edit("inc/Ui.hx", 'className="ui-v2"', 'bogusAttribute="ui-v2"'),
    fails: true,
    sameErrors: true
  },
  {
    id: "FB3 the attribute repaired",
    apply: () => edit("inc/Ui.hx", 'bogusAttribute="ui-v2"', 'className="ui-v2"'),
    walk: "on-path"
  },
  { id: "FB3 no edit after the repair", apply: () => {}, results: ["incremental"], settled: true, walk: "on-path" },
  {
    // FB4: the same for an unknown prop of a component, which Genes checks
    // against the props type of another module (inc.Widgets).
    id: "FB4 a dirty module passes an unknown prop to a component",
    apply: () => edit("inc/Ui.hx", "<WidgetStatus label={label} />",
      '<WidgetStatus label={label} bogus="x" />'),
    fails: true,
    sameErrors: true
  },
  {
    id: "FB4 the prop repaired",
    apply: () => edit("inc/Ui.hx", '<WidgetStatus label={label} bogus="x" />',
      "<WidgetStatus label={label} />"),
    walk: "on-path"
  },
  { id: "FB4 no edit after the repair", apply: () => {}, results: ["incremental"], settled: true, walk: "on-path" },
  {
    // Review of slice S2, M1: with -D genes.extern_init_warning, Genes warns
    // about each extern class with `__init__` (Math and String of Haxe's own
    // library, and inc.RvExtInit) while it reads the type list. A request
    // that leaves the walk with stored edges, and every compare request with
    // a clean set, generates again; the warnings must still come once.
    id: "S2 define genes.extern_init_warning added",
    apply: () => {
      program.defines.push("genes.extern_init_warning");
    },
    // Haxe selects another macro context for another define set, so the
    // request starts with no generation cache.
    results: ["full"]
  },
  {
    id: "S2 no edit with genes.extern_init_warning",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  {
    id: "S2 with genes.extern_init_warning, an edit that leaves the recorded path",
    apply: () => edit("inc/Leaf2.hx", "value(): String {",
      "value(): String {\n    final pairHint: Null<inc.PairWayB> = null;"),
    walk: "left"
  },
  {
    id: "S2 with genes.extern_init_warning, that edit undone",
    apply: () => edit("inc/Leaf2.hx",
      "value(): String {\n    final pairHint: Null<inc.PairWayB> = null;",
      "value(): String {"),
    walk: "left"
  },
  {
    id: "S2 define genes.extern_init_warning removed",
    apply: () => {
      program.defines = program.defines.filter((define) =>
        define !== "genes.extern_init_warning");
    }
  },
  {
    // M2 of the review of #244: the capture of a typedef in `inc.Leaf2`
    // writes a SignatureCache fact for the field `value` that it copies from
    // `inc.Env.Envelope`. Before genes-f8vc.14.31 the print of `inc.Env`
    // read that fact (it printed the values of `inc.Color` for `Envelope<T>`);
    // now the fact names the copy, and `inc.Env` prints `value: T`. `inc.Env`
    // is not typed again.
    id: "another module extends a generic structure with an enum abstract argument",
    apply: () => {
      edit("inc/Leaf2.hx", "/*LEAF2_IMPORT*/",
        "/*LEAF2_IMPORT*/\ntypedef ColorEnvelope = {\n  > inc.Env.Envelope<inc.Color>,\n  final extra: Int;\n}\n");
      edit("inc/Leaf2.hx", "value(): String {",
        "value(): String {\n    final hint: Null<ColorEnvelope> = null;");
    }
  },
  {
    id: "that extension of the generic structure removed",
    apply: () => {
      edit("inc/Leaf2.hx",
        "/*LEAF2_IMPORT*/\ntypedef ColorEnvelope = {\n  > inc.Env.Envelope<inc.Color>,\n  final extra: Int;\n}\n",
        "/*LEAF2_IMPORT*/");
      edit("inc/Leaf2.hx", "value(): String {\n    final hint: Null<ColorEnvelope> = null;",
        "value(): String {");
    }
  },
  {
    // N1 of the review of #244, round 2: an expression macro in inc.Leaf2
    // adds `@:ts.returnType("string | null")` to inc.MetaTarget.value while
    // Haxe types inc.Leaf2. inc.MetaTarget is not typed again, so only its
    // field metadata (now in the fingerprint) shows the change.
    id: "a macro of another module adds metadata to a field of a module that Haxe does not type again",
    apply: () => edit("inc/Leaf2.hx", "/*LEAF2_USE*/",
      '+ inc.MetaMacro.mark("string | null") /*LEAF2_USE*/')
  },
  {
    // A request with no edit here would publish a warm tree that differs
    // from the cold one also without the define: Haxe gives the cached
    // inc.MetaTarget its saved metadata back, and only a cold build runs the
    // macro again. That defect of a warm server is reported, not tested, so
    // the next row removes the macro call.
    id: "that macro call removed",
    apply: () => edit("inc/Leaf2.hx",
      '+ inc.MetaMacro.mark("string | null") /*LEAF2_USE*/', "/*LEAF2_USE*/")
  },
  {
    // N1, second form: the after-typing macro inc.MarkMacro marks the same
    // field in every request while inc.Leaf2 has a static `marker`.
    id: "an after-typing macro marks a field of a module that Haxe does not type again",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var marker = 1;\n")
  },
  {
    id: "no edit after the after-typing mark",
    apply: () => {}
  },
  {
    id: "the after-typing mark removed",
    apply: () => edit("inc/Leaf2.hx",
      "class Leaf2 {\n  public static var marker = 1;\n", "class Leaf2 {")
  },
  {
    // genes-f8vc.9.22: inc.ColorFacts extends inc.Env.Bag<Array<inc.Color>>.
    // The printed inc.Env reads inc.Color by name to spell the values, but
    // the recorded signature-fact answer (`Array<inc.Color>`) stays the
    // same text. Only rule 7 (the witness inc.Color) makes inc.Env dirty.
    id: "an enum abstract value changes; a fact of another module names it",
    apply: () => edit("inc/Color.hx", '"red-v2"', '"red-v3"'),
    dirtyModules: ["inc.Env"]
  },
  {
    id: "that enum abstract value restored",
    apply: () => edit("inc/Color.hx", '"red-v3"', '"red-v2"'),
    dirtyModules: ["inc.Env"]
  },
  {
    // genes-f8vc.9.24, L1 of the round-3 review of #244: the after-typing
    // macro inc.Mark2Macro adds `@:native("parseFloat")` to the field
    // parseInt of the extern-only module inc.ExtApi. inc.ExtUser prints the
    // call and is not typed again; only the field metadata of the extern
    // module (now in its fingerprint) shows the change.
    id: "REVIEW3 after-typing macro renames an extern field with @:native",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markExtern = 1;\n")
  },
  {
    // genes-f8vc.9.24, L2: the same macro adds `@:ts.type("string")` to the
    // field x of the anonymous structure of the typedef inc.Chain.ChainB.
    id: "REVIEW3 after-typing macro overrides the type of a typedef field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAnon = 1;\n")
  },
  {
    // genes-f8vc.9.24, L2 in class fields: an anonymous structure in
    // the type of a variable of inc.AnonSig gets `@:ts.type("string")` on a field.
    id: "after-typing macro overrides an anonymous field in the type of a variable of a class field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAnonVar = 1;\n")
  },
  {
    // genes-f8vc.9.24, L2 in class fields: an anonymous structure in
    // a function argument of inc.AnonSig gets `@:ts.type("string")` on a field.
    id: "after-typing macro overrides an anonymous field in a function argument of a class field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAnonArg = 1;\n")
  },
  {
    // genes-f8vc.9.24, L2 in class fields: an anonymous structure in
    // a function result of inc.AnonSig gets `@:ts.type("string")` on a field.
    id: "after-typing macro overrides an anonymous field in a function result of a class field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAnonResult = 1;\n")
  },
  {
    // genes-f8vc.9.24, L2 in class fields: an anonymous structure in
    // a type argument of inc.AnonSig gets `@:ts.type("string")` on a field.
    id: "after-typing macro overrides an anonymous field in a type argument of a class field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAnonParam = 1;\n")
  },
  {
    // genes-f8vc.9.26, L5 of the review of #245: the after-typing macro
    // inc.Mark3Macro adds `@:ts.type("string")` to the field v of the
    // structure in the constraint of the type parameter of
    // inc.Constrained.pick. Haxe does not type inc.Constrained again; only
    // the constraint part of its fingerprint shows the change.
    id: "after-typing macro overrides an anonymous field in the constraint of a method type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markConstraint = 1;\n")
  },
  {
    // L5, a constraint that names its own parameter
    // (`rank<T: {r: Int, ?next: T}>`): the walk must end.
    id: "after-typing macro overrides an anonymous field in a constraint that names its own parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markRank = 1;\n")
  },
  {
    // L5 on the type parameter of the class inc.Constrained.ConstrainedBox.
    id: "after-typing macro overrides an anonymous field in the constraint of a class type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markBoxConstraint = 1;\n")
  },
  {
    // L5 on the type parameter of the typedef inc.Constrained.ConstrainedDef.
    id: "after-typing macro overrides an anonymous field in the constraint of a typedef type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markDefConstraint = 1;\n")
  },
  {
    // L5 on the type parameter of the abstract inc.Constrained.ConstrainedAbs.
    id: "after-typing macro overrides an anonymous field in the constraint of an abstract type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markAbsConstraint = 1;\n")
  },
  {
    // L5 on the type parameter of the constructor Hold of the enum
    // inc.Constrained.ConstrainedEnum.
    id: "after-typing macro overrides an anonymous field in the constraint of an enum constructor type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markEnumConstraint = 1;\n")
  },
  {
    // genes-f8vc.9.26, L6 of the review of #245: dead-code elimination
    // removes the enum inc.LateEnum, so it is not in the generator's list
    // and has no fingerprint; the walk adds it late because inc.LateUser
    // names it in a typedef field. inc.Mark3Macro adds `@:ts.type("string")`
    // to the field q of the structure of its constructor Item. Only the
    // final member list (now with the metadata of late members) shows it.
    id: "after-typing macro overrides an anonymous field in a constructor of an enum that the generator adds late",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markLateEnum = 1;\n")
  },
  {
    // L6 with a late class: the structure is in the constraint of the type
    // parameter of inc.LateEnum.LateBox.
    id: "after-typing macro overrides an anonymous field in the constraint of a class that the generator adds late",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markLateBox = 1;\n")
  },
  {
    // Round 2 of the review of #246, M1: inc.Mark3Macro adds
    // `@:ts.type("string")` to the type parameter T of inc.Constrained.tag
    // itself. The TypeScript printer reads it where T is used
    // (`TypeEmitter.emitType`), so cold prints `tag<string>`.
    id: "after-typing macro sets the type of a method type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markTpMeta = 1;\n")
  },
  {
    // M1 on the type parameter of the class inc.Constrained.ConstrainedBox.
    id: "after-typing macro sets the type of a class type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markBoxTpMeta = 1;\n")
  },
  {
    // M1 on the type parameter of the late class inc.LateEnum.LateBox: only
    // the late text of the final member list shows it.
    id: "after-typing macro sets the type of a type parameter of a class that the generator adds late",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markLateTpMeta = 1;\n")
  },
  {
    // S2: `@:ts.type("string")` on the late class inc.LateEnum.LateBox
    // itself; the late text of the final member list holds the class
    // metadata, so the request falls back.
    id: "after-typing macro sets the type of a class that the generator adds late",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markLateClassMeta = 1;\n"),
    // Slice S2: the plan of the clean module inc.LateUser loses its edge to
    // LateBox, with the same member list and stamps. The stored step to
    // LateBox records the class metadata (`checkStoredTarget`), so without
    // #249 the walk with stored edges left the recorded path there. Since
    // the merge with #249, the metadata comparison before the passes after
    // typing sees the change first: the session key changes and the request
    // generates in full, before any walk. It must never be `drift`.
    results: ["full"],
    reason: "inc.LateEnum"
  },
  {
    // The same metadata on a listed class (review of the merge of #246 into
    // slice S2): inc.Mark3Macro adds `@:ts.type("string")` to
    // inc.ListedTs.ListedBox, which dead-code elimination keeps. The clean
    // module inc.ListedUser names it only in a typedef field, so its plan
    // loses the edge to ListedBox although its member list and every stamp
    // stay the same.
    id: "after-typing macro sets the type of a listed class that a clean module names only in a type position",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var markListedClassMeta = 1;\n"),
    // The fingerprint of inc.ListedTs holds the class metadata, so the
    // request generates in full before any walk.
    results: ["full"]
  },
  {
    id: "no edit after the type of the listed class was set",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    // M3 of the cross-model review of #246: a structure field can declare
    // its own type parameter (`typedef FableApi = {function pick<T>(item:
    // T): T;}`). inc.FableMacro adds `@:ts.type("string")` to that `T`;
    // TypeScript prints it where `T` is used. Only the structure part of
    // the fingerprint of inc.FableProbe shows the change.
    id: "after-typing macro sets the type of a type parameter of a structure field in a typedef",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var fableAnonTp = 1;\n")
  },
  {
    // M3, the same shape in a structure in the argument type of a static.
    id: "after-typing macro sets the type of a type parameter of a structure field in a class field type",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var fableInlineTp = 1;\n")
  },
  {
    // M3 with L5: a structure in the constraint of the type parameter of a
    // structure field.
    id: "after-typing macro overrides an anonymous field in the constraint of a type parameter of a structure field",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var fableWideConstraint = 1;\n")
  },
  {
    // genes-f8vc.9.27, M2a of the review of #246: dead-code elimination
    // removes the class inc.TsTyped, so no generator list holds it, and the
    // walk never adds it (a type override adds no dependency edge).
    // inc.UnlistedMacro sets its `@:ts.type` to "string"; the printer of
    // inc.TsTypedUser prints the override in a typedef field. Only the
    // unlisted part of the fingerprint of inc.TsTyped shows the change.
    id: "after-typing macro changes the type override of a class that dead-code elimination removes",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var unlistedOverride = 1;\n")
  },
  {
    // M2b: inc.UnlistedMacro writes `@:value("lighter")` on the static
    // Light of the implementation class of the enum abstract inc.Shade.
    // `SignatureCache` reads the union of the values before dead-code
    // elimination removes the statics, and keeps it; the printer of
    // inc.ShadeUser prints it. Only the metadata comparison before the
    // passes after typing sees the change (`GenerationChangeSet
    // .compareMetadata`); compare mode was stale too before it.
    id: "after-typing macro changes the value metadata of an enum abstract value that dead-code elimination removes",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var unlistedValue = 1;\n")
  },
  {
    // Must fix 1 of the review of #249, control: the first use of the inline
    // method `thrice` of an extern class as a value makes Haxe add a wrapper
    // class to inc.FableMixPlain, which Haxe does not type again. No
    // metadata changes, so the request stays incremental.
    id: "a new class in a kept module without a metadata change",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static function fableThrice(): Int {\n    final f = inc.FableMixPlain.thrice;\n    return f(3);\n  }\n"),
    results: ["incremental"]
  },
  {
    // Must fix 1: in one request, Haxe adds the wrapper class of `twice` to
    // inc.FableMix, and inc.Fable3Macro writes `@:value("lighter")` on the
    // static Light of the enum abstract FableShade of the same module. The
    // new class arrives without a stamp; the other declarations keep theirs,
    // so their metadata must still be compared (it was skipped for the
    // whole module, and inc/FableMixUser.tsx kept "dark" | "light").
    id: "metadata changes in a module that gets a new class in the same request",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var fableMixValue = 1;\n  public static function fableTwice(): Int {\n    final f = inc.FableMix.twice;\n    return f(3);\n  }\n")
  },
  {
    // Control: the same kind of change in that module without a new class.
    id: "metadata changes in a module that gets no new class",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var fableMixValueOnly = 1;\n")
  },
  {
    // genes-f8vc.9.23, limit L3 of the round-3 review of genes-ts #244:
    // inc.ArgMetaMacro writes `@:ts.type("string")` on the local variable of
    // the argument `count` of inc.ArgMeta.show, which only the typed body of
    // `show` holds. Haxe does not type inc.ArgMeta again and no clean rule
    // reads that metadata, so reuse replays `count: number` where cold
    // prints `count: string`. The rolling replay audit prints inc.ArgMeta
    // again, sees the difference and drops the cache.
    id: "L3 after-typing macro writes metadata on the local variable of a method argument",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var argMetaType = 1;\n"),
    auditMismatch: ["inc.ArgMeta"]
  },
  {
    // Before the audit evicted it, the stale entry stayed: this request
    // replayed `count: number` again. Now reuse must generate in full here
    // (checked for every request after an audit difference).
    id: "L3 no edit after the audit dropped the cache",
    apply: () => {}
  },
  {
    id: "L3 no edit with the new cache",
    apply: () => {},
    results: ["incremental"]
  },
  {
    // The macro removes the metadata again: the same hole the other way.
    id: "L3 after-typing macro removes the metadata of the method argument",
    apply: () => edit("inc/Leaf2.hx",
      "class Leaf2 {\n  public static var argMetaType = 1;\n", "class Leaf2 {"),
    auditMismatch: ["inc.ArgMeta"]
  },
  {
    id: "L3 no edit after the second audit difference",
    apply: () => {}
  },
  {
    // Stage 3 slice S2 merged with #249 (journal note 2138): inc.Mark3Macro
    // removes `@:ts.type("number")` from the late class
    // inc.LateEnum.LateTyped. While the class had the override, the plan of
    // the clean module inc.LateUser had no edge to it, so no stored step
    // names it, and `checkStoredTarget` cannot see the change. Two checks of
    // #249 each see it: the metadata comparison before the passes after
    // typing (`GenerationChangeSet.compareMetadata`, a new session key) and
    // the unlisted part of the fingerprint of inc.LateEnum
    // (`ModuleFingerprint.unlisted`). Either one makes the request fall back
    // to a full generation. With both switched off, the walk with stored
    // edges keeps the old path: compare reports drift and reuse publishes a
    // stale tree.
    id: "after-typing macro removes the type override of a late class that no stored step names",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var unmarkLateTyped = 1;\n"),
    results: ["full"],
    reason: "inc.LateEnum"
  },
  {
    // The next request compares with the one before, so it is incremental
    // again, and its tree must still equal the cold build.
    id: "no edit after the type override of a late class was removed",
    apply: () => {},
    results: ["incremental"]
  },
  {
    // Must fix of the review of genes-ts #247 (Stage 3 S2). inc.ExcludeMacro
    // calls `exclude()` on the enum inc.ExclOwner.ExclEarly, before the
    // after-typing passes of Genes. That makes the enum extern with no new
    // stamp and no metadata change. inc.ExclHintUser names the enum only in
    // a typedef field; the live walk takes no step to an extern declaration,
    // so the enum leaves inc/ExclOwner.tsx and its type import leaves
    // inc/ExclHintUser.tsx. The class comes first in inc.ExclOwner, and the
    // walk visits inc.ExclHintUser first: its stored step would add the enum
    // back before the visit of inc.ExclOwner, so the member list of that
    // visit matches the record. Only `checkStoredTarget`, which compares the
    // target facts of each stored step (extern flag and metadata), left
    // the recorded path here. With the extern flag out of those facts,
    // compare reported drift and reuse published a stale tree.
    //
    // Since genes-zt9w, `ModuleFingerprint.of` puts an extern enum after
    // the declarations that can be printed, so the enum moves in the text
    // of inc.ExclOwner, and rule 6 falls back first, before any walk. The
    // `ExclTail` rows below keep `checkStoredTarget` the first catch.
    id: "after-typing macro makes an enum extern before the Genes passes",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var excludeEarly = 1;\n"),
    results: ["full"],
    reason: "the fingerprint of a module that was not typed again changed: inc.ExclOwner",
    walk: "none"
  },
  {
    id: "no edit after an enum was made extern before the Genes passes",
    apply: () => {},
    results: ["incremental"],
    walk: "on-path"
  },
  {
    // The same with the enum inc.ExclOwner.ExclLate, excluded after the
    // after-typing passes of Genes, so they never see the change. Rule 6
    // falls back first here too (genes-zt9w).
    id: "after-typing macro makes an enum extern after the Genes passes",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var excludeLate = 1;\n"),
    results: ["full"],
    reason: "the fingerprint of a module that was not typed again changed: inc.ExclOwner",
    walk: "none"
  },
  {
    id: "no edit after an enum was made extern after the Genes passes",
    apply: () => {},
    results: ["incremental"],
    walk: "on-path"
  },
  {
    // genes-zt9w: the same as the first exclude row, with the enum
    // inc.ExclTail.ExclTailEnum. It is the last declaration of its module,
    // and the module has no abstract and no extern declaration, so the
    // fingerprint text of inc.ExclTail stays the same when the enum moves to
    // the sorted group of declarations that are never printed (and an
    // enum's text has no extern flag). inc.ExclHintTail names the enum only
    // in a typedef field, and the walk visits it first (its path sorts
    // first), so its stored step would add the enum back before the visit
    // of inc.ExclTail, whose member list then matches the record. So
    // `checkStoredTarget` is the first check that leaves the recorded path.
    // The live walk then drops the enum from the member list of
    // inc.ExclTail, and the request generates in full.
    id: "after-typing macro makes the last enum of a module extern",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var excludeTail = 1;\n"),
    results: ["full"],
    walk: "left"
  },
  {
    id: "no edit after the last enum of a module was made extern",
    apply: () => {},
    results: ["incremental"],
    walk: "on-path"
  },
  {
    // genes-f8vc.9.27, S3 of the review of genes-ts #246: inc.BodyMetaMacro
    // sets `@:ts.type("string")` on the field `lv` of the structure in the
    // constraint of the type parameter of a local function of inc.BodyMeta.
    // Only the typed body of `BodyMeta.value` holds that structure, so no
    // fingerprint and no metadata comparison sees the change. The answer
    // that inc.BodyMeta recorded for the type parameters of the local
    // function (`SignatureCache.localTypeParameters`) differs now, so the
    // request falls back.
    id: "after-typing macro overrides an anonymous field in the constraint of a local function type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyConstraint = 1;\n"),
    results: ["full"],
    reason: "inc.BodyMeta"
  },
  {
    id: "no edit after the constraint of a local function type parameter was marked",
    apply: () => {},
    results: ["incremental"]
  },
  {
    // The same for `@:ts.type` on the type parameter of a local function.
    id: "after-typing macro sets the type of a local function type parameter",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyParam = 1;\n"),
    results: ["full"],
    reason: "inc.BodyMeta"
  },
  {
    // The field `bv` of the structure in the declared type of a local
    // variable: the recorded answer of the local's declared type.
    id: "after-typing macro overrides an anonymous field in the type of a local variable",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyLocalType = 1;\n"),
    results: ["full"],
    reason: "inc.BodyMeta"
  },
  {
    // The field `av` of the structure in the type of an argument of a local
    // function.
    id: "after-typing macro overrides an anonymous field in the type of a local function argument",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyArgType = 1;\n"),
    results: ["full"],
    reason: "inc.BodyMeta"
  },
  {
    id: "no edit after the body metadata marks",
    apply: () => {},
    results: ["incremental"]
  },
  {
    // Review of genes-ts #258: a class initializer (`__init__` of
    // inc.BodyInit) is a body too. The field `sv` of the structure in the
    // declared type of its local `seen` gets `@:ts.type("string")`. Without
    // a kept holder for that body, reuse replayed `sv: number` where cold
    // prints `sv: string`.
    id: "after-typing macro overrides an anonymous field in the type of a local variable of a class initializer",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyInitType = 1;\n"),
    results: ["full"],
    reason: "inc.BodyInit"
  },
  {
    // The local function `ident<I: {iv: Int}>` of the initializer of
    // inc.BodyInitGeneric: without a kept holder its answer could not be
    // asked again, and every request with a cache generated in full (every
    // no-edit row was red). Now the recorded answer differs, and only this
    // request falls back.
    id: "after-typing macro overrides an anonymous field in the constraint of a local function type parameter of a class initializer",
    apply: () => edit("inc/Leaf2.hx", "class Leaf2 {",
      "class Leaf2 {\n  public static var bodyInitConstraint = 1;\n"),
    results: ["full"],
    reason: "inc.BodyInitGeneric"
  },
  {
    id: "no edit after the class initializer marks",
    apply: () => {},
    results: ["incremental"],
    settled: true
  },
  // Declaration order (genes-zt9w). Haxe 4.3.7 builds the generator list
  // by module path, but adds the parent class, the interfaces and the types
  // that a static initializer reaches before a class. So the declarations
  // of a module that Haxe does not type again can come in another order.
  // In Caffeine, the first warm request after a cold build moved
  // `haxe.Constraints.IMap` from last to first, and every module fell back
  // to a full generation. Here a static initializer of `inc.OrderA` creates
  // `inc.OrderZ`, so the interface `inc.OrderM` moves before the extern
  // class `inc.OrderM.OrderMNative`. The member list of `inc.OrderM` stays
  // `OrderM` alone, so the output is the same and the request must replay.
  {
    id: "ORDER a static initializer moves the declarations of a module that Haxe does not type again",
    apply: () => edit("inc/OrderA.hx", "/*ORDER_SEED*/",
      "public static var seed: OrderM = new OrderZ(); /*ORDER_SEED*/"),
    results: ["incremental"]
  },
  {
    id: "ORDER no edit after the declarations moved",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ORDER the static initializer is removed, the declarations move back",
    apply: () => edit("inc/OrderA.hx",
      "public static var seed: OrderM = new OrderZ(); /*ORDER_SEED*/",
      "/*ORDER_SEED*/"),
    results: ["incremental"]
  },
  {
    id: "ORDER no edit after the declarations moved back",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  // A real member swap: `OrderPairB` moves before `OrderPairA`, so the
  // printed order of `inc.OrderPair` changes. The request must generate in
  // full, with the tree equal to cold.
  {
    id: "ORDER a static initializer swaps two members of a module that Haxe does not type again",
    apply: () => edit("inc/OrderA.hx", "/*ORDER_SEED*/",
      "public static var pair: Int = inc.OrderPair.OrderPairB.size(); /*ORDER_SEED*/"),
    results: ["full"]
  },
  {
    id: "ORDER no edit after the members swapped",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ORDER the members swap back",
    apply: () => edit("inc/OrderA.hx",
      "public static var pair: Int = inc.OrderPair.OrderPairB.size(); /*ORDER_SEED*/",
      "/*ORDER_SEED*/"),
    results: ["full"]
  },
  {
    id: "ORDER no edit after the members swapped back",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  // Two classes of `inc.OrderTwin` share the emitted name `OrderTwinX`.
  // `Module.addTypes` prints the first in list order, and their member-list
  // lines are equal. When `OrderTwinB` moves first, the printed body
  // changes; only the fingerprint in list order sees it (review of
  // genes-ts #262). The request must generate in full.
  {
    id: "ORDER a static initializer moves the second of two classes with one emitted name first",
    apply: () => edit("inc/OrderA.hx", "/*ORDER_SEED*/",
      "public static var twin: String = inc.OrderTwin.OrderTwinB.id(); /*ORDER_SEED*/"),
    results: ["full"],
    reason: "inc.OrderTwin"
  },
  {
    // Safe but slow, while `inc.OrderA` names `OrderTwinB`: its stored step
    // names `class:inc.OrderTwin.OrderTwinX`, which two declarations share,
    // so the walk with stored edges leaves the recorded path and nothing is
    // replayed. The silent drop of the second declaration in
    // `Module.addTypes` is filed separately. The tree must still equal cold.
    id: "ORDER no edit after the twin moved (leaves the stored walk)",
    apply: () => {},
    walk: "left"
  },
  {
    id: "ORDER the twin moves back",
    apply: () => edit("inc/OrderA.hx",
      "public static var twin: String = inc.OrderTwin.OrderTwinB.id(); /*ORDER_SEED*/",
      "/*ORDER_SEED*/"),
    results: ["full"],
    reason: "inc.OrderTwin"
  },
  {
    id: "ORDER no edit after the twin moved back",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  // Import aliases (genes-44h0). `import X as Alias` makes Haxe 4.3.7
  // create a private typedef of the importing module that is in no
  // declaration list; `TypedModuleInventory.importAlias` finds it, so the
  // walk with stored edges can take a stored step to it. `inc.AliasUser`
  // reads fields typed `AliasedShape` (from `inc.AliasModel`) and `HxShape`
  // (from `inc/aliashx/import.hx`). Each change below is followed by a
  // request with no edit, which must replay and stay on the recorded path.
  {
    id: "ALIAS the target of an alias is edited, the importer is untouched",
    apply: () => edit("inc/AliasShape.hx", "final id: Int; /*ALIAS_SHAPE_FIELD*/",
      "final id: Int;\n  final ?label: String; /*ALIAS_SHAPE_FIELD*/")
  },
  {
    id: "ALIAS no edit after the target edit",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ALIAS the target edit is undone",
    apply: () => edit("inc/AliasShape.hx",
      "final id: Int;\n  final ?label: String; /*ALIAS_SHAPE_FIELD*/",
      "final id: Int; /*ALIAS_SHAPE_FIELD*/")
  },
  {
    id: "ALIAS the alias points at another type of the same shape",
    apply: () => edit("inc/AliasModel.hx", "import inc.AliasShape as AliasedShape;",
      "import inc.AliasShapeTwin as AliasedShape;")
  },
  {
    id: "ALIAS no edit after the retarget",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ALIAS the alias points back",
    apply: () => edit("inc/AliasModel.hx", "import inc.AliasShapeTwin as AliasedShape;",
      "import inc.AliasShape as AliasedShape;")
  },
  {
    // The alias comes from `import.hx`; no module file changes.
    id: "ALIAS the import.hx alias points at another type of the same shape",
    apply: () => edit("inc/aliashx/import.hx", "import inc.AliasShape as HxShape;",
      "import inc.AliasShapeTwin as HxShape;")
  },
  {
    id: "ALIAS no edit after the import.hx retarget",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ALIAS the import.hx alias points back",
    apply: () => edit("inc/aliashx/import.hx", "import inc.AliasShapeTwin as HxShape;",
      "import inc.AliasShape as HxShape;")
  },
  {
    // `inc.AliasUser` keeps using `inc.AliasModel`, but no longer reads the
    // field typed with the alias, so no other module names `AliasedShape`.
    id: "ALIAS the only other module stops naming the alias",
    apply: () => edit("inc/AliasUser.hx",
      "final shape = new AliasModel().shape; /*ALIAS_MODEL_USE*/",
      "final model = new AliasModel();\n    final shape = {id: model == null ? 0 : 1}; /*ALIAS_MODEL_USE*/")
  },
  {
    id: "ALIAS no edit after the alias lost its other user",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "ALIAS the other module names the alias again",
    apply: () => edit("inc/AliasUser.hx",
      "final model = new AliasModel();\n    final shape = {id: model == null ? 0 : 1}; /*ALIAS_MODEL_USE*/",
      "final shape = new AliasModel().shape; /*ALIAS_MODEL_USE*/")
  },
  {
    id: "ALIAS no edit with the alias named again",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    // The known miss (genes-cil5): only the inline helper
    // `inc.AliasInline.make` names the alias `InlinePt`. Haxe inlines the
    // call and dead-code elimination removes `make` but keeps the class for
    // `label`, so no surviving declaration of `inc.AliasInline` names the
    // alias, while the inferred return type of `inc.AliasUser.made` still
    // does.
    id: "ALIAS an inlined helper is the only declaration that names an alias",
    apply: () => {
      edit("inc/AliasUser.hx", "class AliasUser {",
        "class AliasUser {\n  static function made()\n    return AliasInline.make();\n");
      edit("inc/AliasUser.hx", "/*ALIAS_INLINE_USE*/",
        "if (made().id < 0)\n      return AliasInline.label(); /*ALIAS_INLINE_USE*/");
    }
  },
  {
    // Safe but slow: the stored walk cannot find `InlinePt` (the report's
    // `walk.left` names `typedef:inc.AliasInline.InlinePt`), so it leaves the
    // recorded path in every request while the use stays, and nothing is
    // replayed. The gate still checks that the tree equals the cold build.
    id: "ALIAS no edit while only an inlined helper names the alias (known miss, genes-cil5)",
    apply: () => {},
    walk: "left"
  },
  {
    id: "ALIAS the inlined helper use is removed",
    apply: () => {
      edit("inc/AliasUser.hx",
        "class AliasUser {\n  static function made()\n    return AliasInline.make();\n",
        "class AliasUser {");
      edit("inc/AliasUser.hx",
        "if (made().id < 0)\n      return AliasInline.label(); /*ALIAS_INLINE_USE*/",
        "/*ALIAS_INLINE_USE*/");
    }
  },
  {
    id: "ALIAS no edit after the inlined helper use",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    walk: "on-path"
  },
  {
    id: "no edit at the end",
    apply: () => {},
    results: ["incremental"],
    settled: true,
    dirtyModules: [lateModule]
  }
];

function outputRoot(mode: Mode): string {
  return path.join(tempRoot, ...output.folders, `${mode}${output.suffix}`);
}

function buildArguments(mode: Mode): string[] {
  return [
    "-cp", path.join(repoRoot, "src"),
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    "--macro", 'haxe.macro.Compiler.nullSafety("genes", Loose, true)',
    "--macro", "inc.ExcludeMacro.installAfter()",
    "--macro", "genes.Generator.use()",
    "--macro", "genes.js.Async.enable()",
    "--macro", "genes.react.InlineMarkup.enable()",
    "--macro", "genes.react.ReactDiagnosticsMacro.install()",
    "--macro", "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "-cp", path.join(workspace, "src"),
    "-cp", partedClassPath,
    "--macro", "inc.LateMacro.install()",
    "--macro", "inc.CloneMacro.install()",
    "--macro", "inc.FailMacro.install()",
    "--macro", "inc.MarkMacro.install()",
    "--macro", "inc.Mark2Macro.install()",
    "--macro", "inc.Mark3Macro.install()",
    "--macro", "inc.ArgMetaMacro.install()",
    "--macro", "inc.FableMacro.install()",
    "--macro", "inc.UnlistedMacro.install()",
    "--macro", "inc.Fable3Macro.install()",
    "--macro", "inc.BodyMetaMacro.install()",
    "--macro", "inc.ExcludeMacro.installBefore()",
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
      // Sources below the gate folder get relative source-map names, also
      // the classpath inside a candidate folder (`partedClassPath`).
      `genes.source_map_root=${tempRoot}`,
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
 * is the digest of the arguments that a cold build of this request receives,
 * without the `-js` path. The development session names each candidate
 * folder in a descriptor file (`-D genes.output_descriptor`), so its
 * arguments, and its digest, stay the same when the folder changes.
 */
function writeDescriptor(): void {
  const output = path.join(outputRoot("shadow"), "index.tsx");
  const digest = createHash("sha256")
    .update(buildArguments("shadow")
      .map((argument) => argument === output ? "<output>" : argument)
      .join("\0"))
    .digest("hex");
  writeFileSync(
    descriptorFile,
    JSON.stringify({
      format: 1,
      programDigest: digest,
      kind: "full",
      afterTyping: request.afterTyping,
      generation: request.generation,
      audit: { modules: options.auditModules, seed: 0 }
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
 * Returns the warnings that Genes reports while it reads the type list,
 * sorted: today "Extern __init__ methods are not supported" with
 * `-D genes.extern_init_warning`. A request reports each of them once, also
 * when it generates a second time after it left the walk with stored edges
 * (slice S2).
 */
function generatorWarnings(result: ProcessResult): ReadonlyArray<string> {
  return `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((line) => line.includes("Extern __init__ methods are not supported"))
    .map((line) => line.trim())
    .sort();
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
  readonly cacheAnswerBytes: number;
  readonly replayed: number;
  readonly reason: string;
  /** The walk verdict, why it left, and its pass and times (slice S2). */
  readonly walk: string;
  readonly walkLeft: string;
  readonly walkPass: string;
  readonly storedWalkMs: number;
  readonly liveWalkMs: number;
  /** Modules that the rolling replay audit printed again, and its time. */
  readonly audited: number;
  readonly auditMs: number;
};

/** Runs one read-only Git command in the repository and returns its output. */
function runGit(args: ReadonlyArray<string>): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8" });
}

/** Returns true when one of the `--only` entries selects the edit `id`. */
function selected(entries: ReadonlyArray<string>, id: string): boolean {
  return entries.some((entry) => entry.startsWith("=")
    ? id === entry.slice(1)
    : id.includes(entry));
}

/** Puts every value that an edit can change back to its first state. */
function resetState(mode: GenerationMode): void {
  currentMode = mode;
  program.defines = options.reactRefresh ? ["genes.react_refresh_modules"] : [];
  program.modules = [
    "inc.Leaf", "inc.Leaf2", "inc.Clock", "inc.Embedded", "inc.Legacy",
    "inc.OrderA", "inc.OrderZ", "inc.OrderPair", "inc.OrderTwin",
    "inc.ExclHintTail", "inc.ExclTail"
  ];
  request.afterTyping = "reuse";
  request.generation = mode;
  output.folders = ["out"];
  output.suffix = "";
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(template, workspace, { recursive: true });
  mkdirSync(path.dirname(partedClassPath), { recursive: true });
  cpSync(path.join(workspace, "gen"), partedClassPath, { recursive: true });
}

type PassResult = {
  readonly mode: GenerationMode;
  readonly rows: ReadonlyArray<Row>;
  readonly replayed: number;
  readonly edits: number;
};

async function main(): Promise<void> {
  // Evidence: the exact commit and working tree that this run tests.
  const head = runGit(["rev-parse", "HEAD"]);
  const status = runGit(["status", "--short"]);
  process.stdout.write(`compiler-server-shadow: HEAD ${head.trim()}\n`
    + `compiler-server-shadow: git status --short: `
    + `${status.trim().length === 0 ? "(clean)" : "\n" + status}\n`);
  const results: PassResult[] = [];
  let probeLine = "";
  const loadAtStart = loadavg()[0] ?? 0;
  for (const mode of options.modes) {
    resetState(mode);
    const compiler = selectedHaxeCompiler(repoRoot);
    if (probeLine.length === 0)
      probeLine = options.skipProbe
        ? "clean-rule probe skipped"
        : await assertCleanRuleProbe(compiler);
    results.push(await runPass(mode, compiler));
  }
  const loadAtEnd = loadavg()[0] ?? 0;
  const timing = Math.max(loadAtStart, loadAtEnd) <= 2
    ? "quiet machine"
    : "diagnostic: 1-minute load above 2.0";
  writeFileSync(path.join(tempRoot, "summary.json"),
    JSON.stringify({ loadAtStart, loadAtEnd, results }, null, 2));
  printTimeComparison(results);
  const partial = options.only !== null || options.skipPlain
    || options.skipProbe || options.auditModules < 1_000_000;
  const counts = results.map((result) =>
    `${result.mode}: ${result.edits} edits, ${result.replayed} replayed modules`
    + (result.mode === "reuse" ? `, audit ${options.auditModules === 0 ? "off" : options.auditModules >= 1_000_000 ? "all" : String(options.auditModules)}` : ""))
    .join("; ");
  process.stdout.write(
    `compiler-server-shadow:${partial ? "partial" : "ok"} (Haxe `
    + `${selectedHaxeCompiler(repoRoot).version}; `
    + `${options.reactRefresh ? "-D genes.react_refresh_modules; " : ""}`
    + `${probeLine}; ${counts}; `
    + `G0 warm equals cold, G1 0 mismatches and trees equal cold, G2 no `
    + `stamp without the define; times ${timing}, load `
    + `${loadAtStart.toFixed(1)} to ${loadAtEnd.toFixed(1)})\n`
  );
}

/**
 * Prints, for each edit that both passes ran, the generation time of the
 * compare pass (every module printed) and of the reuse pass, and the number
 * of replayed modules. Diagnostic only: the fixture is small and the
 * machine is shared.
 */
function printTimeComparison(results: ReadonlyArray<PassResult>): void {
  const compare = results.find((result) => result.mode === "compare");
  const reuse = results.find((result) => result.mode === "reuse");
  if (compare === undefined || reuse === undefined)
    return;
  process.stdout.write("edit | compare generation ms | reuse generation ms "
    + "without the audit | replayed\n");
  let saved = 0;
  let counted = 0;
  for (const row of reuse.rows) {
    const other = compare.rows.find((entry) => entry.id === row.id);
    if (other === undefined || row.replayed === 0)
      continue;
    // The audit runs after publication: leave its time out of the
    // comparison (it is printed per request in the reuse table).
    const reuseMs = row.generationMs - row.auditMs;
    saved += other.generationMs - reuseMs;
    counted++;
    process.stdout.write(`${row.id} | ${other.generationMs} | ${reuseMs} | ${row.replayed}\n`);
  }
  if (counted > 0)
    process.stdout.write(`mean generation time saved on ${counted} replaying `
      + `edits: ${(saved / counted).toFixed(1)} ms (diagnostic)\n`);
  // Slice S2: the walk time of the compare pass (its live walk) against
  // the reuse pass that kept the walk with stored edges.
  let walkSaved = 0;
  let walkCounted = 0;
  for (const row of reuse.rows) {
    const other = compare.rows.find((entry) => entry.id === row.id);
    if (other === undefined || row.walkPass !== "stored")
      continue;
    walkSaved += other.liveWalkMs - row.storedWalkMs - row.liveWalkMs;
    walkCounted++;
  }
  if (walkCounted > 0)
    process.stdout.write(`mean reachability time saved on ${walkCounted} `
      + `edits that kept the walk with stored edges: `
      + `${(walkSaved / walkCounted).toFixed(1)} ms (diagnostic)\n`);
}

/** Runs the edit list once with one `generation` value. */
async function runPass(
  mode: GenerationMode,
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<PassResult> {
  let plain = options.skipPlain
    ? null
    : await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  let shadow = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  const rows: Row[] = [];
  const g1Failures: string[] = [];
  const plainProbe = path.join(tempRoot, "plain.stamps.txt");
  const shadowProbe = path.join(tempRoot, "shadow.stamps.txt");
  let replayedTotal = 0;
  let auditedTotal = 0;
  let editsRun = 0;
  // True after a reuse request whose audit dropped the cache: the next
  // request must generate in full and equal the cold tree.
  let afterAuditDrop = false;
  try {
    for (const [index, step] of edits.entries()) {
      if (index > 0 && options.only !== null && !selected(options.only, step.id))
        continue;
      editsRun++;
      const label = `[${mode} ${index + 1}/${edits.length}] ${step.id}`;
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
      const warm = plain === null
        ? null
        : await plain.compile(warmArguments("plain", plainProbe),
          `Plain ${label}`, timeoutMs, workspace);
      let shadowed = await shadow.compile(warmArguments("shadow", shadowProbe),
        `Shadow ${label}`, timeoutMs, workspace);
      if (step.fails === true) {
        ok(cold.code !== 0, `${label}: the cold build must fail`);
        ok(warm === null || warm.code !== 0,
          `${label}: the plain warm request must fail`);
        ok(shadowed.code !== 0, `${label}: the shadow request must fail`);
        if (step.sameErrors === true) {
          strictEqual(shadowed.stderr, cold.stderr,
            `${label}: the shadow request must report the errors of the cold build`);
          ok(warm === null || warm.stderr === cold.stderr,
            `${label}: the plain warm request must report the errors of the cold build`);
        }
        const report = readReport();
        ok(
          report === null || (report.result === "failed" && !report.committed),
          `${label}: a failed request must not report a committed generation`
        );
        rows.push({
          id: step.id, result: report === null ? "failed before generation" : "failed",
          typedAgain: 0, emitted: 0, clean: 0, mismatches: 0,
          fallbackLookups: 0, generationMs: 0, projectedMs: 0, overheadMs: 0,
          cacheBytes: 0, cacheAnswerBytes: 0, replayed: 0, reason: "",
          walk: "failed", walkLeft: "", walkPass: "", storedWalkMs: 0,
          liveWalkMs: 0, audited: 0, auditMs: 0
        });
        continue;
      }
      if (step.failsAfterCommit === true) {
        ok(cold.code !== 0, `${label}: the cold build must fail`);
        ok(warm === null || warm.code !== 0,
          `${label}: the plain warm request must fail`);
        ok(shadowed.code !== 0, `${label}: the shadow request must fail`);
      } else {
        ok(cold.code === 0, `${label}: cold build failed\n${describe(cold)}`);
        ok(warm === null || warm.code === 0,
          `${label}: plain warm request failed\n${warm === null ? "" : describe(warm)}`);
        ok(shadowed.code === 0, `${label}: shadow request failed\n${describe(shadowed)}`);
      }
      const coldTree = hashTree(outputRoot("cold"));
      if (options.reactRefresh && step.refreshFiles !== undefined) {
        const paths = new Set(coldTree.map((entry) => entry.path));
        for (const file of step.refreshFiles.present)
          ok(paths.has(file), `${label}: the split file ${file} is missing`);
        for (const file of step.refreshFiles.absent)
          ok(!paths.has(file), `${label}: the stale file ${file} is still published`);
      }
      if (warm !== null) {
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
      }
      let report = readReport();
      ok(report !== null, `${label}: the shadow wrote no report`);
      if (step.failsAfterCommit === true) {
        ok(report.committed, `${label}: the failure after the commit must `
          + "find a committed generation");
      }
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
      // G1: the shadow published the cold tree; in compare mode every module
      // that reuse would replay also had the bytes that the full generation
      // staged.
      // A known hole (`auditMismatch`) leaves stale files of the named
      // modules in the tree of a reuse request: the audit runs after
      // publication. Every other file must equal the cold tree.
      const holeModules = step.auditMismatch ?? [];
      const holeFile = (file: string): boolean => mode === "reuse"
        && holeModules.some((module) =>
          file.startsWith(`${module.split(".").join("/")}.`));
      const shadowDifference = treeDifference(hashTree(outputRoot("shadow")),
        coldTree).filter((file) => !holeFile(file));
      deepStrictEqual(
        shadowDifference,
        [],
        `G1 failed at ${label}: the shadow request published a tree that `
        + `differs from the cold build:\n${shadowDifference.join("\n")}`
      );
      // Mismatches are collected over all edits, so that one run lists every
      // cause; the gate fails at the end. Compare must report the modules of
      // a known hole, and only those.
      const compareHole = new Set<string>();
      for (const mismatch of report.mismatches) {
        if (holeModules.includes(mismatch.module)) {
          compareHole.add(mismatch.module);
          continue;
        }
        g1Failures.push(`${label}: ${mismatch.module} ${mismatch.path} `
          + `${mismatch.kind} at line ${mismatch.line}\n  stored: `
          + `${mismatch.stored}\n  staged: ${mismatch.staged}`);
      }
      if (mode === "compare" && report.result !== "off")
        deepStrictEqual([...compareHole].sort(), [...holeModules].sort(),
          `${label}: compare must report the stale output of the known hole`);
      // The rolling replay audit (reuse): no difference except the modules
      // of a known hole, and those must be found, evicted and warned about.
      const auditFound = new Set<string>();
      for (const mismatch of report.audit?.mismatches ?? []) {
        if (holeModules.includes(mismatch.module)) {
          auditFound.add(mismatch.module);
          process.stdout.write(`${label}: the replay audit found the known `
            + `hole: ${mismatch.module} ${mismatch.path} ${mismatch.kind} at `
            + `line ${mismatch.line}; stored: ${mismatch.stored}; printed: `
            + `${mismatch.staged}\n`);
          continue;
        }
        g1Failures.push(`${label}: the replay audit found ${mismatch.module} `
          + `${mismatch.path} ${mismatch.kind} at line ${mismatch.line}\n  `
          + `stored: ${mismatch.stored}\n  printed: ${mismatch.staged}`);
      }
      // With `--audit=off` nothing is printed again: the stale files stay
      // published, and the next request shows that they stay in the cache.
      if (mode === "reuse" && holeModules.length > 0
        && options.auditModules > 0) {
        deepStrictEqual([...auditFound].sort(), [...holeModules].sort(),
          `${label}: the rolling replay audit did not report the stale `
          + `output of the known hole (audited: `
          + `${(report.audit?.audited ?? []).join(" ")})`);
        ok(report.audit.cacheDropped && !report.cacheStored,
          `${label}: the audit difference did not drop the generation cache`);
        ok(`${shadowed.stdout}\n${shadowed.stderr}`
          .includes("GENES-INCREMENTAL-AUDIT-001"),
          `${label}: the request did not warn with GENES-INCREMENTAL-AUDIT-001`);
      }
      if (afterAuditDrop) {
        // The tree comparison above already required the cold tree.
        strictEqual(report.result, "full",
          `${label}: the request after an audit difference must generate in `
          + `full (${String(report.reason)})`);
        strictEqual(report.replayed, 0,
          `${label}: the request after an audit difference replayed modules`);
      }
      afterAuditDrop = mode === "reuse" && (report.audit?.cacheDropped ?? false);
      if (mode === "reuse" && report.result !== "off"
        && options.auditModules > 0)
        strictEqual(report.audit.audited.length,
          Math.min(options.auditModules, report.replayed),
          `${label}: the audit printed ${report.audit.audited.length} of `
          + `${report.replayed} replayed modules`);
      auditedTotal += report.audit?.audited.length ?? 0;
      // Diagnostics are output too: each request reports the warnings of the
      // cold build, also for a module that Haxe did not type again or whose
      // stored output was replayed.
      const coldWarnings = printWarnings(cold);
      ok(coldWarnings.length > 0,
        `${label}: the cold build reported no __js__ warning`);
      if (warm !== null)
        deepStrictEqual(printWarnings(warm), coldWarnings,
          `G0 failed at ${label}: the plain warm request reported other `
          + "print warnings than the cold build");
      deepStrictEqual(printWarnings(shadowed), coldWarnings,
        `G1 failed at ${label}: the shadow request reported other print `
        + "warnings than the cold build");
      const coldGeneratorWarnings = generatorWarnings(cold);
      if (warm !== null)
        deepStrictEqual(generatorWarnings(warm), coldGeneratorWarnings,
          `G0 failed at ${label}: the plain warm request reported other `
          + "generator warnings than the cold build");
      deepStrictEqual(generatorWarnings(shadowed), coldGeneratorWarnings,
        `G1 failed at ${label}: the shadow request reported other generator `
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
      const measured = !(mode === "measure" && step.notMeasured === true);
      if (step.results !== undefined && measured) {
        ok(
          step.results.includes(report.result),
          `${label}: shadow result ${report.result} (${String(report.reason)}); `
          + `expected ${step.results.join(" or ")}`
        );
      }
      if (step.reason !== undefined && measured) {
        ok(
          (report.reason ?? "").includes(step.reason),
          `${label}: shadow reason ${String(report.reason)}; expected it to `
          + `contain ${JSON.stringify(step.reason)}`
        );
      }
      if (step.mode !== undefined && measured) {
        strictEqual(report.mode, step.mode === "current" ? mode : step.mode,
          `${label}: shadow mode`);
      }
      if (step.refusal !== undefined && measured) {
        strictEqual(report.refusal, `${mode}-${step.refusal}`,
          `${label}: refusal code`);
        strictEqual(report.mismatches.length, 0,
          `${label}: a refused request compared files`);
        strictEqual(report.replayed, 0, `${label}: a refused request replayed`);
      }
      if (report.mode !== "compare") {
        strictEqual(report.mismatches.length, 0,
          `${label}: a ${report.mode} request compared files`);
      }
      if (report.mode !== "reuse") {
        strictEqual(report.replayed, 0,
          `${label}: a ${report.mode} request replayed modules`);
      }
      // genes-wcd0: a replayed module is not printed, so no stage needs its
      // typed bodies. Reading them was most of the inventory stage of a warm
      // Caffeine edit. The count does not depend on host speed.
      if (measured) {
        strictEqual(report.replayedBodyReads, 0,
          `${label}: Genes read ${report.replayedBodyReads} typed bodies of `
          + `the ${report.replayed} replayed modules`);
      }
      const emittedModules: ShadowReport["modules"] = report.modules;
      for (const name of step.dirtyModules ?? []) {
        const entry = emittedModules.find((item) => item.module === name);
        ok(entry !== undefined, `${label}: ${name} was not emitted`);
        strictEqual(entry.state, "dirty", `${label}: ${name} must be dirty`);
      }
      if (step.settled === true) {
        // `inc.Late` and `inc.Clone` are defined anew in every request (see
        // `macroModules`).
        deepStrictEqual(
          report.typedAgainModules.filter((module) => !macroModules.includes(module)),
          [],
          `${label}: Haxe typed modules again with no edit`
        );
        ok(report.clean > 0, `${label}: no module was clean with no edit`);
        strictEqual(report.planFallback, null,
          `${label}: the checks before emission fell back with no edit`);
        // With no edit, every module is replayed (reuse) or would be
        // (compare), except the modules that are never clean.
        const neverClean = new Set([rootModule, ...macroModules,
          ...emissionFeatureModules, ...report.haxePrinterModuleNames]);
        const leftOut = emittedModules
          .filter((entry) => entry.state === "dirty" && !neverClean.has(entry.module))
          .map((entry) => entry.module);
        deepStrictEqual(leftOut, [],
          `${label}: modules that a request with no edit did not replay`);
        if (mode === "reuse") {
          ok(report.replayed > 0, `${label}: nothing was replayed with no edit`);
          strictEqual(report.replayed, report.clean,
            `${label}: a clean module was not replayed`);
        }
        // Slice S2: with no edit the walk with stored edges stays on the
        // recorded path; reuse keeps it and builds no plan of a clean module.
        strictEqual(report.walk.verdict, "on-path",
          `${label}: the walk left the recorded path with no edit `
          + `(${String(report.walk.left)})`);
        if (mode === "reuse")
          ok(report.walk.pass === "stored" && report.walk.storedVisits > 0,
            `${label}: reuse did not keep the walk with stored edges `
            + `(${report.walk.pass}, ${report.walk.storedVisits} stored visits)`);
      }
      if (report.result !== "off") {
        // Slice S2: a recorded member list never has other steps than the
        // live plan, and the two walks of compare never differ.
        ok(report.walk.verdict !== "drift",
          `${label}: the walk with stored edges drifts from the live walk: `
          + `${String(report.walk.left)} ${String(report.walk.walksDiffer)}`);
      }
      if (step.walk !== undefined) {
        strictEqual(report.walk.verdict, step.walk,
          `${label}: walk verdict (${String(report.walk.left)})`);
      }
      replayedTotal += report.replayed;
      rows.push(row(step.id, report));
      // Keep the evidence of the edits so far, also when a later edit fails.
      writeFileSync(path.join(tempRoot, `progress-${mode}.json`),
        JSON.stringify({ rows, g1Failures }, null, 2));
    }
  } finally {
    await plain?.stop();
    await shadow.stop();
  }
  process.stdout.write(
    `[${mode}] edit | result | typed again | emitted | clean | replayed | `
    + "mismatches | generation ms | projected ms | overhead ms | cache bytes "
    + "| answer bytes | walk | walk pass | stored walk ms | live walk ms "
    + "| audited | audit ms\n"
  );
  for (const entry of rows) {
    process.stdout.write(
      `${entry.id} | ${entry.result} | ${entry.typedAgain} | ${entry.emitted} `
      + `| ${entry.clean} | ${entry.replayed} | ${entry.mismatches} `
      + `| ${entry.generationMs} | ${entry.projectedMs} | ${entry.overheadMs} `
      + `| ${entry.cacheBytes} | ${entry.cacheAnswerBytes} | ${entry.walk} `
      + `| ${entry.walkPass} | ${entry.storedWalkMs} | ${entry.liveWalkMs} `
      + `| ${entry.audited} | ${entry.auditMs}`
      + (entry.reason.length > 0 ? ` | ${entry.reason}` : "")
      + (entry.walkLeft.length > 0 ? ` | walk: ${entry.walkLeft}` : "")
      + "\n"
    );
  }
  // Slice S2, the go/no-go number: of the requests whose walk visited a
  // clean module, how many left (or, in measure, would leave) the
  // recorded path.
  const judged = rows.filter((entry) => entry.walk === "on-path"
    || entry.walk === "left");
  const left = judged.filter((entry) => entry.walk === "left");
  const walkLeftEarly = left.filter((entry) =>
    !entry.walkLeft.startsWith("checks before emission"));
  process.stdout.write(`[${mode}] walk with stored edges: ${left.length} of `
    + `${judged.length} requests with a clean module left the recorded path `
    + `(${walkLeftEarly.length} during the walk, `
    + `${left.length - walkLeftEarly.length} at the checks before emission)\n`);
  ok(
    g1Failures.length === 0,
    `G1 failed (${mode}): modules that reuse would replay changed:\n`
    + g1Failures.join("\n")
  );
  if (mode === "reuse")
    ok(replayedTotal > 0, "the reuse pass replayed no module");
  if (mode === "reuse" && options.auditModules > 0)
    ok(auditedTotal > 0, "the reuse pass audited no module");
  const auditRows = rows.filter((entry) => entry.audited > 0);
  if (auditRows.length > 0)
    process.stdout.write(`[${mode}] rolling replay audit: ${auditedTotal} `
      + `modules printed again in ${auditRows.length} requests, mean `
      + `${(auditRows.reduce((sum, entry) => sum + entry.auditMs, 0)
        / auditRows.length).toFixed(1)} ms per request (diagnostic)\n`);
  return { mode, rows, replayed: replayedTotal, edits: editsRun };
}

/**
 * Runs `CleanRuleProbe` in one cold compile: the output lines of the session
 * key, the clean rule for a module without a declaration stamp, and the
 * refusal of compare without afterTyping reuse, each case on its own.
 * Returns the probe's result line.
 */
async function assertCleanRuleProbe(
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<string> {
  const result = await runBoundedProcess(compiler.binary, [
    ...buildArguments("cold"),
    "-cp", path.join(fixtureRoot, "probes"),
    "--macro", "CleanRuleProbe.check()",
    "--no-output"
  ], {
    cwd: workspace,
    timeoutMs,
    label: "clean-rule probe",
    reportProgress: true
  });
  ok(result.code === 0, `CleanRuleProbe failed\n${describe(result)}`);
  const line = /clean-rule-probe:ok \(\d+ cases\)/.exec(result.stdout);
  ok(line !== null, `CleanRuleProbe printed no result\n${describe(result)}`);
  return line[0];
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
    cacheAnswerBytes: report.cacheAnswerBytes ?? 0,
    replayed: report.replayed ?? 0,
    reason: (report.reason ?? "")
      + (report.reservedNamesChanged ? " (reserved names changed)" : ""),
    walk: report.walk?.verdict ?? "none",
    walkLeft: report.walk?.left ?? "",
    walkPass: report.walk?.pass ?? "",
    storedWalkMs: report.walk?.storedMs ?? 0,
    liveWalkMs: report.walk?.liveMs ?? 0,
    audited: report.audit?.audited.length ?? 0,
    auditMs: report.audit?.ms ?? 0
  };
}

await main();
