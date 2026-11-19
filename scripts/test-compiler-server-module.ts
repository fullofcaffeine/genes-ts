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
 * How: each group copies `tests/compiler-server/templates/module-request`
 * (plus the group's own source files) and uses one warm server:
 *
 * 1. a full request (`--main mr.Main`) with `"moduleRecords": true` stores
 *    the records;
 * 2. after each edit, a module request (the edited module as the only root,
 *    no `--main`, its own sibling output folder) runs; its report must have
 *    the expected result. A `preview` must hold only the module's files,
 *    and each of them must be byte-identical to the same file of a cold
 *    build (a new Haxe process, no define) of the edited program. A refused
 *    request must leave no module file in its folder;
 * 3. a full request then runs as the authority; its tree must equal the
 *    cold tree, so a module request leaves nothing behind in the server's
 *    cache.
 *
 * The first group is the base list. The other groups are the review
 * scenarios of PR #250 (named after them): uses that dead-code elimination
 * follows through types (s02, s08) and `Std.string` (s03b), edits outside
 * the previewed module's imports (s05, s12, s14), a feature that only the
 * edited module defined (s10), field types that another module's use
 * decides (s09), a request that fails after the roots were added (s18),
 * descriptors written for another request (S2, s14), and a refused request
 * into a folder that holds an earlier preview (s19). After them, the
 * groups of `lateMacroGroups` (m249, f1, f2, f3, a1, a2, d1, d1-full) run a
 * macro that changes another module or a define from a literal of the
 * requested module, after typing or after save, in both callback orders. After each accepted preview, the tree check
 * requires that cold changes only the previewed module's files.
 *
 * `--keep-control` also runs the older way to root a module request,
 * `--macro keep(<module>)`, and prints whether the next full request then
 * differs from cold (the measured cache pollution of genes-f8vc.14.1). It is
 * an observation, not a pass condition. `--only=<text>` runs the groups
 * whose name contains the text.
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
const failFlag = path.join(tempRoot, "fail.flag");
const raceFlag = path.join(tempRoot, "race.flag");

/**
 * A test double for an editor that saves a file while Haxe types a request:
 * `mr.Race` rewrites the file that `race.flag` names in `onAfterTyping`,
 * after Haxe parsed it.
 */
const raceMacro = `package mr;\n\nimport haxe.macro.Context;\n\nclass Race {\n`
  + `  public static function install(flag: String, sources: String): Void {\n`
  + `    Context.onAfterTyping(_ -> {\n      if (!sys.FileSystem.exists(flag))\n        return;\n`
  + `      final parts = sys.io.File.getContent(flag).split('|');\n`
  + `      sys.FileSystem.deleteFile(flag);\n      final file = sources + '/' + parts[0];\n`
  + `      sys.io.File.saveContent(file, StringTools.replace(sys.io.File.getContent(file), parts[1], parts[2]));\n`
  + `    });\n  }\n}\n`;
const raceArgs = ["--macro", `mr.Race.install(${JSON.stringify(raceFlag)}, ${JSON.stringify(path.join(workspace, "src"))})`];
const timeoutMs = 180_000;
const keepControl = process.argv.includes("--keep-control");
const only = process.argv.find((argument) => argument.startsWith("--only="))
  ?.slice("--only=".length);
/**
 * The Genes source folder under test. `GENES_TEST_SOURCE` points the gate
 * at another copy, for example an older commit, to show that a group fails
 * there.
 */
const genesSource = process.env.GENES_TEST_SOURCE ?? path.join(repoRoot, "src");
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
  /** The module to preview; without it the step runs only the full request. */
  readonly module?: string;
  /** `preview`, or the expected refusal code; a list allows each of them. */
  readonly expect?: string | ReadonlyArray<string>;
  /**
   * `full-descriptor`: the module request reads a full descriptor with
   * `"moduleRecords": true` (S2) and must fail before it writes anything.
   * `module-descriptor`: a full request reads a module descriptor and must
   * be refused (`has-main`) without changing the program's tree.
   */
  readonly race?: "full-descriptor" | "module-descriptor";
  /** Make a later after-save step of the module request fail (s18). */
  readonly fails?: boolean;
  /** Do not empty the preview folder before the request (s19). */
  readonly keepFolder?: boolean;
  /** Write the preview into the full request's output folder (a session mistake). */
  readonly sameFolder?: boolean;
  /** Skip the full request after this step (the next step depends on it). */
  readonly skipProgram?: boolean;
  /** Runs after the module request and before the full request (r05). */
  readonly afterModule?: () => void;
  /** A save (`file|from|to`, under `src/`) that lands while Haxe types the module request. */
  readonly raceOnModule?: string;
  /** A save (`file|from|to`) that lands while Haxe types the full request. */
  readonly raceOnFull?: string;
};

/** A list of steps on its own server and its own copy of the template. */
type Group = {
  readonly name: string;
  /** Source files (relative to `src/`) written over the template. */
  readonly files?: Readonly<Record<string, string>>;
  /** Extra Haxe arguments of every request of the group. */
  readonly extraArgs?: ReadonlyArray<string>;
  /**
   * Extra Haxe arguments given before `--macro genes.Generator.use()`: an
   * after-typing callback registered here runs after the passes of Genes.
   */
  readonly argsBeforeGenes?: ReadonlyArray<string>;
  /**
   * Do not send `server/invalidate` for saved files before a request (a
   * session that forgot): Genes must then notice stale content itself.
   */
  readonly noInvalidate?: boolean;
  readonly steps: ReadonlyArray<Step>;
};

let clock = Math.floor(Date.now() / 1000);

/** Moves a file time to a later whole second than any earlier edit. */
function touch(file: string): void {
  clock = Math.max(clock, Math.floor(Date.now() / 1000),
    Math.floor(statSync(file).mtimeMs / 1000)) + 2;
  utimesSync(file, clock, clock);
}

/** Files saved since the last request; the driver invalidates them first. */
const saved = new Set<string>();

/** The file status of the last `edit`, for a test that sets the time back to it. */
let firstSave = statSync(".");

/** Replaces one exact text in a fixture file and moves its time. */
function edit(relative: string, from: string, to: string): void {
  const file = path.join(workspace, "src/mr", relative);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  writeFileSync(file, text.replace(from, to));
  touch(file);
  firstSave = statSync(file);
  saved.add(file);
}

/**
 * Replaces one exact text with another of the same length and keeps the
 * file time: a second save within the same second, which Haxe's whole-second
 * file-time check cannot see.
 */
function editSameSecond(relative: string, from: string, to: string): void {
  const file = path.join(workspace, "src/mr", relative);
  strictEqual(from.length, to.length, `${relative}: the replacement must keep the size`);
  const before = statSync(file);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  writeFileSync(file, text.replace(from, to));
  utimesSync(file, before.atime, before.mtime);
  strictEqual(Math.floor(statSync(file).mtimeMs / 1000), Math.floor(before.mtimeMs / 1000),
    `${relative}: the file time must stay in the same second`);
  saved.add(file);
}

const baseSteps: ReadonlyArray<Step> = [
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
    // A new field changes the module's signature: refused, as every
    // structural edit (see `ModuleRequest`).
    expect: "signature-changed"
  },
  {
    id: "body edit in a class with a parent class and an interface",
    apply: () => edit("Panel.hx", "return 'panel ' + name",
      "return 'panel: ' + name"),
    module: "mr.Panel",
    expect: "preview"
  },
  {
    id: "structural edit of the module with main (a new + 1)",
    apply: () => edit("Main.hx", "trace(Theme.size());",
      "trace(Theme.size() + 1);"),
    module: "mr.Main",
    expect: "uses-changed"
  },
  {
    id: "literal edit of the module with main",
    apply: () => edit("Main.hx", "trace(Theme.size() + 1);",
      "trace(Theme.size() + 2);"),
    module: "mr.Main",
    expect: "preview"
  },
  {
    id: "new use of a field of another module",
    apply: () => edit("Button.hx", "return label() + ':' + helper();",
      "return label() + ':' + helper() + Theme.spacing();"),
    module: "mr.Button",
    expect: "uses-changed"
  },
  {
    id: "the only call of a private helper is removed",
    apply: () => edit("Button.hx",
      "return label() + ':' + helper() + Theme.spacing();",
      "return label() + ':' + Theme.spacing();"),
    module: "mr.Button",
    expect: "uses-changed"
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
    // The Theme request marked mr.Theme for a new typing, so Haxe types it
    // again here; either way the request is refused.
    expect: ["other-modules-typed", "other-modules-changed"]
  },
  {
    id: "no edit after the full request",
    apply: () => {},
    module: "mr.Button",
    expect: "preview"
  },
  {
    id: "a full request reads a module descriptor (has-main)",
    apply: () => {},
    module: "mr.Button",
    race: "module-descriptor",
    expect: "has-main"
  }
];

/** The main module of the review scenarios that add source files. */
function mainWith(lines: ReadonlyArray<string>): string {
  return `package mr;\nclass Main {\n  static function main() {\n`
    + `    trace(Button.render());\n`
    + lines.map((line) => `    ${line}\n`).join("")
    + `  }\n}\n`;
}

/**
 * The source of `mr.CopyMacro`: an after-typing macro that reads the first
 * string literal of the body of `mr.Probe.tag()` and copies it into another
 * module that Haxe does not type again. `install(kind)` runs it in an
 * after-typing callback, `installAfterSave(kind)` in an after-save callback
 * (`Context.onGenerate(..., false)`). `kind` picks what it does:
 *
 * - `leaf-meta`: writes `@:mrTag(<literal>)` on the class `mr.Leaf.Leaf`;
 * - `ts-type`: writes `@:ts.type(<literal>)` on the class `mr.TsTyped`;
 * - `exclude`: calls `exclude()` on the enum `mr.ExclOwner.ExclE` when the
 *   literal is `ext`;
 * - `field-meta`: writes `@:ts.type(<literal>)` on the field `typed` of the
 *   typedef `mr.TsUser.TsHint`;
 * - `define`: calls `Compiler.define('genes.disable_native_accessors', '1')`
 *   when the literal is `ext`.
 */
const copyMacro = `package mr;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.TypedExprTools;

class CopyMacro {
  public static function install(kind: String): Void {
    Context.onAfterTyping(types -> apply([for (type in types) type], kind));
  }

  public static function installAfterSave(kind: String): Void {
    Context.onGenerate(types -> apply([for (type in types) declarationOf(type)], kind), false);
  }

  static function declarationOf(type: Type): ModuleType {
    return switch type {
      case TInst(ref, _): TClassDecl(ref);
      case TEnum(ref, _): TEnumDecl(ref);
      case TType(ref, _): TTypeDecl(ref);
      case TAbstract(ref, _): TAbstract(ref);
      default: null;
    }
  }

  static function firstText(expr: TypedExpr): Null<String> {
    var found: Null<String> = null;
    function visit(item: TypedExpr): Void {
      if (found != null)
        return;
      switch item.expr {
        case TConst(TString(text)): found = text;
        default: TypedExprTools.iter(item, visit);
      }
    }
    visit(expr);
    return found;
  }

  static function apply(types: Array<ModuleType>, kind: String): Void {
    var tag: Null<String> = null;
    var leaf: Null<ClassType> = null;
    var typed: Null<ClassType> = null;
    var excluded: Null<EnumType> = null;
    var hint: Null<DefType> = null;
    for (type in types)
      if (type != null) switch type {
        case TClassDecl(ref):
          final cls = ref.get();
          if (cls.module == 'mr.Probe')
            for (field in cls.statics.get())
              if (field.name == 'tag') {
                final value = field.expr();
                if (value != null)
                  tag = firstText(value);
              }
          if (cls.module == 'mr.Leaf' && cls.name == 'Leaf')
            leaf = cls;
          if (cls.module == 'mr.TsTyped' && cls.name == 'TsTyped')
            typed = cls;
        case TEnumDecl(ref):
          final enm = ref.get();
          if (enm.module == 'mr.ExclOwner' && enm.name == 'ExclE')
            excluded = enm;
        case TTypeDecl(ref):
          final def = ref.get();
          if (def.module == 'mr.TsUser' && def.name == 'TsHint')
            hint = def;
        default:
      }
    final text = tag;
    if (text == null)
      return;
    final pos = Context.currentPos();
    switch kind {
      case 'leaf-meta':
        final found = leaf;
        if (found == null)
          return;
        found.meta.remove(':mrTag');
        found.meta.add(':mrTag', [macro $v{text}], pos);
      case 'ts-type':
        final found = typed;
        if (found == null)
          return;
        found.meta.remove(':ts.type');
        found.meta.add(':ts.type', [macro $v{text}], pos);
      case 'exclude':
        final found = excluded;
        if (found != null && text == 'ext')
          found.exclude();
      case 'define':
        if (text == 'ext')
          haxe.macro.Compiler.define('genes.disable_native_accessors', '1');
      case 'field-meta':
        final found = hint;
        if (found == null)
          return;
        switch found.type {
          case TAnonymous(anon):
            for (field in anon.get().fields)
              if (field.name == 'typed') {
                field.meta.remove(':ts.type');
                field.meta.add(':ts.type', [macro $v{text}], pos);
              }
          default:
        }
      default:
        Context.fatalError('CopyMacro: unknown kind ' + kind, pos);
    }
  }
}
#end
`;

/** `mr.Probe`: `tag()` returns `literal`, and `run()` calls `uses`. */
function probeWith(literal: string, uses: string): string {
  return `package mr;\n\nclass Probe {\n`
    + `  static function tag(): String {\n    return '${literal}';\n  }\n\n`
    + `  public static function run(): String {\n`
    + `    return 'probe ' + tag() + ${uses};\n  }\n}\n`;
}

/**
 * The groups of after-typing macros that change another module from a
 * literal of the requested module (review of genes-ts #250 after the merge
 * with #249 and #247). Each case runs twice:
 *
 * - "macro after Genes.use()": the macro is given after
 *   `--macro genes.Generator.use()`, so its callback runs BEFORE the
 *   after-typing passes of Genes (Haxe runs those callbacks in reverse
 *   order of registration), and `GenerationChangeSet.compareMetadata` sees
 *   a metadata change;
 * - "macro before Genes.use()": the macro is given before it, so its
 *   callback runs AFTER those passes (the `installAfter` pattern), and only
 *   the check before dead-code elimination (`target-facts-changed`) sees the change.
 *
 * In every case cold changes other files than the module's, so a preview
 * would leave the tree stale. A literal that the macro does not read still
 * previews.
 */
function lateMacroGroups(): ReadonlyArray<Group> {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly what: string;
    readonly files: Readonly<Record<string, string>>;
    readonly from: string;
    readonly to: string;
    readonly early: string | ReadonlyArray<string>;
    readonly late: string | ReadonlyArray<string>;
    /** `save`: the macro runs in an after-save callback, not after typing. */
    readonly phase?: "save";
    /** Only full requests: checks the full incremental path. */
    readonly fullOnly?: boolean;
  }> = [
    {
      // m249: metadata of a class that no printer reads.
      name: "m249-metadata",
      kind: "leaf-meta",
      what: "copies the literal into @:mrTag of mr.Leaf",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("one", "Leaf.kindName(Leaf.Kind.Small)")
      },
      from: "one",
      to: "two",
      early: "session-changed",
      late: "target-facts-changed"
    },
    {
      // f1: @:ts.type of a class that another module names in a typedef
      // field; cold changes mr/TsUser.ts.
      name: "f1-ts-type",
      kind: "ts-type",
      what: "copies the literal into @:ts.type of mr.TsTyped",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("number", "TsUser.run()"),
        "mr/TsTyped.hx": `package mr;\n\n@:ts.type("number") class TsTyped {}\n`,
        "mr/TsUser.hx": `package mr;\n\ntypedef TsHint = {\n  final ?typed: mr.TsTyped;\n}\n\n`
          + `class TsUser {\n  public static function run(): String {\n`
          + `    final hint: Null<TsHint> = null;\n`
          + `    return hint == null ? 'user' : 'hint';\n  }\n}\n`
      },
      from: "number",
      to: "string",
      early: "session-changed",
      late: "target-facts-changed"
    },
    {
      // f2: exclude() of an enum that another module names in a typedef
      // field; cold changes mr/ExclOwner.ts and mr/ExclHintUser.ts. No
      // metadata changes, so the metadata comparison never sees it.
      name: "f2-exclude",
      kind: "exclude",
      what: "calls exclude() on mr.ExclOwner.ExclE for the literal ext",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("keep", "ExclOwner.run() + ExclHintUser.run()"),
        "mr/ExclOwner.hx": `package mr;\n\nenum ExclE {\n  EA;\n  EB;\n}\n\n`
          + `class ExclOwner {\n  public static function run(): String {\n`
          + `    return 'owner';\n  }\n}\n`,
        "mr/ExclHintUser.hx": `package mr;\n\ntypedef ExclHint = {\n`
          + `  final ?mode: mr.ExclOwner.ExclE;\n}\n\n`
          + `class ExclHintUser {\n  public static function run(): String {\n`
          + `    final hint: Null<ExclHint> = null;\n`
          + `    return hint == null ? 'excl' : 'hint';\n  }\n}\n`
      },
      from: "keep",
      to: "ext",
      early: "target-facts-changed",
      late: "target-facts-changed"
    },
    {
      // f3: @:ts.type of a field of a typedef's structure; cold changes
      // mr/TsUser.ts. Only the metadata text of
      // `ModuleFingerprint.addDeclaration` holds field metadata.
      name: "f3-field-meta",
      kind: "field-meta",
      what: "copies the literal into @:ts.type of the field typed of mr.TsUser.TsHint",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("number", "TsUser.run()"),
        "mr/TsUser.hx": `package mr;\n\ntypedef TsHint = {\n  final ?typed: Int;\n}\n\n`
          + `class TsUser {\n  public static function run(): String {\n`
          + `    final hint: Null<TsHint> = null;\n`
          + `    return hint == null ? 'user' : 'hint';\n  }\n}\n`
      },
      from: "number",
      to: "string",
      early: "session-changed",
      late: "target-facts-changed"
    },
    {
      // a1: f1, but the macro writes @:ts.type in an after-save callback,
      // which runs after `ModuleRequest.afterSave` when it was registered
      // later (macro after Genes.use()) unless Genes reads late enough.
      name: "a1-ts-type-after-save",
      kind: "ts-type",
      phase: "save",
      what: "copies the literal into @:ts.type of mr.TsTyped after save",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("number", "TsUser.run()"),
        "mr/TsTyped.hx": `package mr;\n\n@:ts.type("number") class TsTyped {}\n`,
        "mr/TsUser.hx": `package mr;\n\ntypedef TsHint = {\n  final ?typed: mr.TsTyped;\n}\n\n`
          + `class TsUser {\n  public static function run(): String {\n`
          + `    final hint: Null<TsHint> = null;\n`
          + `    return hint == null ? 'user' : 'hint';\n  }\n}\n`
      },
      from: "number",
      to: "string",
      early: "target-facts-changed",
      late: "target-facts-changed"
    },
    {
      // a2: f2, but exclude() runs in an after-save callback.
      name: "a2-exclude-after-save",
      kind: "exclude",
      phase: "save",
      what: "calls exclude() on mr.ExclOwner.ExclE after save for the literal ext",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("keep", "ExclOwner.run() + ExclHintUser.run()"),
        "mr/ExclOwner.hx": `package mr;\n\nenum ExclE {\n  EA;\n  EB;\n}\n\n`
          + `class ExclOwner {\n  public static function run(): String {\n`
          + `    return 'owner';\n  }\n}\n`,
        "mr/ExclHintUser.hx": `package mr;\n\ntypedef ExclHint = {\n`
          + `  final ?mode: mr.ExclOwner.ExclE;\n}\n\n`
          + `class ExclHintUser {\n  public static function run(): String {\n`
          + `    final hint: Null<ExclHint> = null;\n`
          + `    return hint == null ? 'excl' : 'hint';\n  }\n}\n`
      },
      from: "keep",
      to: "ext",
      early: "target-facts-changed",
      late: "target-facts-changed"
    },
    {
      // d1: a define that a macro sets after typing; cold prints mr/Acc.ts
      // without its native getter. With the macro after Genes.use() the
      // define is set before the session key is read.
      name: "d1-late-define",
      kind: "define",
      what: "sets -D genes.disable_native_accessors for the literal ext",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("keep", "new Acc().value"),
        "mr/Acc.hx": `package mr;\n\nclass Acc {\n  public function new() {}\n\n`
          + `  public var value(get, never): Int;\n\n`
          + `  function get_value(): Int {\n    return 1;\n  }\n}\n`
      },
      from: "keep",
      to: "ext",
      early: "session-changed",
      late: "defines-changed"
    },
    {
      // d1-full: the same edit with full requests only: the full warm
      // request must equal cold (the generation shadow must not replay
      // mr/Acc.ts).
      name: "d1-late-define-full",
      kind: "define",
      fullOnly: true,
      what: "sets -D genes.disable_native_accessors for the literal ext",
      files: {
        "mr/Main.hx": mainWith(["trace(Probe.run());"]),
        "mr/Probe.hx": probeWith("keep", "new Acc().value"),
        "mr/Acc.hx": `package mr;\n\nclass Acc {\n  public function new() {}\n\n`
          + `  public var value(get, never): Int;\n\n`
          + `  function get_value(): Int {\n    return 1;\n  }\n}\n`
      },
      from: "keep",
      to: "ext",
      early: "-",
      late: "-"
    }
  ];
  const groups: Group[] = [];
  for (const item of cases)
    for (const order of ["after", "before"] as const) {
      const installer = item.phase === "save" ? "installAfterSave" : "install";
      const install = ["--macro", `mr.CopyMacro.${installer}(${JSON.stringify(item.kind)})`];
      groups.push({
        name: `${item.name}-macro-${order}-genes-use`,
        files: { ...item.files, "mr/CopyMacro.hx": copyMacro },
        ...(order === "after" ? { extraArgs: install } : { argsBeforeGenes: install }),
        steps: [
          {
            // The metadata comparison compares with the earlier request, and
            // a macro after the passes of Genes writes after that
            // comparison: a second full request settles the baseline.
            id: `macro ${order} Genes.use(), a second full request, no edit`,
            apply: () => {}
          },
          item.fullOnly === true ? {
            id: `macro ${order} Genes.use() ${item.what}: '${item.from}' -> '${item.to}', `
              + "full request only",
            apply: () => edit("Probe.hx", `return '${item.from}';`, `return '${item.to}';`)
          } : {
            id: `macro ${order} Genes.use() ${item.what}: '${item.from}' -> '${item.to}'`,
            apply: () => edit("Probe.hx", `return '${item.from}';`, `return '${item.to}';`),
            module: "mr.Probe",
            expect: order === "after" ? item.early : item.late
          },
          item.fullOnly === true ? {
            id: `macro ${order} Genes.use(), a second full request, no edit`,
            apply: () => {}
          } : {
            id: `macro ${order} Genes.use(), a literal that the macro does not read`,
            apply: () => edit("Probe.hx", "return 'probe ' + tag()", "return 'probe! ' + tag()"),
            module: "mr.Probe",
            // The define stays set while the literal is `ext`, and a macro
            // after the passes of Genes sets it after the session key.
            expect: item.kind === "define" && order === "before" ? "defines-changed" : "preview"
          }
        ]
      });
    }
  return groups;
}

const groups: ReadonlyArray<Group> = [
  { name: "base", steps: baseSteps },
  {
    // M1: an enum kept only through the parameter type of a private function.
    name: "s02-enum-by-param-type",
    files: {
      "mr/Main.hx": mainWith(["trace(Modes.show());"]),
      "mr/Modes.hx": `package mr;\n\nenum Mode {\n  Light;\n  Dark;\n}\n\n`
        + `class Modes {\n  public static function show(): String {\n`
        + `    return 'modes ' + pick(null);\n  }\n\n`
        + `  static function pick(mode: Mode): String {\n    return 'none';\n  }\n}\n`
    },
    steps: [
      { id: "no edit", apply: () => {}, module: "mr.Modes", expect: "preview" },
      {
        id: "private parameter type Mode -> Dynamic",
        apply: () => edit("Modes.hx", "static function pick(mode: Mode): String {",
          "static function pick(mode: Dynamic): String {"),
        module: "mr.Modes",
        expect: "signature-changed"
      }
    ]
  },
  {
    // M1: toString kept only through Std.string of an instance.
    name: "s03b-tostring",
    files: {
      "mr/Main.hx": mainWith(["trace(Tags.show(Theme.size()));"]),
      "mr/Tags.hx": `package mr;\n\nclass Tag {\n  public final text: String;\n\n`
        + `  public function new(text: String) {\n    this.text = text;\n  }\n\n`
        + `  public function toString(): String {\n    return '<' + text + '>';\n  }\n}\n\n`
        + `class Tags {\n  public static function show(count: Int): String {\n`
        + `    final tag = new Tag('a');\n    final other: Dynamic = count;\n`
        + `    return 'tag ' + Std.string(tag) + Std.string(other);\n  }\n}\n`
    },
    steps: [
      {
        id: "Std.string(tag) -> tag.text",
        apply: () => edit("Tags.hx", "Std.string(tag) + Std.string(other)",
          "tag.text + Std.string(other)"),
        module: "mr.Tags",
        expect: "uses-changed"
      }
    ]
  },
  {
    // M1: enums kept only through type mentions.
    name: "s08-enum-type-mentions",
    files: {
      "mr/Main.hx": mainWith(["trace(Sidebar.render());", "trace(Lists.count());",
        "trace(Calls.run());"]),
      "mr/Sidebar.hx": `package mr;\n\nenum Tab {\n  Notes;\n  Graph;\n}\n\n`
        + `class Sidebar {\n  static var current: Null<Tab> = null;\n\n`
        + `  public static function render(): String {\n`
        + `    return current == null ? 'no tab' : 'tab';\n  }\n}\n`,
      "mr/Lists.hx": `package mr;\n\nenum Row {\n  Plain;\n  Bold;\n}\n\n`
        + `class Lists {\n  public static function count(): Int {\n`
        + `    final rows: Array<Row> = [];\n    final ints: Array<Int> = [];\n`
        + `    return rows.length + ints.length;\n  }\n}\n`,
      "mr/Calls.hx": `package mr;\n\nenum Signal {\n  On;\n  Off;\n}\n\n`
        + `class Calls {\n  public static function run(): String {\n`
        + `    final handler: Signal -> String = _ -> 'handled';\n`
        + `    final other: Int -> String = _ -> 'int';\n`
        + `    return handler == null ? 'none' : other(1);\n  }\n}\n`
    },
    steps: [
      {
        id: "static var Null<Tab> -> Null<String>",
        apply: () => edit("Sidebar.hx", "static var current: Null<Tab> = null;",
          "static var current: Null<String> = null;"),
        module: "mr.Sidebar",
        expect: "signature-changed"
      },
      {
        id: "local Array<Row> -> Array<Int>",
        apply: () => edit("Lists.hx", "final rows: Array<Row> = [];",
          "final rows: Array<Int> = [];"),
        module: "mr.Lists",
        // Haxe folds `rows.length + ints.length` of two empty arrays to `0`
        // before dead-code elimination, so the local's type is not a use:
        // the skeleton stays, and the preview equals cold.
        expect: "preview"
      },
      {
        id: "local Signal -> String becomes Int -> String",
        apply: () => edit("Calls.hx",
          "final handler: Signal -> String = _ -> 'handled';",
          "final handler: Int -> String = _ -> 'handled';"),
        module: "mr.Calls",
        expect: "uses-changed"
      }
    ]
  },
  {
    // M2: the other edited file (Main) imports the previewed module.
    name: "s05-outside-closure",
    steps: [
      {
        id: "Theme body edit + Main stops calling Theme.size()",
        apply: () => {
          edit("Theme.hx", "return 'blue';", "return 'green';");
          edit("Main.hx", "    trace(Theme.size());\n", "");
        },
        module: "mr.Theme",
        expect: "source-changed"
      }
    ]
  },
  {
    // M2: previews in a row without a full request between them.
    name: "s12-repeat-previews",
    steps: [
      {
        id: "Button edit 1",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
        module: "mr.Button",
        expect: "preview",
        skipProgram: true
      },
      {
        id: "Button edit 2 (same module again)",
        apply: () => edit("Button.hx", "return 'Store';", "return 'Keep';"),
        module: "mr.Button",
        expect: "preview",
        skipProgram: true
      },
      {
        id: "Theme edit while Button (which imports Theme) is dirty",
        apply: () => edit("Theme.hx", "return 'blue';", "return 'green';"),
        module: "mr.Theme",
        expect: "source-changed"
      }
    ]
  },
  {
    // M2 and the descriptor races (S2, s14).
    name: "s14-descriptor-races",
    steps: [
      {
        id: "module arguments read a full descriptor",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
        module: "mr.Button",
        race: "full-descriptor"
      },
      {
        id: "a full request with pending edits in Main and Theme reads a module descriptor",
        apply: () => {
          edit("Main.hx", "    trace(Theme.size());\n", "");
          edit("Theme.hx", "return 'blue';", "return 'red';");
        },
        module: "mr.Theme",
        race: "module-descriptor",
        expect: "has-main",
        skipProgram: true
      },
      {
        id: "module request right after the refused full request",
        apply: () => {},
        module: "mr.Theme",
        expect: ["source-changed", "other-modules-changed"]
      }
    ]
  },
  {
    // M3: only the edited module used js.Lib.global.
    name: "s10-feature-global",
    files: {
      "mr/Main.hx": mainWith(["trace(Globals.read());",
        "trace(Leaf.kindName(Leaf.Kind.Small));"]),
      "mr/Globals.hx": `package mr;\n\nclass Globals {\n`
        + `  public static function read(): String {\n`
        + `    final host: Dynamic = js.Lib.global;\n`
        + `    final kind: String = js.Syntax.code("typeof {0}", host);\n`
        + `    return 'global ' + kind;\n  }\n}\n`
    },
    steps: [
      { id: "no edit Leaf", apply: () => {}, module: "mr.Leaf", expect: "preview" },
      {
        id: "js.Lib.global -> null",
        apply: () => edit("Globals.hx", "final host: Dynamic = js.Lib.global;",
          "final host: Dynamic = null;"),
        module: "mr.Globals",
        expect: "uses-changed"
      },
      {
        id: "after: Leaf body edit",
        apply: () => edit("Leaf.hx", "case Small: 'small';", "case Small: 'tiny';"),
        module: "mr.Leaf",
        expect: "preview"
      }
    ]
  },
  {
    // M4: field and parameter types that another module's use decides.
    name: "s09-monomorph",
    files: {
      "mr/Main.hx": mainWith(["Registry.items.push('first');",
        "trace(Registry.describe());", "trace(Loose.echo('text'));"]),
      "mr/Registry.hx": `package mr;\n\nclass Registry {\n`
        + `  public static final items = [];\n\n`
        + `  public static function describe(): String {\n`
        + `    return 'registry ' + items.length;\n  }\n}\n`,
      "mr/Loose.hx": `package mr;\n\nclass Loose {\n`
        + `  public static function echo(value) {\n    return value;\n  }\n\n`
        + `  public static function label(): String {\n    return 'loose';\n  }\n}\n`
    },
    steps: [
      { id: "no edit Registry", apply: () => {}, module: "mr.Registry", expect: "preview" },
      {
        id: "Registry body edit",
        apply: () => edit("Registry.hx", "return 'registry ' + items.length;",
          "return 'registry: ' + items.length;"),
        module: "mr.Registry",
        expect: "public-shape-changed"
      },
      {
        id: "Loose body edit",
        apply: () => edit("Loose.hx", "return 'loose';", "return 'loose!';"),
        module: "mr.Loose",
        expect: "public-shape-changed"
      }
    ]
  },
  {
    // S1: a request fails after the roots were added.
    name: "s18-keep-leak",
    files: {
      "mr/Main.hx": mainWith(["trace(Leaf.kindName(Leaf.Kind.Small));",
        "trace(Leaf.other());"]),
      "mr/Leaf.hx": `package mr;\n\nenum Kind {\n  Small;\n  Large;\n}\n\n`
        + `class Leaf {\n  public static function kindName(kind: Kind): String {\n`
        + `    return switch kind {\n      case Small: 'small';\n`
        + `      case Large: 'large';\n    }\n  }\n\n`
        + `  public static function other(): String {\n    return 'other';\n  }\n}\n`,
      "mr/Fail.hx": `package mr;\n\nimport haxe.macro.Context;\n\nclass Fail {\n`
        + `  public static function install(flag: String): Void {\n`
        + `    Context.onGenerate(_ -> {\n      if (sys.FileSystem.exists(flag))\n`
        + `        Context.error('a later step of this request fails', Context.currentPos());\n`
        + `    }, false);\n  }\n}\n`
    },
    extraArgs: ["--macro", `mr.Fail.install(${JSON.stringify(failFlag)})`],
    steps: [
      {
        id: "module request that fails after the roots",
        apply: () => {},
        module: "mr.Leaf",
        fails: true,
        skipProgram: true
      },
      {
        id: "Main stops using the enum (Leaf is not typed again)",
        apply: () => edit("Main.hx", "    trace(Leaf.kindName(Leaf.Kind.Small));\n", "")
      }
    ]
  },
  {
    // S3: a refused request into a folder that holds an earlier preview.
    name: "s19-stale-preview-folder",
    steps: [
      {
        id: "admitted preview",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
        module: "mr.Button",
        expect: "preview",
        skipProgram: true
      },
      {
        id: "refused request into the same folder",
        apply: () => edit("Button.hx", "return label() + ':' + helper();",
          "return label() + ':';"),
        module: "mr.Button",
        expect: "uses-changed",
        keepFolder: true
      }
    ]
  },
  {
    // N1: a use of the module (by Plugin.fire) that is alive only because the
    // module calls Hook.fire, which Plugin overrides.
    name: "r01-override-cycle",
    files: {
      "mr/Main.hx": mainWith(["trace(Core.run(new Plugin()));"]),
      "mr/Hook.hx": `package mr;\n\nclass Hook {\n  public function new() {}\n\n`
        + `  public function fire(): String {\n    return 'hook';\n  }\n}\n`,
      "mr/Plugin.hx": `package mr;\n\nclass Plugin extends Hook {\n`
        + `  override public function fire(): String {\n`
        + `    return 'plugin ' + Core.secret();\n  }\n}\n`,
      "mr/Core.hx": `package mr;\n\nclass Core {\n  static var depth = 0;\n\n`
        + `  public static function run(hook: Hook): String {\n`
        + `    return 'run ' + trigger(hook);\n  }\n\n`
        + `  static function trigger(hook: Hook): String {\n    return hook.fire();\n  }\n\n`
        + `  public static function secret(): String {\n`
        + `    return depth++ > 0 ? 'deep' : trigger(new Hook());\n  }\n}\n`
    },
    steps: [
      { id: "no edit", apply: () => {}, module: "mr.Core", expect: "preview" },
      {
        id: "run() stops calling trigger()",
        apply: () => edit("Core.hx", "return 'run ' + trigger(hook);", "return 'run';"),
        module: "mr.Core",
        expect: "uses-changed"
      },
      {
        id: "text edit only",
        apply: () => edit("Core.hx", "return 'run';", "return 'run!';"),
        module: "mr.Core",
        expect: "preview"
      }
    ]
  },
  {
    // N2: a private field type makes a class of another module used; its
    // override then reaches an override in the edited module.
    name: "r02-used-class-dispatch",
    files: {
      "mr/Main.hx": mainWith(["trace(new mr.Hook.Task().work());",
        "final local = new mr.Core.Local();", "trace(Core.run());"]),
      "mr/Hook.hx": `package mr;\n\nclass Hook {\n  public function new() {}\n\n`
        + `  public function fire(): String {\n    return 'hook';\n  }\n}\n\n`
        + `class Task {\n  public function new() {}\n\n`
        + `  public function work(): String {\n    return 'task';\n  }\n}\n\n`
        + `class FiringTask extends Task {\n  final hook: Hook;\n\n`
        + `  public function new(hook: Hook) {\n    super();\n    this.hook = hook;\n  }\n\n`
        + `  override public function work(): String {\n    return hook.fire();\n  }\n}\n`,
      "mr/Core.hx": `package mr;\n\nclass Local extends Hook {\n`
        + `  public function new() {\n    super();\n  }\n\n`
        + `  override public function fire(): String {\n`
        + `    return 'local ' + Core.secret();\n  }\n}\n\n`
        + `class Core {\n  static var pending: Array<Int> = [];\n\n`
        + `  public static function run(): String {\n`
        + `    return 'run ' + pending.length;\n  }\n\n`
        + `  public static function secret(): String {\n    return 'secret';\n  }\n}\n`
    },
    steps: [
      { id: "no edit", apply: () => {}, module: "mr.Core", expect: "preview" },
      {
        id: "private static Array<Int> -> Array<mr.Hook.FiringTask>",
        apply: () => edit("Core.hx", "static var pending: Array<Int> = [];",
          "static var pending: Array<mr.Hook.FiringTask> = [];"),
        module: "mr.Core",
        expect: "signature-changed"
      }
    ]
  },
  {
    // r03 step 2: an @:ifFeature field keeps a dead function in a full
    // build when another module keeps the named field.
    name: "r03-if-feature",
    files: {
      "mr/Main.hx": mainWith(["trace(Theme.size());", "trace(Probe.run());"]),
      "mr/Probe.hx": `package mr;\n\nclass Probe {\n`
        + `  public static function run(): String {\n    return 'probe';\n  }\n\n`
        + `  static function spare(): String {\n    return 'spare';\n  }\n}\n`
    },
    steps: [
      {
        id: "@:ifFeature of a field that only Main keeps, added to a dead private function",
        apply: () => edit("Probe.hx", "  static function spare(): String {",
          "  @:ifFeature(\"mr.Theme.size\")\n  static function spare(): String {"),
        module: "mr.Probe",
        expect: ["signature-changed", "if-feature"]
      },
      {
        id: "text edit while the @:ifFeature field exists",
        apply: () => edit("Probe.hx", "return 'probe';", "return 'probe!';"),
        module: "mr.Probe",
        expect: "if-feature"
      }
    ]
  },
  {
    // h1b: a class kept only as the constraint of a type parameter of a
    // private function; the edit changes the constraint.
    name: "h1b-constraint-first",
    files: {
      "mr/Main.hx": mainWith(["trace(Shapes.total());"]),
      "mr/Shapes.hx": `package mr;\n\nclass Shape {\n  public function new() {}\n\n`
        + `  public function area(): Float {\n    return 0.0;\n  }\n}\n\n`
        + `class Square extends Shape {\n  override public function area(): Float {\n`
        + `    return 1.0;\n  }\n}\n\n`
        + `class Shapes {\n  public static function total(): String {\n`
        + `    final shape = new Shape();\n`
        + `    return 'total ' + shape.area() + pick(null);\n  }\n\n`
        + `  static function pick<T: Square>(item: T): String {\n    return 'picked';\n  }\n}\n`
    },
    steps: [
      {
        id: "constraint <T: Square> -> <T: Shape>",
        apply: () => edit("Shapes.hx", "static function pick<T: Square>(item: T): String {",
          "static function pick<T: Shape>(item: T): String {"),
        module: "mr.Shapes",
        expect: ["signature-changed", "uses-changed"]
      }
    ]
  },
  {
    // h3: a class kept only as the constraint of an enum's type parameter;
    // the edit changes the constraint.
    name: "h3-enum-constraint",
    files: {
      "mr/Main.hx": mainWith(["trace(Shapes.total());"]),
      "mr/Shapes.hx": `package mr;\n\nclass Shape {\n  public function new() {}\n\n`
        + `  public function area(): Float {\n    return 0.0;\n  }\n}\n\n`
        + `class Square extends Shape {\n  override public function area(): Float {\n`
        + `    return 1.0;\n  }\n}\n\n`
        + `enum Holder<T: Square> {\n  Item(value: T);\n  Empty;\n}\n\n`
        + `class Shapes {\n  public static function total(): String {\n`
        + `    final shape = new Shape();\n`
        + `    return 'total ' + shape.area() + count(Empty);\n  }\n\n`
        + `  static function count(holder: Holder<Dynamic>): Int {\n`
        + `    return switch holder {\n      case Item(_): 1;\n      case Empty: 0;\n    }\n  }\n}\n`
    },
    steps: [
      {
        id: "enum constraint <T: Square> -> <T: Shape>",
        apply: () => edit("Shapes.hx", "enum Holder<T: Square> {", "enum Holder<T: Shape> {"),
        module: "mr.Shapes",
        expect: ["public-shape-changed", "signature-changed", "uses-changed"]
      }
    ]
  },
  {
    // Two saves of one module within one second, same size: Haxe's
    // whole-second file-time check sees one save. No server/invalidate.
    name: "same-second-saves",
    noInvalidate: true,
    steps: [
      {
        id: "first save",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Sava';"),
        module: "mr.Button",
        expect: "preview",
        skipProgram: true
      },
      {
        id: "second save in the same second, same size",
        apply: () => editSameSecond("Button.hx", "return 'Sava';", "return 'Savb';"),
        module: "mr.Button",
        expect: ["preview", "stale-source"]
      }
    ]
  },
  {
    // A same-size replacement after a full request, in the same second as
    // the save that the full request typed. No server/invalidate.
    name: "same-size-replacement",
    noInvalidate: true,
    steps: [
      {
        id: "save and full request",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Sava';")
      },
      {
        id: "same-size replacement in the same second",
        apply: () => editSameSecond("Button.hx", "return 'Sava';", "return 'Savb';"),
        module: "mr.Button",
        expect: ["preview", "stale-source"]
      },
      {
        id: "same-size replacement of an imported module in the same second",
        apply: () => editSameSecond("Theme.hx", "return 'blue';", "return 'teal';"),
        module: "mr.Button",
        expect: ["source-changed", "other-modules-changed", "other-modules-typed"]
      }
    ]
  },
  {
    // t1 part A: a second save lands while Haxe types the module request,
    // in the same second as the first. No server/invalidate.
    name: "t1-save-during-module-request",
    noInvalidate: true,
    files: { "mr/Race.hx": raceMacro },
    extraArgs: raceArgs,
    steps: [
      {
        id: "first save; a second save lands while Haxe types",
        apply: () => edit("Button.hx", "return 'Save';", "return 'Sava';"),
        module: "mr.Button",
        raceOnModule: "mr/Button.hx|return 'Sava';|return 'Savb';",
        expect: "stale-source",
        afterModule: () => {
          // The editor's second save kept the second of the first save.
          const file = path.join(workspace, "src/mr/Button.hx");
          utimesSync(file, firstSave.atime, firstSave.mtime);
        },
        skipProgram: true
      },
      {
        id: "next module request, no further save",
        apply: () => {},
        module: "mr.Button",
        expect: ["preview", "stale-source"]
      },
      { id: "a second full request", apply: () => {} }
    ]
  },
  {
    // t1b: a save lands while Haxe types a full request; the session then
    // invalidates every saved file and previews another module.
    name: "t1b-save-during-full-request",
    files: { "mr/Race.hx": raceMacro },
    extraArgs: raceArgs,
    steps: [
      {
        id: "full request during which Main stops calling Theme.size()",
        apply: () => edit("Leaf.hx", "case Small: 'small';", "case Small: 'tiny';"),
        raceOnFull: "mr/Main.hx|    trace(Theme.size());\n|"
      },
      {
        id: "Theme text edit; Main and Theme invalidated; preview Theme",
        apply: () => {
          saved.add(path.join(workspace, "src/mr/Main.hx"));
          edit("Theme.hx", "return 'blue';", "return 'teal';");
        },
        module: "mr.Theme",
        expect: ["source-changed", "other-modules-changed", "other-modules-typed"]
      }
    ]
  },
  {
    // t3 step 2: an import.hx changes in the same second with the same size.
    // No server/invalidate.
    name: "t3-import-hx",
    noInvalidate: true,
    files: {
      "mr/Main.hx": mainWith(["trace(mr.sub.Tagged.show());",
        "trace(ExtA.tag('a') + ExtB.tag('b'));"]),
      "mr/ExtA.hx": `package mr;\nclass ExtA {\n  public static function tag(text: String): String {\n`
        + `    return 'A' + text;\n  }\n}\n`,
      "mr/ExtB.hx": `package mr;\nclass ExtB {\n  public static function tag(text: String): String {\n`
        + `    return 'B' + text;\n  }\n}\n`,
      "mr/sub/Tagged.hx": `package mr.sub;\nclass Tagged {\n  public static function show(): String {\n`
        + `    return 'tagged ' + 'x'.tag();\n  }\n}\n`,
      "mr/sub/import.hx": "using mr.ExtA;\n"
    },
    steps: [
      { id: "no edit, module below an import.hx", apply: () => {}, module: "mr.sub.Tagged", expect: "preview" },
      {
        id: "import.hx ExtA -> ExtB, same time and size; preview Tagged; then a full request",
        apply: () => editSameSecond("sub/import.hx", "using mr.ExtA;", "using mr.ExtB;"),
        module: "mr.sub.Tagged",
        expect: ["source-changed", "stale-source"]
      }
    ]
  },
  {
    // r05 B: the module dependency file is deleted before the full request.
    name: "r05-module-dep",
    files: {
      "mr/Main.hx": mainWith(["Registry.items.push('first');",
        "trace(Registry.describe());"]),
      "mr/Registry.hx": `package mr;\n\nclass Registry {\n`
        + `  public static final items = [];\n\n`
        + `  public static function describe(): String {\n`
        + `    return 'registry ' + items.length;\n  }\n}\n`
    },
    steps: [
      {
        id: "Registry edit, then the .module-dep file is deleted",
        apply: () => edit("Registry.hx", "return 'registry ' + items.length;",
          "return 'registry! ' + items.length;"),
        module: "mr.Registry",
        expect: "public-shape-changed",
        afterModule: () => rmSync(`${descriptorFile}.module-dep`, { force: true })
      },
      {
        id: "a second full request, no edit",
        apply: () => {}
      }
    ]
  },
  ...lateMacroGroups()
];

function folder(name: string): string {
  return path.join(tempRoot, "out", name);
}

let groupArgs: ReadonlyArray<string> = [];

/** The number of accepted previews whose tree check passed. */
let treeChecks = 0;
let groupArgsBeforeGenes: ReadonlyArray<string> = [];
let invalidateSaved = true;

/**
 * Sends Haxe's `server/invalidate` for each file saved since the last
 * request, as a development session must before each request.
 */
async function invalidate(server: OwnedHaxeCompilerServer, label: string): Promise<void> {
  if (!invalidateSaved) {
    saved.clear();
    return;
  }
  for (const file of saved) {
    const result = await server.compile(["--display", JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "server/invalidate", params: { file }
    })], `Invalidate ${path.basename(file)} ${label}`, timeoutMs, workspace);
    ok(result.code === 0, `${label}: server/invalidate failed\n${describe(result)}`);
  }
  saved.clear();
}

/** Arguments shared by every request: the defines of the session. */
function commonArguments(): string[] {
  return [
    "-cp", genesSource,
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    ...groupArgsBeforeGenes,
    "--macro", "genes.Generator.use()",
    "-cp", path.join(workspace, "src"),
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    "-D", "genes.ts",
    "-D", `genes.source_map_root=${tempRoot}`,
    ...groupArgs
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

/** The files of a folder without the Genes manifest. */
function publishedFiles(root: string): ReadonlyArray<string> {
  return hashTree(root).map((entry) => entry.path)
    .filter((file) => !file.startsWith(".genes-output-")).sort();
}

function loadPerCpu(): number {
  return (loadavg()[0] ?? 0) / Math.max(1, cpus().length);
}

type Row = {
  readonly group: string;
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
    label: string, race?: string): Promise<number> {
  await invalidate(server, label);
  if (race !== undefined)
    writeFileSync(raceFlag, race);
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

/** Prepares a new workspace for one group: the template and the group's files. */
function prepare(group: Group): void {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(template, workspace, { recursive: true });
  for (const [relative, text] of Object.entries(group.files ?? {})) {
    const file = path.join(workspace, "src", relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    touch(file);
  }
  groupArgs = group.extraArgs ?? [];
  groupArgsBeforeGenes = group.argsBeforeGenes ?? [];
  invalidateSaved = group.noInvalidate !== true;
  saved.clear();
}

/** Runs the module request of one step and checks its output; returns the outcome. */
async function moduleStep(server: OwnedHaxeCompilerServer,
    compiler: ReturnType<typeof selectedHaxeCompiler>, step: Step,
    label: string): Promise<{ outcome: string, ms: number, report: ModuleReport | null }> {
  const module = step.module ?? "";
  const previewFolder = step.sameFolder === true ? folder("program") : folder("preview");
  const programBefore = hashTree(folder("program"));
  if (step.sameFolder !== true && step.keepFolder !== true)
    rmSync(previewFolder, { recursive: true, force: true });
  rmSync(reportFile, { force: true });
  await invalidate(server, label);
  if (step.race === "full-descriptor") {
    // S2: the session wrote the full descriptor before this module request ran.
    writeDescriptor({ kind: "full", moduleRecords: true });
    const result = await server.compile(incremental(moduleArguments(module, previewFolder)),
      `Raced module ${label}`, timeoutMs, workspace);
    ok(result.code !== 0, `${label}: a module request that reads a full descriptor must fail`);
    ok(`${result.stdout}\n${result.stderr}`.includes("GENES-MODULE-REQUEST-001"),
      `${label}: the failure must name GENES-MODULE-REQUEST-001\n${describe(result)}`);
    deepStrictEqual(publishedFiles(previewFolder), [],
      `${label}: a module request that read a full descriptor published files`);
    return { outcome: "failed", ms: 0, report: null };
  }
  if (step.race === "module-descriptor") {
    // s14: a full request reads the module descriptor of another request.
    writeDescriptor({ kind: "module", module });
    const result = await server.compile(incremental(programArguments(folder("program"))),
      `Raced full ${label}`, timeoutMs, workspace);
    ok(result.code === 0, `${label}: full request with a module descriptor failed\n${describe(result)}`);
    const report = readReport();
    deepStrictEqual(hashTree(folder("program")), programBefore,
      `${label}: a full request that read a module descriptor changed the program tree`);
    return { outcome: report.refusal ?? report.result, ms: 0, report };
  }
  if (step.fails === true)
    writeFileSync(failFlag, "fail\n");
  if (step.raceOnModule !== undefined)
    writeFileSync(raceFlag, step.raceOnModule);
  writeDescriptor({ kind: "module", module });
  const started = performance.now();
  const result = await server.compile(incremental(moduleArguments(module, previewFolder)),
    `Module ${label}`, timeoutMs, workspace);
  const ms = performance.now() - started;
  if (step.fails === true) {
    rmSync(failFlag, { force: true });
    ok(result.code !== 0, `${label}: the module request must fail`);
    return { outcome: "failed", ms, report: null };
  }
  ok(result.code === 0, `${label}: module request failed\n${describe(result)}`);
  const report = readReport();
  strictEqual(report.kind, "module", `${label}: report kind`);
  strictEqual(report.module, module, `${label}: report module`);
  const outcome = report.result === "preview" ? "preview" : report.refusal ?? report.result;
  if (report.result === "preview") {
    const coldTree = await coldBuild(compiler, label);
    // The preview holds the module's files and the manifest, nothing else.
    const published = publishedFiles(previewFolder);
    deepStrictEqual(published, [...report.files].sort(),
      `${label}: the preview folder holds other files than the report names`);
    ok(published.length > 0, `${label}: the preview published no file`);
    const prefix = module.split(".").join("/");
    for (const file of published) {
      ok(file === `${prefix}.ts` || file.startsWith(`${prefix}.`),
        `${label}: ${file} is not a file of ${module}`);
      const coldFile = path.join(folder("cold"), file);
      ok(existsSync(coldFile), `${label}: the cold build has no ${file}`);
      ok(readFileSync(path.join(previewFolder, file)).equals(readFileSync(coldFile)),
        `${label}: ${file} of the preview differs from the cold build`);
    }
    // The tree check (review of genes-ts #250): an accepted preview is the
    // only change that the edit makes. Cold must differ from the last full
    // tree only in the module's own files (and their maps); a change of any
    // other file means that the published tree goes stale until the next
    // full request.
    const others = treeDifference(programBefore, coldTree)
      .filter((file) => !file.startsWith(".genes-output-"))
      .filter((file) => !(file === `${prefix}.ts` || file.startsWith(`${prefix}.`)));
    deepStrictEqual(others, [],
      `${label}: the preview was accepted, but cold also changes other files `
      + `than those of ${module}:\n${others.join("\n")}`);
    treeChecks++;
  } else if (step.sameFolder === true) {
    deepStrictEqual(hashTree(folder("program")), programBefore,
      `${label}: a refused module request changed the full request's tree`);
  } else {
    deepStrictEqual(publishedFiles(previewFolder), [],
      `${label}: a refused module request left module files in its folder`);
  }
  return { outcome, ms, report };
}

async function runGroup(group: Group,
    compiler: ReturnType<typeof selectedHaxeCompiler>,
    rows: Row[]): Promise<{ previews: number, refusals: number }> {
  prepare(group);
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  let previews = 0;
  let refusals = 0;
  try {
    await programRequest(server, `${group.name} first`);
    for (const [index, step] of group.steps.entries()) {
      const label = `[${group.name} ${index + 1}/${group.steps.length}] ${step.id}`;
      step.apply();
      const load = loadPerCpu();
      let outcome = "-";
      let moduleMs = 0;
      let report: ModuleReport | null = null;
      if (step.module !== undefined) {
        const done = await moduleStep(server, compiler, step, label);
        outcome = done.outcome;
        moduleMs = done.ms;
        report = done.report;
        if (step.expect !== undefined) {
          const allowed = typeof step.expect === "string" ? [step.expect] : step.expect;
          ok(allowed.includes(outcome),
            `${label}: expected ${allowed.join(" or ")}, got ${outcome} (${String(report?.reason)})`);
        }
        if (outcome === "preview")
          previews++;
        else
          refusals++;
      }
      step.afterModule?.();
      let programMs = 0;
      if (step.skipProgram !== true) {
        const coldTree = await coldBuild(compiler, label);
        programMs = await programRequest(server, label, step.raceOnFull);
        const difference = treeDifference(hashTree(folder("program")), coldTree);
        deepStrictEqual(difference, [],
          `${label}: the full request after the step differs from the cold build:\n`
          + difference.join("\n"));
      }
      rows.push({
        group: group.name,
        id: step.id,
        result: outcome,
        typedAgain: report === null ? "" : report.typedAgainModules.join(" "),
        moduleMs: Math.round(moduleMs),
        genesMs: report === null ? 0 : report.generationMs,
        programMs: Math.round(programMs),
        load: Number(load.toFixed(2))
      });
    }
  } finally {
    await server.stop();
  }
  return { previews, refusals };
}

async function main(): Promise<void> {
  const compiler = selectedHaxeCompiler(repoRoot);
  const rows: Row[] = [];
  let previews = 0;
  let refusals = 0;
  const selectedGroups = groups.filter((group) => only === undefined
    || group.name.includes(only));
  for (const group of selectedGroups) {
    const counts = await runGroup(group, compiler, rows);
    previews += counts.previews;
    refusals += counts.refusals;
  }
  process.stdout.write("group | step | result | typed again | module request ms | "
    + "Genes ms | full request ms | load per CPU\n");
  for (const row of rows)
    process.stdout.write(`${row.group} | ${row.id} | ${row.result} | ${row.typedAgain} | `
      + `${row.moduleMs} | ${row.genesMs} | ${row.programMs} | ${row.load}\n`);
  let control = "keep control skipped";
  if (keepControl)
    control = await runKeepControl(compiler);
  process.stdout.write(`compiler-server-module:${only === undefined ? "ok" : "partial"} `
    + `(Haxe ${compiler.version}; ${selectedGroups.length} groups; ${previews} `
    + `previews byte-identical to cold, ${refusals} refused or failed as expected, `
    + `every full request after a step equal to cold; tree check on ${treeChecks} `
    + `previews: cold changes only the previewed module's files; ${control})\n`);
}

/**
 * Observation for `--keep-control`: roots a module request with
 * `--macro keep(<module>)` instead of the Genes roots, then runs a full
 * request and compares it with cold. Returns a summary line.
 */
async function runKeepControl(
  compiler: ReturnType<typeof selectedHaxeCompiler>
): Promise<string> {
  // No server/invalidate here: the observation is what keep() leaves in
  // Haxe's cache for a session that sends nothing else.
  prepare({ name: "keep-control", noInvalidate: true, steps: [] });
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  try {
    await programRequest(server, "keep control first");
    edit("Button.hx", "return 'Save';", "return 'Store';");
    // A full request of the module's program, as genes-f8vc.14.1 measured
    // it: Genes adds no roots, keep() does. Same define, so the same Haxe
    // cache as the session. It has no --main, so it asks for no module
    // records (`GENES-MODULE-REQUEST-001`).
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
