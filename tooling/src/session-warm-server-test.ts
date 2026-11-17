/**
 * Session-level gate: the real `DevelopmentSession` keeps one warm Haxe
 * compiler-server cache across builds.
 *
 * Why: Haxe 4.3.7 selects its compiler-server cache by the values of all
 * defines. When the session named each new private candidate folder in a
 * define, every build got a new cache: Haxe typed the whole program again,
 * Genes lost its kept records, and server memory grew. The compiler-server
 * fixture gates did not see this, because they drive Haxe directly with
 * stable arguments; only the session code path added the changing define.
 * This test drives the session code path itself.
 *
 * What: the compiler-server fixture `project-a` is built by a real session
 * with the full Genes generator. After the first build the test edits source
 * files several times and checks, after each build:
 *
 * - the server holds the same cache signatures as after the first build (from the
 *   server's own `server/contexts` answer);
 * - the Genes incremental report keeps records (kept > 0);
 * - the owned server was started once;
 * - two saves with the same whole-second file time are both built (the
 *   second one through `server/invalidate`);
 * - the public tree equals a cold build in a new Haxe process, byte for byte;
 * - the server memory stays roughly flat;
 * - a structure change (a new module, a new `import.hx`, a new module that
 *   shadows a top-level name, a removed module) starts a new server, a
 *   content edit between them does not, and each tree equals cold;
 * - a change to a file that a macro reads (`data/snippet.hx`, `data/note.txt`)
 *   starts a new server and publishes the new text, while a change to an
 *   input declared with `keepCache` keeps the server.
 *
 * Timings are printed, not judged: a timing claim needs a quiet machine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
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
  type DevelopmentEvent,
  type JsonValue,
} from "./session/index.js";
import { sendHaxeServerRequest } from "./session/haxe-driver.js";

type Diagnostic = {
  readonly [key: string]: JsonValue;
  readonly code: string;
  readonly message: string;
};

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const haxeVersion = execFileSync("haxe", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const haxeExecutable =
  process.env.HAXE_STD_PATH === undefined
    ? path.join(
        homedir(),
        "haxe",
        "versions",
        haxeVersion,
        process.platform === "win32" ? "haxe.exe" : "haxe",
      )
    : path.join(
        path.dirname(process.env.HAXE_STD_PATH),
        process.platform === "win32" ? "haxe.exe" : "haxe",
      );
const helderSourceRoot = realpathSync.native(
  execFileSync("haxelib", ["path", "helder.set"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .find((line) => line.length > 0 && !line.startsWith("-"))!,
);
const genesVersion = (
  JSON.parse(readFileSync(path.join(repositoryRoot, "haxelib.json"), "utf8")) as {
    readonly version: string;
  }
).version;
const genesSourceRoot = path.join(repositoryRoot, "src");
const projectRoot = realpathSync.native(
  mkdtempSync(path.join(os.tmpdir(), "genes-session-warm-")),
);
const buildTimeoutMs = 240_000;

/** The program arguments of `yarn test:compiler-server` for project A, without a target. */
const programArguments = [
  `-cp ${genesSourceRoot}`,
  `-cp ${helderSourceRoot}`,
  "-D helder.set=0.3.1",
  `-D genes-ts=${genesVersion}`,
  '--macro haxe.macro.Compiler.nullSafety("genes", Loose, true)',
  "--macro genes.Generator.use()",
  "--macro genes.js.Async.enable()",
  "--macro genes.react.InlineMarkup.enable()",
  "--macro genes.react.ReactDiagnosticsMacro.install()",
  "--macro addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
  "-cp src",
  "--main servercase.Main",
  "servercase.UnimportedLeaf",
  "-D js-es=6",
  "-D no-deprecation-warnings",
  "-D genes.ts",
  "-dce full",
  "-debug",
];

/** One Haxe compiler-server cache, as `server/contexts` reports it. */
type ServerContext = {
  readonly signature: string;
  readonly platform: string;
  readonly desc: string;
};

/** Returns the sorted relative paths and SHA-256 digests of a tree. */
function treeDigest(root: string): string[] {
  const entries: string[] = [];
  const walk = (relative: string): void => {
    const directory = path.join(root, relative);
    for (const name of readdirSync(directory).sort()) {
      const child = relative.length === 0 ? name : `${relative}/${name}`;
      const absolute = path.join(root, child);
      if (statSync(absolute).isDirectory()) {
        walk(child);
      } else {
        entries.push(
          `${child} ${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`,
        );
      }
    }
  };
  walk("");
  return entries;
}

/**
 * Builds the current sources in a new Haxe process, outside the session.
 *
 * Source maps hold source paths relative to the folder where Genes wrote
 * them. The session writes into a private candidate folder five levels
 * below the project (`.genes/dev/candidates/<revision>/output`) and
 * publishes those bytes unchanged, so the cold tree is written at the same
 * depth. Then every byte, source maps included, must be equal.
 */
function coldTree(label: string): string[] {
  const coldParent = path.join(projectRoot, "cold");
  const coldRoot = path.join(coldParent, "same", "depth", "as", "candidate");
  rmSync(coldParent, { recursive: true, force: true });
  const result = spawnSync(
    haxeExecutable,
    [
      "build.hxml",
      "--js",
      path.join(projectRoot, "cold-haxe-target", "compiler.js"),
      "-D",
      `genes.output=${path.join(coldRoot, "index.ts")}`,
    ],
    { cwd: projectRoot, encoding: "utf8", timeout: buildTimeoutMs },
  );
  assert.equal(
    result.status,
    0,
    `${label}: cold build failed\n${result.stdout}${result.stderr}`,
  );
  return treeDigest(coldRoot);
}

/** Moves a file time to an exact whole second. */
function setWholeSecond(file: string, seconds: number): void {
  utimesSync(file, seconds, seconds);
}

/** Replaces one marker in a fixture source file and returns the file. */
function edit(relative: string, from: string, to: string): string {
  const file = path.join(projectRoot, "src", relative);
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes(from), true, `${relative} has no ${from}`);
  writeFileSync(file, text.replace(from, to), "utf8");
  return file;
}

function residentKilobytes(pid: number): number {
  const output = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  }).trim();
  const value = Number.parseInt(output, 10);
  assert.equal(Number.isSafeInteger(value) && value > 0, true, `no RSS for ${pid}`);
  return value;
}

try {
  cpSync(
    path.join(repositoryRoot, "tests/compiler-server/templates/project-a"),
    projectRoot,
    { recursive: true },
  );
  mkdirSync(path.join(projectRoot, "data"));
  writeFileSync(path.join(projectRoot, "data", "snippet.hx"), "snippet-v1", "utf8");
  writeFileSync(path.join(projectRoot, "data", "note.txt"), "note-v1", "utf8");
  mkdirSync(path.join(projectRoot, "notes"));
  writeFileSync(path.join(projectRoot, "notes", "readme.txt"), "readme-v1", "utf8");
  writeFileSync(
    path.join(projectRoot, "build.hxml"),
    [...programArguments, ""].join("\n"),
    "utf8",
  );

  const events: DevelopmentEvent<Diagnostic>[] = [];
  const session = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "warm-server-session-fixture",
    hxml: { allowedRoots: [projectRoot, genesSourceRoot, helderSourceRoot] },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    extraInputs: [
      // A declared input that is not on a class path. A macro reads a `.hx`
      // file and a `.txt` file in it as text, so its change must not keep
      // the warm cache.
      { kind: "tree", path: "data", impact: { rebuild: true } },
      // An input that Haxe never reads; the host says so with `keepCache`.
      { kind: "tree", path: "notes", impact: { rebuild: true, keepCache: true } },
    ],
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: projectRoot,
      args: ["build.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "warm-server-session", haxe: haxeVersion },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "accept-every-candidate" },
    debounceMs: 0,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 5_000,
  });
  session.subscribe((event) => events.push(event));

  const waitForGeneration = async (generation: number, label: string): Promise<number> => {
    const started = Date.now();
    while ((session.inspect().accepted?.generation ?? 0) < generation) {
      assert.equal(
        session.state.kind === "degraded" || session.state.kind === "blocked",
        false,
        `${label}: the session failed: ${JSON.stringify(session.inspect())}`,
      );
      assert.equal(
        Date.now() - started < buildTimeoutMs,
        true,
        `${label}: no generation ${generation}: ${JSON.stringify(session.inspect())}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      await session.waitForIdle();
    }
    return Date.now() - started;
  };

  const lease = (): { readonly port: number; readonly serverPid: number } =>
    JSON.parse(
      readFileSync(path.join(projectRoot, ".genes/dev/haxe-server.json"), "utf8"),
    ) as { readonly port: number; readonly serverPid: number };

  /**
   * Sends one display-protocol request to the session's server and returns
   * its result value. Haxe 4.3.7 wraps the value as `{result, timestamp}`.
   */
  const serverResult = async (method: string): Promise<unknown> => {
    const { port } = lease();
    const answer = await sendHaxeServerRequest(
      { host: "127.0.0.1", port, argument: `127.0.0.1:${port}` },
      projectRoot,
      method,
      {},
      { timeoutMs: 30_000 },
    );
    const start = answer.indexOf("{");
    assert.notEqual(start, -1, `${method} gave no JSON: ${answer}`);
    // BOUNDARY_DYNAMIC: the Haxe display protocol answer is foreign JSON;
    // the callers read only the fields that they name.
    const parsed = JSON.parse(answer.slice(start)) as {
      readonly result: { readonly result: unknown };
    };
    return parsed.result.result;
  };

  const serverCaches = async (): Promise<readonly string[]> =>
    ((await serverResult("server/contexts")) as readonly ServerContext[])
      .map((context) => `${context.platform} ${context.desc} ${context.signature}`)
      .sort();

  const keptRecords = (label: string): number => {
    const report = JSON.parse(
      readFileSync(
        path.join(projectRoot, ".genes/dev/haxe-request/incremental.json.after-typing.json"),
        "utf8",
      ),
    ) as {
      readonly mode: string;
      readonly reason: string | null;
      readonly passes: readonly { readonly pass: string; readonly kept: number }[];
    };
    assert.equal(report.mode, "measure", `${label}: ${report.reason ?? "wrong incremental mode"}`);
    return report.passes.reduce((total, pass) => total + pass.kept, 0);
  };

  const publicTree = (): string[] => treeDigest(path.join(projectRoot, "src-gen"));
  const published = (relative: string): string =>
    readFileSync(path.join(projectRoot, "src-gen", relative), "utf8");

  // The caches after the first build: the JavaScript program cache (one
  // signature before and one after the init macros) and the macro cache.
  // Every later build must reuse exactly these.
  let firstCaches: readonly string[] | null = null;
  const memory: number[] = [];
  const observe = async (
    generation: number,
    label: string,
    ms: number,
    freshServer = false,
  ): Promise<void> => {
    const current = await serverCaches();
    assert.equal(
      current.some((cache) => cache.startsWith("js ")),
      true,
      `${label}: the server reports no JavaScript cache: ${JSON.stringify(current)}`,
    );
    firstCaches ??= current;
    assert.deepEqual(
      current,
      firstCaches,
      `${label}: a new Haxe cache signature appeared; a define changes between session builds`,
    );
    const kept = keptRecords(label);
    if (generation > 1 && !freshServer) {
      assert.equal(kept > 0, true, `${label}: Genes kept no record across requests`);
    }
    memory.push(residentKilobytes(lease().serverPid));
    console.log(
      `warm session ${label}: generation ${generation}, ${ms} ms, ${current.length} caches, kept ${kept}, server RSS ${memory.at(-1)} KiB`,
    );
  };

  try {
    await session.start();
    let generation = 1;
    await observe(generation, "first build", await waitForGeneration(generation, "first build"));
    assert.deepEqual(publicTree(), coldTree("first build"), "first build: tree differs from cold");

    const leaf = "servercase/UnimportedLeaf.ts";
    const steps: readonly {
      readonly label: string;
      readonly apply: () => void;
      readonly expect: () => void;
    }[] = [
      {
        label: "leaf edit 1",
        apply: () => {
          const file = edit("servercase/UnimportedLeaf.hx", "leaf-v1", "leaf-v2");
          setWholeSecond(file, Math.floor(statSync(file).mtimeMs / 1000) + 2);
        },
        expect: () => assert.equal(published(leaf).includes("leaf-v2"), true),
      },
      {
        label: "main edit",
        apply: () => {
          const file = edit("servercase/Main.hx", "server-project-a-v1", "server-project-a-v2");
          setWholeSecond(file, Math.floor(statSync(file).mtimeMs / 1000) + 2);
        },
        expect: () =>
          assert.equal(published("servercase/Main.ts").includes("server-project-a-v2"), true),
      },
      {
        label: "leaf edit 2",
        apply: () => {
          const file = edit("servercase/UnimportedLeaf.hx", "leaf-v2", "leaf-v3");
          setWholeSecond(file, Math.floor(statSync(file).mtimeMs / 1000) + 2);
        },
        expect: () => assert.equal(published(leaf).includes("leaf-v3"), true),
      },
    ];
    for (const step of steps) {
      step.apply();
      generation += 1;
      await observe(generation, step.label, await waitForGeneration(generation, step.label));
      step.expect();
    }

    // Two saves in one second: the second save keeps the whole-second file
    // time of the first one. Haxe alone compares only that time and would
    // keep the module of the first save; `server/invalidate` must make it
    // read the second.
    const leafSource = path.join(projectRoot, "src", "servercase/UnimportedLeaf.hx");
    const sameSecond = Math.floor(statSync(leafSource).mtimeMs / 1000) + 2;
    edit("servercase/UnimportedLeaf.hx", "leaf-v3", "leaf-v4");
    setWholeSecond(leafSource, sameSecond);
    generation += 1;
    await observe(generation, "first save in one second", await waitForGeneration(generation, "first save"));
    assert.equal(published(leaf).includes("leaf-v4"), true);
    edit("servercase/UnimportedLeaf.hx", "leaf-v4", "leaf-v5-same-second");
    setWholeSecond(leafSource, sameSecond);
    generation += 1;
    await observe(generation, "second save in the same second", await waitForGeneration(generation, "second save"));
    assert.equal(
      published(leaf).includes("leaf-v5-same-second"),
      true,
      "the second save within one second was not built",
    );

    assert.deepEqual(publicTree(), coldTree("after the edits"), "after the edits: tree differs from cold");
    const serverStarts = (): number =>
      events.filter(
        (event) =>
          event.event.kind === "compiler-lifecycle" &&
          event.event.event.kind === "started",
      ).length;
    assert.equal(serverStarts(), 1, "the session must reuse one owned Haxe server");
    // Roughly flat. With a new cache per build the process grew from about
    // 250 MB to 675 MB over these five warm builds of the fixture (2.7x);
    // with one cache it stays near its size after the first two builds. The
    // process size moves by tens of megabytes with garbage collection (the
    // minor heap alone is 32 MB), so the base is the larger of the first two
    // sizes and the limit is 2x.
    const base = Math.max(memory[0]!, memory[1]!);
    const peak = Math.max(...memory.slice(2));
    assert.equal(
      peak <= base * 2,
      true,
      `server memory grew from ${base} KiB to ${peak} KiB over ${memory.length - 2} warm builds`,
    );

    // Structure changes. Haxe 4.3.7 remembers a failed name lookup without a
    // dependency edge, so a created or removed `.hx` file can change the
    // meaning of a module that did not change. Each such change must start a
    // new server, and the tree must equal cold.
    const writeSource = (relative: string, text: string): void => {
      writeFileSync(path.join(projectRoot, "src", relative), text, "utf8");
    };
    const structureSteps: readonly {
      readonly label: string;
      readonly apply: () => void;
      readonly expect?: () => void;
      /** The owned server stays; by default only for a content edit. */
      readonly keepsServer?: boolean;
    }[] = [
      {
        label: "new unused module other.Extra",
        apply: () => {
          mkdirSync(path.join(projectRoot, "src", "other"));
          writeSource(
            "other/Extra.hx",
            'package other;\n\nclass Extra {\n  public static function value(): String {\n    return "extra-other";\n  }\n}\n',
          );
        },
      },
      {
        label: "new import.hx that imports other.Extra",
        apply: () => writeSource("servercase/import.hx", "import other.Extra;\n"),
        expect: () =>
          assert.equal(/other\/Extra/u.test(published("servercase/Main.ts")), true),
      },
      {
        label: "new top-level TopThing",
        apply: () =>
          writeSource(
            "TopThing.hx",
            'class TopThing {\n  public static function value(): String {\n    return "top-level";\n  }\n}\n',
          ),
      },
      {
        label: "leaf uses TopThing (content edit)",
        apply: () => {
          edit("servercase/UnimportedLeaf.hx", '"leaf-v5-same-second"', '"leaf-" + TopThing.value()');
        },
      },
      {
        label: "new servercase.TopThing shadows the top-level one",
        apply: () =>
          writeSource(
            "servercase/TopThing.hx",
            'package servercase;\n\nclass TopThing {\n  public static function value(): String {\n    return "same-package";\n  }\n}\n',
          ),
      },
      {
        label: "servercase.TopThing removed",
        apply: () => rmSync(path.join(projectRoot, "src", "servercase/TopThing.hx")),
      },
      {
        label: "new macro module Snip that reads data/snippet.hx and data/note.txt",
        apply: () =>
          writeSource(
            "servercase/Snip.hx",
            'package servercase;\n\nclass Snip {\n  public static macro function text() {\n    return macro $v{sys.io.File.getContent("data/snippet.hx")};\n  }\n\n  public static macro function note() {\n    return macro $v{sys.io.File.getContent("data/note.txt")};\n  }\n}\n',
          ),
      },
      {
        label: "leaf uses Snip (content edit)",
        apply: () => {
          edit("servercase/UnimportedLeaf.hx", '"leaf-" + TopThing.value()', '"leaf-" + TopThing.value() + Snip.text() + Snip.note()');
        },
        expect: () => {
          assert.equal(published(leaf).includes("snippet-v1"), true);
          assert.equal(published(leaf).includes("note-v1"), true);
        },
      },
      {
        label: "data/snippet.hx edited (a .hx file that is not on a class path)",
        apply: () =>
          writeFileSync(path.join(projectRoot, "data", "snippet.hx"), "snippet-v2", "utf8"),
        expect: () => assert.equal(published(leaf).includes("snippet-v2"), true),
      },
      {
        label: "data/note.txt edited (a macro reads it; not a .hx file)",
        apply: () =>
          writeFileSync(path.join(projectRoot, "data", "note.txt"), "note-v2", "utf8"),
        expect: () => assert.equal(published(leaf).includes("note-v2"), true),
      },
      {
        label: "notes/readme.txt edited (keepCache input)",
        apply: () =>
          writeFileSync(path.join(projectRoot, "notes", "readme.txt"), "readme-v2", "utf8"),
        keepsServer: true,
      },
    ];
    for (const step of structureSteps) {
      const startsBefore = serverStarts();
      step.apply();
      generation += 1;
      const ms = await waitForGeneration(generation, step.label);
      const keepsServer = step.keepsServer ?? step.label.includes("content edit");
      await observe(generation, step.label, ms, !keepsServer);
      assert.equal(
        serverStarts(),
        startsBefore + (keepsServer ? 0 : 1),
        `${step.label}: ${keepsServer ? "this change must keep" : "this change must replace"} the server`,
      );
      step.expect?.();
      assert.deepEqual(publicTree(), coldTree(step.label), `${step.label}: tree differs from cold`);
    }
  } finally {
    await session.close();
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("genes tooling warm-server session gate: passed");
