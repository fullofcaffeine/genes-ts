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
 * Each of them ends with a `partial` line.
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
type GenerationMode = "compare" | "reuse";

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
    ok(mode === "compare" || mode === "reuse", `unknown mode ${mode}`);
  // `--only` is a list of edit ids separated by "|"; an entry matches an id
  // that contains it, or, with a leading "=", the id that equals it. Plain
  // text matching: the value never becomes a regular expression.
  const only = value("only");
  return {
    modes: modes as GenerationMode[],
    only: only === undefined ? null : only.split("|").filter((part) => part.length > 0),
    skipPlain: process.argv.includes("--skip-plain"),
    skipProbe: process.argv.includes("--skip-probe")
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
  readonly replayable: number;
  readonly replayed: number;
  readonly replayedFiles: number;
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
  /** Modules that the report must list as emitted and dirty. */
  readonly dirtyModules?: ReadonlyArray<string>;
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
    refusal: "needs-after-typing-reuse"
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
    mode: "current"
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
    // M2 of the review of #244: the capture of a typedef in `inc.Leaf2`
    // writes a SignatureCache fact for the source position of the field
    // `value` of `inc.Env.Envelope`, and the print of `inc.Env` reads that
    // fact. `inc.Env` is not typed again.
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
      generation: request.generation
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
  readonly cacheAnswerBytes: number;
  readonly replayed: number;
  readonly reason: string;
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
  program.defines = [];
  program.modules = [
    "inc.Leaf", "inc.Leaf2", "inc.Clock", "inc.Embedded", "inc.Legacy"
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
    || options.skipProbe;
  const counts = results.map((result) =>
    `${result.mode}: ${result.edits} edits, ${result.replayed} replayed modules`)
    .join("; ");
  process.stdout.write(
    `compiler-server-shadow:${partial ? "partial" : "ok"} (Haxe `
    + `${selectedHaxeCompiler(repoRoot).version}; ${probeLine}; ${counts}; `
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
  process.stdout.write("edit | compare generation ms | reuse generation ms | replayed\n");
  let saved = 0;
  let counted = 0;
  for (const row of reuse.rows) {
    const other = compare.rows.find((entry) => entry.id === row.id);
    if (other === undefined || row.replayed === 0)
      continue;
    saved += other.generationMs - row.generationMs;
    counted++;
    process.stdout.write(`${row.id} | ${other.generationMs} | ${row.generationMs} | ${row.replayed}\n`);
  }
  if (counted > 0)
    process.stdout.write(`mean generation time saved on ${counted} replaying `
      + `edits: ${(saved / counted).toFixed(1)} ms (diagnostic)\n`);
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
  let editsRun = 0;
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
        const report = readReport();
        ok(
          report === null || (report.result === "failed" && !report.committed),
          `${label}: a failed request must not report a committed generation`
        );
        rows.push({
          id: step.id, result: report === null ? "failed before generation" : "failed",
          typedAgain: 0, emitted: 0, clean: 0, mismatches: 0,
          fallbackLookups: 0, generationMs: 0, projectedMs: 0, overheadMs: 0,
          cacheBytes: 0, cacheAnswerBytes: 0, replayed: 0, reason: ""
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
      if (step.reason !== undefined) {
        ok(
          (report.reason ?? "").includes(step.reason),
          `${label}: shadow reason ${String(report.reason)}; expected it to `
          + `contain ${JSON.stringify(step.reason)}`
        );
      }
      if (step.mode !== undefined) {
        strictEqual(report.mode, step.mode === "current" ? mode : step.mode,
          `${label}: shadow mode`);
      }
      if (step.refusal !== undefined) {
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
    + "| answer bytes\n"
  );
  for (const entry of rows) {
    process.stdout.write(
      `${entry.id} | ${entry.result} | ${entry.typedAgain} | ${entry.emitted} `
      + `| ${entry.clean} | ${entry.replayed} | ${entry.mismatches} `
      + `| ${entry.generationMs} | ${entry.projectedMs} | ${entry.overheadMs} `
      + `| ${entry.cacheBytes} | ${entry.cacheAnswerBytes}`
      + (entry.reason.length > 0 ? ` | ${entry.reason}` : "")
      + "\n"
    );
  }
  ok(
    g1Failures.length === 0,
    `G1 failed (${mode}): modules that reuse would replay changed:\n`
    + g1Failures.join("\n")
  );
  if (mode === "reuse")
    ok(replayedTotal > 0, "the reuse pass replayed no module");
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
      + (report.reservedNamesChanged ? " (reserved names changed)" : "")
  };
}

await main();
