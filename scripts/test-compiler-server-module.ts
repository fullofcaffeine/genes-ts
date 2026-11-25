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
 * The groups of `statGroups` check how Genes knows file contents
 * (genes-f8vc.14.11). A module request trusts the kept status of an
 * unchanged file (size, modification time, change time, inode) only when
 * that status was read more than the grain (2 s) after the file's last
 * change, and reads every other file. The groups cover a save that keeps the
 * size and the modification time, a file replaced by another one, a status
 * read inside the grain, a save and a revert while Haxe types, a file first
 * seen in a full request (unknown once, as before) and a deleted
 * `import.hx`.
 *
 * The groups of `earlyInitMacroGroups` (genes-v54c) give an init macro
 * before `genes.Generator.use()` that types `mr.Fresh` by name, and save
 * `mr/Fresh.hx` so that Haxe's whole-second check misses it (modification
 * time kept, or moved inside the same second, also with a dependency save
 * that makes Haxe type `mr.Fresh` again from its old text). Genes then
 * refuses the first request after the change once (`initRefusal`), and the
 * same request sent again must equal cold. A step that does not name such a
 * refusal fails when one happens.
 *
 * The groups of `failedRequestGroups` (genes-u8fq) let a request fail with
 * a type error in `mr/Fresh.hx`, then save the file back with the
 * modification time of the failed save: the next request must equal cold
 * at once, after a full request, a module request, an edit of another file
 * and editor requests.
 *
 * The groups of `stdGroups` (genes-f8vc.14.7) run with `-dce std`: they make
 * structural edits that the `-dce std` rule previews (byte-identical to
 * cold, with the tree check) or refuses with its own code, and one group
 * makes the same edit under `-dce full`, which keeps the strict rule.
 * `--sweep` runs only `sweepGroup`: five structural edits of each of 20
 * generated UI modules. `--observe` records results instead of failing on
 * them, for red evidence against another Genes source.
 *
 * Records that match the sources (genes-f8vc.14.8): every request asks for
 * the records text (`"recordsText": true`). After an accepted preview the
 * text must equal the text of the full request after it, and that full
 * request must find the advanced records equal to its own; after a refused
 * module request the text must not change. The `chain-` groups make
 * previews in a row without a full request between them, and `--chain`
 * runs only `runChains`: 100 chains of five sweep edits each, checked
 * against cold and against the records of a reference server's full
 * request after every edit.
 *
 * `--keep-control` also runs the older way to root a module request,
 * `--macro keep(<module>)`, and prints whether the next full request then
 * differs from cold (the measured cache pollution of genes-f8vc.14.1). It is
 * an observation, not a pass condition. `--only=<text>` runs the groups
 * whose name contains the text.
 *
 * Times are printed with the 1-minute load; they are diagnostic only. The
 * last lines give the median time that module requests spent on source
 * files (`digestMs` of the report).
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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
const flipFlag = path.join(tempRoot, "flip.flag");

/**
 * A test double for an editor that saves a file and reverts it while Haxe
 * types a request: `mr.Flip`, an init macro given after
 * `genes.Generator.use()` (so after Genes read the file), replaces a text in
 * the file that `flip.flag` names, and puts the old content back in
 * `onAfterTyping`, after Haxe parsed the file. The digest before and after
 * typing is the same; the change time is not.
 */
const flipMacro = `package mr;\n\nimport haxe.macro.Context;\n\nclass Flip {\n`
  + `  public static function install(flag: String, sources: String): Void {\n`
  + `    if (!sys.FileSystem.exists(flag))\n      return;\n`
  + `    final parts = sys.io.File.getContent(flag).split('|');\n`
  + `    sys.FileSystem.deleteFile(flag);\n    final file = sources + '/' + parts[0];\n`
  + `    final original = sys.io.File.getContent(file);\n`
  + `    sys.io.File.saveContent(file, StringTools.replace(original, parts[1], parts[2]));\n`
  + `    Context.onAfterTyping(_ -> sys.io.File.saveContent(file, original));\n`
  + `  }\n}\n`;
const flipArgs = ["--macro", `mr.Flip.install(${JSON.stringify(flipFlag)}, ${JSON.stringify(path.join(workspace, "src"))})`];

/** The timestamp grain of `ModuleRequest` (2 s) plus a margin, in milliseconds. */
const settleMs = 2_500;

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

/**
 * A test double for an editor that saves a file twice inside one whole
 * second while Haxe runs a full request (genes-f8vc.14.24): `mr.Strip`, an
 * init macro given after `genes.Generator.use()` (so after Genes walked the
 * included folders), replaces a text in the file that `strip.flag` names,
 * before Haxe's own `include` walk parses the file, and puts the old content
 * back in `onAfterTyping` with the modification time of the first save
 * (`touch -r`), so Haxe's file-time check cannot see the second save. It
 * runs only in a request with `--main` (a cold build or a full request), so
 * the module request of a step never takes the flag.
 */
const stripMacro = `package mr;\n\nimport haxe.macro.Context;\n\nclass Strip {\n`
  + `  public static function install(flag: String, sources: String): Void {\n`
  + `    if (!sys.FileSystem.exists(flag)\n`
  + `      || haxe.macro.Compiler.getConfiguration().args.indexOf('--main') < 0)\n      return;\n`
  + `    final parts = sys.io.File.getContent(flag).split('|');\n`
  + `    sys.FileSystem.deleteFile(flag);\n    final file = sources + '/' + parts[0];\n`
  + `    final original = sys.io.File.getContent(file);\n`
  + `    sys.io.File.saveContent(file, StringTools.replace(original, parts[1], parts[2]));\n`
  + `    Sys.command('touch', ['-r', file, flag + '.time']);\n`
  + `    Context.onAfterTyping(_ -> {\n      sys.io.File.saveContent(file, original);\n`
  + `      Sys.command('touch', ['-r', flag + '.time', file]);\n    });\n  }\n}\n`;
const stripFlag = path.join(tempRoot, "strip.flag");
const stripArgs = ["--macro", `mr.Strip.install(${JSON.stringify(stripFlag)}, ${JSON.stringify(path.join(workspace, "src"))})`];
const timeoutMs = 180_000;
const keepControl = process.argv.includes("--keep-control");
/** `--sweep` runs only the scripted structural sweep (`sweepGroup`). */
const sweep = process.argv.includes("--sweep");
/** `--chain` runs only the chains of previews without a full request between them (`runChains`, genes-f8vc.14.8). */
const chainMode = process.argv.includes("--chain");
/**
 * `--observe` records each step's result instead of failing on it, for red
 * evidence with `GENES_TEST_SOURCE` (an older or a changed Genes): a result
 * other than the expected one is printed as is, and a preview whose files
 * differ from cold, or that cold changes other files beside, is printed as
 * `STALE <files>`. A full request that differs from cold still fails.
 */
const observe = process.argv.includes("--observe");
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
  /** Time spent on source files (read, hash, status). */
  readonly digestMs: number;
  /** Files of the stored program that the source check read; absent before genes-f8vc.14.11. */
  readonly hashedSources?: ReadonlyArray<string>;
  /** Files of the stored program that the status rule trusted; absent before genes-f8vc.14.11. */
  readonly trustedSources?: number;
  /**
   * What the request did with the stored records (genes-f8vc.14.8):
   * `advanced` after a preview, `kept` after a refusal, or `dropped: <why>`
   * when a preview could not advance them exactly. Absent before.
   */
  readonly records?: string;
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
  /**
   * A save (`file|from|to`, under `src/`) that lands after Genes walked the
   * included folders and before Haxe's own `include` walk, and a second
   * save that puts the file back in the same whole second (`mr.Strip`), in
   * the cold build and in the full request of the step. Both see the first
   * save, so they must still be equal. Only for a step without a module
   * request: the cold build of a preview would take the flag.
   */
  readonly stripOnFull?: string;
  /**
   * A save (`file|from|to`, under `src/`) after Genes read the file and before
   * Haxe parses it, reverted after typing (`mr.Flip`), in the module request.
   */
  readonly flipOnModule?: string;
  /**
   * Wait this long after `apply` and before the requests, so that the files
   * that `apply` wrote are older than the grain when a request reads them.
   */
  readonly settleMs?: number;
  /** The number of modules that Haxe must type again in the full request after this step (`shapes` of its records report). */
  readonly fullTypedAgain?: number;
  /**
   * The modules that Haxe must type again in the full request after this
   * step (`typedAgainModules` of its after-typing report). Unlike
   * `fullTypedAgain`, it also holds after Genes started with new macro state,
   * whose shape cache is empty.
   */
  readonly fullTypedAgainModules?: ReadonlyArray<string>;
  /** More checks of the module request's report. */
  readonly check?: (report: ModuleReport, label: string) => void;
  /**
   * The request of this step that Genes refuses once because Haxe may have
   * typed old text of a changed file (genes-v54c): an init macro given
   * before `genes.Generator.use()` can type a module (`init-macro-before-
   * genes` for a module request), or Haxe kept a module of a changed file
   * from its cache (a full request stops with `GENES-MODULE-REQUEST-003` in
   * both cases). `module`, `full` or `both` name the refused requests. The
   * refused request must publish nothing. The driver then sends the same
   * request again, once, as a session must, and checks that one. Any other
   * such refusal fails the gate.
   */
  readonly initRefusal?: "module" | "full" | "both";
  /**
   * An editor request that the same server answers before or after `apply`
   * (genes-lnrv): a diagnostics request that types the program and
   * generates nothing (see `displayRequest`).
   */
  readonly display?: { readonly when: "before-save" | "after-save", readonly form: DisplayForm };
  /**
   * After `apply` and before an after-save `display`, a cold `haxe` process
   * builds the program with the session's descriptor define, which breaks
   * the rule "one Haxe process per descriptor path" (review of genes-ts
   * #255). It writes the stored cache facts with its own process token.
   */
  readonly coldWithDescriptor?: boolean;
  /**
   * Stop the server and start a new one before `apply`, so the step's full
   * request is the first request of a new process, which finds the stored
   * cache facts of the old one.
   */
  readonly restartServer?: boolean;
  /**
   * The text after `apply` has a type error (genes-u8fq): the cold build,
   * the step's module request and its full request must each fail, and the
   * warm full request must report the errors of the cold build. Neither
   * request may publish anything.
   */
  readonly typeError?: boolean;
  /**
   * The edited module still types alone, but the program no longer
   * compiles (review of #260: a new private field that another module
   * calls). The module request must not preview; the cold build and the
   * full request must fail with the same errors (as for `typeError`).
   */
  readonly programFails?: boolean;
  /**
   * With `programFails`: the module request may publish a preview (limit B
   * of the review of genes-ts #260). The step's result is then
   * `preview-program-fails`. No stale file results: the full request after
   * it fails with the errors of the cold build, as `programFails` checks.
   */
  readonly previewWhileProgramFails?: boolean;
};

/**
 * The form of an editor request (genes-lnrv):
 *
 * - `cli`: `--display <Main.hx>@0@diagnostics`, with the session's
 *   arguments but without the descriptor define, as an editor sends it;
 * - `json`: the JSON-RPC method `display/diagnostics`, also without the
 *   descriptor define;
 * - `json-session`: `display/diagnostics` with the descriptor define, so
 *   with the defines of the full requests: Genes runs in it and Haxe keeps
 *   its typing in the cache of the full requests.
 */
type DisplayForm = "cli" | "json" | "json-session";

/** A list of steps on its own server and its own copy of the template. */
type Group = {
  readonly name: string;
  /** Source files (relative to `src/`) written over the template. */
  readonly files?: Readonly<Record<string, string>>;
  /** Extra Haxe arguments of every request of the group. */
  readonly extraArgs?: ReadonlyArray<string>;
  /**
   * The dead-code elimination of every request (`-dce`); `full` when not
   * given. The `std-` groups use `std`, the profile of the structural rule
   * (genes-f8vc.14.7).
   */
  readonly dce?: "std" | "full";
  /** The `--main` class of the full requests; `mr.Main` when not given. */
  readonly main?: string;
  /**
   * More roots of the full requests only (genes-f8vc.14.12): class-name
   * arguments and `--macro include(...)` lines. A module request leaves
   * them out, as the development session does
   * (`moduleRequestArguments` of `tooling/src/session`).
   */
  readonly programRoots?: ReadonlyArray<string>;
  /** Give `programRoots` before `--macro genes.Generator.use()` instead of after the class paths. */
  readonly rootsBeforeGenes?: boolean;
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
  editSource(path.join("mr", relative), from, to);
}

/** Replaces one exact text in a file under `src/` and moves its time. */
function editSource(relative: string, from: string, to: string): void {
  const file = path.join(workspace, "src", relative);
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

/**
 * Replaces one exact text with another of the same length and moves the
 * modification time inside the same whole second: a second save in the
 * same second, which Haxe's whole-second file-time check cannot see.
 */
function editInSameSecond(relative: string, from: string, to: string): void {
  const file = sourceFile(relative);
  strictEqual(from.length, to.length, `${relative}: the replacement must keep the size`);
  const before = statSync(file);
  const second = Math.floor(before.mtimeMs / 1000);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  writeFileSync(file, text.replace(from, to));
  const fraction = before.mtimeMs - second * 1000 < 500 ? 0.75 : 0.25;
  utimesSync(file, before.atime, second + fraction);
  const after = statSync(file);
  strictEqual(Math.floor(after.mtimeMs / 1000), second,
    `${relative}: the file time must stay in the same whole second`);
  ok(after.mtimeMs !== before.mtimeMs, `${relative}: the file time must move inside the second`);
  saved.add(file);
}

/** The absolute path of a fixture file under `src/mr`. */
function sourceFile(relative: string): string {
  return path.join(workspace, "src/mr", relative);
}

/**
 * Sets the modification time of a fixture file to a whole second, so that
 * a later save can set it back exactly. The change time becomes now.
 */
function setTime(relative: string, seconds: number): void {
  ok(Number.isInteger(seconds), `${relative}: the time must be a whole second`);
  utimesSync(sourceFile(relative), seconds, seconds);
}

/**
 * Replaces one exact text with another of the same length and sets the
 * modification time back exactly: size, modification time and inode stay,
 * only the change time moves. Neither Haxe's whole-second check nor a
 * status rule without the change time can see this save.
 */
function editKeepingStatus(relative: string, from: string, to: string): void {
  const file = sourceFile(relative);
  strictEqual(from.length, to.length, `${relative}: the replacement must keep the size`);
  const before = statSync(file);
  ok(before.mtimeMs % 1000 === 0, `${relative}: setTime must set a whole second first`);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  writeFileSync(file, text.replace(from, to));
  utimesSync(file, before.atime, before.mtime);
  const after = statSync(file);
  strictEqual(after.size, before.size, `${relative}: the size must stay`);
  strictEqual(after.mtimeMs, before.mtimeMs, `${relative}: the modification time must stay`);
  strictEqual(after.ino, before.ino, `${relative}: the inode must stay`);
}

/**
 * Replaces a fixture file by a new file (another inode) whose text differs
 * in one same-length place, with the same modification time: an editor
 * that writes a copy and renames it over the file.
 */
function replaceKeepingTime(relative: string, from: string, to: string): void {
  const file = sourceFile(relative);
  strictEqual(from.length, to.length, `${relative}: the replacement must keep the size`);
  const before = statSync(file);
  ok(before.mtimeMs % 1000 === 0, `${relative}: setTime must set a whole second first`);
  const text = readFileSync(file, "utf8");
  ok(text.split(from).length === 2,
    `${relative} must contain ${JSON.stringify(from)} exactly once`);
  const copy = `${file}.new`;
  writeFileSync(copy, text.replace(from, to));
  utimesSync(copy, before.atime, before.mtime);
  renameSync(copy, file);
  const after = statSync(file);
  strictEqual(after.size, before.size, `${relative}: the size must stay`);
  strictEqual(after.mtimeMs, before.mtimeMs, `${relative}: the modification time must stay`);
  ok(after.ino !== before.ino, `${relative}: the new file must have another inode`);
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
    // genes-f8vc.14.8: the accepted Theme preview advanced the records of
    // mr.Theme, and Haxe keeps the mr.Theme of that preview until the next
    // request that is not a module request. mr.Button imports mr.Theme
    // directly, so this preview is checked against records that match the
    // sources (before: `other-modules-typed`).
    expect: "preview"
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
      // Given before `genes.Generator.use()`, `mr.CopyMacro` is an init macro
      // that Genes cannot prove to type nothing, so the init macro rule
      // refuses the first request after each edit once (genes-v54c).
      const editRefusal = (request: "module" | "full") =>
        order === "before" ? { initRefusal: request } : {};
      // The refused first request already ran the macro. Its write of a
      // typedef field's metadata (f3) stays on the cached declaration, so the
      // metadata comparison of the request sent again sees it first
      // (`session-changed`; observed). Either code refuses the preview. The
      // other cases keep their code when sent again.
      const late = order === "before" && item.kind === "field-meta"
        ? [item.late, "session-changed"].flat()
        : item.late;
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
            apply: () => edit("Probe.hx", `return '${item.from}';`, `return '${item.to}';`),
            ...editRefusal("full")
          } : {
            id: `macro ${order} Genes.use() ${item.what}: '${item.from}' -> '${item.to}'`,
            apply: () => edit("Probe.hx", `return '${item.from}';`, `return '${item.to}';`),
            module: "mr.Probe",
            ...editRefusal("module"),
            expect: order === "after" ? item.early : late
          },
          item.fullOnly === true ? {
            id: `macro ${order} Genes.use(), a second full request, no edit`,
            apply: () => {}
          } : {
            id: `macro ${order} Genes.use(), a literal that the macro does not read`,
            apply: () => edit("Probe.hx", "return 'probe ' + tag()", "return 'probe! ' + tag()"),
            module: "mr.Probe",
            ...editRefusal("module"),
            // The define stays set while the literal is `ext`, and a macro
            // after the passes of Genes sets it after the session key.
            expect: item.kind === "define" && order === "before" ? "defines-changed" : "preview"
          }
        ]
      });
    }
  return groups;
}

/** `mr.Fresh`: a module that a group adds after the first full request. */
function freshWith(text: string): string {
  return `package mr;\n\nclass Fresh {\n  public static function run(): String {\n`
    + `    return '${text}';\n  }\n}\n`;
}

/** The fixture files (under the workspace's `src/`) that a module request read. */
function hashedFixtureFiles(report: ModuleReport): ReadonlyArray<string> {
  const root = path.join(workspace, "src") + path.sep;
  return (report.hashedSources ?? []).filter((file) => file.startsWith(root));
}

/** Checks that a refused module request read `mr/Theme.hx` and named it. */
function readTheme(report: ModuleReport, label: string): void {
  ok(String(report.reason).includes(sourceFile("Theme.hx")),
    `${label}: the refusal must name mr/Theme.hx (${String(report.reason)})`);
  deepStrictEqual(hashedFixtureFiles(report), [sourceFile("Theme.hx")],
    `${label}: the module request must read mr/Theme.hx and no other fixture file`);
}

/**
 * The groups of genes-f8vc.14.11: how a module request knows that the files
 * of the stored program still hold what Haxe typed, without reading every
 * file.
 *
 * - `stat-rule`: a module request trusts the kept status of an unchanged
 *   file only when it was read more than the grain after the file's last
 *   change; a save that keeps the size and the modification time (only the
 *   change time moves), a file replaced by another one with the same size
 *   and time, and a status read inside the grain (a modification time in
 *   the future) are read and seen. No `server/invalidate`, so Haxe's own
 *   whole-second check does not see these saves either.
 * - `stat-save-and-revert`: a save and a revert while Haxe types leave the
 *   digest equal; the change time shows them (`stale-source`).
 * - `stat-first-seen`: a new module stays unknown after the full request
 *   that first typed it, even when it is older than the grain: Haxe may
 *   have parsed it outside the reads of Genes (for example in a failed
 *   request, or in an init macro given before `genes.Generator.use()`).
 *   The next module request is refused once (`source-changed`); after the
 *   next full request it previews.
 * - `stat-deleted-import-hx`: a module request sees a deleted `import.hx`
 *   by its missing status (`source-changed`), and the full request after
 *   the next one does not make Haxe type its folder again.
 */
function statGroups(): ReadonlyArray<Group> {
  const now = (): number => Math.floor(Date.now() / 1000);
  return [
    {
      name: "stat-rule",
      noInvalidate: true,
      steps: [
        {
          id: "Theme gets a whole-second time in the past; the files settle; a full request reads them",
          apply: () => setTime("Theme.hx", now() - 60),
          settleMs
        },
        {
          id: "Button text edit: every unchanged file is trusted by its status",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Sale';"),
          module: "mr.Button",
          expect: "preview",
          check: (report, label) => {
            ok((report.trustedSources ?? 0) > 0,
              `${label}: the status rule trusted no file (trustedSources ${String(report.trustedSources)})`);
            deepStrictEqual(hashedFixtureFiles(report), [],
              `${label}: the module request read fixture files that did not change`);
          }
        },
        {
          id: "Theme saved with the same size, modification time and inode (only the change time moves)",
          apply: () => editKeepingStatus("Theme.hx", "return 'blue';", "return 'teal';"),
          module: "mr.Button",
          expect: "source-changed",
          check: readTheme
        },
        { id: "the files settle; a full request reads them", apply: () => {}, settleMs },
        {
          id: "Theme replaced by another file (another inode) with the same size and modification time",
          apply: () => replaceKeepingTime("Theme.hx", "return 'teal';", "return 'gray';"),
          module: "mr.Button",
          expect: "source-changed",
          check: readTheme
        },
        {
          id: "Theme gets a whole-second time in the future (a status inside the grain), no content change",
          apply: () => setTime("Theme.hx", now() + 3600)
        },
        {
          id: "no edit: the status read inside the grain is not trusted",
          apply: () => {},
          module: "mr.Button",
          expect: "preview",
          check: (report, label) => deepStrictEqual(hashedFixtureFiles(report),
            [sourceFile("Theme.hx")], `${label}: the module request must read mr/Theme.hx only`)
        },
        {
          id: "Theme saved inside the grain with the same size, modification time and inode",
          apply: () => editKeepingStatus("Theme.hx", "return 'gray';", "return 'pink';"),
          module: "mr.Button",
          expect: "source-changed",
          check: readTheme
        }
      ]
    },
    {
      name: "stat-save-and-revert",
      files: { "mr/Flip.hx": flipMacro },
      extraArgs: flipArgs,
      steps: [
        {
          id: "Button text edit; a save and a revert land while Haxe types",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Sale';"),
          module: "mr.Button",
          flipOnModule: "mr/Button.hx|return 'Sale';|return 'Salt';",
          expect: "stale-source"
        },
        {
          id: "next module request, no further save",
          apply: () => {},
          module: "mr.Button",
          expect: "preview"
        }
      ]
    },
    {
      name: "stat-first-seen",
      steps: [
        {
          id: "new module Fresh, older than the grain when the full request first types it",
          apply: () => {
            writeFileSync(sourceFile("Fresh.hx"), freshWith("one"));
            edit("Main.hx", "    trace(Theme.size());\n",
              "    trace(Theme.size());\n    trace(Fresh.run());\n");
          },
          settleMs
        },
        {
          id: "Button text edit, the first module request after them: Fresh is unknown",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Sale';"),
          module: "mr.Button",
          expect: "source-changed",
          check: (report, label) => ok(String(report.reason).includes(sourceFile("Fresh.hx")),
            `${label}: the refusal must name mr/Fresh.hx (${String(report.reason)})`)
        },
        {
          id: "Button text edit after the next full request",
          apply: () => edit("Button.hx", "return 'Sale';", "return 'Salt';"),
          module: "mr.Button",
          expect: "preview"
        }
      ]
    },
    {
      name: "stat-deleted-import-hx",
      files: {
        "mr/Main.hx": mainWith(["trace(mr.sub.Tagged.show());"]),
        "mr/sub/Tagged.hx": "package mr.sub;\n\nclass Tagged {\n"
          + "  public static function show(): String {\n    return 'tagged';\n  }\n}\n",
        "mr/sub/import.hx": "using StringTools;\n"
      },
      steps: [
        {
          id: "mr/sub/import.hx deleted; preview of Button, which does not import it",
          apply: () => rmSync(sourceFile("sub/import.hx")),
          module: "mr.Button",
          expect: "source-changed",
          check: (report, label) => ok(String(report.reason).includes(sourceFile("sub/import.hx")),
            `${label}: the refusal must name mr/sub/import.hx (${String(report.reason)})`)
        },
        {
          id: "no edit: the next full request makes Haxe type nothing again",
          apply: () => {},
          module: "mr.Button",
          expect: "preview",
          fullTypedAgain: 0
        }
      ]
    }
  ];
}

/**
 * `mr.Early`: an init macro that types `mr.Fresh` by name. Given before
 * `--macro genes.Generator.use()`, it runs before Genes reads any file.
 */
const earlyMacro = `package mr;\n\n#if macro\nclass Early {\n`
  + `  public static function install(): Void {\n`
  + `    haxe.macro.Context.getType('mr.Fresh');\n  }\n}\n#end\n`;

/**
 * `mr.EarlyBuild`: a build macro that types `mr.Fresh` by name and leaves the
 * fields of the type that it builds as they are.
 */
const earlyBuildMacro = `package mr;\n\n#if macro\nclass EarlyBuild {\n`
  + `  public static function build(): Array<haxe.macro.Expr.Field> {\n`
  + `    haxe.macro.Context.getType('mr.Fresh');\n    return null;\n  }\n}\n#end\n`;

/** `mr.Fresh` that also reads `Theme.size()`, so that it depends on `mr.Theme`. */
function freshUsingTheme(text: string): string {
  return `package mr;\n\nclass Fresh {\n  public static function run(): String {\n`
    + `    return '${text}' + Theme.size();\n  }\n}\n`;
}

/**
 * The groups of genes-v54c: an init macro given before
 * `genes.Generator.use()` types a project module (`mr.Fresh`) by name, so
 * Haxe types it before Genes reads any file. The groups save `mr/Fresh.hx`
 * so that Haxe's whole-second file-time check cannot see the save, and send
 * no `server/invalidate`. Before the fix, each full request after such a
 * save published the old text of `mr/Fresh.ts`.
 *
 * - `early-init-mtime-kept`: the save keeps the modification time. The
 *   full request is refused once (`GENES-MODULE-REQUEST-003`) and equals
 *   cold when sent again. Then a text edit of another module and a second
 *   save of `mr/Fresh.hx`: each module request is refused once
 *   (`init-macro-before-genes`) and previews when sent again;
 * - `early-init-same-second`: the save moves the modification time inside
 *   the same whole second;
 * - `early-init-dependency-changed`: `mr.Fresh` reads `mr.Theme`, and
 *   `mr/Theme.hx` gets a save that Haxe sees in the same step, so Haxe types
 *   `mr.Fresh` again in the init macro, from the text that it parsed before
 *   (a new typing of a stale text, which the stamps of
 *   `GenerationChangeSet` cannot show);
 * - `early-init-not-typing`: the only init macro before
 *   `genes.Generator.use()` is a `haxe.macro.Compiler` call that types
 *   nothing (`define`), so the rule refuses nothing and Genes makes Haxe
 *   read a save in the same second itself, as before.
 *
 * The `early-init-global-` groups (review of genes-ts #254) give only an
 * allowed `addGlobalMetadata` call before `genes.Generator.use()`, so
 * nothing is refused, but its metadata loads `mr.Fresh` when a type is
 * built: `@:build(mr.EarlyBuild.build())` on `genes.Register` (`-build-
 * register`) or on every type (`-build-all`), where the build macro calls
 * `Context.getType('mr.Fresh')`, and `@:using(mr.Fresh)` on
 * `genes.Register` (`-using`). `Generator.use()` types `genes.Register`
 * itself, so before Genes read the files first (`ModuleRequest.begin`), the
 * full request after a save that keeps the modification time published the
 * old `mr/Fresh.ts`. With `-build-all`, the build macro also ran for
 * standard types in the first request, so they depend on `mr.Fresh`, and
 * Haxe loads them from its cache with every dependency before any init
 * macro: `mr.Fresh` arrives as the object of the first request, and the
 * full request is refused once (`keptStaleModules`).
 * `kept-stale-global-build-after-genes` gives the same macro after
 * `genes.Generator.use()`, where it is refused the same way.
 */
function earlyInitMacroGroups(): ReadonlyArray<Group> {
  const early = {
    argsBeforeGenes: ["--macro", "mr.Early.install()"],
    noInvalidate: true
  };
  return [
    {
      name: "early-init-mtime-kept",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/Early.hx": earlyMacro
      },
      ...early,
      steps: [
        {
          id: "no edit: the init macro rule refuses nothing",
          apply: () => {}
        },
        {
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        },
        {
          id: "Button text edit",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Sale';"),
          module: "mr.Button",
          initRefusal: "module",
          expect: "preview"
        },
        {
          id: "Fresh saved again with its modification time kept, preview of Fresh",
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';"),
          module: "mr.Fresh",
          initRefusal: "module",
          expect: "preview"
        }
      ]
    },
    {
      name: "early-init-same-second",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/Early.hx": earlyMacro
      },
      ...early,
      steps: [
        {
          id: "Fresh saved in the same whole second",
          apply: () => editInSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        }
      ]
    },
    {
      // The same init macro written as one argument, `--macro=<call>`, as
      // Haxe 4.3.7 accepts it and keeps it in
      // `Compiler.getConfiguration().args` (genes-f8vc.14.22). Before the
      // fix, Genes looked only for `--macro` as an argument of its own, so
      // the init-macro rule missed this macro: the full request of step 1
      // was refused only by the kept-stale check, and the module request of
      // step 2 was refused as `stale-source` instead of by this rule.
      name: "early-init-inline-macro",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/Early.hx": earlyMacro
      },
      argsBeforeGenes: ["--macro=mr.Early.install()"],
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept (inline --macro=)",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        },
        {
          id: "Fresh saved again with its modification time kept, preview of Fresh (inline --macro=)",
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';"),
          module: "mr.Fresh",
          initRefusal: "module",
          expect: "preview"
        }
      ]
    },
    {
      name: "early-init-dependency-changed",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshUsingTheme("one"),
        "mr/Early.hx": earlyMacro
      },
      ...early,
      steps: [
        {
          id: "Theme saved (Haxe sees it); Fresh saved with its modification time kept",
          apply: () => {
            edit("Theme.hx", "return 12;", "return 13;");
            editSameSecond("Fresh.hx", "return 'one'", "return 'two'");
          },
          initRefusal: "full"
        }
      ]
    },
    {
      name: "early-init-not-typing",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one")
      },
      argsBeforeGenes: ["--macro", "define('mr_early_define')"],
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        },
        {
          id: "Fresh saved again with its modification time kept, preview of Fresh",
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';"),
          module: "mr.Fresh",
          expect: "preview"
        }
      ]
    },
    {
      name: "early-init-global-build-register",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/EarlyBuild.hx": earlyBuildMacro
      },
      argsBeforeGenes: ["--macro",
        "addGlobalMetadata('genes.Register', '@:build(mr.EarlyBuild.build())')"],
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        },
        {
          id: "Fresh saved again with its modification time kept, module request of Fresh",
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';"),
          module: "mr.Fresh",
          // The build macro of `genes.Register` types `mr.Fresh`, so
          // `genes.Register` depends on it and Haxe types it again.
          expect: "other-modules-typed"
        }
      ]
    },
    {
      name: "early-init-global-build-all",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/EarlyBuild.hx": earlyBuildMacro
      },
      argsBeforeGenes: ["--macro", "addGlobalMetadata('', '@:build(mr.EarlyBuild.build())')"],
      noInvalidate: true,
      steps: [
        {
          // The build macro ran for standard types in the first request, so
          // they depend on `mr.Fresh`, and Haxe loads them from its cache
          // with every dependency before any init macro: `mr.Fresh` arrives
          // as the object of the first request (`keptStaleModules`).
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        }
      ]
    },
    {
      name: "early-init-global-using",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one")
      },
      argsBeforeGenes: ["--macro", "addGlobalMetadata('genes.Register', '@:using(mr.Fresh)')"],
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        }
      ]
    },
    {
      // The same global build macro, given after `genes.Generator.use()`:
      // the standard types still depend on `mr.Fresh`, so init macro order
      // does not matter here.
      name: "kept-stale-global-build-after-genes",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/EarlyBuild.hx": earlyBuildMacro
      },
      extraArgs: ["--macro", "addGlobalMetadata('', '@:build(mr.EarlyBuild.build())')"],
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        },
        {
          id: "Fresh saved in the same whole second",
          apply: () => editInSameSecond("Fresh.hx", "return 'two';", "return 'six';"),
          initRefusal: "full"
        }
      ]
    }
  ];
}

/**
 * The groups of genes-lnrv: an editor request (`displayRequest`) reaches
 * the same server between two full requests, before or after a save of
 * `mr/Fresh.hx` that keeps the modification time, and no
 * `server/invalidate` is sent. An editor request without the descriptor
 * define has other defines, so Haxe types the macro classes of Genes again
 * for it, and their `@:persistent` state starts empty in the next full
 * request. Haxe still keeps the modules of the full requests. Before the
 * fix, that full request published the old `mr/Fresh.ts` and the request
 * after it was right.
 *
 * - `display-cli`: `--display Main.hx@0@diagnostics` before the save, then
 *   after a second save, then a step without an edit;
 * - `display-json`: the JSON-RPC method `display/diagnostics`, before and
 *   after a save;
 * - `display-json-session`: `display/diagnostics` with the descriptor
 *   define, so Genes runs in it and Haxe keeps its typing in the cache of
 *   the full requests; it must not count as a published request;
 * - `display-dependency-changed`: `mr.Fresh` reads `mr.Theme`, and a save of
 *   `mr/Theme.hx` that Haxe sees comes with the save of `mr/Fresh.hx`, so
 *   Haxe types `mr.Fresh` again from the text that it parsed before; a
 *   stamp of `GenerationChangeSet` cannot show this case;
 * - `display-none-no-edit`: five full requests without an edit and
 *   without an editor request: Haxe types no module again, and the rows give
 *   the time of such a request;
 * - `display-cold-run`: a save that keeps the modification time, then a cold
 *   `haxe` run with the session's descriptor define (it breaks the rule
 *   "one Haxe process per descriptor path" and writes the stored facts with
 *   its own process token), then an editor request. The full request makes
 *   Haxe parse every file again, is refused once because of the standard
 *   types that Haxe loaded before Genes ran, and equals cold when sent
 *   again; the request after it types no module again;
 * - `display-new-server`: the server is restarted and `mr/Fresh.hx` saved
 *   in between, with an init macro before Genes that types `mr.Fresh`. The
 *   first request of the new process holds no module, so it is not refused;
 * - `display-global-build-all`: the global build macro of
 *   `early-init-global-build-all`, so Haxe loads `mr.Fresh` with the
 *   standard types before any init macro. The full request is refused once
 *   (`keptStaleModules`), as without the editor request.
 *
 * Every full request must equal cold, and only the step of
 * `display-global-build-all` may be refused.
 */
function displayRequestGroups(): ReadonlyArray<Group> {
  const files = {
    "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
    "mr/Fresh.hx": freshWith("one")
  };
  return [
    {
      name: "display-cli",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "CLI diagnostics request, then Fresh saved with its modification time kept",
          display: { when: "before-save", form: "cli" },
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        },
        {
          id: "Fresh saved again with its modification time kept, then CLI diagnostics request",
          display: { when: "after-save", form: "cli" },
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';")
        },
        {
          id: "CLI diagnostics request, no edit",
          display: { when: "before-save", form: "cli" },
          apply: () => {},
          fullTypedAgainModules: []
        },
        {
          id: "no edit after the editor requests",
          apply: () => {},
          fullTypedAgain: 0
        }
      ]
    },
    {
      name: "display-json",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "JSON-RPC diagnostics request, then Fresh saved with its modification time kept",
          display: { when: "before-save", form: "json" },
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        },
        {
          id: "Fresh saved again with its modification time kept, then JSON-RPC diagnostics request",
          display: { when: "after-save", form: "json" },
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'six';")
        }
      ]
    },
    {
      name: "display-json-session",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept, then JSON-RPC diagnostics with the session's defines",
          display: { when: "after-save", form: "json-session" },
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        },
        {
          id: "JSON-RPC diagnostics with the session's defines, then Fresh saved back",
          display: { when: "before-save", form: "json-session" },
          apply: () => editSameSecond("Fresh.hx", "return 'two';", "return 'one';")
        },
        {
          id: "Fresh saved, JSON-RPC diagnostics with the session's defines, Fresh saved back",
          apply: () => {
            editSameSecond("Fresh.hx", "return 'one';", "return 'six';");
          },
          display: { when: "after-save", form: "json-session" }
        },
        {
          id: "Fresh saved back to the text of the last full request",
          apply: () => editSameSecond("Fresh.hx", "return 'six';", "return 'one';")
        }
      ]
    },
    {
      name: "display-dependency-changed",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshUsingTheme("one")
      },
      noInvalidate: true,
      steps: [
        {
          id: "CLI diagnostics request; Theme saved (Haxe sees it); Fresh saved with its modification time kept",
          display: { when: "before-save", form: "cli" },
          apply: () => {
            edit("Theme.hx", "return 12;", "return 13;");
            editSameSecond("Fresh.hx", "return 'one'", "return 'two'");
          }
        }
      ]
    },
    {
      // No editor request and no edit: the stored cache facts add no new
      // typing, and their rows give the time of a warm full request without
      // an edit (diagnostic only).
      name: "display-none-no-edit",
      files,
      noInvalidate: true,
      steps: [1, 2, 3, 4, 5].map((round) => ({
        id: `no edit, round ${round}`,
        apply: () => {},
        fullTypedAgain: 0,
        fullTypedAgainModules: []
      }))
    },
    {
      // Review of genes-ts #255: a cold run with the session's descriptor
      // define writes the stored facts with its own process token; the
      // server's next new macro state must not use them.
      name: "display-cold-run",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "Fresh saved with its modification time kept, cold run with the descriptor, CLI diagnostics request",
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          coldWithDescriptor: true,
          display: { when: "after-save", form: "cli" },
          // Genes makes Haxe parse every file again; the standard types
          // that Haxe loaded before Genes ran are then refused once.
          initRefusal: "full"
        },
        {
          id: "no edit after the facts of the server were written again",
          display: { when: "before-save", form: "cli" },
          apply: () => {},
          fullTypedAgainModules: []
        }
      ]
    },
    {
      // Review of genes-ts #255: the first request of a new server process
      // finds the stored facts of the old one, while an init macro before
      // Genes can type a module; a file changed while no server ran. The
      // new process holds no module, so nothing is refused.
      name: "display-new-server",
      files: { ...files, "mr/Early.hx": earlyMacro },
      argsBeforeGenes: ["--macro", "mr.Early.install()"],
      noInvalidate: true,
      steps: [
        {
          id: "server restarted, Fresh saved with its modification time kept",
          restartServer: true,
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';")
        }
      ]
    },
    {
      name: "display-global-build-all",
      files: { ...files, "mr/EarlyBuild.hx": earlyBuildMacro },
      argsBeforeGenes: ["--macro", "addGlobalMetadata('', '@:build(mr.EarlyBuild.build())')"],
      noInvalidate: true,
      steps: [
        {
          id: "CLI diagnostics request, then Fresh saved with its modification time kept",
          display: { when: "before-save", form: "cli" },
          apply: () => editSameSecond("Fresh.hx", "return 'one';", "return 'two';"),
          initRefusal: "full"
        }
      ]
    }
  ];
}

/**
 * The groups of genes-u8fq: a request fails with a type error in
 * `mr/Fresh.hx`, and the file is then saved back to the text of the last
 * successful request with the modification time of the failed save kept. No
 * `server/invalidate` is sent, so Haxe's whole-second file-time check
 * cannot see the second save, and Haxe still holds its parse of the failed
 * text. The digest of the file equals the one that Genes last proved, so
 * before the fix Genes did not make Haxe parse the file again, and every
 * later full request failed with the old error.
 *
 * - `failed-revert-full`: a full request fails; the next one must equal cold
 *   at once; then a request without an edit types no module again, and a
 *   normal text edit previews as usual;
 * - `failed-revert-module`: the module request and the full request of the
 *   failed text both fail; the next module request previews;
 * - `failed-then-other-edit`: after the failure, an edit of `mr/Button.hx`
 *   while `mr/Fresh.hx` still has the error fails again as cold does; the
 *   save back is then equal to cold;
 * - `failed-display-session`: `display/diagnostics` with the session's
 *   defines answers between the requests, also on the failed text;
 * - `failed-display-cli`: `--display ...@diagnostics` without the descriptor
 *   define answers between the requests, so the next full request starts
 *   Genes with new macro state and reads the stored cache facts.
 */
function failedRequestGroups(): ReadonlyArray<Group> {
  const files = {
    "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
    "mr/Fresh.hx": freshWith("one")
  };
  // The same length as `return 'one';`, so the save back keeps the size too.
  const broken = (): void => edit("Fresh.hx", "return 'one';", "return 1.000;");
  const savedBack = (): void => editSameSecond("Fresh.hx", "return 1.000;", "return 'one';");
  return [
    {
      name: "failed-revert-full",
      files,
      noInvalidate: true,
      steps: [
        { id: "Fresh gets a type error", apply: broken, typeError: true },
        {
          id: "Fresh saved back with the modification time of the failed save",
          apply: savedBack
        },
        {
          id: "no edit after the recovery",
          apply: () => {},
          fullTypedAgain: 0,
          fullTypedAgainModules: []
        },
        {
          id: "Fresh text edit after the recovery",
          apply: () => edit("Fresh.hx", "return 'one';", "return 'two';"),
          module: "mr.Fresh",
          expect: "preview"
        }
      ]
    },
    {
      name: "failed-revert-module",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "Fresh gets a type error, module request of Fresh",
          apply: broken,
          module: "mr.Fresh",
          typeError: true
        },
        {
          id: "Fresh saved back with the modification time of the failed save, module request of Fresh",
          apply: savedBack,
          module: "mr.Fresh",
          expect: "preview"
        },
        {
          id: "no edit after the recovery",
          apply: () => {},
          module: "mr.Fresh",
          expect: "preview",
          fullTypedAgain: 0
        }
      ]
    },
    {
      name: "failed-then-other-edit",
      files,
      noInvalidate: true,
      steps: [
        { id: "Fresh gets a type error", apply: broken, typeError: true },
        {
          id: "Button text edit while Fresh still has the error",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Sale';"),
          typeError: true
        },
        {
          id: "Fresh saved back with the modification time of the failed save",
          apply: savedBack
        },
        {
          id: "no edit after the recovery",
          apply: () => {},
          fullTypedAgain: 0,
          fullTypedAgainModules: []
        }
      ]
    },
    {
      name: "failed-display-session",
      files,
      noInvalidate: true,
      steps: [
        {
          id: "Fresh gets a type error, then JSON-RPC diagnostics with the session's defines",
          apply: broken,
          display: { when: "after-save", form: "json-session" },
          typeError: true
        },
        {
          id: "Fresh saved back with the modification time of the failed save, then JSON-RPC diagnostics with the session's defines",
          display: { when: "after-save", form: "json-session" },
          apply: savedBack
        },
        {
          id: "no edit after the recovery",
          apply: () => {},
          fullTypedAgain: 0
        }
      ]
    },
    {
      name: "failed-display-cli",
      files,
      noInvalidate: true,
      steps: [
        { id: "Fresh gets a type error", apply: broken, typeError: true },
        {
          id: "Fresh saved back with the modification time of the failed save, then CLI diagnostics request",
          apply: savedBack,
          display: { when: "after-save", form: "cli" }
        },
        {
          id: "no edit after the recovery",
          apply: () => {},
          fullTypedAgainModules: []
        }
      ]
    }
  ];
}

/**
 * The source files of the `std-` groups (genes-f8vc.14.7): the template plus
 * a UI-like module `mr.Card` that the rows edit, and the modules that each
 * part of the `-dce std` rule needs:
 *
 * - `mr.OnlyHere`: loaded only by an import of `mr.Card` without a use;
 * - `mr.Hints`: a module of typedefs that `mr.Main` imports and nothing
 *   reaches, so it has no file until a module names its typedef;
 * - `mr.Words`: keeps `StringTools.trim`;
 * - `mr.Styles`: a project macro function (opaque to Genes), and `mr.Built`
 *   with `@:build(mr.BuildMacro.build())`, which only the `std-macro` group
 *   puts into its program (a project macro makes every private field count
 *   as visible, see the `std-private-` groups);
 * - `mr.Box`: a `@:generic` class;
 * - `mr.CardUser`: imports `mr.Card`, so a call back closes a cycle;
 * - `mr.Tag`: the module of the macro row;
 * - `mr.CyBase` and `mr.CyChild`: a cycle with inheritance, so that
 *   `mr.CyChild` prints its parent lazily while the cycle exists;
 * - `mr.Px`, `mr.Row` and `mr.Bag`: abstracts, with `mr.PxUser` comparing
 *   two `Px` values and `mr.RowUser` indexing a `Row` (review of #260);
 * - `mr.Deck`: a class and, below it, a private typedef that `mr.DeckUser`
 *   imports, so its source map names the typedef's position;
 * - `mr.Gadget`, `mr.GadgetTools` and `mr.GadgetUser`, which calls
 *   `g.label()` through `using` and has `@:access(mr.Gadget)`;
 * - `mr.Ext` with a private extern class (round 2 of the review of #260).
 */
const stdFiles: Readonly<Record<string, string>> = {
  "mr/Main.hx": `package mr;\nimport mr.Hints;\n\nclass Main {\n`
    + `  static function main() {\n    trace(Button.render());\n    trace(new Panel('main').describe());\n`
    + `    trace(Consts.LIMIT + Consts.describe().length);\n    trace(Leaf.kindName(Leaf.Kind.Small));\n`
    + `    trace(Cycle.start());\n    trace(CycleB.next(0));\n    trace(Theme.size());\n`
    + `    trace(Card.render());\n    trace(Words.clean(' x '));\n`
    + `    trace(new Box<String>('box').value);\n    trace(CardUser.use());\n    trace(Tag.text());\n`
    + `    trace(CyBase.make() != null);\n    trace(new CyChild() != null);\n`
    + `    trace(PxUser.same());\n    trace(RowUser.first());\n    trace((3 : Bag).count());\n`
    + `    trace(DeckUser.size());\n    trace(GadgetUser.show());\n    trace(Ext.value());\n  }\n}\n`,
  "mr/Card.hx": `package mr;\n\nimport mr.OnlyHere;\n\n`
    + `/** A UI-like module for structural edits under -dce std (genes-f8vc.14.7). */\n`
    + `class Card {\n  public static function render(): String {\n    return title() + ' ' + Theme.color();\n  }\n\n`
    + `  static function title(): String {\n    return 'Card';\n  }\n\n`
    + `  static function unusedHelper(): String {\n    return 'unused';\n  }\n}\n`,
  "mr/OnlyHere.hx": `package mr;\n\nclass OnlyHere {\n  public static function note(): String {\n    return 'only';\n  }\n}\n`,
  "mr/Hints.hx": `package mr;\n\ntypedef CardHint = {\n  final label: String;\n}\n`,
  "mr/Words.hx": `package mr;\n\nclass Words {\n  public static function clean(text: String): String {\n`
    + `    return StringTools.trim(text);\n  }\n}\n`,
  "mr/Styles.hx": `package mr;\n\nclass Styles {\n  public static macro function css(value: haxe.macro.Expr): haxe.macro.Expr {\n`
    + `    return value;\n  }\n}\n`,
  "mr/BuildMacro.hx": `package mr;\n\nclass BuildMacro {\n`
    + `  public static macro function build(): Array<haxe.macro.Expr.Field> {\n`
    + `    return haxe.macro.Context.getBuildFields();\n  }\n}\n`,
  "mr/Built.hx": `package mr;\n\n@:build(mr.BuildMacro.build())\nclass Built {\n`
    + `  public static function value(): String {\n    return 'built';\n  }\n}\n`,
  "mr/Box.hx": `package mr;\n\n@:generic\nclass Box<T> {\n  public final value: T;\n\n`
    + `  public function new(value: T) {\n    this.value = value;\n  }\n}\n`,
  "mr/CardUser.hx": `package mr;\n\nclass CardUser {\n  public static function use(): String {\n`
    + `    return Card.render();\n  }\n\n  public static function tag(): String {\n    return 'user';\n  }\n}\n`,
  "mr/Tag.hx": `package mr;\n\nclass Tag {\n  public static function text(): String {\n    return 'tag';\n  }\n}\n`,
  "mr/CyBase.hx": `package mr;\n\nclass CyBase {\n  public function new() {}\n\n`
    + `  public static function make(): CyBase {\n    return new CyChild();\n  }\n}\n`,
  "mr/CyChild.hx": `package mr;\n\nclass CyChild extends CyBase {\n  public function new() {\n    super();\n  }\n}\n`,
  "mr/Px.hx": `package mr;\n\n/** An abstract that another module compares. */\n`
    + `abstract Px(Int) from Int to Int {\n  public function double(): Int {\n    return this * 2;\n  }\n}\n`,
  "mr/PxUser.hx": `package mr;\n\nclass PxUser {\n  public static function same(): Bool {\n`
    + `    final a: Px = 1;\n    final b: Px = 2;\n    return a == b;\n  }\n}\n`,
  "mr/Row.hx": `package mr;\n\n/** An abstract that another module indexes. */\n`
    + `abstract Row(Array<Int>) from Array<Int> {\n  @:arrayAccess public function at(index: Int): Int {\n`
    + `    return this[index];\n  }\n}\n`,
  "mr/RowUser.hx": `package mr;\n\nclass RowUser {\n  public static function first(): Int {\n`
    + `    final row: Row = [4, 5];\n    return row[0];\n  }\n}\n`,
  "mr/Bag.hx": `package mr;\n\n/** An abstract with a method. */\n`
    + `abstract Bag(Int) from Int {\n  public function count(): Int {\n    return this;\n  }\n}\n`,
  "mr/Deck.hx": `package mr;\n\nclass Deck {\n  public static function options(): DeckOpt {\n`
    + `    return {size: 3};\n  }\n}\n\nprivate typedef DeckOpt = {\n  final size: Int;\n}\n`,
  "mr/DeckUser.hx": `package mr;\n\nclass DeckUser {\n  public static function size(): Int {\n`
    + `    final options = Deck.options();\n    return options.size;\n  }\n}\n`,
  ...gadgetFiles("Gadget", true),
  // The import loads `haxe.ds.List` and keeps nothing of it: dead-code
  // elimination removes it until a field keeps it.
  "mr/Ext.hx": `package mr;\n\nimport haxe.ds.List;\n\nclass Ext {\n  public static function value(): Int {\n    return 1;\n  }\n}\n\n`
    + `private extern class ExtNative {\n  static function a(): Int;\n}\n`
};

/**
 * A class `mr.<name>`, a static extension `mr.<name>Tools.label(g)` and a
 * module `mr.<name>User` that calls `g.label()` through `using`, with
 * `@:access(mr.<name>)` when `access` is true (review of #260).
 */
function gadgetFiles(name: string, access: boolean): Record<string, string> {
  return {
    [`mr/${name}.hx`]: `package mr;\n\nclass ${name} {\n  public function new() {}\n\n`
      + `  public function title(): String {\n    return '${name.toLowerCase()}';\n  }\n}\n`,
    [`mr/${name}Tools.hx`]: `package mr;\n\nclass ${name}Tools {\n`
      + `  public static function label(item: ${name}): String {\n    return 'tools ' + item.title();\n  }\n}\n`,
    [`mr/${name}User.hx`]: `package mr;\n\nusing mr.${name}Tools;\n\n${access ? `@:access(mr.${name})\n` : ""}`
      + `class ${name}User {\n  public static function show(): String {\n    final item = new ${name}();\n`
      + `    return item.label();\n  }\n}\n`
  };
}

/**
 * The structural edits under `-dce std` (genes-f8vc.14.7). Each row names
 * the shape and the expected answer; on Genes before the rule, every row
 * that expects `preview` or a new code got `signature-changed` or
 * `uses-changed`. After a refused row the full request stores the edit, so
 * the next row starts from it.
 */
function stdGroups(): ReadonlyArray<Group> {
  const card = (from: string, to: string) => () => edit("Card.hx", from, to);
  return [
    {
      name: "std-structural",
      dce: "std",
      files: stdFiles,
      steps: [
        { id: "std: literal edit (strict rule)", apply: card("return 'Card';", "return 'Card!';"),
          module: "mr.Card", expect: "preview" },
        { id: "std: new private function with a call", apply: () => {
          edit("Card.hx", "return title() + ' ' + Theme.color();",
            "return title() + ' ' + Theme.color() + subtitle();");
          edit("Card.hx", "  static function unusedHelper(): String {",
            "  static function subtitle(): String {\n    return 'sub';\n  }\n\n"
            + "  static function unusedHelper(): String {");
        }, module: "mr.Card", expect: "preview" },
        { id: "std: first use of an unused private function",
          apply: card("+ subtitle();", "+ subtitle() + unusedHelper();"),
          module: "mr.Card", expect: "preview" },
        { id: "std: new use of another module of the program",
          apply: card("+ unusedHelper();", "+ unusedHelper() + Button.render();"),
          module: "mr.Card", expect: "preview" },
        { id: "std: the only call of a private function is removed",
          apply: card("+ subtitle() + unusedHelper()", "+ unusedHelper()"),
          module: "mr.Card", expect: "preview" },
        { id: "std: new use of a std field that another module keeps",
          apply: card("+ Button.render();", "+ Button.render() + StringTools.trim(' c ');"),
          module: "mr.Card", expect: "preview" },
        { id: "std: new enum use in a program with enums",
          apply: card("+ StringTools.trim(' c ');",
            "+ StringTools.trim(' c ') + Leaf.kindName(Leaf.Kind.Large);"),
          module: "mr.Card", expect: "preview" },
        { id: "std: first use of a std field that nothing keeps (dce-use-added)",
          apply: card("+ Leaf.kindName(Leaf.Kind.Large);",
            "+ Leaf.kindName(Leaf.Kind.Large) + StringTools.lpad('c', '-', 3);"),
          module: "mr.Card", expect: "dce-use-added" },
        { id: "std: the last use of a std field is removed (dce-use-removed)",
          apply: card(" + StringTools.lpad('c', '-', 3);", ";"),
          module: "mr.Card", expect: "dce-use-removed" },
        { id: "std: new public function (public-shape-changed)",
          apply: card("  static function title(): String {",
            "  public static function extra(): String {\n    return 'extra';\n  }\n\n"
            + "  static function title(): String {"),
          module: "mr.Card", expect: "public-shape-changed" },
        { id: "std: a new import line moves a class that other modules import (position-changed)",
          apply: card("package mr;\n", "package mr;\n\nimport mr.Theme;\n"),
          module: "mr.Card", expect: "position-changed" },
        { id: "std: the import of a module that only this one loads is removed (module-may-leave)",
          apply: card("import mr.OnlyHere;\n", ""),
          module: "mr.Card", expect: "module-may-leave" },
        { id: "std: first reference to a typedef module that nothing reached (walk-target-added)",
          apply: card("  static function title(): String {",
            "  static function hint(): mr.Hints.CardHint {\n    return {label: 'hint'};\n  }\n\n"
            + "  static function title(): String {"),
          module: "mr.Card", expect: "walk-target-added" },
        { id: "std: the only reference to a typedef module is removed (walk-target-removed)",
          apply: card("  static function hint(): mr.Hints.CardHint {\n    return {label: 'hint'};\n  }\n\n", ""),
          module: "mr.Card", expect: "walk-target-removed" },
        { id: "std: first typed cast of the program (feature-changed)",
          apply: card("  static function title(): String {",
            "  static function asButton(value: Dynamic): Button {\n    return cast(value, Button);\n  }\n\n"
            + "  static function title(): String {"),
          module: "mr.Card", expect: "feature-changed" },
        { id: "std: new instance of a generic class",
          apply: card("+ Leaf.kindName(Leaf.Kind.Large);",
            "+ Leaf.kindName(Leaf.Kind.Large) + new Box<Int>(1).value;"),
          module: "mr.Card", expect: ["other-modules-changed", "other-modules-typed"] },
        { id: "std: a call back that closes an import cycle",
          apply: card("+ new Box<Int>(1).value;", "+ new Box<Int>(1).value + CardUser.tag();"),
          module: "mr.Card", expect: ["other-modules-typed", "import-cycle"] },
        { id: "std: structural edit that breaks an import cycle (import-cycle)",
          apply: () => edit("Cycle.hx", "return 'cycle ' + CycleB.next(2);", "return 'cycle';"),
          module: "mr.Cycle", expect: "import-cycle" },
        { id: "std: structural edit that breaks a cycle with a subclass (import-cycle)",
          apply: () => edit("CyBase.hx", "return new CyChild();", "return new CyBase();"),
          module: "mr.CyBase", expect: "import-cycle" },
        // Review of #260 (Fable): each of these previewed and differed from cold.
        { id: "std: a private @:op on an abstract changes its importers (public-shape-changed)",
          apply: () => edit("Px.hx", "  public function double(): Int {",
            "  @:op(A == B) static function same(a: Px, b: Px): Bool {\n"
            + "    return (a : Int) == (b : Int);\n  }\n\n  public function double(): Int {"),
          module: "mr.Px", expect: "public-shape-changed" },
        { id: "std: a private @:arrayAccess on an abstract (public-shape-changed)",
          // Before the public accessor: Haxe then picks it for `row[0]` of
          // `mr.RowUser`, which becomes `Row.head(row, 0)` in a cold build.
          apply: () => edit("Row.hx", "  @:arrayAccess public function at(index: Int): Int {",
            "  @:arrayAccess function head(index: Int): Int {\n    return this[0] + 100;\n  }\n\n"
            + "  @:arrayAccess public function at(index: Int): Int {"),
          module: "mr.Row", expect: "public-shape-changed" },
        // No stale case was found for `@:resolve` (Haxe allows one resolve
        // method, and `@:forward` wins over it); the row shows the refusal.
        { id: "std: a private @:resolve on an abstract (public-shape-changed)",
          apply: () => edit("Bag.hx", "  public function count(): Int {",
            "  @:resolve function lookup(name: String): Int {\n    return this + name.length;\n  }\n\n"
            + "  public function count(): Int {"),
          module: "mr.Bag", expect: "public-shape-changed" },
        { id: "std: a new function moves a private typedef that another module imports (position-changed)",
          apply: () => edit("Deck.hx", "  public static function options(): DeckOpt {",
            "  static function spare(): Int {\n    return 1;\n  }\n\n"
            + "  public static function options(): DeckOpt {"),
          module: "mr.Deck", expect: "position-changed" },
        { id: "std: a comment line above that private typedef (position-changed)",
          apply: () => edit("Deck.hx", "private typedef DeckOpt", "// The options of a deck.\nprivate typedef DeckOpt"),
          module: "mr.Deck", expect: "position-changed" },
        // Round 2 of the review of #260: each of these previewed and differed
        // from cold on 77ef155d.
        { id: "std: a private method takes a using call of a module with @:access (public-shape-changed)",
          apply: () => edit("Gadget.hx", "  public function title(): String {",
            "  function label(): String {\n    return 'own';\n  }\n\n  public function title(): String {"),
          module: "mr.Gadget", expect: ["public-shape-changed", "shadowed-extension"] },
        { id: "std: a @:keep field of a private extern class keeps a std class (dce-use-added)",
          apply: () => edit("Ext.hx", "  static function a(): Int;\n",
            "  static function a(): Int;\n\n  @:keep private static function b(): haxe.ds.List<Int>;\n"),
          module: "mr.Ext", expect: "dce-use-added" }
      ]
    },
    {
      // Round 2 of the review of #260: the same private method without
      // `@:access`. The module types alone, but a full build fails with
      // "Cannot access private field label".
      name: "std-shadow-error",
      dce: "std",
      files: {
        ...stdFiles,
        ...gadgetFiles("Knob", false),
        "mr/Main.hx": `package mr;\n\nclass Main {\n  static function main() {\n`
          + `    trace(KnobUser.show());\n  }\n}\n`
      },
      steps: [
        { id: "std: a private method takes a using call, and the program no longer compiles (shadowed-extension)",
          apply: () => edit("Knob.hx", "  public function title(): String {",
            "  function label(): String {\n    return 'own';\n  }\n\n  public function title(): String {"),
          module: "mr.Knob", expect: "shadowed-extension", programFails: true }
      ]
    },
    {
      // A value use of an abstract (review of #260): on its own server, so
      // that no earlier row has made `Int` a value already (the typed cast
      // row keeps `js.Boot.__instanceof`, which does).
      name: "std-value-use",
      dce: "std",
      files: stdFiles,
      steps: [
        { id: "std: first value use of an abstract, return Int (feature-changed)",
          apply: () => edit("Words.hx", "  public static function clean(text: String): String {",
            "  static function intType(): Dynamic {\n    return Int;\n  }\n\n"
            + "  public static function clean(text: String): String {"),
          module: "mr.Words", expect: "feature-changed" },
        { id: "std: the only value use of Int is removed (feature-changed)",
          apply: () => edit("Words.hx", "    return Int;\n", "    final count: Int = 2;\n    return count;\n"),
          module: "mr.Words", expect: "feature-changed" }
      ]
    },
    {
      // The profile gate: the same structural edit under `-dce full` keeps
      // the strict rule.
      name: "std-profile-full",
      dce: "full",
      files: stdFiles,
      steps: [
        { id: "full: new private function with a call (signature-changed)", apply: () => {
          edit("Card.hx", "return title() + ' ' + Theme.color();",
            "return title() + ' ' + Theme.color() + subtitle();");
          edit("Card.hx", "  static function unusedHelper(): String {",
            "  static function subtitle(): String {\n    return 'sub';\n  }\n\n"
            + "  static function unusedHelper(): String {");
        }, module: "mr.Card", expect: "signature-changed" }
      ]
    }
  ];
}

/**
 * How one module calls a static extension on a class `mr.<name>` in the
 * private-access groups (genes-zbva, round 3 of the review of #260).
 */
type ExtensionCallCase = {
  /** A metadata line above `class <name>`, for example `@:allow(mr.BoltUser)`. */
  readonly classMeta?: string;
  /** The parent class of `<name>`, in a module of its own. */
  readonly parent?: string;
  /** True for an inline extension: Haxe copies its body into the caller, so no static call is left. */
  readonly inline?: boolean;
  /** The type of the extension's first argument; `<name>` when not given. */
  readonly receiver?: string;
  /** A metadata line above `class <name>User`. */
  readonly userMeta?: string;
  /** More import lines of `mr.<name>User`, after its `using` line. */
  readonly imports?: string;
  /** The members of `class <name>User`, with `public static function show(): String`. */
  readonly user: string;
};

/**
 * The files of one `ExtensionCallCase`: `mr.<name>` with a public
 * `title()`, `mr.<name>Tools` with the static extension `label(item)`, and
 * `mr.<name>User` with `using mr.<name>Tools;`. A later row adds a private
 * `label()` to `mr.<name>`, which Haxe then finds before the extension.
 */
function extensionCallFiles(name: string, spec: ExtensionCallCase): Record<string, string> {
  const files: Record<string, string> = {
    [`mr/${name}.hx`]: `package mr;\n\n${spec.classMeta === undefined ? "" : `${spec.classMeta}\n`}`
      + `class ${name}${spec.parent === undefined ? "" : ` extends ${spec.parent}`} {\n`
      + `  public function new() {${spec.parent === undefined ? "" : "\n    super();\n  "}}\n\n`
      + `  public function title(): String {\n    return '${name.toLowerCase()}';\n  }\n}\n`,
    [`mr/${name}Tools.hx`]: `package mr;\n\nclass ${name}Tools {\n`
      + `  public static ${spec.inline === true ? "inline " : ""}function label(item: ${spec.receiver ?? name}): String {\n`
      + `    return 'tools ' + item.title();\n  }\n}\n`,
    [`mr/${name}User.hx`]: `package mr;\n\nusing mr.${name}Tools;\n${spec.imports ?? ""}\n`
      + `${spec.userMeta === undefined ? "" : `${spec.userMeta}\n`}class ${name}User {\n${spec.user}}\n`
  };
  if (spec.parent !== undefined)
    files[`mr/${spec.parent}.hx`] = `package mr;\n\nclass ${spec.parent} {\n  public function new() {}\n}\n`;
  return files;
}

/** The text of `mr.Main` that calls `show()` of each `mr.<name>User`. */
function mainOfUsers(names: ReadonlyArray<string>): string {
  return `package mr;\n\nclass Main {\n  static function main() {\n`
    + names.map((name) => `    trace(${name}User.show());\n`).join("") + "  }\n}\n";
}

/** The edit that adds a private method `label()` to `mr.<name>`, with `meta` above it. */
function addPrivateLabel(name: string, meta = ""): () => void {
  return () => edit(`${name}.hx`, "  public function title(): String {",
    `  ${meta}function label(): String {\n    return 'own';\n  }\n\n  public function title(): String {`);
}

/** A `check` that the refusal reason names `text`, so that the row proves which rule refused it. */
function reasonNames(text: string): (report: ModuleReport, label: string) => void {
  return (report, label) => ok(String(report.reason).includes(text),
    `${label}: the reason must name ${JSON.stringify(text)}: ${String(report.reason)}`);
}

/**
 * The private-access groups (genes-zbva). Under `-dce std`, a new private
 * method can take a call that another module makes through `using`, when
 * that module may access private fields: Haxe looks for a field of the
 * class before it tries a static extension. On main 938a758b each `label`
 * row below published a preview that differed from cold (`--observe`
 * prints `STALE mr/<name>User.ts`): the extension call is inline, its
 * receiver is a type parameter or a `@:forward` abstract (so
 * `shadowed-extension` saw no call), and the visible shape left out the
 * private field. The rule now keeps every private field of the requested
 * module in its visible shape when another module of the program may see
 * private fields without naming them (`@:privateAccess` or `untyped` code
 * here, more ways in `privateReachGroups`), when a class or a field has
 * `@:allow`, and when another module names the class, one of its parent
 * classes or one of its fields in `@:access`.
 */
function privateAccessGroups(): ReadonlyArray<Group> {
  const accessCalls: Record<string, ExtensionCallCase> = {
    // An inline extension inside `@:privateAccess`.
    Sprocket: {
      inline: true,
      user: "  public static function show(): String {\n    final item = new Sprocket();\n"
        + "    return @:privateAccess item.label();\n  }\n"
    },
    // A receiver whose type is a type parameter constrained to the class.
    Gizmo: {
      user: "  static function of<T: Gizmo>(item: T): String {\n    return @:privateAccess item.label();\n  }\n\n"
        + "  public static function show(): String {\n    return of(new Gizmo());\n  }\n"
    },
    // A receiver whose type is a `@:forward` abstract over the class.
    Gear: {
      receiver: "GearRef",
      user: "  public static function show(): String {\n    final item: GearRef = new Gear();\n"
        + "    return @:privateAccess item.label();\n  }\n"
    }
  };
  const accessFiles: Record<string, string> = {
    "mr/Main.hx": mainOfUsers([...Object.keys(accessCalls), "Jar"]),
    "mr/GearRef.hx": "package mr;\n\n@:forward\nabstract GearRef(Gear) from Gear {}\n",
    // A later row adds a private static `describe` to `mr.JarTools`: inside
    // `@:privateAccess` it takes the call from `mr.JarLabels`.
    "mr/Jar.hx": "package mr;\n\nclass Jar {\n  public function new() {}\n}\n",
    "mr/JarLabels.hx": "package mr;\n\nclass JarLabels {\n"
      + "  public static function describe(item: Jar): String {\n    return 'labels';\n  }\n}\n",
    "mr/JarTools.hx": "package mr;\n\nclass JarTools {\n"
      + "  public static function size(item: Jar): Int {\n    return 1;\n  }\n}\n",
    "mr/JarUser.hx": "package mr;\n\nusing mr.JarLabels;\nusing mr.JarTools;\n\nclass JarUser {\n"
      + "  public static function show(): String {\n    return @:privateAccess new Jar().describe();\n  }\n}\n"
  };
  for (const [name, spec] of Object.entries(accessCalls))
    Object.assign(accessFiles, extensionCallFiles(name, spec));
  const allowCalls: Record<string, ExtensionCallCase> = {
    // `@:allow` on the class lets `mr.BoltUser` access its private fields.
    Bolt: {
      inline: true,
      classMeta: "@:allow(mr.BoltUser)",
      user: "  public static function show(): String {\n    return new Bolt().label();\n  }\n"
    },
    // `@:allow` on the new field itself (the row adds it).
    Nut: {
      inline: true,
      user: "  public static function show(): String {\n    return new Nut().label();\n  }\n"
    },
    // `@:access` names a parent class: Haxe then allows the private fields
    // of every subclass (`can_access` walks the parents of the class).
    Lever: {
      inline: true,
      parent: "LeverBase",
      userMeta: "@:access(mr.LeverBase)",
      user: "  public static function show(): String {\n    return new Lever().label();\n  }\n"
    },
    // `@:access` names a field of the class, before the field exists.
    Pin: {
      inline: true,
      userMeta: "@:access(mr.Pin.label)",
      user: "  public static function show(): String {\n    return new Pin().label();\n  }\n"
    },
    // No private access: the private field breaks the program (limit B).
    Latch: {
      inline: true,
      user: "  public static function show(): String {\n    return new Latch().label();\n  }\n"
    }
  };
  const allowFiles: Record<string, string> = { "mr/Main.hx": mainOfUsers(Object.keys(allowCalls)) };
  for (const [name, spec] of Object.entries(allowCalls))
    Object.assign(allowFiles, extensionCallFiles(name, spec));
  const untypedFiles: Record<string, string> = {
    "mr/Main.hx": mainOfUsers(["Cog"]),
    ...extensionCallFiles("Cog", {
      inline: true,
      user: "  public static function show(): String {\n    final item = new Cog();\n"
        + "    return untyped item.label();\n  }\n"
    })
  };
  return [
    {
      name: "std-private-access",
      dce: "std",
      files: accessFiles,
      steps: [
        // The rule does not refuse every structural edit: this one adds no
        // field.
        { id: "std: a new call in a module with @:privateAccess code (preview)",
          apply: () => edit("SprocketUser.hx", "return @:privateAccess item.label();",
            "return @:privateAccess item.label() + item.title();"),
          module: "mr.SprocketUser", expect: "preview" },
        { id: "std: a private method takes an inline extension call inside @:privateAccess (public-shape-changed)",
          apply: addPrivateLabel("Sprocket"), module: "mr.Sprocket", expect: "public-shape-changed",
          check: reasonNames("has @:privateAccess code") },
        { id: "std: a private method takes an extension call on a type parameter inside @:privateAccess (public-shape-changed)",
          apply: addPrivateLabel("Gizmo"), module: "mr.Gizmo", expect: "public-shape-changed",
          check: reasonNames("has @:privateAccess code") },
        { id: "std: a private method takes an extension call on a @:forward abstract inside @:privateAccess (public-shape-changed)",
          apply: addPrivateLabel("Gear"), module: "mr.Gear", expect: "public-shape-changed",
          check: reasonNames("has @:privateAccess code") },
        // The rule is coarse: with @:privateAccess code in the program, a
        // private method with a fresh name is refused too.
        { id: "std: a private method with a fresh name while another module has @:privateAccess code (public-shape-changed)",
          apply: () => edit("Gizmo.hx", "  public function title(): String {",
            "  function spare(): String {\n    return 'spare';\n  }\n\n  public function title(): String {"),
          module: "mr.Gizmo", expect: "public-shape-changed" },
        // A private static extension: Haxe skips it where it cannot access
        // it, and takes it inside `@:privateAccess`.
        { id: "std: a private static extension takes a call inside @:privateAccess (public-shape-changed)",
          apply: () => edit("JarTools.hx", "  public static function size(",
            "  static function describe(item: Jar): String {\n    return 'tools';\n  }\n\n  public static function size("),
          module: "mr.JarTools", expect: "public-shape-changed", check: reasonNames("has @:privateAccess code") }
      ]
    },
    {
      // `untyped` skips the access check of a field, as `@:privateAccess` does.
      name: "std-private-untyped",
      dce: "std",
      files: untypedFiles,
      steps: [
        { id: "std: a private method takes an inline extension call inside untyped (public-shape-changed)",
          apply: addPrivateLabel("Cog"), module: "mr.Cog", expect: "public-shape-changed",
          check: reasonNames("mr.CogUser has untyped code") }
      ]
    },
    {
      // No @:privateAccess or untyped code in this program.
      name: "std-private-allow",
      dce: "std",
      files: allowFiles,
      steps: [
        { id: "std: a private method takes an inline extension call, and the class has @:allow (public-shape-changed)",
          apply: addPrivateLabel("Bolt"), module: "mr.Bolt", expect: "public-shape-changed",
          check: reasonNames("became \"  field label ") },
        { id: "std: a private method with @:allow takes an inline extension call (public-shape-changed)",
          apply: addPrivateLabel("Nut", "@:allow(mr.NutUser) "), module: "mr.Nut", expect: "public-shape-changed",
          check: reasonNames("became \"  field label ") },
        { id: "std: a private method takes an inline extension call of a module with @:access on a parent class (public-shape-changed)",
          apply: addPrivateLabel("Lever"), module: "mr.Lever", expect: "public-shape-changed",
          check: reasonNames("became \"  private mr.Lever.Lever i:label ") },
        { id: "std: a private method takes an inline extension call of a module with @:access on the field (public-shape-changed)",
          apply: addPrivateLabel("Pin"), module: "mr.Pin", expect: "public-shape-changed",
          check: reasonNames("became \"  private mr.Pin.Pin i:label ") },
        // Without private access anywhere, a private method still previews.
        { id: "std: a private method with a fresh name, without private access (preview)",
          apply: () => edit("Latch.hx", "  public function title(): String {",
            "  function spare(): String {\n    return 'spare';\n  }\n\n  public function title(): String {"),
          module: "mr.Latch", expect: "preview" },
        // Limit B of #260: the module types alone, but a full build fails
        // with "Cannot access private field label". No stale file results.
        { id: "std: a private method takes an inline extension call without private access, and the program no longer compiles (limit B)",
          apply: addPrivateLabel("Latch"), module: "mr.Latch", expect: "preview-program-fails",
          programFails: true, previewWhileProgramFails: true }
      ]
    },
    ...privateReachGroups()
  ];
}

/** A class `mr.<name>` with a public constructor and `title()`, and `meta` above it. */
function plainClass(name: string, meta = ""): string {
  return `package mr;\n\n${meta}class ${name} {\n  public function new() {}\n\n`
    + `  public function title(): String {\n    return '${name.toLowerCase()}';\n  }\n}\n`;
}

/**
 * The groups of round 4 of the review (Fable on 3fa8782c, genes-zbva):
 * more ways in which a new private field changes another module's code.
 * Each `label` or `describe` row published a preview that differed from
 * cold on 3fa8782c (`--observe`), unless its comment says otherwise. Each
 * group is its own program, so that its `check` shows the reason that
 * refused it.
 */
function privateReachGroups(): ReadonlyArray<Group> {
  const ownMain = (users: ReadonlyArray<string>) => ({ "mr/Main.hx": mainOfUsers(users) });
  return [
    {
      // Genes' own `State.set` returned `@:privateAccess
      // $state.__setDirect($next)`, so the new value was typed with private
      // access, and a private static extension took the call. It now wraps
      // the value in `@:noPrivateAccess`, and the preview equals cold.
      name: "std-private-state",
      dce: "std",
      files: {
        ...ownMain(["Rivet"]),
        "mr/Rivet.hx": plainClass("Rivet"),
        "mr/RivetLabels.hx": "package mr;\n\nclass RivetLabels {\n"
          + "  public static function describe(item: Rivet): String {\n    return 'labels ' + item.title();\n  }\n}\n",
        "mr/RivetTools.hx": "package mr;\n\nclass RivetTools {\n"
          + "  public static function size(item: Rivet): Int {\n    return 1;\n  }\n}\n",
        "mr/RivetUser.hx": "package mr;\n\nusing mr.RivetLabels;\nusing mr.RivetTools;\n\nclass RivetUser {\n"
          + "  public static function show(): String {\n    final state: genes.react.State<String> = cast null;\n"
          + "    state.set(new Rivet().describe());\n    return 'rivet';\n  }\n}\n"
      },
      steps: [
        { id: "std: a private static extension and the value of State.set (preview)",
          apply: () => edit("RivetTools.hx", "  public static function size(",
            "  static function describe(item: Rivet): String {\n    return 'tools';\n  }\n\n  public static function size("),
          module: "mr.RivetTools", expect: "preview" }
      ]
    },
    {
      // `import mr.Dial.*` imports the private statics too, and Haxe types
      // a pattern with the access check off: the capture `case label`
      // becomes a comparison with the new `Dial.label`.
      name: "std-private-import",
      dce: "std",
      files: {
        ...ownMain(["Dial"]),
        "mr/Dial.hx": "package mr;\n\nclass Dial {\n  public static final top = 1;\n}\n",
        "mr/DialUser.hx": "package mr;\n\nimport mr.Dial.*;\n\nclass DialUser {\n"
          + "  public static function show(): String {\n    return switch 'own' {\n"
          + "      case label if (top > 0): 'first';\n      default: 'other';\n    }\n  }\n}\n"
      },
      steps: [
        { id: "std: a private static final turns a pattern capture of a module with import Dial.* into a comparison (public-shape-changed)",
          apply: () => edit("Dial.hx", "  public static final top = 1;\n",
            "  public static final top = 1;\n\n  static final label = 'own';\n"),
          module: "mr.Dial", expect: "public-shape-changed",
          check: reasonNames("mr.DialUser imports the static fields of a type") }
      ]
    },
    {
      // A private class field meets a private structure field: with a new
      // private `label()`, `mr.Lamp` unifies with `mr.Peek`, and the call
      // takes the other extension. The caller has no private access.
      name: "std-private-structure",
      dce: "std",
      files: {
        ...ownMain(["Lamp"]),
        "mr/Lamp.hx": plainClass("Lamp"),
        "mr/Peek.hx": "package mr;\n\ntypedef Peek = {\n  private function label(): String;\n}\n",
        "mr/PeekTools.hx": "package mr;\n\nclass PeekTools {\n"
          + "  public static function describe(item: Peek): String {\n    return 'peek';\n  }\n}\n",
        "mr/LampTools.hx": "package mr;\n\nclass LampTools {\n"
          + "  public static function describe(item: Lamp): String {\n    return 'lamp ' + item.title();\n  }\n}\n",
        "mr/LampUser.hx": "package mr;\n\nusing mr.LampTools;\nusing mr.PeekTools;\n\nclass LampUser {\n"
          + "  public static function show(): String {\n    return new Lamp().describe();\n  }\n}\n"
      },
      steps: [
        { id: "std: a private method makes a class unify with a structure that has a private field (public-shape-changed)",
          apply: addPrivateLabel("Lamp"), module: "mr.Lamp", expect: "public-shape-changed",
          check: reasonNames("mr.Peek has a structure type with a private field") }
      ]
    },
    {
      // Haxe drops the metadata of `__init__`, so its `@:access` cannot be
      // read from the typed class.
      name: "std-private-init",
      dce: "std",
      files: {
        ...ownMain(["Knot"]),
        ...extensionCallFiles("Knot", {
          inline: true,
          user: "  public static var shown = '';\n\n  @:access(mr.Knot)\n  static function __init__() {\n"
            + "    shown = new Knot().label();\n  }\n\n  public static function show(): String {\n    return shown;\n  }\n"
        })
      },
      steps: [
        { id: "std: a private method takes an inline extension call in an __init__ with @:access (public-shape-changed)",
          apply: addPrivateLabel("Knot"), module: "mr.Knot", expect: "public-shape-changed",
          check: reasonNames("mr.KnotUser has an __init__ function with @:access or untyped code") }
      ]
    },
    {
      // A project macro returns `@:privateAccess` code from a helper that
      // only Haxe's macro context loads, so no file of the program shows it.
      name: "std-private-macro-helper",
      dce: "std",
      files: {
        ...ownMain(["Sash"]),
        ...extensionCallFiles("Sash", {
          inline: true,
          imports: "import mr.Wrap;\n",
          user: "  public static function show(): String {\n    return Wrap.open(new Sash().label());\n  }\n"
        }),
        "mr/Wrap.hx": "package mr;\n\nclass Wrap {\n"
          + "  public static macro function open(value: haxe.macro.Expr): haxe.macro.Expr {\n"
          + "    return mr.WrapHelper.open(value);\n  }\n}\n",
        "mr/WrapHelper.hx": "package mr;\n\n#if macro\nclass WrapHelper {\n"
          + "  public static function open(value: haxe.macro.Expr): haxe.macro.Expr {\n"
          + "    return macro @:privateAccess $value;\n  }\n}\n#end\n"
      },
      steps: [
        { id: "std: a private method takes a call that a project macro wraps in @:privateAccess (public-shape-changed)",
          apply: addPrivateLabel("Sash"), module: "mr.Sash", expect: "public-shape-changed",
          check: reasonNames("project macro") }
      ]
    },
    {
      // A project macro of another module lists the fields of a class (a
      // serializer), so a new private field changes that module's text.
      name: "std-private-macro-fields",
      dce: "std",
      files: {
        ...ownMain(["Crate"]),
        "mr/Crate.hx": plainClass("Crate"),
        "mr/Lister.hx": "package mr;\n\nclass Lister {\n"
          + "  public static macro function names(): haxe.macro.Expr {\n"
          + "    final names = switch haxe.macro.Context.getType('mr.Crate') {\n"
          + "      case haxe.macro.Type.TInst(owner, _): [for (field in owner.get().fields.get()) field.name];\n"
          + "      default: [];\n    }\n    return macro $v{names.join(',')};\n  }\n}\n",
        "mr/CrateUser.hx": "package mr;\n\nimport mr.Lister;\n\nclass CrateUser {\n"
          + "  public static function show(): String {\n    return Lister.names();\n  }\n}\n"
      },
      steps: [
        { id: "std: a private method changes the field list that a project macro of another module prints (public-shape-changed)",
          apply: addPrivateLabel("Crate"), module: "mr.Crate", expect: "public-shape-changed",
          check: reasonNames("project macro") }
      ]
    },
    {
      // A build macro of another module adds `@:privateAccess` code from a
      // helper that only Haxe's macro context loads.
      name: "std-private-build-macro",
      dce: "std",
      files: {
        "mr/Main.hx": "package mr;\n\nclass Main {\n  static function main() {\n    trace(BeadUser.shown());\n  }\n}\n",
        "mr/Bead.hx": plainClass("Bead"),
        "mr/BeadTools.hx": "package mr;\n\nclass BeadTools {\n"
          + "  public static inline function label(item: Bead): String {\n    return 'tools ' + item.title();\n  }\n}\n",
        // The fields that the build macro adds are typed in this module, so
        // its `using` line applies to them.
        "mr/BeadUser.hx": "package mr;\n\nusing mr.BeadTools;\n\n@:build(mr.BeadMacro.build())\nclass BeadUser {\n"
          + "  public static function show(): String {\n    return 'bead';\n  }\n}\n",
        "mr/BeadMacro.hx": "package mr;\n\nclass BeadMacro {\n"
          + "  public static macro function build(): Array<haxe.macro.Expr.Field> {\n"
          + "    return mr.BeadHelper.build();\n  }\n}\n",
        "mr/BeadHelper.hx": "package mr;\n\n#if macro\nclass BeadHelper {\n"
          + "  public static function build(): Array<haxe.macro.Expr.Field> {\n"
          + "    final extra = macro class Extra {\n      public static function shown(): String {\n"
          + "        return @:privateAccess new mr.Bead().label();\n      }\n    };\n"
          + "    return haxe.macro.Context.getBuildFields().concat(extra.fields);\n  }\n}\n#end\n"
      },
      steps: [
        { id: "std: a private method takes a call that a build macro of another module adds inside @:privateAccess (public-shape-changed)",
          apply: addPrivateLabel("Bead"), module: "mr.Bead", expect: "public-shape-changed",
          check: reasonNames("mr.BeadUser runs the build macro") }
      ]
    },
    {
      // `untyped` in a static variable's value: Haxe marks the variable
      // `:has_untyped`, which is the only place the rule reads it (on
      // 3fa8782c the text also counted, so this row refused there too).
      name: "std-private-untyped-var",
      dce: "std",
      files: {
        ...ownMain(["Cam"]),
        ...extensionCallFiles("Cam", {
          inline: true,
          user: "  static final shown: String = {\n    final item = new Cam();\n    untyped item.label();\n  };\n\n"
            + "  public static function show(): String {\n    return shown;\n  }\n"
        })
      },
      steps: [
        { id: "std: a private method takes an inline extension call inside untyped in a static variable (public-shape-changed)",
          apply: addPrivateLabel("Cam"), module: "mr.Cam", expect: "public-shape-changed",
          check: reasonNames("mr.CamUser has untyped code") }
      ]
    },
    {
      // The word `untyped` in a comment is no private access. On 3fa8782c
      // this row was refused (public-shape-changed).
      name: "std-private-comment",
      dce: "std",
      files: {
        ...ownMain(["Hinge"]),
        ...extensionCallFiles("Hinge", {
          user: "  // The label was untyped once; now it is a plain call.\n"
            + "  public static function show(): String {\n    return new Hinge().title();\n  }\n"
        })
      },
      steps: [
        { id: "std: a private method with a fresh name beside a comment that says untyped (preview)",
          apply: () => edit("Hinge.hx", "  public function title(): String {",
            "  function spare(): String {\n    return 'spare';\n  }\n\n  public function title(): String {"),
          module: "mr.Hinge", expect: "preview" }
      ]
    },
    {
      // Round 3 of Fable on 58bff340: the structure with a private field is
      // declared in the requested module itself, before the class. A new
      // private `label()` makes `mr.Globe` unify with `GlobePeek`, so
      // `mr.GlobeUser` takes `PeekTools.describe` (stale on 58bff340).
      name: "std-private-own-structure",
      dce: "std",
      files: {
        ...ownMain(["Globe"]),
        "mr/Globe.hx": "package mr;\n\ntypedef GlobePeek = {\n  private function label(): String;\n}\n\n"
          + "class PeekTools {\n  public static function describe(item: GlobePeek): String {\n    return 'peek';\n  }\n}\n\n"
          + "class Globe {\n  public function new() {}\n\n  public function title(): String {\n    return 'globe';\n  }\n}\n",
        "mr/AnyTools.hx": "package mr;\n\nclass AnyTools {\n"
          + "  public static function describe(item: Globe): String {\n    return 'any ' + item.title();\n  }\n}\n",
        "mr/GlobeUser.hx": "package mr;\n\nusing mr.AnyTools;\nusing mr.Globe.PeekTools;\n\nclass GlobeUser {\n"
          + "  public static function show(): String {\n    return new Globe().describe();\n  }\n}\n"
      },
      steps: [
        { id: "std: a private method makes a class unify with a structure of its own module (public-shape-changed)",
          apply: addPrivateLabel("Globe"), module: "mr.Globe", expect: "public-shape-changed",
          check: reasonNames("mr.Globe has a structure type with a private field") }
      ]
    },
    {
      // The same with the class first: the edit then also moves the typedef
      // and the extension class that `mr.OrbUser` imports
      // (`position-changed` on 58bff340), and the structure rule refuses it
      // first.
      name: "std-private-own-structure-first",
      dce: "std",
      files: {
        ...ownMain(["Orb"]),
        "mr/Orb.hx": "package mr;\n\nclass Orb {\n  public function new() {}\n\n  public function title(): String {\n    return 'orb';\n  }\n}\n\n"
          + "typedef OrbPeek = {\n  private function label(): String;\n}\n\n"
          + "class OrbPeekTools {\n  public static function describe(item: OrbPeek): String {\n    return 'peek';\n  }\n}\n",
        "mr/OrbAny.hx": "package mr;\n\nclass OrbAny {\n"
          + "  public static function describe(item: Orb): String {\n    return 'any ' + item.title();\n  }\n}\n",
        "mr/OrbUser.hx": "package mr;\n\nusing mr.OrbAny;\nusing mr.Orb.OrbPeekTools;\n\nclass OrbUser {\n"
          + "  public static function show(): String {\n    return new Orb().describe();\n  }\n}\n"
      },
      steps: [
        { id: "std: a private method makes a class unify with a structure declared below it in its module (public-shape-changed)",
          apply: addPrivateLabel("Orb"), module: "mr.Orb", expect: "public-shape-changed",
          check: reasonNames("mr.Orb has a structure type with a private field") }
      ]
    },
    {
      // An init macro other than Genes' own and the calls that only record
      // a define, metadata or a class path can change code without metadata,
      // so every private field counts. This one does nothing, so the row
      // previewed on 58bff340 too; it guards the rule.
      name: "std-private-init-macro",
      dce: "std",
      extraArgs: ["--macro", "mr.Spy.install()"],
      files: {
        ...ownMain(["Pod"]),
        "mr/Spy.hx": "package mr;\n\nclass Spy {\n  public static function install(): Void {}\n}\n",
        ...extensionCallFiles("Pod", {
          user: "  public static function show(): String {\n    return new Pod().title();\n  }\n"
        })
      },
      steps: [
        { id: "std: a private method with a fresh name in a program with a project init macro (public-shape-changed)",
          apply: () => edit("Pod.hx", "  public function title(): String {",
            "  function spare(): String {\n    return 'spare';\n  }\n\n  public function title(): String {"),
          module: "mr.Pod", expect: "public-shape-changed",
          check: reasonNames("--macro mr.Spy.install() is an init macro outside Genes") }
      ]
    },
    {
      // The same project init macro written as one argument,
      // `--macro=<call>` (genes-f8vc.14.22). Before the fix, Genes did not
      // see it, so the private method previewed.
      name: "std-private-init-macro-inline",
      dce: "std",
      extraArgs: ["--macro=mr.Spy.install()"],
      files: {
        ...ownMain(["Pod"]),
        "mr/Spy.hx": "package mr;\n\nclass Spy {\n  public static function install(): Void {}\n}\n",
        ...extensionCallFiles("Pod", {
          user: "  public static function show(): String {\n    return new Pod().title();\n  }\n"
        })
      },
      steps: [
        { id: "std: a private method with a fresh name in a program with an inline --macro= project init macro (public-shape-changed)",
          apply: () => edit("Pod.hx", "  public function title(): String {",
            "  function spare(): String {\n    return 'spare';\n  }\n\n  public function title(): String {"),
          module: "mr.Pod", expect: "public-shape-changed",
          check: reasonNames("--macro mr.Spy.install() is an init macro outside Genes") }
      ]
    },
    {
      // The two project-macro rows of `std-structural` (genes-f8vc.14.7), in
      // a program of their own: a project macro makes every private field of
      // the program visible, so the private-function previews of
      // `std-structural` need a program without one.
      name: "std-macro",
      dce: "std",
      files: {
        ...stdFiles,
        "mr/Main.hx": "package mr;\n\nimport mr.Styles;\n\nclass Main {\n  static function main() {\n"
          + "    trace(Tag.text());\n    trace(Built.value());\n    trace(Card.render());\n  }\n}\n"
      },
      steps: [
        { id: "std: new use of an imported project macro (opaque-macro)",
          apply: () => {
            edit("Tag.hx", "package mr;\n", "package mr;\n\nimport mr.Styles;\n");
            edit("Tag.hx", "return 'tag';", "return Styles.css('tag') + '!';");
          },
          module: "mr.Tag", expect: "opaque-macro" },
        { id: "std: structural edit of a module with a build macro (opaque-macro)",
          apply: () => edit("Built.hx", "return 'built';", "return 'built' + Tag.text();"),
          module: "mr.Built", expect: "opaque-macro" },
        { id: "std: a new private function in a program with a project macro (public-shape-changed)",
          apply: () => edit("Card.hx", "  static function unusedHelper(): String {",
            "  static function subtitle(): String {\n    return 'sub';\n  }\n\n  static function unusedHelper(): String {"),
          module: "mr.Card", expect: "public-shape-changed", check: reasonNames("mr.Built runs the build macro") }
      ]
    }
  ];
}

/** One generated UI module of the sweep: its package, name, UI imports and the module that its third edit imports. */
type SweepModule = {
  readonly pack: string;
  readonly name: string;
  readonly uses: ReadonlyArray<string>;
  readonly next: string;
  readonly fillers: number;
};

/**
 * The 20 edited modules of the sweep (genes-f8vc.14.7): six controls, six
 * layout modules, six views and two shells, in layers so that no edit can
 * close an import cycle. `uses` are full module paths; `next` is the module
 * that the third edit starts to use, which is already in the program.
 */
const sweepModules: ReadonlyArray<SweepModule> = [
  { pack: "controls", name: "Button", uses: [], next: "ui.controls.Badge", fillers: 0 },
  { pack: "controls", name: "Badge", uses: [], next: "ui.controls.Avatar", fillers: 4 },
  { pack: "controls", name: "Avatar", uses: [], next: "ui.controls.Chip", fillers: 9 },
  { pack: "controls", name: "Chip", uses: [], next: "ui.controls.Icon", fillers: 14 },
  { pack: "controls", name: "Icon", uses: [], next: "ui.controls.Toggle", fillers: 19 },
  { pack: "controls", name: "Toggle", uses: [], next: "ui.core.Format", fillers: 24 },
  { pack: "layout", name: "Card", uses: ["ui.controls.Button"], next: "ui.controls.Badge", fillers: 2 },
  { pack: "layout", name: "Panel", uses: ["ui.controls.Badge"], next: "ui.controls.Avatar", fillers: 6 },
  { pack: "layout", name: "Stack", uses: ["ui.controls.Avatar"], next: "ui.controls.Chip", fillers: 11 },
  { pack: "layout", name: "Header", uses: ["ui.controls.Icon"], next: "ui.controls.Toggle", fillers: 16 },
  { pack: "layout", name: "Footer", uses: ["ui.controls.Chip"], next: "ui.controls.Button", fillers: 21 },
  { pack: "layout", name: "Sidebar", uses: ["ui.controls.Toggle"], next: "ui.controls.Icon", fillers: 25 },
  { pack: "views", name: "Dashboard", uses: ["ui.layout.Card", "ui.controls.Button"], next: "ui.layout.Panel", fillers: 1 },
  { pack: "views", name: "Settings", uses: ["ui.layout.Panel", "ui.controls.Toggle"], next: "ui.layout.Stack", fillers: 7 },
  { pack: "views", name: "Profile", uses: ["ui.layout.Stack", "ui.controls.Avatar"], next: "ui.layout.Card", fillers: 12 },
  { pack: "views", name: "Inbox", uses: ["ui.layout.Card", "ui.controls.Badge"], next: "ui.layout.Panel", fillers: 17 },
  { pack: "views", name: "Search", uses: ["ui.layout.Stack", "ui.controls.Icon"], next: "ui.layout.Card", fillers: 22 },
  { pack: "views", name: "Notes", uses: ["ui.layout.Panel", "ui.controls.Chip"], next: "ui.layout.Stack", fillers: 26 },
  { pack: "app", name: "App", uses: ["ui.views.Dashboard", "ui.views.Settings", "ui.views.Profile",
    "ui.views.Inbox", "ui.views.Search", "ui.views.Notes"], next: "ui.layout.Header", fillers: 3 },
  { pack: "app", name: "Shell", uses: ["ui.layout.Header", "ui.layout.Footer", "ui.layout.Sidebar"],
    next: "ui.views.Dashboard", fillers: 10 }
];

/** The last part of a module path: `ui.controls.Badge` gives `Badge`. */
function shortName(module: string): string {
  return module.split(".").at(-1) ?? module;
}

/** The text of one generated UI module of the sweep, shaped like a UI component of a real application. */
function sweepModuleText(spec: SweepModule): string {
  const imports = ["ui.core.Theme", "ui.core.Text", "ui.core.Kind", ...spec.uses]
    .map((module) => `import ${module};\n`).join("");
  const props = `${spec.name}Props`;
  const parts = ["header(props)", "body(props)", ...spec.uses.map((module) => `${shortName(module)}.summary()`)];
  const fillers = Array.from({ length: spec.fillers }, (_, index) =>
    `  static function row${index}(value: Int): String {\n`
    + `    return '${spec.name} row ' + (value + ${index}) + ' ' + Theme.spacing();\n  }\n`).join("\n");
  return `package ui.${spec.pack};\n\n${imports}\n`
    + `typedef ${props} = {\n  final label: String;\n  final kind: Kind;\n  final count: Int;\n}\n\n`
    + `/** ${spec.name}: a generated UI module of the -dce std sweep (genes-f8vc.14.7). */\n`
    + `class ${spec.name} {\n`
    + `  public static function render(props: ${props}): String {\n`
    + `    final parts = [${parts.join(", ")}];\n    // sweep-anchor\n    return parts.join(' ');\n  }\n\n`
    + `  public static function summary(): String {\n`
    + `    return render({label: '${spec.name}', kind: Kind.Small, count: ${spec.fillers}});\n  }\n\n`
    + `  static function header(props: ${props}): String {\n`
    + `    return Text.title(props.label) + ':' + Theme.color();\n  }\n\n`
    + `  static function body(props: ${props}): String {\n    return switch props.kind {\n`
    + `      case Small: 'small ' + props.count;\n      case Large: 'large ' + props.count;\n    }\n  }\n\n`
    + `  static function spare(props: ${props}): String {\n    return 'spare ' + props.label;\n  }\n`
    + (fillers.length > 0 ? `\n${fillers}` : "")
    + `}\n`;
}

/**
 * The scripted structural sweep (genes-f8vc.14.7, `--sweep`): five
 * structural edits of each of the 20 generated UI modules, in order:
 *
 * 1. a new private function and a call of it;
 * 2. a first call of an unused private function;
 * 3. a new import of another UI module of the program, on the line of an
 *    existing import, and a call of it;
 * 4. a new local variable with a standard-library call that another module
 *    already makes;
 * 5. the call of step 1 is removed (the function stays).
 *
 * Each module request must publish only files byte-identical to cold, and
 * the full request after it must equal cold. A refusal is allowed and
 * counted by code.
 */
function sweepGroup(): Group {
  const steps: Step[] = [];
  for (const spec of sweepModules)
    for (const edit of sweepEdits(spec))
      steps.push({ id: edit.id, module: sweepModulePath(spec), expect: ["preview"], apply: edit.apply });
  return { name: "sweep-ui", dce: "std", main: "ui.Main", files: sweepFiles(), steps };
}

/** The source files of the sweep program: the core modules, `ui.Main` and the 20 UI modules. */
function sweepFiles(): Record<string, string> {
  const files: Record<string, string> = {
    "ui/Main.hx": `package ui;\n\nimport ui.app.App;\nimport ui.app.Shell;\nimport ui.core.Format;\n\n`
      + `class Main {\n  static function main() {\n    trace(App.summary());\n    trace(Shell.summary());\n`
      + `    trace(Format.summary());\n  }\n}\n`,
    "ui/core/Theme.hx": `package ui.core;\n\nclass Theme {\n  public static function color(): String {\n`
      + `    return 'blue';\n  }\n\n  public static function spacing(): Int {\n    return 4;\n  }\n}\n`,
    "ui/core/Text.hx": `package ui.core;\n\nclass Text {\n  public static function title(text: String): String {\n`
      + `    return StringTools.trim(text).toUpperCase();\n  }\n}\n`,
    "ui/core/Kind.hx": `package ui.core;\n\nenum Kind {\n  Small;\n  Large;\n}\n`,
    "ui/core/Format.hx": `package ui.core;\n\nclass Format {\n  public static function summary(): String {\n`
      + `    return 'format ' + Theme.spacing();\n  }\n}\n`
  };
  for (const spec of sweepModules)
    files[`ui/${spec.pack}/${spec.name}.hx`] = sweepModuleText(spec);
  return files;
}

/** The module path of a sweep module: `ui.controls.Button`. */
function sweepModulePath(spec: SweepModule): string {
  return `ui.${spec.pack}.${spec.name}`;
}

/** The five structural edits of one sweep module, in the order that they must be made. */
function sweepEdits(spec: SweepModule): ReadonlyArray<{ readonly id: string, readonly apply: () => void }> {
  const relative = `ui/${spec.pack}/${spec.name}.hx`;
  const anchor = "    // sweep-anchor\n";
  const props = `${spec.name}Props`;
  return [
    { id: `sweep ${spec.name}: new private function with a call`, apply: () => {
      editSource(relative, anchor, `    parts.push(note(props));\n${anchor}`);
      editSource(relative, `  static function spare(`,
        `  static function note(props: ${props}): String {\n    return 'note ' + props.count;\n  }\n\n`
        + `  static function spare(`);
    } },
    { id: `sweep ${spec.name}: first use of an unused private function`,
      apply: () => editSource(relative, anchor, `    parts.push(spare(props));\n${anchor}`) },
    { id: `sweep ${spec.name}: new import and use of another UI module`, apply: () => {
      // On the line of an existing import: a new line would move the
      // class that other modules import, and their source maps name its
      // position (`position-changed`; see the std-structural rows).
      editSource(relative, "import ui.core.Kind;\n", `import ui.core.Kind; import ${spec.next};\n`);
      editSource(relative, anchor, `    parts.push(${shortName(spec.next)}.summary());\n${anchor}`);
    } },
    { id: `sweep ${spec.name}: new local with a kept standard-library call`,
      apply: () => editSource(relative, anchor,
        `    final shout = StringTools.trim(' ' + props.label + ' ');\n    parts.push(shout.toUpperCase());\n${anchor}`) },
    { id: `sweep ${spec.name}: the call of a private function is removed`,
      apply: () => editSource(relative, "    parts.push(note(props));\n", "") }
  ];
}

/**
 * Previews in a row without a full request between them (genes-f8vc.14.8).
 * An accepted preview advances the records of its module, so the next
 * module request compares with records that match the sources; a refused
 * one leaves them as they are (`runGroup` compares the records text after
 * each module request and each full request).
 *
 * - `chain-unrelated-and-transitive` (`-dce full`): a preview of `mr.Leaf`
 *   after a preview of `mr.Theme` (before: `source-changed`), then a
 *   preview of `mr.Panel`, whose program holds `mr.Button`: Haxe types the
 *   `mr.Button` of the last full request again, because it depends on the
 *   `mr.Theme` that the first preview replaced, so the request is refused
 *   (`other-modules-typed`, the limit of the rule).
 * - `chain-refused` (`-dce std`): a structural preview of `mr.Card`, a
 *   refused edit of it, a preview of it that is checked against the records
 *   of the first preview, and a preview of `mr.CardUser`, which imports
 *   `mr.Card`.
 * - the rows of the review of genes-ts #268: `chain-type-only-target`,
 *   `chain-global-build-refused` and `chain-new-process-module-first` (see
 *   each group).
 */
function chainGroups(): ReadonlyArray<Group> {
  const card = (from: string, to: string) => () => edit("Card.hx", from, to);
  // `mr.Ext` names `haxe.ds.List`, which dead-code elimination removes, only
  // inside a structure type (review of genes-ts #268).
  const extTypeOnly = `package mr;\n\nimport haxe.ds.List;\n\nclass Ext {\n  public static function value(): Int {\n`
    + `    return 1;\n  }\n\n  public static function size(options: {final list: Null<List<Int>>;}): Int {\n`
    + `    return 2;\n  }\n}\n\nprivate extern class ExtNative {\n  static function a(): Int;\n}\n`;
  return [
    {
      // Must-fix 1 of the review of genes-ts #268: the walk of a full
      // request stores the second name of the step to `haxe.ds.List` or not
      // by the order of its walk, so the records text leaves it out (before:
      // `advancedCheck: differs` and GENES-MODULE-REQUEST-005).
      name: "chain-type-only-target",
      dce: "std",
      files: { ...stdFiles, "mr/Ext.hx": extTypeOnly },
      steps: [
        { id: "chain: literal edit of a module that names a removed class only in a structure type",
          apply: () => edit("Ext.hx", "return 1;", "return 3;"), module: "mr.Ext", expect: "preview" }
      ]
    },
    {
      // Must-fix 2 of the review of genes-ts #268, case A: with a global build
      // macro that types `mr.Fresh`, Haxe loads `mr.Fresh` with the standard
      // types before any init macro. A refused module request must fire the
      // mark of every module that it typed at once, so the full request
      // after it is not refused (before: GENES-MODULE-REQUEST-003 in every
      // cycle).
      name: "chain-global-build-refused",
      files: {
        "mr/Main.hx": mainWith(["trace(Fresh.run());"]),
        "mr/Fresh.hx": freshWith("one"),
        "mr/EarlyBuild.hx": earlyBuildMacro
      },
      extraArgs: ["--macro", "addGlobalMetadata('', '@:build(mr.EarlyBuild.build())')"],
      steps: [
        { id: "chain: Fresh literal edit, a refused module request, then the full request",
          apply: () => edit("Fresh.hx", "return 'one';", "return 'two';"),
          module: "mr.Fresh", expect: "other-modules-typed" },
        // On c1befe06 too, this program's second module request finds no
        // records (`no-records`); the claim of the row is that no full
        // request is refused.
        { id: "chain: a second cycle of the same",
          apply: () => edit("Fresh.hx", "return 'two';", "return 'three';"),
          module: "mr.Fresh", expect: ["other-modules-typed", "no-records"] }
      ]
    },
    {
      // Must-fix 2, case B: the first request of a new server process is a
      // module request. It types every module and is refused; the full
      // request after it is not refused (before: GENES-MODULE-REQUEST-003).
      // A client sends a full request first in a new process.
      name: "chain-new-process-module-first",
      steps: [
        { id: "chain: preview of mr.Theme", apply: () => edit("Theme.hx", "return 'blue';", "return 'navy';"),
          module: "mr.Theme", expect: "preview", skipProgram: true },
        { id: "chain: a new server whose first request is a module request, then the full request",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
          restartServer: true, module: "mr.Button", expect: "no-records" }
      ]
    },
    {
      name: "chain-unrelated-and-transitive",
      steps: [
        { id: "chain: preview of mr.Theme", apply: () => edit("Theme.hx", "return 'blue';", "return 'navy';"),
          module: "mr.Theme", expect: "preview", skipProgram: true },
        { id: "chain: preview of a module that does not load mr.Theme",
          apply: () => edit("Leaf.hx", "case Small: 'small';", "case Small: 'tiny';"),
          module: "mr.Leaf", expect: "preview", skipProgram: true },
        { id: "chain: a module whose program holds a module that imports mr.Theme (other-modules-typed)",
          apply: () => edit("Panel.hx", "return 'panel ' + name", "return 'panel: ' + name"),
          module: "mr.Panel", expect: "other-modules-typed" },
        { id: "chain: no edit after the full request", apply: () => {}, module: "mr.Button", expect: "preview" }
      ]
    },
    {
      name: "chain-importer",
      steps: [
        { id: "chain: preview of mr.Theme", apply: () => edit("Theme.hx", "return 'blue';", "return 'navy';"),
          module: "mr.Theme", expect: "preview", skipProgram: true },
        { id: "chain: preview of mr.Button, which imports mr.Theme",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Store';"),
          module: "mr.Button", expect: "preview" }
      ]
    },
    {
      name: "chain-refused",
      dce: "std",
      files: stdFiles,
      steps: [
        { id: "chain: structural preview of mr.Card", apply: () => {
          edit("Card.hx", "return title() + ' ' + Theme.color();",
            "return title() + ' ' + Theme.color() + subtitle();");
          edit("Card.hx", "  static function unusedHelper(): String {",
            "  static function subtitle(): String {\n    return 'sub';\n  }\n\n"
            + "  static function unusedHelper(): String {");
        }, module: "mr.Card", expect: "preview", skipProgram: true },
        { id: "chain: a refused edit leaves the advanced records (dce-use-added)",
          apply: card("+ subtitle();", "+ subtitle() + StringTools.lpad('c', '-', 3);"),
          module: "mr.Card", expect: "dce-use-added", skipProgram: true },
        { id: "chain: a preview of the same module after the refusal", apply: () => {
          edit("Card.hx", "+ subtitle() + StringTools.lpad('c', '-', 3);", "+ subtitle();");
          edit("Card.hx", "return 'Card';", "return 'Card!';");
        }, module: "mr.Card", expect: "preview", skipProgram: true },
        { id: "chain: a preview of a module that imports mr.Card",
          apply: () => edit("CardUser.hx", "return 'user';", "return 'user!';"),
          module: "mr.CardUser", expect: "preview" }
      ]
    }
  ];
}

/** Writes a new file under `src/` (or one outside it, with `../`) and moves its time. */
function addSource(relative: string, text: string): void {
  const file = path.join(workspace, "src", relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  touch(file);
  saved.add(file);
}

/** Deletes a file under `src/`. */
function removeSource(relative: string): void {
  const file = path.join(workspace, "src", relative);
  rmSync(file);
  saved.add(file);
}

/** A class `<pack>.<name>` whose `text()` returns `literal` and calls each of `uses`. */
function rootClass(pack: string, name: string, literal: string,
    uses: ReadonlyArray<string> = [], imports: ReadonlyArray<string> = []): string {
  return `package ${pack};\n\n${imports.map((module) => `import ${module};\n`).join("")}`
    + `\nclass ${name} {\n  public static function text(): String {\n`
    + `    return '${literal}'${uses.map((use) => ` + ' ' + ${use}`).join("")};\n  }\n}\n`;
}

/**
 * Programs with roots beside `--main` (genes-f8vc.14.12): a class-name
 * argument, a recursive `--macro include(...)`, a non-recursive one, and
 * a program shaped like Caffeine's development build (`--main`, four
 * non-recursive includes, `-dce std`). Only the full requests have these
 * roots; a module request leaves them out, as the development session
 * does. Each root holds a module that only the root brings into the program
 * and a module that only that module imports. Before genes-f8vc.14.12
 * Genes knew only the `--main` root, so every module request of these
 * groups was refused with `module-may-leave`.
 */
function extraRootGroups(): ReadonlyArray<Group> {
  const button = (from: string, to: string) => () => edit("Button.hx", from, to);
  const includeFiles = {
    "mr/inc/Card.hx": rootClass("mr.inc", "Card", "card", ["CardHelp.text()", "mr.Theme.color()"]),
    "mr/inc/CardHelp.hx": rootClass("mr.inc", "CardHelp", "help"),
    "mr/inc/sub/Deep.hx": rootClass("mr.inc.sub", "Deep", "deep", ["DeepHelp.text()"]),
    "mr/inc/sub/DeepHelp.hx": rootClass("mr.inc.sub", "DeepHelp", "deep help")
  };
  return [
    {
      name: "roots-class-name",
      dce: "std",
      files: {
        "mr/extra/Format.hx": rootClass("mr.extra", "Format", "format",
          ["FormatHelp.text()", "mr.Theme.color()"]),
        "mr/extra/FormatHelp.hx": rootClass("mr.extra", "FormatHelp", "format help")
      },
      programRoots: ["mr.extra.Format"],
      steps: [
        { id: "roots: literal edit beside a class-name root", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "roots: literal edit of the class-name root",
          apply: () => editSource("mr/extra/Format.hx", "'format'", "'format!'"),
          module: "mr.extra.Format", expect: "preview" },
        { id: "roots: literal edit of a module that only the root imports",
          apply: () => editSource("mr/extra/FormatHelp.hx", "'format help'", "'format help!'"),
          module: "mr.extra.FormatHelp", expect: "preview" },
        { id: "roots: structural edit of the class-name root",
          apply: () => editSource("mr/extra/Format.hx", "'format!'", "'format!' + more()"
            + ";\n  }\n\n  static function more(): String {\n    return 'more'"),
          module: "mr.extra.Format", expect: "preview" },
        { id: "roots: the class-name root drops its only import of a module (module-may-leave)",
          apply: () => editSource("mr/extra/Format.hx", " + ' ' + FormatHelp.text()", ""),
          module: "mr.extra.Format", expect: "module-may-leave" }
      ]
    },
    {
      name: "roots-include-recursive",
      dce: "std",
      files: includeFiles,
      programRoots: ["--macro", "include('mr.inc')"],
      steps: [
        { id: "include: literal edit beside a recursive include", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "include: literal edit of a module in a subfolder of the include",
          apply: () => editSource("mr/inc/sub/Deep.hx", "'deep'", "'deep!'"),
          module: "mr.inc.sub.Deep", expect: "preview" },
        { id: "include: structural edit of a module that only an included module imports",
          apply: () => editSource("mr/inc/sub/DeepHelp.hx", "    return 'deep help';",
            "    return 'deep help' + extra();\n  }\n\n  static function extra(): String {\n    return '+';"),
          module: "mr.inc.sub.DeepHelp", expect: "preview" },
        { id: "include: a new file in a subfolder of the include (include-changed)",
          apply: () => {
            addSource("mr/inc/sub/Fresh.hx", rootClass("mr.inc.sub", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "include-changed" },
        // A file that Genes first sees in a full request is unknown once
        // (genes-f8vc.14.11). An included file is not: the full request
        // read it before typing, when it walked the included folders
        // (`ProgramRoots.beginRequest`), so it proves what Haxe parsed.
        { id: "include: first module request after the new file was built",
          apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "include: literal edit after the new file was built", apply: button("return 'Save!';", "return 'Save';"),
          module: "mr.Button", expect: "preview" },
        // A removed file of the stored program is a changed source before
        // the include rule is checked.
        { id: "include: a file of the include is removed (source-changed)",
          apply: () => {
            removeSource("mr/inc/sub/Fresh.hx");
            edit("Button.hx", "return 'Save';", "return 'Save!';");
          }, module: "mr.Button", expect: "source-changed" },
        { id: "include: a changed include argument (session-changed)",
          apply: () => {
            groupProgramRoots = ["--macro", "include('mr.inc', true, ['mr.inc.sub.Deep'])"];
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "session-changed" },
        { id: "include: literal edit with an ignore list", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" }
      ]
    },
    {
      name: "roots-include-flat",
      dce: "std",
      files: includeFiles,
      programRoots: ["--macro", "include('mr.inc', false)"],
      steps: [
        { id: "include flat: literal edit beside a non-recursive include", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "include flat: literal edit of an included module",
          apply: () => editSource("mr/inc/Card.hx", "'card'", "'card!'"),
          module: "mr.inc.Card", expect: "preview" },
        { id: "include flat: a new file in a subfolder that the include leaves out",
          apply: () => {
            addSource("mr/inc/sub/Fresh.hx", rootClass("mr.inc.sub", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "preview" },
        { id: "include flat: a new file in the included folder (include-changed)",
          apply: () => {
            addSource("mr/inc/Fresh.hx", rootClass("mr.inc", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save';", "return 'Save!';");
          }, module: "mr.Button", expect: "include-changed" }
      ]
    },
    {
      name: "roots-include-before-genes",
      dce: "std",
      files: includeFiles,
      programRoots: ["--macro", "include('mr.inc', false)"],
      rootsBeforeGenes: true,
      steps: [
        { id: "include before Genes: literal edit", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "include before Genes: a new file in the included folder (include-changed)",
          apply: () => {
            addSource("mr/inc/Fresh.hx", rootClass("mr.inc", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "include-changed" }
      ]
    },
    // Under `-dce full` an included module that dead-code elimination
    // keeps can keep a field of the edited module. Before genes-f8vc.14.12
    // the module request did not see the new file and published
    // `mr/Button.ts` without `unused`, which cold keeps.
    dceFullIncludeGroup("roots-include-dce-full", [], ["--macro", "include('mr.inc', false)"]),
    // Review of #269: Haxe also takes an option and its value as one
    // argument with `=`. On 0723e4e8 `-D=probe_inline` took the next
    // argument as its value, and `--macro=include(...)` was not read, so
    // the include line was missed and both previews were stale.
    dceFullIncludeGroup("roots-inline-define-dce-full", ["-D=probe_inline"],
      ["--macro", "include('mr.inc', false)"]),
    dceFullIncludeGroup("roots-inline-macro-dce-full", [], ["--macro=include('mr.inc',false)"]),
    {
      // On 0723e4e8 `-D=probe_inline` took the class name as its value
      // (`module-may-leave`, safe but no preview).
      name: "roots-inline-define-class-name",
      dce: "std",
      extraArgs: ["-D=probe_inline"],
      files: {
        "mr/extra/Format.hx": rootClass("mr.extra", "Format", "format", ["mr.Theme.color()"])
      },
      programRoots: ["mr.extra.Format"],
      steps: [
        { id: "inline define: literal edit beside a class-name root", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" }
      ]
    },
    {
      // A file of the included folder with no declaration outside macro
      // code: Haxe parses it and adds nothing. On 0723e4e8 it made the roots
      // unknown, so every module request was refused (`include-changed`).
      name: "probe-macro-only-module",
      dce: "std",
      files: {
        ...includeFiles,
        "mr/inc/MacroOnly.hx": "package mr.inc;\n\n#if macro\nclass MacroOnly {\n  public static function make() {}\n}\n#end\n"
      },
      programRoots: ["--macro", "include('mr.inc', false)"],
      steps: [
        { id: "macro-only module: literal edit beside it", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "macro-only module: it gets a declaration (include-changed)",
          apply: () => {
            editSource("mr/inc/MacroOnly.hx", "#end\n", "#end\n\nclass MacroOnlyRuntime {\n  public static function text(): String {\n    return 'runtime';\n  }\n}\n");
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "include-changed" }
      ]
    },
    {
      // Review round 2 of #269: a client that sends no `server/invalidate`
      // saves a declaration-less included file in the same second. Haxe's
      // file-time check misses it, and Genes proved no content of it, so
      // on d8b4b5ad the full request kept the old parse (differs from cold:
      // `mr/Button.ts`, `mr/inc/Late.ts`) and the next preview was stale.
      // Now the full request makes Haxe parse such a file again.
      name: "probe-late-macro-only-module",
      noInvalidate: true,
      files: {
        "mr/inc/Card.hx": `package mr.inc;\n\n@:keep\nclass Card {\n  public static function text(): String {\n`
          + `    return 'card ' + mr.Theme.color();\n  }\n}\n`,
        "mr/inc/Late.hx": `package mr.inc;\n\n#if macro\n@:keep\nclass Late {\n`
          + `  public static function text(): String {\n    return @:privateAccess mr.Button.unused();\n  }\n}\n#end\n`
      },
      programRoots: ["--macro", "include('mr.inc', false)"],
      steps: [
        { id: "late macro-only: literal edit beside it", apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "late macro-only: the file gets a class in the same second (include-changed)",
          apply: () => {
            editSameSecond("inc/Late.hx", "#if macro", "#if !acro");
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "include-changed" },
        { id: "late macro-only: literal edit after the full request built the class",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" }
      ]
    },
    declarationlessRaceGroup("roots-declarationless-race", "mr/inc", "mr.inc"),
    // The same race on the class path that Haxe gives without `-cp`: the
    // folder of the request, which the walk spells `./rootinc/Late.hx` and
    // Haxe's positions spell `rootinc/Late.hx` (genes-f8vc.14.24).
    declarationlessRaceGroup("roots-declarationless-race-root-class-path", "../rootinc", "rootinc"),
    {
      // genes-f8vc.14.24: an init macro given before Genes that loads an
      // included module by name can make Haxe use its old parse of a file
      // without a declaration before Genes walks the folder. On 339b4855
      // Genes noted no content of such a file, so the init macro rule did
      // not see its change: when the file was saved in the same second after
      // a module request had parsed it (no server/invalidate), the full
      // request kept the old parse and differed from cold. Now the full
      // request notes what Haxe parsed for each such file: the first time it
      // cannot prove it (the roots are unknown, and the next full request is
      // refused once), and a change of the file is refused once
      // (`GENES-MODULE-REQUEST-003`).
      name: "roots-declarationless-early-macro",
      noInvalidate: true,
      files: {
        "mr/EarlyInclude.hx": `package mr;\n\n#if macro\nclass EarlyInclude {\n`
          + `  public static function install(): Void {\n`
          + `    haxe.macro.Context.getModule('mr.inc.Late');\n  }\n}\n#end\n`,
        "mr/inc/Card.hx": `package mr.inc;\n\n@:keep\nclass Card {\n  public static function text(): String {\n`
          + `    return 'card ' + mr.Theme.color();\n  }\n}\n`,
        "mr/inc/Late.hx": `package mr.inc;\n\n#if macro\n@:keep\nclass Late {\n`
          + `  public static function text(): String {\n    return @:privateAccess mr.Button.unused();\n  }\n}\n#end\n`
      },
      argsBeforeGenes: ["--macro", "mr.EarlyInclude.install()"],
      programRoots: ["--macro", "include('mr.inc', false)"],
      steps: [
        // No step edits `mr/Button.hx`: the init macro rule would refuse
        // each module request of a changed file once, which is not what
        // these steps show.
        { id: "early macro: Genes has not proven the file without a declaration (include-changed)",
          apply: () => {}, module: "mr.Button", expect: "include-changed", initRefusal: "full" },
        { id: "early macro: module request after the full request proved the file",
          apply: () => {}, module: "mr.Button", expect: "preview" },
        // The module request runs the early macro too, so Haxe holds a parse
        // of the file without the class when the save lands after it.
        { id: "early macro: only the file without a declaration gets a class, in the same second",
          apply: () => {}, module: "mr.Button", expect: "preview",
          afterModule: () => editSameSecond("inc/Late.hx", "#if macro", "#if !acro"),
          initRefusal: "full" },
        { id: "early macro: module request after the full request built the class",
          apply: () => {},
          module: "mr.Button", expect: "preview" }
      ]
    },
    earlyMacroRestoreGroup("roots-early-macro-module-restore", "module"),
    earlyMacroRestoreGroup("roots-early-macro-display-restore", "display"),
    {
      // genes-f8vc.14.24: the `root empty` lines of the records text follow
      // the module names, not the order in which the file system lists the
      // folder (APFS lists these files in another order).
      name: "roots-empty-order",
      dce: "std",
      files: {
        ...includeFiles,
        ...Object.fromEntries(["Zeta", "Alpha", "Mid", "Beta", "Omega", "Kappa", "Delta"].map((name) =>
          [`mr/inc/${name}.hx`, `package mr.inc;\n\n#if macro\nclass ${name} {}\n#end\n`]))
      },
      programRoots: ["--macro", "include('mr.inc', false)"],
      steps: [
        { id: "empty order: literal edit beside seven files without a declaration",
          apply: button("return 'Save';", "return 'Save!';"), module: "mr.Button", expect: "preview" }
      ]
    },
    {
      name: "roots-include-ignore-wildcard",
      dce: "std",
      files: includeFiles,
      programRoots: ["--macro", "include('mr.inc', true, ['mr.inc.sub*'])"],
      steps: [
        { id: "ignore wildcard: literal edit", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "ignore wildcard: a new file in an ignored folder",
          apply: () => {
            addSource("mr/inc/sub/Fresh.hx", rootClass("mr.inc.sub", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "preview" },
        { id: "ignore wildcard: a new file in the included folder (include-changed)",
          apply: () => {
            addSource("mr/inc/Fresh.hx", rootClass("mr.inc", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save';", "return 'Save!';");
          }, module: "mr.Button", expect: "include-changed" }
      ]
    },
    {
      // `classPaths` given: only the folder `lib` (relative to the request).
      name: "roots-include-class-paths",
      dce: "std",
      extraArgs: ["-cp", "lib"],
      files: {
        "../lib/canvas/Surface.hx": rootClass("canvas", "Surface", "surface", ["canvas.Paint.text()"]),
        "../lib/canvas/Paint.hx": rootClass("canvas", "Paint", "paint")
      },
      programRoots: ["--macro", "include('canvas', false, null, ['lib'])"],
      steps: [
        { id: "class paths: literal edit", apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "class paths: literal edit of an included module",
          apply: () => editSource("../lib/canvas/Paint.hx", "'paint'", "'paint!'"),
          module: "canvas.Paint", expect: "preview" },
        { id: "class paths: a new file in the included folder (include-changed)",
          apply: () => {
            addSource("../lib/canvas/Fresh.hx", rootClass("canvas", "Fresh", "fresh"));
            edit("Button.hx", "return 'Save!';", "return 'Save';");
          }, module: "mr.Button", expect: "include-changed" }
      ]
    },
    {
      // Haxe skips the optional `Bool` and takes `['x']` as `ignore`; Genes
      // reads each argument in its place only, so the roots are unknown.
      // (Haxe 4.3.7 takes only constant arguments in an init macro and
      // rejects `#if` around it, so this is the include line that Genes
      // cannot read and Haxe accepts.)
      name: "roots-include-wrong-argument",
      dce: "std",
      files: includeFiles,
      programRoots: ["--macro", "include('mr.inc', ['x'])"],
      steps: [
        { id: "wrong argument: an array where include takes a Bool (include-changed)",
          apply: button("return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "include-changed" }
      ]
    },
    caffeineShapedGroup()
  ];
}

/**
 * An include under `-dce full` (genes-f8vc.14.12): `mr.inc.Card` is
 * `@:keep`, a literal edit of `mr.Button` previews, and a new `@:keep` class
 * in the included folder that calls the private `mr.Button.unused()` is
 * refused (`include-changed`), because cold then keeps `unused`.
 * `extraArgs` go to every request, `programRoots` to the full requests.
 */
function dceFullIncludeGroup(name: string, extraArgs: ReadonlyArray<string>,
    programRoots: ReadonlyArray<string>): Group {
  const button = (from: string, to: string) => () => edit("Button.hx", from, to);
  return {
    name,
    extraArgs,
    files: {
      "mr/inc/Card.hx": `package mr.inc;\n\n@:keep\nclass Card {\n  public static function text(): String {\n`
        + `    return 'card ' + mr.Theme.color();\n  }\n}\n`
    },
    programRoots,
    steps: [
      { id: `${name}: literal edit beside an include`, apply: button("return 'Save';", "return 'Save!';"),
        module: "mr.Button", expect: "preview" },
      { id: `${name}: a new kept file of the include uses a field of the edited module (include-changed)`,
        apply: () => {
          addSource("mr/inc/Caller.hx", `package mr.inc;\n\n@:keep\nclass Caller {\n`
            + `  public static function text(): String {\n    return @:privateAccess mr.Button.unused();\n  }\n}\n`);
          edit("Button.hx", "return 'Save!';", "return 'Save';");
        }, module: "mr.Button", expect: "include-changed" }
    ]
  };
}

/**
 * A listed file that loses its class while a full request runs
 * (genes-f8vc.14.24, review round 3 of #269). Under `-dce full`,
 * `include('<pack>', false)` adds `Late`, a `@:keep` class that keeps the
 * private `mr.Button.unused`. In step 2, `mr.Strip` removes the class after
 * Genes walked the folder and before Haxe's walk, and puts it back after
 * typing with the same modification time; the session invalidates only
 * `mr/Button.hx`. Haxe keeps the parse without the class. On 339b4855 Genes
 * kept the old digest of the file as proven, so the full request of step 3
 * kept that parse and differed from cold (`mr/Button.ts`, `<folder>/Late.ts`),
 * and step 4 published a stale preview. `folder` is the included folder
 * relative to `src/`.
 */
function declarationlessRaceGroup(name: string, folder: string, pack: string): Group {
  return {
    name,
    files: {
      "mr/Strip.hx": stripMacro,
      [`${folder}/Card.hx`]: `package ${pack};\n\n@:keep\nclass Card {\n  public static function text(): String {\n`
        + `    return 'card ' + mr.Theme.color();\n  }\n}\n`,
      [`${folder}/Late.hx`]: `package ${pack};\n\n#if !acro\n@:keep\nclass Late {\n`
        + `  public static function text(): String {\n    return @:privateAccess mr.Button.unused();\n  }\n}\n#end\n`
    },
    extraArgs: stripArgs,
    programRoots: ["--macro", `include('${pack}', false)`],
    steps: [
      { id: `${name}: literal edit beside the kept class`, apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
        module: "mr.Button", expect: "preview" },
      { id: `${name}: the class goes and comes back in one second while the full request runs`,
        apply: () => edit("Button.hx", "return 'Save!';", "return 'Save';"),
        stripOnFull: `${folder}/Late.hx|#if !acro|#if macro` },
      // The second walk saw the file change while the request ran, so the
      // roots are unknown until the next full request.
      { id: `${name}: module request after the race (include-changed)`,
        apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
        module: "mr.Button", expect: "include-changed" },
      { id: `${name}: literal edit after the full request parsed the class again`,
        apply: () => edit("Button.hx", "return 'Save!';", "return 'Save';"),
        module: "mr.Button", expect: "preview" }
    ]
  };
}

/**
 * Another request makes Haxe parse an included file without its class, and
 * a save puts the class back in the same whole second (genes-f8vc.14.24,
 * review of #270 on 4c78e5d2). `mr.EarlyInclude`, an init macro given
 * before `genes.Generator.use()`, loads `mr.inc.Late` in every request, also
 * in a module request (`via: "module"`) and in an editor request with the
 * session's defines (`via: "display"`), where Genes notes no content of the
 * file. In step 3 a save removes the `@:keep` class of `mr/inc/Late.hx`, that
 * request parses the file, and a second save in the same whole second puts
 * the class back; no server/invalidate is sent. On 4c78e5d2 the next full
 * request was refused once (`GENES-MODULE-REQUEST-003`): the digest was the
 * proven one, only the file status differed, so Genes did not make Haxe
 * parse the file again, and the request sent again differed from cold
 * (`mr/Button.ts`, `mr/inc/Late.ts`); the previews after it were stale. Now
 * a file whose status differs from the noted one is parsed again too.
 */
function earlyMacroRestoreGroup(name: string, via: "module" | "display"): Group {
  const restore = () => editSameSecond("inc/Late.hx", "#if macro", "#if !acro");
  return {
    name,
    noInvalidate: true,
    files: {
      "mr/EarlyInclude.hx": `package mr;\n\n#if macro\nclass EarlyInclude {\n`
        + `  public static function install(): Void {\n`
        + `    haxe.macro.Context.getModule('mr.inc.Late');\n  }\n}\n#end\n`,
      "mr/inc/Late.hx": `package mr.inc;\n\n#if !acro\n@:keep\nclass Late {\n`
        + `  public static function text(): String {\n    return @:privateAccess mr.Button.unused();\n  }\n}\n#end\n`
    },
    argsBeforeGenes: ["--macro", "mr.EarlyInclude.install()"],
    programRoots: ["--macro", "include('mr.inc', false)"],
    steps: [
      { id: `${name}: module request without an edit`, apply: () => {}, module: "mr.Button", expect: "preview" },
      { id: `${name}: second module request without an edit`, apply: () => {}, module: "mr.Button", expect: "preview" },
      via === "module"
        ? { id: `${name}: a module request parses the file without its class, which comes back in the same second`,
            apply: () => editSource("mr/inc/Late.hx", "#if !acro", "#if macro"),
            module: "mr.Button", expect: "source-changed", afterModule: restore, initRefusal: "full" }
        : { id: `${name}: an editor request parses the file without its class, which comes back in the same second`,
            apply: () => editSource("mr/inc/Late.hx", "#if !acro", "#if macro"),
            display: { when: "after-save", form: "json-session" }, afterModule: restore, initRefusal: "full" },
      { id: `${name}: module request after the full request`, apply: () => {}, module: "mr.Button", expect: "preview" },
      { id: `${name}: another module request`, apply: () => {}, module: "mr.Button", expect: "preview" }
    ]
  };
}

/**
 * A program shaped like Caffeine's development build (`development.hxml`
 * over `web.hxml`): `--main`, four non-recursive includes (two packages of
 * one domain tree, a UI package and a package on a second class path), and
 * `-dce std` after the default. Included modules import each other and the
 * modules of `--main`, and each include has a module that only it brings
 * into the program. The second class path is relative (`lib`), so the
 * listing of `include('canvas', false)` resolves it as Haxe does.
 */
function caffeineShapedGroup(): Group {
  return {
    name: "roots-caffeine-shaped",
    dce: "std",
    // A class path relative to the request's folder, as in Caffeine's HXML.
    extraArgs: ["-cp", "lib"],
    files: {
      "app/domain/Note.hx": rootClass("app.domain", "Note", "note", ["mr.Theme.color()"]),
      "app/domain/Store.hx": rootClass("app.domain", "Store", "store", ["Note.text()"]),
      "app/domain/viewport/Camera.hx": rootClass("app.domain.viewport", "Camera", "camera",
        ["app.domain.Note.text()"]),
      "app/domain/viewport/Zoom.hx": rootClass("app.domain.viewport", "Zoom", "zoom"),
      "app/ui/viewport/View.hx": `package app.ui.viewport;\n\nimport app.domain.viewport.Camera;\n\n`
        + `class View {\n  public static function text(): String {\n`
        + `    return 'view ' + Camera.text() + ' ' + canvas.Surface.text() + ' ' + ViewHelp.text();\n  }\n}\n`,
      "app/ui/viewport/ViewHelp.hx": rootClass("app.ui.viewport", "ViewHelp", "view help"),
      "../lib/canvas/Surface.hx": rootClass("canvas", "Surface", "surface", ["canvas.Paint.text()"]),
      "../lib/canvas/Paint.hx": rootClass("canvas", "Paint", "paint")
    },
    programRoots: [
      "--macro", "include('app.domain', false)",
      "--macro", "include('app.domain.viewport', false)",
      "--macro", "include('app.ui.viewport', false)",
      "--macro", "include('canvas', false)"
    ],
    steps: [
      { id: "caffeine: literal edit of a module of --main", apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
        module: "mr.Button", expect: "preview" },
      { id: "caffeine: literal edit of a module that included modules import",
        apply: () => edit("Theme.hx", "return 'blue';", "return 'teal';"),
        module: "mr.Theme", expect: "preview" },
      { id: "caffeine: literal edit of an included domain module",
        apply: () => editSource("app/domain/Note.hx", "'note'", "'note!'"),
        module: "app.domain.Note", expect: "preview" },
      { id: "caffeine: literal edit of an included viewport module",
        apply: () => editSource("app/domain/viewport/Zoom.hx", "'zoom'", "'zoom!'"),
        module: "app.domain.viewport.Zoom", expect: "preview" },
      { id: "caffeine: structural edit of an included UI module",
        apply: () => editSource("app/ui/viewport/View.hx",
          "' ' + ViewHelp.text();\n  }\n",
          "' ' + ViewHelp.text() + label();\n  }\n\n  static function label(): String {\n    return 'label';\n  }\n"),
        module: "app.ui.viewport.View", expect: "preview" },
      { id: "caffeine: literal edit of a module on the second class path",
        apply: () => editSource("../lib/canvas/Paint.hx", "'paint'", "'paint!'"),
        module: "canvas.Paint", expect: "preview" }
    ]
  };
}

/** A class `mr.reach.<name>` whose `text()` returns `'<word> ' + <use>`. */
function reachUser(name: string, word: string, use: string): string {
  return `package mr.reach;\n\nclass ${name} {\n  public static function text(): String {\n`
    + `    return '${word} ' + ${use};\n  }\n}\n`;
}

/**
 * Modules that only an inline call or a macro call brings into the program
 * (genes-f8vc.14.26). Haxe types each of these calls in the caller and
 * leaves no reference to the callee's class in the typed body: an inline
 * function's body or an inline constant's value replaces the call, and a
 * macro returns other code. Haxe still loads the callee's module, and a
 * full build writes its file. Before the fix, `DceStdUses.dependenciesOf`
 * read only typed bodies, so no module that stays was known to load the
 * callee, and every `-dce std` module request was refused with
 * `module-may-leave` (measured on Caffeine: 0 of 18 edits previewed). Now
 * Genes also reads Haxe's own list of the modules that each module loads
 * (`HaxeDependencies`). The last rows remove the only call: a full build
 * then drops the callee's file, and the request must still be refused.
 */
function inlineReachGroups(): ReadonlyArray<Group> {
  return [
    {
      name: "std-inline-reach",
      dce: "std",
      files: {
        "mr/Main.hx": mainWith([
          "trace(mr.reach.ViaInline.text());",
          "trace(mr.reach.ViaFinal.text());",
          "trace(mr.reach.ViaMacro.text());"
        ]),
        "mr/reach/Codec.hx": "package mr.reach;\n\nclass Codec {\n"
          + "  public static inline function assume<T>(value: T): T {\n    return value;\n  }\n}\n",
        "mr/reach/Names.hx": "package mr.reach;\n\nclass Names {\n"
          + "  public static inline final CITATION = 'citation';\n}\n",
        "mr/reach/Twice.hx": "package mr.reach;\n\nclass Twice {\n"
          + "  public static macro function twice(value: haxe.macro.Expr): haxe.macro.Expr {\n"
          + "    return macro $value * 2;\n  }\n}\n",
        "mr/reach/ViaInline.hx": reachUser("ViaInline", "inline", "Codec.assume('value')"),
        "mr/reach/ViaFinal.hx": reachUser("ViaFinal", "final", "Names.CITATION"),
        "mr/reach/ViaMacro.hx": reachUser("ViaMacro", "macro", "Twice.twice(2)")
      },
      steps: [
        { id: "reach: literal edit of a module beside the inline and macro calls",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "reach: literal edit of the module with the inline function call",
          apply: () => editSource("mr/reach/ViaInline.hx", "'inline '", "'inline! '"),
          module: "mr.reach.ViaInline", expect: "preview" },
        { id: "reach: literal edit of the module with the inline constant",
          apply: () => editSource("mr/reach/ViaFinal.hx", "'final '", "'final! '"),
          module: "mr.reach.ViaFinal", expect: "preview" },
        { id: "reach: literal edit of the module with the macro call",
          apply: () => editSource("mr/reach/ViaMacro.hx", "'macro '", "'macro! '"),
          module: "mr.reach.ViaMacro", expect: "preview" },
        { id: "reach: the only inline function call is removed (module-may-leave)",
          apply: () => editSource("mr/reach/ViaInline.hx", "Codec.assume('value')", "'value'"),
          module: "mr.reach.ViaInline", expect: "module-may-leave",
          check: reasonNames("mr.reach.Codec") },
        { id: "reach: the only inline constant is removed (module-may-leave)",
          apply: () => editSource("mr/reach/ViaFinal.hx", "Names.CITATION", "'citation'"),
          module: "mr.reach.ViaFinal", expect: "module-may-leave",
          check: reasonNames("mr.reach.Names") },
        { id: "reach: the only macro call is removed (module-may-leave)",
          apply: () => editSource("mr/reach/ViaMacro.hx", "Twice.twice(2)", "4"),
          module: "mr.reach.ViaMacro", expect: "module-may-leave",
          check: reasonNames("mr.reach.Twice") }
      ]
    },
    {
      // Caffeine's shapes: `genes.ts.Json.value` returns a call of
      // `Json.checkedValue`, which reaches `genes.ts.JsonCodec` only through
      // the inline `unsafeAssumeJson`; a module of another package reads a
      // `public static inline final` (as Caffeine's CmlGraphReadModel reads
      // `GraphReferenceCard.CitationProperty`); and a Genes macro call
      // (`genes.ts.TypeArguments.call`) loads its macro class, which
      // nothing else names. Each one made every request `module-may-leave`.
      // `genes.js.Async.enable()` gives every class a global build macro, as
      // Caffeine's development build does. On d64d0ee2, which distrusted
      // every single line of Haxe's list for a module that ran any build
      // macro, each preview row here was still `module-may-leave`.
      name: "std-inline-reach-caffeine-shaped",
      dce: "std",
      extraArgs: ["--macro", "genes.js.Async.enable()"],
      files: {
        "mr/Main.hx": mainWith(["trace(app.read.ReadModel.text());"]),
        "app/graph/ReferenceCard.hx": "package app.graph;\n\nclass ReferenceCard {\n"
          + "  public static inline final CitationProperty = 'citation';\n}\n",
        // No import line: Haxe loads an imported module with its importer,
        // so the last row would then keep `app.graph.ReferenceCard`.
        "app/read/ReadModel.hx": "package app.read;\n\n"
          + "class ReadModel {\n  public static function text(): String {\n"
          + "    final value = genes.ts.Json.value({kind: 'note'});\n"
          + "    return 'read ' + app.graph.ReferenceCard.CitationProperty + ' ' + (value == null ? 'none' : 'json');\n"
          + "  }\n}\n",
        "app/read/Typed.hx": "package app.read;\n\nclass Typed {\n"
          + "  @:ts.explicitTypeArguments\n"
          + "  static function same<T>(value: T): T {\n    return value;\n  }\n\n"
          + "  public static function text(): String {\n"
          + "    return 'typed ' + genes.ts.TypeArguments.call(same('x'), 'w');\n  }\n}\n"
      },
      programRoots: ["--macro", "include('app.read', false)"],
      steps: [
        { id: "caffeine reach: literal edit of a module of --main",
          apply: () => edit("Button.hx", "return 'Save';", "return 'Save!';"),
          module: "mr.Button", expect: "preview" },
        { id: "caffeine reach: literal edit of the module with Json.value and the inline constant",
          apply: () => editSource("app/read/ReadModel.hx", "'read '", "'read! '"),
          module: "app.read.ReadModel", expect: "preview" },
        { id: "caffeine reach: literal edit of the module with the Genes macro call",
          apply: () => editSource("app/read/Typed.hx", "'typed '", "'typed! '"),
          module: "app.read.Typed", expect: "preview" },
        { id: "caffeine reach: structural edit of the module with the Genes macro call",
          apply: () => {
            editSource("app/read/Typed.hx", "    return 'typed! ' +",
              "    return extra() + 'typed! ' +");
            editSource("app/read/Typed.hx", "  public static function text(): String {",
              "  static function extra(): String {\n    return '+';\n  }\n\n"
              + "  public static function text(): String {");
          },
          module: "app.read.Typed", expect: "preview" },
        { id: "caffeine reach: the only read of the inline constant is removed (module-may-leave)",
          apply: () => editSource("app/read/ReadModel.hx", "app.graph.ReferenceCard.CitationProperty", "'citation'"),
          module: "app.read.ReadModel", expect: "module-may-leave",
          check: reasonNames("app.graph.ReferenceCard") }
      ]
    }
  ];
}

const groups: ReadonlyArray<Group> = [
  { name: "base", steps: baseSteps },
  ...chainGroups(),
  ...stdGroups(),
  ...extraRootGroups(),
  ...inlineReachGroups(),
  ...privateAccessGroups(),
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
        // genes-f8vc.14.8: the previews of mr.Button advanced its records,
        // so its saved file is the stored one (before: `source-changed`).
        // mr.Theme's program does not hold mr.Button, and a literal edit
        // keeps the shape that mr.Button types against.
        expect: "preview"
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
    // r05 B: the files of the mark for a new typing are deleted before the
    // full request; the full request still makes Haxe type the module again
    // (it also makes Haxe parse the files that a module request typed alone).
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
        id: "Registry edit, then the files of the mark for a new typing are deleted",
        apply: () => edit("Registry.hx", "return 'registry ' + items.length;",
          "return 'registry! ' + items.length;"),
        module: "mr.Registry",
        expect: "public-shape-changed",
        afterModule: () => {
          for (const entry of readdirSync(tempRoot))
            if (entry.startsWith(`${path.basename(descriptorFile)}.module-retype`))
              rmSync(path.join(tempRoot, entry), { force: true });
        }
      },
      {
        id: "a second full request, no edit",
        apply: () => {}
      }
    ]
  },
  ...lateMacroGroups(),
  ...statGroups(),
  ...earlyInitMacroGroups(),
  ...displayRequestGroups(),
  ...failedRequestGroups()
];

function folder(name: string): string {
  return path.join(tempRoot, "out", name);
}

let groupArgs: ReadonlyArray<string> = [];
let groupDce: "std" | "full" = "full";
let groupMain = "mr.Main";
/** `Group.programRoots` of the running group; a step may change it (a changed include argument). */
let groupProgramRoots: ReadonlyArray<string> = [];
let groupRootsBeforeGenes = false;

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

/**
 * Arguments shared by every request: the defines of the session. With
 * `program`, also the roots that only the full request has
 * (`groupProgramRoots`).
 */
function commonArguments(program = false): string[] {
  return [
    "-cp", genesSource,
    "-lib", "helder.set",
    "-D", `genes-ts=${genesVersion}`,
    ...groupArgsBeforeGenes,
    ...(program && groupRootsBeforeGenes ? groupProgramRoots : []),
    "--macro", "genes.Generator.use()",
    "-cp", path.join(workspace, "src"),
    "-D", "js-es=6",
    "-dce", groupDce,
    "-debug",
    "-D", "genes.ts",
    "-D", `genes.source_map_root=${tempRoot}`,
    ...groupArgs,
    ...(program && !groupRootsBeforeGenes ? groupProgramRoots : [])
  ];
}

function programArguments(out: string): string[] {
  return [...commonArguments(true), "--main", groupMain, "-js",
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

/**
 * Writes the request descriptor. Every request asks for the records text
 * (`"recordsText": true`, genes-f8vc.14.8): Genes then writes the stored
 * records as plain text beside the descriptor, and the gate compares them.
 */
function writeDescriptor(fields: Record<string, unknown>, file = descriptorFile): void {
  writeFileSync(file, JSON.stringify({
    format: 1,
    programDigest: programDigest(),
    afterTyping: "reuse",
    generation: "reuse",
    recordsText: true,
    ...fields
  }));
}

function incremental(args: string[], file = descriptorFile): string[] {
  return [...args, "-D", `genes.dev_incremental=${file}`];
}

/** The records text that the last request beside `file` wrote, or `null` (genes-f8vc.14.8). */
function readRecordsText(file = descriptorFile): string | null {
  const text = `${file}.records.txt`;
  return existsSync(text) ? readFileSync(text, "utf8") : null;
}

/**
 * Fails when the `root empty` lines of one `include` line in a records text
 * are not sorted by module (genes-f8vc.14.24). Their order must not depend
 * on the order in which the file system lists a folder.
 */
function rootEmptyInOrder(records: string | null, label: string): void {
  let previous: string | null = null;
  for (const line of (records ?? "").split("\n")) {
    if (!line.startsWith("root empty ")) {
      previous = null;
      continue;
    }
    const module = line.split(" ")[2] ?? "";
    ok(previous === null || previous < module,
      `${label}: the root empty lines must be sorted by module (${previous ?? ""} before ${module})`);
    previous = module;
  }
}

/** Deletes the records text beside `file`, so that a request that writes none leaves none. */
function clearRecordsText(file = descriptorFile): void {
  rmSync(`${file}.records.txt`, { force: true });
}

/**
 * Fails when two records texts differ, with the first differing lines.
 * `left` and `right` name the two requests in the message.
 */
function sameRecords(actual: string | null, expected: string | null, label: string,
    left: string, right: string): void {
  ok(actual !== null, `${label}: the ${left} wrote no records text`);
  ok(expected !== null, `${label}: the ${right} wrote no records text`);
  if (actual === expected)
    return;
  // The lines that only one side has (each line counted as often as it
  // occurs), with the module line above each, so that one extra line does
  // not show as a shift of every line after it.
  function only(lines: ReadonlyArray<string>, other: ReadonlyArray<string>): string[] {
    const counts = new Map<string, number>();
    for (const line of other)
      counts.set(line, (counts.get(line) ?? 0) + 1);
    const found: string[] = [];
    let module = "";
    for (const line of lines) {
      if (line.startsWith("module "))
        module = line;
      const count = counts.get(line) ?? 0;
      if (count > 0)
        counts.set(line, count - 1);
      else if (found.length < 20)
        found.push(`${module} | ${line}`);
    }
    return found;
  }
  const a = actual.split("\n");
  const b = expected.split("\n");
  ok(false, `${label}: the records after the ${left} differ from the records after the ${right}:\n`
    + `only after the ${left}:\n  ${only(a, b).join("\n  ")}\n`
    + `only after the ${right}:\n  ${only(b, a).join("\n  ")}`);
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
  /** `digestMs` of the module request's report, or `null` without a report. */
  readonly digestMs: number | null;
  /** Files that the status rule trusted / files that the source check read. */
  readonly sources: string;
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

/**
 * Runs the full request of a step whose text has a type error (genes-u8fq)
 * and returns its time. The cold build must fail, and the warm full request
 * must fail too, report every error line of the cold build (the lines that
 * name a file of the workspace), and leave the program tree as it was. A
 * warm request that reports an older error, or none, fails the gate.
 */
async function failingProgramRequest(server: OwnedHaxeCompilerServer,
    compiler: ReturnType<typeof selectedHaxeCompiler>, label: string): Promise<number> {
  rmSync(folder("cold"), { recursive: true, force: true });
  const cold = await runBoundedProcess(compiler.binary,
    programArguments(folder("cold")), {
      cwd: workspace,
      timeoutMs,
      label: `Cold (type error) ${label}`,
      reportProgress: true
    });
  ok(cold.code !== 0, `${label}: the cold build of a text with a type error must fail\n${describe(cold)}`);
  const errors = `${cold.stdout}\n${cold.stderr}`.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(workspace));
  ok(errors.length > 0, `${label}: the cold build reported no error in the workspace\n${describe(cold)}`);
  await invalidate(server, label);
  writeDescriptor({ kind: "full", moduleRecords: true });
  const before = existsSync(folder("program")) ? hashTree(folder("program")) : [];
  const started = performance.now();
  const result = await server.compile(incremental(programArguments(folder("program"))),
    `Program (type error) ${label}`, timeoutMs, workspace);
  const elapsed = performance.now() - started;
  const output = `${result.stdout}\n${result.stderr}`;
  ok(result.code !== 0, `${label}: the full request of a text with a type error must fail\n${describe(result)}`);
  for (const error of errors)
    ok(output.includes(error),
      `${label}: the full request must report the error of the cold build ${JSON.stringify(error)}\n${describe(result)}`);
  deepStrictEqual(existsSync(folder("program")) ? hashTree(folder("program")) : [], before,
    `${label}: a full request that failed with a type error changed the program tree`);
  return elapsed;
}

/** The diagnostic code of a full request that the init macro rule refuses (genes-v54c). */
const initMacroCode = "GENES-MODULE-REQUEST-003";

/** The refusal code of a module request that the init macro rule refuses (genes-v54c). */
const initMacroRefusal = "init-macro-before-genes";

/** The number of requests refused once for old text (genes-v54c), each as a step expected it. */
let initRefusals = 0;

/**
 * Runs the full request and returns its time and whether the init macro rule
 * refused it first. A refused full request must stop with
 * `GENES-MODULE-REQUEST-003`, leave the program tree as it was and write a
 * records report that stored nothing; the driver then sends it again, as a
 * session does. Without `initRefusal`, that refusal fails the gate at once;
 * the caller checks a refusal that did not happen after its tree check, so
 * that a run on older Genes sources shows the stale file first.
 */
async function programRequest(server: OwnedHaxeCompilerServer,
    label: string, race?: string,
    initRefusal = false): Promise<{ readonly ms: number, readonly refused: boolean }> {
  await invalidate(server, label);
  if (race !== undefined)
    writeFileSync(raceFlag, race);
  writeDescriptor({ kind: "full", moduleRecords: true });
  rmSync(`${descriptorFile}.module-records.json`, { force: true });
  clearRecordsText();
  const before = existsSync(folder("program")) ? hashTree(folder("program")) : [];
  const started = performance.now();
  let result = await server.compile(incremental(programArguments(folder("program"))),
    `Program ${label}`, timeoutMs, workspace);
  const refused = result.code !== 0
    && `${result.stdout}\n${result.stderr}`.includes(initMacroCode);
  ok(!refused || initRefusal,
    `${label}: the init macro rule refused the full request, which the step does not expect\n${describe(result)}`);
  if (refused) {
    deepStrictEqual(existsSync(folder("program")) ? hashTree(folder("program")) : [], before,
      `${label}: a full request that the init macro rule refused changed the program tree`);
    const report = readRecordsReport();
    strictEqual(report.stored, false, `${label}: a refused full request stored module records`);
    ok(String(report.reason).includes(initMacroCode),
      `${label}: the records report must name ${initMacroCode} (${String(report.reason)})`);
    initRefusals++;
    result = await server.compile(incremental(programArguments(folder("program"))),
      `Program again ${label}`, timeoutMs, workspace);
  }
  const elapsed = performance.now() - started;
  ok(result.code === 0, `${label}: full request failed\n${describe(result)}`);
  const records = `${descriptorFile}.module-records.json`;
  ok(existsSync(records), `${label}: the full request stored no module records`);
  strictEqual(readRecordsReport().stored, true,
    `${label}: the full request did not store its module records`);
  return { ms: elapsed, refused };
}

/**
 * Sends one editor request (`DisplayForm`) for `mr/Main.hx` to the server.
 * Haxe types the whole program and generates nothing. The forms without
 * the descriptor define have other defines than the full requests, so Haxe
 * types the macro classes of Genes again for them; the next full request
 * then starts Genes with new macro state, while Haxe keeps the modules of
 * the full requests in their own cache. The request must not fail, and it
 * must leave the program tree as it was.
 */
async function displayRequest(server: OwnedHaxeCompilerServer, form: DisplayForm,
    label: string): Promise<void> {
  const main = path.join(workspace, "src/mr/Main.hx");
  const args = programArguments(folder("display"));
  const request = form === "cli" ? `${main}@0@diagnostics` : JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "display/diagnostics", params: { file: main }
  });
  const before = existsSync(folder("program")) ? hashTree(folder("program")) : [];
  const result = await server.compile([...(form === "json-session" ? incremental(args) : args),
    "--display", request], `Display (${form}) ${label}`, timeoutMs, workspace);
  ok(result.code === 0, `${label}: the ${form} display request failed\n${describe(result)}`);
  ok(!`${result.stdout}\n${result.stderr}`.includes("GENES-"),
    `${label}: the ${form} display request reported a Genes diagnostic\n${describe(result)}`);
  deepStrictEqual(existsSync(folder("program")) ? hashTree(folder("program")) : [], before,
    `${label}: the ${form} display request changed the program tree`);
  ok(!existsSync(folder("display")) || publishedFiles(folder("display")).length === 0,
    `${label}: the ${form} display request published output`);
}

/** The part of the after-typing report of the last request that this gate reads. */
function readAfterTypingReport(): { readonly typedAgainModules: ReadonlyArray<string> } {
  return JSON.parse(readFileSync(`${descriptorFile}.after-typing.json`, "utf8")) as {
    readonly typedAgainModules: ReadonlyArray<string>
  };
}

/** The parts of the records report of the last full request that this gate reads. */
type RecordsReport = {
  readonly stored: boolean,
  readonly reason: string | null,
  readonly shapes: number,
  /** Modules whose records an accepted preview advanced since the full request before (genes-f8vc.14.8). */
  readonly advanced?: number,
  /** `none`, `equal`, `sources-changed`, or `differs: <first difference>` (genes-f8vc.14.8). */
  readonly advancedCheck?: string
};

function readRecordsReport(file = descriptorFile): RecordsReport {
  return JSON.parse(readFileSync(`${file}.module-records.json`, "utf8")) as RecordsReport;
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The median of a list of numbers, or 0 for an empty list. */
function median(values: ReadonlyArray<number>): number {
  if (values.length === 0)
    return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
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
  groupDce = group.dce ?? "full";
  groupMain = group.main ?? "mr.Main";
  groupArgsBeforeGenes = group.argsBeforeGenes ?? [];
  groupProgramRoots = group.programRoots ?? [];
  groupRootsBeforeGenes = group.rootsBeforeGenes === true;
  invalidateSaved = group.noInvalidate !== true;
  saved.clear();
}

/** Runs the module request of one step and checks its output; returns the outcome. */
async function moduleStep(server: OwnedHaxeCompilerServer,
    compiler: ReturnType<typeof selectedHaxeCompiler>, step: Step,
    label: string, base: ReadonlyArray<TreeEntry>): Promise<{
      outcome: string,
      ms: number,
      report: ModuleReport | null,
      /** The cold tree that a preview was compared with, for the full request's check. */
      cold?: ReadonlyArray<TreeEntry>
    }> {
  const module = step.module ?? "";
  const previewFolder = step.sameFolder === true ? folder("program") : folder("preview");
  const programBefore = hashTree(folder("program"));
  if (step.sameFolder !== true && step.keepFolder !== true)
    rmSync(previewFolder, { recursive: true, force: true });
  rmSync(reportFile, { force: true });
  clearRecordsText();
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
  if (step.flipOnModule !== undefined)
    writeFileSync(flipFlag, step.flipOnModule);
  writeDescriptor({ kind: "module", module });
  const started = performance.now();
  const result = await server.compile(incremental(moduleArguments(module, previewFolder)),
    `Module ${label}`, timeoutMs, workspace);
  const ms = performance.now() - started;
  if (step.flipOnModule !== undefined) {
    ok(!existsSync(flipFlag), `${label}: mr.Flip did not run`);
    ok(readFileSync(path.join(workspace, "src", step.flipOnModule.split("|")[0] ?? ""), "utf8")
      .includes(step.flipOnModule.split("|")[1] ?? "|"), `${label}: mr.Flip did not revert its save`);
  }
  if (step.fails === true) {
    rmSync(failFlag, { force: true });
    ok(result.code !== 0, `${label}: the module request must fail`);
    return { outcome: "failed", ms, report: null };
  }
  if (step.typeError === true) {
    ok(result.code !== 0, `${label}: the module request of a text with a type error must fail\n${describe(result)}`);
    ok(!`${result.stdout}\n${result.stderr}`.includes("GENES-"),
      `${label}: the module request must fail with the type error, not a Genes diagnostic\n${describe(result)}`);
    deepStrictEqual(publishedFiles(previewFolder), [],
      `${label}: a module request that failed with a type error published files`);
    return { outcome: "type-error", ms, report: null };
  }
  ok(result.code === 0, `${label}: module request failed\n${describe(result)}`);
  const report = readReport();
  strictEqual(report.kind, "module", `${label}: report kind`);
  strictEqual(report.module, module, `${label}: report module`);
  const outcome = report.result === "preview" ? "preview" : report.refusal ?? report.result;
  if (report.result === "preview" && step.programFails === true) {
    // A preview of a program that no longer compiles: cold has no tree.
    if (step.previewWhileProgramFails === true)
      return { outcome: "preview-program-fails", ms, report };
    ok(observe, `${label}: a preview was published although the program does not compile`);
    return { outcome: "STALE cold fails", ms, report };
  }
  if (report.result === "preview") {
    const coldTree = await coldBuild(compiler, label);
    // The preview holds the module's files and the manifest, nothing else.
    const published = publishedFiles(previewFolder);
    deepStrictEqual(published, [...report.files].sort(),
      `${label}: the preview folder holds other files than the report names`);
    ok(published.length > 0, `${label}: the preview published no file`);
    const prefix = module.split(".").join("/");
    const stale: string[] = [];
    for (const file of published) {
      ok(file === `${prefix}.ts` || file.startsWith(`${prefix}.`),
        `${label}: ${file} is not a file of ${module}`);
      const coldFile = path.join(folder("cold"), file);
      const same = existsSync(coldFile)
        && readFileSync(path.join(previewFolder, file)).equals(readFileSync(coldFile));
      if (observe && !same)
        stale.push(file);
      else {
        ok(existsSync(coldFile), `${label}: the cold build has no ${file}`);
        ok(same, `${label}: ${file} of the preview differs from the cold build`);
      }
    }
    // The tree check (review of genes-ts #250): an accepted preview is the
    // only change that the edit makes. Cold must differ from the tree of the
    // sources before the edit (`base`: the last full tree, or after previews
    // in a row the cold tree of the step before, genes-f8vc.14.8) only in
    // the module's own files (and their maps); a change of any other file
    // means that the published tree goes stale until the next full request.
    const others = treeDifference(base, coldTree)
      .filter((file) => !file.startsWith(".genes-output-"))
      .filter((file) => !(file === `${prefix}.ts` || file.startsWith(`${prefix}.`)));
    if (observe && (stale.length > 0 || others.length > 0))
      return { outcome: `STALE ${[...stale, ...others].join(" ")}`, ms, report, cold: coldTree };
    deepStrictEqual(others, [],
      `${label}: the preview was accepted, but cold also changes other files `
      + `than those of ${module}:\n${others.join("\n")}`);
    treeChecks++;
    return { outcome, ms, report, cold: coldTree };
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
  let server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  let previews = 0;
  let refusals = 0;
  try {
    await programRequest(server, `${group.name} first`);
    // The records text after the last request (genes-f8vc.14.8): a refused
    // module request must leave it as it is, and the records that a preview
    // advanced must equal the records of the full request after it.
    let records = readRecordsText();
    ok(observe || records !== null, `${group.name}: the first full request wrote no records text`);
    // The tree that a session shows before the next step: the last full
    // tree and every preview accepted since, that is the cold tree of the
    // last accepted preview (previews in a row, genes-f8vc.14.8). A refused
    // step shows nothing, so it leaves this tree as it is.
    let base: ReadonlyArray<TreeEntry> = hashTree(folder("program"));
    for (const [index, step] of group.steps.entries()) {
      const label = `[${group.name} ${index + 1}/${group.steps.length}] ${step.id}`;
      if (step.restartServer === true) {
        await server.stop();
        server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
        // A new process holds no records.
        records = null;
      }
      if (step.display?.when === "before-save")
        await displayRequest(server, step.display.form, label);
      step.apply();
      if (step.coldWithDescriptor === true) {
        const cold = await runBoundedProcess(compiler.binary,
          incremental(programArguments(folder("cold-session"))),
          { cwd: workspace, timeoutMs, label: `Cold with the descriptor ${label}` });
        ok(cold.code === 0, `${label}: the cold run with the descriptor failed\n${describe(cold)}`);
      }
      if (step.display?.when === "after-save")
        await displayRequest(server, step.display.form, label);
      if (step.settleMs !== undefined)
        await sleep(step.settleMs);
      const load = loadPerCpu();
      let outcome = "-";
      let moduleMs = 0;
      let report: ModuleReport | null = null;
      let previewCold: ReadonlyArray<TreeEntry> | undefined;
      /** The records text after this step's accepted preview (genes-f8vc.14.8). */
      let advancedRecords: string | null = null;
      if (step.module !== undefined) {
        const before = base;
        let done = await moduleStep(server, compiler, step, label, before);
        const moduleRefusal = step.initRefusal === "module" || step.initRefusal === "both";
        strictEqual(done.outcome === initMacroRefusal, moduleRefusal, moduleRefusal
          ? `${label}: the init macro rule did not refuse the module request (got ${done.outcome})`
          : `${label}: the init macro rule refused the module request, which the step does not expect `
            + `(${String(done.report?.reason)})`);
        if (moduleRefusal) {
          // The refused request published nothing (`moduleStep`); a session
          // sends it again.
          initRefusals++;
          done = await moduleStep(server, compiler, step, `${label} (sent again)`, before);
        }
        outcome = done.outcome;
        moduleMs = done.ms;
        report = done.report;
        previewCold = done.cold;
        if (step.expect !== undefined && !observe) {
          const allowed = typeof step.expect === "string" ? [step.expect] : step.expect;
          ok(allowed.includes(outcome),
            `${label}: expected ${allowed.join(" or ")}, got ${outcome} (${String(report?.reason)})`);
        }
        if (step.check !== undefined && !observe) {
          ok(report !== null, `${label}: the module request wrote no report to check`);
          step.check(report, label);
        }
        if (outcome === "preview")
          previews++;
        else
          refusals++;
        if (!observe && report !== null) {
          const after = readRecordsText();
          if (report.result === "preview" && report.records !== "advanced") {
            // The module of the `--main` class keeps the records of the full
            // request (a full request marks its main function `@:keep`).
            ok(String(report.records).startsWith("kept: "),
              `${label}: an accepted preview must advance the records (${String(report.records)})`);
            if (records !== null)
              sameRecords(after, records, label, "preview that keeps the records", "request before it");
          } else if (report.result === "preview") {
            advancedRecords = after;
          } else if (report.refusal === "no-records") {
            // This macro state holds no records (a new server, or Haxe typed
            // the macro classes of Genes again): nothing to keep.
            ok(after === null || after.startsWith("records none"),
              `${label}: a request refused with no-records wrote records`);
          } else if (records !== null) {
            // A refused preview leaves no advanced record.
            strictEqual(report.records, "kept",
              `${label}: a refused module request must keep the records (${String(report.records)})`);
            sameRecords(after, records, label, "refused module request", "request before it");
          }
          if (after !== null)
            records = after;
        }
      }
      step.afterModule?.();
      if (previewCold !== undefined)
        base = previewCold;
      let programMs = 0;
      if (step.skipProgram !== true && (step.typeError === true || step.programFails === true)) {
        programMs = await failingProgramRequest(server, compiler, label);
      } else if (step.skipProgram !== true) {
        // The cold build of the preview check holds the same sources, unless
        // the step changes a file after the module request.
        const strip = step.stripOnFull;
        if (strip !== undefined) {
          ok(step.module === undefined, `${label}: stripOnFull needs a step without a module request`);
          writeFileSync(stripFlag, strip);
        }
        const coldTree = previewCold !== undefined && step.afterModule === undefined
          ? previewCold : await coldBuild(compiler, label);
        if (strip !== undefined) {
          ok(!existsSync(stripFlag), `${label}: mr.Strip did not run in the cold build`);
          writeFileSync(stripFlag, strip);
        }
        const fullRefusal = step.initRefusal === "full" || step.initRefusal === "both";
        const program = await programRequest(server, label, step.raceOnFull, fullRefusal);
        if (strip !== undefined) {
          const [file, from] = strip.split("|");
          ok(!existsSync(stripFlag), `${label}: mr.Strip did not run in the full request`);
          ok(readFileSync(path.join(workspace, "src", file ?? ""), "utf8").includes(from ?? "|"),
            `${label}: mr.Strip did not put the file back`);
        }
        programMs = program.ms;
        const difference = treeDifference(hashTree(folder("program")), coldTree);
        deepStrictEqual(difference, [],
          `${label}: the full request after the step differs from the cold build:\n`
          + difference.join("\n"));
        ok(observe || program.refused || !fullRefusal,
          `${label}: the init macro rule did not refuse the full request`);
        base = hashTree(folder("program"));
        if (!observe) {
          // The program request stays the authority: its records replace the
          // advanced ones, and for the same sources they must be equal
          // (genes-f8vc.14.8), in its own check and in the plain text.
          const full = readRecordsText();
          rootEmptyInOrder(full, label);
          const check = readRecordsReport().advancedCheck ?? "<absent>";
          if (advancedRecords !== null && step.afterModule === undefined && step.raceOnFull === undefined) {
            sameRecords(advancedRecords, full, label, "preview", "full request");
            strictEqual(check, "equal",
              `${label}: the full request after a preview must check the advanced records`);
          }
          ok(!check.startsWith("differs"), `${label}: the full request found advanced records that `
            + `differ from its own: ${check}`);
          records = full;
        }
        if (step.fullTypedAgain !== undefined)
          strictEqual(readRecordsReport().shapes, step.fullTypedAgain,
            `${label}: Haxe typed another number of modules again in the full request`);
        if (step.fullTypedAgainModules !== undefined)
          deepStrictEqual(readAfterTypingReport().typedAgainModules, step.fullTypedAgainModules,
            `${label}: Haxe typed other modules again in the full request`);
      }
      rows.push({
        group: group.name,
        id: step.id,
        result: outcome,
        typedAgain: report === null ? "" : report.typedAgainModules.join(" "),
        moduleMs: Math.round(moduleMs),
        genesMs: report === null ? 0 : report.generationMs,
        digestMs: report === null ? null : report.digestMs,
        sources: report === null || report.trustedSources === undefined ? ""
          : `${report.trustedSources}/${(report.hashedSources ?? []).length}`,
        programMs: Math.round(programMs),
        load: Number(load.toFixed(2))
      });
    }
  } finally {
    await server.stop();
  }
  return { previews, refusals };
}

/** The number of rounds of `--chain`; each round makes 20 chains of five edits from a new copy of the sweep program. */
const CHAIN_ROUNDS = 5;
const CHAINS_PER_ROUND = 20;
const CHAIN_LENGTH = 5;

/**
 * `--chain-rounds=<n>` and `--chain-limit=<n>` run only the first rounds and
 * the first chains of each round (diagnostic, for example red evidence with
 * `--observe`); the gate runs every round and chain.
 */
function chainOption(name: string, fallback: number): number {
  const text = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const value = text === undefined ? fallback : Number.parseInt(text, 10);
  ok(Number.isInteger(value) && value > 0, `--${name} needs a positive whole number`);
  return value;
}

/** A deterministic generator of numbers in [0, 1) (mulberry32), so that a plan never depends on the run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The plan of one round of `--chain`: 20 chains of five sweep modules; the
 * edits of each module are made in order (`sweepEdits`). `kinds` counts the
 * steps by kind: `same` (the module of the step before), `importer` (the
 * module imports a module that the chain edited before) and `other`.
 * `blocked` counts the candidates that the planner skipped because their
 * program holds a module that Haxe must type again (see `chainPreviews`).
 */
type ChainPlan = {
  readonly chains: ReadonlyArray<ReadonlyArray<SweepModule>>,
  /** The counts of each chain, in the order of `chains`. */
  readonly counts: ReadonlyArray<Readonly<Record<"same" | "importer" | "other" | "blocked", number>>>
};

/** The sweep modules that `spec` imports after `applied` of its edits (the third edit adds `next`). */
function sweepImports(spec: SweepModule, applied: number): ReadonlyArray<string> {
  const known = new Set(sweepModules.map(sweepModulePath));
  return [...spec.uses, ...(applied >= 3 ? [spec.next] : [])].filter((name) => known.has(name));
}

/**
 * Returns true when the module request after the next edit of `spec` can
 * preview inside a chain, as Haxe 4.3.7's module cache decides it
 * (`check_module` in `server.ml`, genes-f8vc.14.8). Haxe keeps a cached
 * module only when every module that it depends on is the one it was typed
 * against and is clean itself; a module that an accepted preview typed stays
 * clean until the next request that is not a module request. `typedAt` holds
 * the step at which a preview of the chain typed each module; a module that
 * the chain did not edit has -1 (the full request before the chain). A
 * module whose import was typed later than itself is typed again by Haxe,
 * and the request is refused (`other-modules-typed`): the limit of the rule.
 */
function chainPreviews(spec: SweepModule, applied: ReadonlyMap<string, number>,
    typedAt: ReadonlyMap<string, number>): boolean {
  const byPath = new Map(sweepModules.map((item) => [sweepModulePath(item), item]));
  function clean(name: string): boolean {
    const item = byPath.get(name);
    if (item === undefined)
      return true;
    const at = typedAt.get(name) ?? -1;
    return sweepImports(item, applied.get(name) ?? 0)
      .every((dependency) => (typedAt.get(dependency) ?? -1) <= at && clean(dependency));
  }
  return sweepImports(spec, (applied.get(sweepModulePath(spec)) ?? 0) + 1).every(clean);
}

/**
 * Plans one round of `--chain`. Round 0 edits one module five times in each
 * chain. The other rounds mix modules: at each step the planner takes, in a
 * seeded random order with the modules that have the most edits left first,
 * the first module whose request can preview (`chainPreviews`); it tries
 * other seeds until all 100 edits fit in 20 chains of five.
 */
function planChainRound(round: number): ChainPlan {
  if (round === 0)
    return {
      chains: sweepModules.map((spec) => Array.from({ length: CHAIN_LENGTH }, () => spec)),
      counts: sweepModules.map(() => ({ same: CHAIN_LENGTH - 1, importer: 0, other: 1, blocked: 0 }))
    };
  for (let attempt = 0; attempt < 5_000; attempt++) {
    const random = seededRandom(round * 100_003 + attempt);
    const applied = new Map<string, number>();
    const chains: SweepModule[][] = [];
    const counts: Array<Record<"same" | "importer" | "other" | "blocked", number>> = [];
    let complete = true;
    for (let index = 0; index < CHAINS_PER_ROUND && complete; index++) {
      const typedAt = new Map<string, number>();
      const chain: SweepModule[] = [];
      const kinds = { same: 0, importer: 0, other: 0, blocked: 0 };
      for (let step = 0; step < CHAIN_LENGTH; step++) {
        const left = (spec: SweepModule) => sweepEdits(spec).length - (applied.get(sweepModulePath(spec)) ?? 0);
        const order = sweepModules.filter((spec) => left(spec) > 0)
          .map((spec) => ({ spec, key: random() }))
          .sort((a, b) => left(b.spec) - left(a.spec) || a.key - b.key)
          .map((item) => item.spec);
        const picked = order.find((spec) => chainPreviews(spec, applied, typedAt));
        kinds.blocked += picked === undefined ? order.length : order.indexOf(picked);
        if (picked === undefined) {
          complete = false;
          break;
        }
        const name = sweepModulePath(picked);
        const previous = chain[chain.length - 1];
        if (previous === picked)
          kinds.same++;
        else if (sweepImports(picked, (applied.get(name) ?? 0) + 1).some((dependency) => typedAt.has(dependency)))
          kinds.importer++;
        else
          kinds.other++;
        chain.push(picked);
        applied.set(name, (applied.get(name) ?? 0) + 1);
        typedAt.set(name, step);
      }
      chains.push(chain);
      counts.push(kinds);
    }
    if (complete)
      return { chains, counts };
  }
  throw new Error(`--chain: no plan for round ${round}`);
}

/** Sends `server/invalidate` for each of `files` to one server. */
async function invalidateFiles(server: OwnedHaxeCompilerServer, files: ReadonlyArray<string>,
    label: string): Promise<void> {
  for (const file of files) {
    const result = await server.compile(["--display", JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "server/invalidate", params: { file }
    })], `Invalidate ${path.basename(file)} ${label}`, timeoutMs, workspace);
    ok(result.code === 0, `${label}: server/invalidate failed\n${describe(result)}`);
  }
}

/**
 * The full request of the reference server of `--chain`: a second warm
 * server with its own descriptor and its own output folder at the same
 * depth, which runs a full request after every edit. Its records are the
 * records that a full request writes for the sources of that moment.
 */
async function referenceRequest(server: OwnedHaxeCompilerServer, files: ReadonlyArray<string>,
    label: string): Promise<{ readonly tree: ReadonlyArray<TreeEntry>, readonly records: string | null }> {
  const descriptor = path.join(tempRoot, "reference.json");
  await invalidateFiles(server, files, label);
  writeDescriptor({ kind: "full", moduleRecords: true }, descriptor);
  clearRecordsText(descriptor);
  const result = await server.compile(incremental(programArguments(folder("reference")), descriptor),
    `Reference ${label}`, timeoutMs, workspace);
  ok(result.code === 0, `${label}: the reference full request failed\n${describe(result)}`);
  strictEqual(readRecordsReport(descriptor).stored, true, `${label}: the reference full request stored no records`);
  return { tree: hashTree(folder("reference")), records: readRecordsText(descriptor) };
}

/**
 * `--chain` (genes-f8vc.14.8): 100 chains of five structural edits of the
 * sweep program (`-dce std`), with no full request inside a chain.
 *
 * Why: a development session sends a module request for each save, and the
 * full request only after a quiet time. Without records that advance, the
 * second save of a chain was compared with the records of the last full
 * request and refused (`source-changed`, `other-modules-typed`).
 *
 * How: each round starts from a new copy of the sweep program with two warm
 * servers: the chain server and a reference server. After each edit the
 * chain server runs the module request, and a cold build and a full request
 * of the reference server run at the same time. Each step must preview, as
 * `chainPreviews` plans it; the preview's files must be byte-identical to
 * cold, cold must change no other file than the module's own since the step
 * before, the reference tree must equal cold, and the records text that the
 * module request wrote must equal the records text of the reference full
 * request. After each chain the chain server runs a full request, which must
 * equal cold, find the advanced records equal to its own
 * (`advancedCheck: equal`) and write the reference's records text.
 */
async function runChains(compiler: ReturnType<typeof selectedHaxeCompiler>): Promise<void> {
  const rounds = chainOption("chain-rounds", CHAIN_ROUNDS);
  const limit = chainOption("chain-limit", CHAINS_PER_ROUND);
  const moduleTimes: number[] = [];
  let previews = 0;
  let chains = 0;
  const totals = { same: 0, importer: 0, other: 0 };
  let blocked = 0;
  /** `--observe`: the result of each step, by step number in its chain. */
  const observed = new Map<string, number>();
  for (let round = 0; round < rounds; round++) {
    const plan = planChainRound(round);
    // Only the chains that run count (`--chain-limit`).
    for (const counts of plan.counts.slice(0, limit)) {
      totals.same += counts.same;
      totals.importer += counts.importer;
      totals.other += counts.other;
      blocked += counts.blocked;
    }
    prepare({ name: `chain-${round}`, dce: "std", main: "ui.Main", files: sweepFiles(), steps: [] });
    const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
    const reference = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
    try {
      await programRequest(server, `chain ${round} first`);
      const first = await referenceRequest(reference, [], `chain ${round} first`);
      if (!observe)
        sameRecords(readRecordsText(), first.records, `chain ${round} first`, "full request", "reference full request");
      // The tree that the sources of the last step give (cold).
      let expected = await coldBuild(compiler, `chain ${round} first`);
      deepStrictEqual(treeDifference(hashTree(folder("program")), expected), [],
        `chain ${round}: the first full request differs from cold`);
      const applied = new Map<string, number>();
      for (const [index, chain] of plan.chains.slice(0, limit).entries()) {
        chains++;
        const edited = new Set<string>();
        let last: { readonly tree: ReadonlyArray<TreeEntry>, readonly records: string | null } = first;
        for (const [step, spec] of chain.entries()) {
          const name = sweepModulePath(spec);
          const count = applied.get(name) ?? 0;
          const edit = sweepEdits(spec)[count];
          ok(edit !== undefined, `chain ${round}.${index + 1}: ${name} has no edit left`);
          const label = `[chain ${round}.${index + 1} ${step + 1}/${chain.length}] ${edit.id}`;
          edit.apply();
          applied.set(name, count + 1);
          edited.add(name);
          const files = [...saved];
          rmSync(folder("preview"), { recursive: true, force: true });
          rmSync(reportFile, { force: true });
          clearRecordsText();
          await invalidate(server, label);
          writeDescriptor({ kind: "module", module: name });
          const started = performance.now();
          const result = await server.compile(incremental(moduleArguments(name, folder("preview"))),
            `Module ${label}`, timeoutMs, workspace);
          moduleTimes.push(performance.now() - started);
          ok(result.code === 0, `${label}: module request failed\n${describe(result)}`);
          const report = readReport();
          const records = readRecordsText();
          const [cold, referenced] = await Promise.all([
            coldBuild(compiler, label),
            referenceRequest(reference, files, label)
          ]);
          const outcome = report.result === "preview" ? "preview" : String(report.refusal);
          if (observe) {
            const key = `step ${step + 1}: ${outcome}`;
            observed.set(key, (observed.get(key) ?? 0) + 1);
            process.stdout.write(`${label} | ${outcome} | ${String(report.reason)}\n`);
            if (outcome !== "preview") {
              expected = cold;
              last = referenced;
              continue;
            }
          }
          strictEqual(outcome, "preview",
            `${label}: a module request inside a chain must preview (${String(report.reason)})`);
          if (!observe)
            strictEqual(report.records, "advanced", `${label}: the preview did not advance the records`);
          const prefix = name.split(".").join("/");
          const published = publishedFiles(folder("preview"));
          deepStrictEqual(published, [...report.files].sort(),
            `${label}: the preview folder holds other files than the report names`);
          ok(published.length > 0, `${label}: the preview published no file`);
          for (const file of published) {
            ok(file === `${prefix}.ts` || file.startsWith(`${prefix}.`), `${label}: ${file} is not a file of ${name}`);
            const coldFile = path.join(folder("cold"), file);
            ok(existsSync(coldFile) && readFileSync(path.join(folder("preview"), file)).equals(readFileSync(coldFile)),
              `${label}: ${file} of the preview differs from the cold build`);
          }
          const others = treeDifference(expected, cold)
            .filter((file) => !file.startsWith(".genes-output-"))
            .filter((file) => !(file === `${prefix}.ts` || file.startsWith(`${prefix}.`)));
          deepStrictEqual(others, [], `${label}: cold also changes other files than those of ${name}:\n`
            + others.join("\n"));
          deepStrictEqual(treeDifference(referenced.tree, cold), [],
            `${label}: the reference full request differs from cold`);
          if (!observe)
            sameRecords(records, referenced.records, label, "preview", "reference full request");
          expected = cold;
          last = referenced;
          previews++;
          treeChecks++;
        }
        // The program request stays the authority (genes-f8vc.14.8).
        const label = `[chain ${round}.${index + 1}] full request after the chain`;
        await programRequest(server, label);
        deepStrictEqual(treeDifference(hashTree(folder("program")), expected), [],
          `${label}: the full request after the chain differs from cold`);
        if (!observe) {
          const report = readRecordsReport();
          strictEqual(report.advancedCheck, "equal", `${label}: the advanced records differ from the full request's`);
          strictEqual(report.advanced, edited.size,
            `${label}: the full request found another number of advanced modules`);
          sameRecords(readRecordsText(), last.records, label, "full request", "reference full request");
        }
      }
    } finally {
      await server.stop();
      await reference.stop();
    }
  }
  if (observe) {
    process.stdout.write(`compiler-server-module:chain-observe (${chains} chains; results by step: `
      + `${[...observed.entries()].sort().map(([key, count]) => `${key} ${count}`).join(", ")})\n`);
    return;
  }
  process.stdout.write(`chain steps: ${totals.same} the same module as the step before, ${totals.importer} `
    + `a module that imports a module that the chain edited before, ${totals.other} other; the planner `
    + `skipped ${blocked} candidates whose program holds a module that Haxe must type again\n`);
  process.stdout.write(`chain module requests: median ${median(moduleTimes).toFixed(0)} ms over ${moduleTimes.length} `
    + `(diagnostic)\n`);
  process.stdout.write(`compiler-server-module:${chains === CHAIN_ROUNDS * CHAINS_PER_ROUND ? "chain" : "chain-partial"} `
    + `(Haxe ${compiler.version}; ${chains} chains `
    + `of ${CHAIN_LENGTH} edits with no full request inside a chain; ${previews} previews byte-identical to cold, `
    + `each with records equal to the records of a full request for the same sources; every full request after a `
    + `chain equal to cold and to the advanced records)\n`);
}

async function main(): Promise<void> {
  const compiler = selectedHaxeCompiler(repoRoot);
  const rows: Row[] = [];
  let previews = 0;
  let refusals = 0;
  if (chainMode) {
    await runChains(compiler);
    return;
  }
  const selectedGroups = sweep ? [sweepGroup()] : groups.filter((group) => only === undefined
    || group.name.includes(only));
  for (const group of selectedGroups) {
    const counts = await runGroup(group, compiler, rows);
    previews += counts.previews;
    refusals += counts.refusals;
  }
  process.stdout.write("group | step | result | typed again | module request ms | "
    + "Genes ms | source ms | trusted/read | full request ms | load per CPU\n");
  for (const row of rows)
    process.stdout.write(`${row.group} | ${row.id} | ${row.result} | ${row.typedAgain} | `
      + `${row.moduleMs} | ${row.genesMs} | ${row.digestMs ?? "-"} | ${row.sources} | `
      + `${row.programMs} | ${row.load}\n`);
  const digests = rows.flatMap((row) => row.digestMs === null ? [] : [row.digestMs]);
  const loads = rows.map((row) => row.load);
  process.stdout.write(`module request source time (digestMs): median ${median(digests).toFixed(2)} ms `
    + `over ${digests.length} module requests; median load per CPU ${median(loads).toFixed(2)} `
    + `(diagnostic only)\n`);
  if (sweep) {
    // The sweep summary: refusals by code, and the times of the previews
    // with the size of each module (diagnostic; the load is in each row).
    const byCode = new Map<string, number>();
    for (const row of rows)
      byCode.set(row.result, (byCode.get(row.result) ?? 0) + 1);
    const previewRows = rows.filter((row) => row.result === "preview");
    const sizes = new Map(sweepModules.map((spec) => [spec.name,
      readFileSync(path.join(workspace, "src/ui", spec.pack, `${spec.name}.hx`), "utf8").split("\n").length]));
    process.stdout.write(`sweep results: ${[...byCode.entries()].map(([code, count]) => `${code} ${count}`).join(", ")}\n`);
    process.stdout.write(`sweep previews: median module request ${median(previewRows.map((row) => row.moduleMs)).toFixed(0)} ms, `
      + `median Genes ${median(previewRows.map((row) => row.genesMs)).toFixed(0)} ms over ${previewRows.length} previews; `
      + `module sizes ${Math.min(...sizes.values())}-${Math.max(...sizes.values())} lines at the end; `
      + `median load per CPU ${median(rows.map((row) => row.load)).toFixed(2)} (diagnostic)\n`);
  }
  let control = "keep control skipped";
  if (keepControl)
    control = await runKeepControl(compiler);
  if (observe) {
    process.stdout.write(`compiler-server-module:observe (results recorded, not checked; `
      + `${rows.filter((row) => row.result.startsWith("STALE")).length} stale previews)\n`);
    return;
  }
  process.stdout.write(`compiler-server-module:${only === undefined ? "ok" : "partial"} `
    + `(Haxe ${compiler.version}; ${selectedGroups.length} groups; ${previews} `
    + `previews byte-identical to cold, ${refusals} refused or failed as expected, `
    + `every full request after a step equal to cold; tree check on ${treeChecks} `
    + `previews: cold changes only the previewed module's files; ${initRefusals} `
    + `requests refused once because Haxe may have typed old text (genes-v54c), `
    + `as their steps expected, and equal to cold when sent again; ${control})\n`);
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
