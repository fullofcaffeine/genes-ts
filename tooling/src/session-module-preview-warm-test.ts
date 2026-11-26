/**
 * Acceptance gate of the module-first path (genes-f8vc.14.3) with the real
 * Haxe compiler server and the real Genes generator.
 *
 * Why: the module-first path shows the edited module before the program
 * request ends. Its value depends on how often Genes admits a preview for
 * ordinary UI edits, and its safety on the rule that every preview equals
 * the program result. A controlled compiler cannot show either.
 *
 * What: a project of UI-like modules (each at most 150 lines, `-dce std`,
 * no source maps, as a development build) runs in a real session with
 * `generationReuse` and `modulePreview`. The HXML has every kind of root
 * that a module request must leave out: `--main`, a class name, and
 * `--macro include(...)`. The test then:
 *
 * - makes 30 scripted edits over 10 modules (a text, a new attribute, a new
 *   private function with a call, a new local), waiting for the accepted
 *   generation of each, and requires a preview for at least 90% of them;
 * - requires that every preview is confirmed: its bytes equal the program
 *   result (also compared again with the published file);
 * - compares the public tree with a cold build after edits 1, 10, 20 and 30;
 * - makes a shape-changing edit (refused by Genes, pending until the program
 *   request), a type error (refused by the session, then repaired) and a
 *   save of two modules at once (refused by the session), and requires that
 *   each leaves no stale file: no private folder stays, and the tree equals
 *   cold;
 * - prints the time to the preview against the time to the accepted
 *   generation (`summarizePreviewTimings`), from the session's events and
 *   from the test's own write times.
 *
 * Timings are printed, not judged: a timing claim needs a quiet machine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os, { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createGenesDevelopmentSession,
  summarizePreviewTimings,
  type DevelopmentEvent,
  type JsonValue,
} from "./session/index.js";

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const haxeVersion = execFileSync("haxe", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const haxeExecutable =
  process.env.HAXE_STD_PATH === undefined
    ? path.join(homedir(), "haxe", "versions", haxeVersion, process.platform === "win32" ? "haxe.exe" : "haxe")
    : path.join(path.dirname(process.env.HAXE_STD_PATH), process.platform === "win32" ? "haxe.exe" : "haxe");
const helderSourceRoot = realpathSync.native(
  execFileSync("haxelib", ["path", "helder.set"], { cwd: repositoryRoot, encoding: "utf8" })
    .split(/\r?\n/u)
    .find((line) => line.length > 0 && !line.startsWith("-"))!,
);
const genesVersion = (
  JSON.parse(readFileSync(path.join(repositoryRoot, "haxelib.json"), "utf8")) as { readonly version: string }
).version;
const genesSourceRoot = path.join(repositoryRoot, "src");
const projectRoot = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "genes-session-preview-")));
const buildTimeoutMs = 240_000;

/** One edited UI module of the fixture. */
interface UiModule {
  readonly pack: string;
  readonly name: string;
  readonly uses: readonly string[];
  /** Extra private functions, so that the sizes differ (all at most 150 lines). */
  readonly fillers: number;
}

const uiModules: readonly UiModule[] = [
  { pack: "controls", name: "Button", uses: [], fillers: 0 },
  { pack: "controls", name: "Badge", uses: [], fillers: 6 },
  { pack: "controls", name: "Avatar", uses: [], fillers: 12 },
  { pack: "controls", name: "Chip", uses: [], fillers: 18 },
  { pack: "layout", name: "Card", uses: ["ui.controls.Button"], fillers: 3 },
  { pack: "layout", name: "Panel", uses: ["ui.controls.Badge"], fillers: 9 },
  { pack: "layout", name: "Stack", uses: ["ui.controls.Avatar"], fillers: 15 },
  { pack: "views", name: "Dashboard", uses: ["ui.layout.Card", "ui.controls.Button"], fillers: 2 },
  { pack: "views", name: "Settings", uses: ["ui.layout.Panel", "ui.controls.Chip"], fillers: 8 },
  { pack: "views", name: "Profile", uses: ["ui.layout.Stack", "ui.controls.Avatar"], fillers: 20 },
];

function shortName(module: string): string {
  return module.split(".").at(-1) ?? module;
}

function relativeFile(module: UiModule): string {
  return `ui/${module.pack}/${module.name}.hx`;
}

/** The text of one UI module: a render function that builds markup-like strings. */
function uiModuleText(module: UiModule): string {
  const imports = ["ui.core.Theme", "ui.core.Text", "ui.core.Html", "ui.core.Kind", ...module.uses]
    .map((name) => `import ${name};\n`).join("");
  const props = `${module.name}Props`;
  const parts = ["header(props)", "body(props)", ...module.uses.map((name) => `${shortName(name)}.summary()`)];
  const fillers = Array.from({ length: module.fillers }, (_, index) =>
    `  static function row${index}(value: Int): String {\n`
    + `    return '${module.name} row ' + (value + ${index}) + ' ' + Theme.spacing();\n  }\n`).join("\n");
  const id = module.name.toLowerCase();
  return `package ui.${module.pack};\n\n${imports}\n`
    + `typedef ${props} = {\n  final label: String;\n  final kind: Kind;\n  final count: Int;\n}\n\n`
    + `/** ${module.name}: a UI-like module of the module-first gate. */\n`
    + `class ${module.name} {\n`
    + `  public static function render(props: ${props}): String {\n`
    + `    final parts = [${parts.join(", ")}];\n    // edit-anchor\n`
    + `    return Html.el('section', {className: '${id}-root', role: 'region'}, parts);\n  }\n\n`
    + `  public static function summary(): String {\n`
    + `    return render({label: '${module.name}', kind: Kind.Small, count: ${module.fillers}});\n  }\n\n`
    + `  static function header(props: ${props}): String {\n`
    + `    return Html.el('h2', {className: '${id}-title'}, [Text.title(props.label + ' text-0'), Theme.color()]);\n  }\n\n`
    + `  static function body(props: ${props}): String {\n    return switch props.kind {\n`
    + `      case Small: 'small ' + props.count;\n      case Large: 'large ' + props.count;\n    }\n  }\n\n`
    + `  static function spare(props: ${props}): String {\n    return 'spare ' + props.label;\n  }\n`
    + (fillers.length > 0 ? `\n${fillers}` : "")
    + `}\n`;
}

const fixedFiles: Readonly<Record<string, string>> = {
  "ui/Main.hx": `package ui;\n\nimport ui.app.App;\n\nclass Main {\n  static function main() {\n    trace(App.summary());\n  }\n}\n`,
  "ui/app/App.hx": `package ui.app;\n\nimport ui.views.Dashboard;\nimport ui.views.Settings;\nimport ui.views.Profile;\nimport ui.layout.Panel;\nimport ui.controls.Chip;\n\n`
    + `class App {\n  public static function summary(): String {\n`
    + `    return [Dashboard.summary(), Settings.summary(), Profile.summary(), Panel.summary(), Chip.summary()].join('\\n');\n  }\n}\n`,
  "ui/core/Theme.hx": `package ui.core;\n\nclass Theme {\n  public static function color(): String {\n    return 'blue';\n  }\n\n`
    + `  public static function spacing(): Int {\n    return 4;\n  }\n}\n`,
  "ui/core/Text.hx": `package ui.core;\n\nclass Text {\n  public static function title(text: String): String {\n`
    + `    return StringTools.trim(text).toUpperCase();\n  }\n}\n`,
  "ui/core/Kind.hx": `package ui.core;\n\nenum Kind {\n  Small;\n  Large;\n}\n`,
  "ui/core/Html.hx": `package ui.core;\n\nclass Html {\n`
    + `  public static function el(tag: String, attributes: haxe.DynamicAccess<String>, children: Array<String>): String {\n`
    + `    final names = attributes.keys();\n    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);\n`
    + `    final text = [for (name in names) name + '="' + attributes.get(name) + '"'].join(' ');\n`
    + `    return '<' + tag + (text.length > 0 ? ' ' + text : '') + '>' + children.join('') + '</' + tag + '>';\n  }\n}\n`,
  // In no program until the last phase names it as a class-name root.
  "ui/core/Format.hx": `package ui.core;\n\nclass Format {\n  public static function summary(): String {\n    return 'format ' + Theme.spacing();\n  }\n}\n`,
};

const programArguments = [
  `-cp ${genesSourceRoot}`,
  `-cp ${helderSourceRoot}`,
  "-D helder.set=0.3.1",
  `-D genes-ts=${genesVersion}`,
  "--macro genes.Generator.use()",
  "-cp src",
  "--main ui.Main",
  // Roots that a module request must leave out. Each one types modules that
  // import the edited controls and layouts (the views); a module request
  // that kept them would make Haxe type those importers again, and Genes
  // would refuse every preview (`other-modules-typed`).
  "ui.views.Profile",
  "--macro include('ui.views')",
  "-D js-es=6",
  "-D no-deprecation-warnings",
  "-D genes.ts",
  "-dce std",
];

/** Returns the sorted relative paths and SHA-256 digests of a tree. */
function treeDigest(root: string): string[] {
  const entries: string[] = [];
  const walk = (relative: string): void => {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      const child = relative.length === 0 ? name : `${relative}/${name}`;
      const absolute = path.join(root, child);
      if (statSync(absolute).isDirectory()) walk(child);
      else entries.push(`${child} ${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
    }
  };
  walk("");
  return entries;
}

/** Builds the current sources in a new Haxe process, at the depth of a session candidate. */
function coldTree(label: string): string[] {
  const coldParent = path.join(projectRoot, "cold");
  const coldRoot = path.join(coldParent, "same", "depth", "as", "candidate");
  rmSync(coldParent, { recursive: true, force: true });
  const result = spawnSync(
    haxeExecutable,
    ["build.hxml", "--js", path.join(projectRoot, "cold-haxe-target", "compiler.js"), "-D", `genes.output=${path.join(coldRoot, "index.ts")}`],
    { cwd: projectRoot, encoding: "utf8", timeout: buildTimeoutMs },
  );
  assert.equal(result.status, 0, `${label}: cold build failed\n${result.stdout}${result.stderr}`);
  const tree = treeDigest(coldRoot);
  rmSync(coldParent, { recursive: true, force: true });
  return tree;
}

function sourcePath(relative: string): string {
  return path.join(projectRoot, "src", ...relative.split("/"));
}

function edit(relative: string, from: string, to: string): void {
  const file = sourcePath(relative);
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes(from), true, `${relative} has no ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to), "utf8");
  assert.equal(readFileSync(file, "utf8").split("\n").length <= 151, true, `${relative} grew above 150 lines`);
}

/** The four scripted kinds of edit; `round` makes each one new. */
const editKinds: readonly {
  readonly kind: string;
  readonly apply: (module: UiModule, round: number) => void;
}[] = [
  {
    kind: "text",
    apply: (module, round) => {
      const text = readFileSync(sourcePath(relativeFile(module)), "utf8");
      const current = /text-(\d+)/u.exec(text)![0];
      edit(relativeFile(module), current, `text-${round}`);
    },
  },
  {
    kind: "attribute",
    apply: (module, round) => {
      const id = module.name.toLowerCase();
      edit(relativeFile(module), `className: '${id}-root'`, `data${round}: 'v${round}', className: '${id}-root'`);
    },
  },
  {
    kind: "new private function with a call",
    apply: (module, round) => {
      edit(relativeFile(module), "    // edit-anchor\n", `    parts.push(note${round}(props));\n    // edit-anchor\n`);
      edit(relativeFile(module), "  static function spare(",
        `  static function note${round}(props: ${module.name}Props): String {\n    return 'note ${round} ' + props.count;\n  }\n\n  static function spare(`);
    },
  },
  {
    kind: "new local",
    apply: (module, round) => {
      edit(relativeFile(module), "    // edit-anchor\n",
        `    final local${round} = StringTools.trim(' ' + props.label + ' ${round} ');\n    parts.push(local${round});\n    // edit-anchor\n`);
    },
  },
];

type Event = DevelopmentEvent<JsonValue>;

try {
  for (const [relative, text] of Object.entries(fixedFiles)) {
    mkdirSync(path.dirname(sourcePath(relative)), { recursive: true });
    writeFileSync(sourcePath(relative), text, "utf8");
  }
  for (const module of uiModules) {
    mkdirSync(path.dirname(sourcePath(relativeFile(module))), { recursive: true });
    writeFileSync(sourcePath(relativeFile(module)), uiModuleText(module), "utf8");
    assert.equal(uiModuleText(module).split("\n").length <= 150, true);
  }
  writeFileSync(path.join(projectRoot, "build.hxml"), [...programArguments, ""].join("\n"), "utf8");

  const events: Event[] = [];
  const session = createGenesDevelopmentSession<JsonValue>({
    projectRoot,
    projectIdentity: "module-preview-session-fixture",
    hxml: { allowedRoots: [projectRoot, genesSourceRoot, helderSourceRoot] },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: projectRoot,
      args: ["build.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "module-preview-session", haxe: haxeVersion },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "accept-every-candidate" },
    generationReuse: { coldCheckEvery: 0 },
    modulePreview: { quietMs: 50 },
    debounceMs: 50,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 5_000,
  });
  /** Bytes of each preview file, read in the event listener. */
  const previewBytes = new Map<string, Buffer>();
  const statesAtRefusal: string[] = [];
  session.subscribe((event) => {
    events.push(event);
    if (event.event.kind === "preview-generated") {
      for (const file of event.event.files) {
        const content = session.readPreviewFile(file.path);
        assert.notEqual(content, null, `no bytes for the preview file ${file.path}`);
        assert.equal(createHash("sha256").update(content!.bytes).digest("hex"), file.sha256);
        previewBytes.set(`${event.event.revision}:${file.path}`, Buffer.from(content!.bytes));
      }
    }
    if (event.event.kind === "preview-refused") statesAtRefusal.push(session.state.kind);
  });

  /**
   * Waits for the session's observation of the next save of `relative`
   * (after event `sequence`), then for its accepted generation, or for a
   * failure when `expectFailure` is set. Returns the revision of the save.
   */
  const settle = async (
    sequence: number,
    files: readonly string[],
    label: string,
    expectFailure = false,
    folder = "src/",
  ): Promise<number> => {
    const started = Date.now();
    const wanted = files.map((relative) => `${folder}${relative}`);
    let revision = 0;
    for (;;) {
      assert.equal(Date.now() - started < buildTimeoutMs, true, `${label}: timed out: ${JSON.stringify(session.inspect())}`);
      const changes = events.filter((event) => event.sequence > sequence && event.event.kind === "inputs-changed");
      const seen = new Set(changes.flatMap((event) => event.event.kind === "inputs-changed" ? event.event.paths : []));
      if (wanted.every((file) => seen.has(file))) {
        revision = Math.max(...changes.map((event) => event.event.kind === "inputs-changed" ? event.event.revision : 0));
        const state = session.state;
        if (expectFailure && state.kind === "degraded" && (state.failure.revision ?? 0) >= revision) break;
        if (!expectFailure && (session.inspect().accepted?.revision ?? 0) >= revision && state.kind === "ready") break;
        assert.equal(!expectFailure && state.kind === "degraded" && (state.failure.revision ?? 0) >= revision, false,
          `${label}: the build failed: ${JSON.stringify(state)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await session.waitForIdle();
    return revision;
  };

  const publicTree = (): string[] => treeDigest(path.join(projectRoot, "src-gen"));
  const candidates = (): string[] => {
    const folder = path.join(projectRoot, ".genes/dev/candidates");
    return existsSync(folder) ? readdirSync(folder) : [];
  };
  const checkCold = (label: string): void => {
    assert.deepEqual(publicTree(), coldTree(label), `${label}: the public tree differs from cold`);
    assert.deepEqual(candidates(), [], `${label}: a private folder stayed`);
  };

  try {
    await session.start();
    await session.firstAccepted;
    await session.waitForIdle();
    checkCold("first build");

    // 30 scripted edits over 10 modules, each waiting for its accepted generation.
    const saves = new Map<number, number>();
    const editRevisions: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const module = uiModules[index % uiModules.length]!;
      const kind = editKinds[index % editKinds.length]!;
      const sequence = session.inspect().lastSequence;
      const savedAt = Date.now();
      kind.apply(module, index + 1);
      const revision = await settle(sequence, [relativeFile(module)], `edit ${index + 1} (${module.name}, ${kind.kind})`);
      saves.set(revision, savedAt);
      editRevisions.push(revision);
      if ([1, 10, 20, 30].includes(index + 1)) checkCold(`after edit ${index + 1}`);
    }

    // The events of the 30 scripted edits only.
    const scriptedEnd = session.inspect().lastSequence;
    const scripted = summarizePreviewTimings(events.filter((event) => event.sequence <= scriptedEnd));
    const rows = scripted.rows.filter((row) => editRevisions.includes(row.revision));
    assert.equal(rows.length, 30, `every scripted edit has one preview or refusal row: ${JSON.stringify(rows)}`);
    const refused = rows.filter((row) => row.outcome === "refused");
    console.log(`module-first session: ${rows.length - refused.length} of ${rows.length} scripted edits shown as previews`
      + (refused.length === 0 ? "" : `; refused: ${refused.map((row) => `r${row.revision} ${row.module} ${row.code}`).join(", ")}`));
    assert.equal((rows.length - refused.length) / rows.length >= 0.9, true, "at least 90% of the scripted edits must be previews");
    // No preview differs from the program result.
    for (const row of rows.filter((candidate) => candidate.outcome === "preview")) {
      assert.equal(row.confirmed, true, `the preview of revision ${row.revision} (${row.module}) was not confirmed`);
    }
    assert.deepEqual(session.inspect().modulePreview, { differences: 0, stoppedModules: [] });
    for (const event of events) {
      if (event.event.kind !== "preview-confirmed") continue;
      for (const file of event.event.paths) {
        const bytes = previewBytes.get(`${event.event.revision}:${file}`);
        assert.notEqual(bytes, undefined);
        // The confirmation compared the program candidate; a later edit of
        // the same module may have changed the published file since.
        if (session.inspect().accepted?.revision === event.event.revision) {
          assert.deepEqual(readFileSync(path.join(projectRoot, file)), bytes);
        }
      }
    }

    // Each refusal leaves no stale file.
    const badge = uiModules[1]!;
    let sequence = session.inspect().lastSequence;
    edit(relativeFile(badge), "  static function spare(", "  public static function extraShape(): Int {\n    return 1;\n  }\n\n  static function spare(");
    await settle(sequence, [relativeFile(badge)], "shape-changing edit");
    const shapeRefusal = events.filter((event) => event.sequence > sequence && event.event.kind === "preview-refused");
    assert.equal(shapeRefusal.length, 1);
    assert.deepEqual(
      shapeRefusal.map((event) => event.event.kind === "preview-refused" ? [event.event.source, event.event.code, event.event.module] : []),
      [["genes", "public-shape-changed", "ui.controls.Badge"]],
    );
    assert.equal(statesAtRefusal.at(-1), "building", "a shape-changing edit is pending until the program request");
    checkCold("after the shape-changing edit");

    const card = uiModules[4]!;
    sequence = session.inspect().lastSequence;
    edit(relativeFile(card), "    // edit-anchor\n", "    final broken: Int = 'not a number';\n    // edit-anchor\n");
    await settle(sequence, [relativeFile(card)], "type error", true);
    sequence = session.inspect().lastSequence;
    edit(relativeFile(card), "    final broken: Int = 'not a number';\n", "");
    await settle(sequence, [relativeFile(card)], "type error repaired");
    checkCold("after the repaired type error");

    sequence = session.inspect().lastSequence;
    edit(relativeFile(uiModules[0]!), "text-", "text-x");
    edit(relativeFile(uiModules[3]!), "text-", "text-y");
    await settle(sequence, [relativeFile(uiModules[0]!), relativeFile(uiModules[3]!)], "two modules at once");
    checkCold("after two modules at once");

    // A save with the same bytes starts no build (no module request, no
    // program request): it only advances the revision.
    const button = uiModules[0]!;
    sequence = session.inspect().lastSequence;
    const acceptedBefore = session.inspect().accepted?.revision;
    const sameBytes = readFileSync(sourcePath(relativeFile(button)));
    const later = new Date(Date.now() + 2_000);
    writeFileSync(sourcePath(relativeFile(button)), sameBytes);
    // A new whole-second time, as an editor save a moment later gives.
    utimesSync(sourcePath(relativeFile(button)), later, later);
    for (let waited = 0; ; waited += 10) {
      assert.equal(waited < 30_000, true, "the save with the same bytes was not observed");
      if (events.some((event) => event.sequence > sequence && event.event.kind === "inputs-changed")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await session.waitForIdle();
    assert.deepEqual(
      events.filter((event) => event.sequence > sequence).map((event) => event.event.kind),
      ["inputs-changed"],
      "a save with the same bytes must start no build",
    );
    assert.equal(session.inspect().accepted?.revision, acceptedBefore);
    // Observation, printed and not judged: Haxe 4.3.7 types a module again
    // when its file time changed (no content check in its default module
    // check policy), so the next module request of a module that imports it
    // (Card imports Button) can see that module typed again.
    sequence = session.inspect().lastSequence;
    editKinds[0]!.apply(uiModules[4]!, 77);
    await settle(sequence, [relativeFile(uiModules[4]!)], "an edit after a save with the same bytes");
    const afterSameBytes = events.filter((event) => event.sequence > sequence
      && (event.event.kind === "preview-generated" || event.event.kind === "preview-refused"))
      .map((event) => event.event.kind === "preview-refused" ? `refused ${event.event.source}:${event.event.code}` : "preview");
    console.log(`module-first session observation: an edit of Card (it imports Button) after a save of Button with the same bytes gives ${afterSameBytes.join(", ")}`);
    checkCold("after the save with the same bytes");

    const refusals = events.filter((event) => event.event.kind === "preview-refused"
      && !editRevisions.includes(event.event.revision)).map((event) =>
      event.event.kind === "preview-refused" ? `${event.event.source}:${event.event.code}` : "");
    assert.equal(refusals.includes("genes:public-shape-changed"), true);
    assert.equal(refusals.includes("session:compile-failed"), true);
    // Two saves at once give `several-modules` when one build sees both;
    // when the watcher reports them apart, the second build is refused by
    // Genes or previewed. Each way, the tree above equals cold.
    console.log(`module-first session refusals after the scripted edits: ${refusals.join(", ")}`);
    assert.equal(existsSync(path.join(projectRoot, ".genes/dev/preview-evidence")), false, "no preview differed");

    const serverStarts = events.filter((event) =>
      event.event.kind === "compiler-lifecycle" && event.event.event.kind === "started").length;
    assert.equal(serverStarts, 1, "the session must reuse one owned Haxe server");

    // Time to the preview against time to the accepted generation.
    const fromSave = (at: number | null, revision: number): number | null => {
      const saved = saves.get(revision);
      return at === null || saved === undefined ? null : at - saved;
    };
    const savePreview: number[] = [];
    const saveAccepted: number[] = [];
    for (const row of rows) {
      const changed = events.find((event) => event.event.kind === "inputs-changed" && event.event.revision === row.revision)!;
      if (row.previewMs !== null) savePreview.push(fromSave(changed.at + row.previewMs, row.revision)!);
      if (row.acceptedMs !== null) saveAccepted.push(fromSave(changed.at + row.acceptedMs, row.revision)!);
    }
    const median = (values: number[]): number => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
    };
    const p95 = (values: number[]): number => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
    };
    console.log(
      `module-first session timing (load ${os.loadavg()[0]!.toFixed(1)}): `
      + `event to preview median ${scripted.timeToPreview?.medianMs} ms p95 ${scripted.timeToPreview?.p95Ms} ms; `
      + `event to acceptance median ${scripted.timeToAcceptance?.medianMs} ms p95 ${scripted.timeToAcceptance?.p95Ms} ms; `
      + `save to preview median ${median(savePreview)} ms p95 ${p95(savePreview)} ms; `
      + `save to acceptance median ${median(saveAccepted)} ms p95 ${p95(saveAccepted)} ms`,
    );
    for (const row of rows) {
      console.log(`  r${row.revision} ${row.module ?? "-"} ${row.outcome}${row.code === null ? "" : ` ${row.code}`}: preview ${row.previewMs ?? "-"} ms, accepted ${row.acceptedMs ?? "-"} ms`);
    }

    // An observation of a Genes limit, printed and not judged: a module
    // that only a class-name root keeps in the program (`ui.core.Format`,
    // which no module imports). The module request leaves that root out, as
    // it must, and the `-dce std` rule of Genes cannot see that the program
    // request keeps the module, so it refuses (`module-may-leave` today).
    sequence = session.inspect().lastSequence;
    writeFileSync(path.join(projectRoot, "build.hxml"), [...programArguments, "ui.core.Format", ""].join("\n"), "utf8");
    await settle(sequence, ["build.hxml"], "a class-name root that only roots keep", false, "");
    sequence = session.inspect().lastSequence;
    editKinds[0]!.apply(uiModules[2]!, 99);
    await settle(sequence, [relativeFile(uiModules[2]!)], "an edit with that root");
    const observed = events.filter((event) => event.sequence > sequence
      && (event.event.kind === "preview-generated" || event.event.kind === "preview-refused"))
      .map((event) => event.event.kind === "preview-refused" ? `refused ${event.event.source}:${event.event.code}` : "preview");
    console.log(`module-first session observation: with the class-name root ui.core.Format, an edit of Avatar gives ${observed.join(", ")}`);
    checkCold("after the class-name root");
  } finally {
    await session.close();
  }
  console.log("genes tooling module-first warm session gate: passed");
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
