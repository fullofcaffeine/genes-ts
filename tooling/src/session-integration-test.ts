import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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

type Diagnostic = {
  readonly [key: string]: JsonValue;
  readonly code: string;
  readonly message: string;
};

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const projectRoot = realpathSync.native(
  mkdtempSync(path.join(os.tmpdir(), "genes-session-real-")),
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

try {
  const sourceRoot = path.join(projectRoot, "src");
  mkdirSync(sourceRoot);
  writeFileSync(
    path.join(sourceRoot, "Main.hx"),
    [
      "package;",
      "class Main {",
      "  static function main():Void trace('ready');",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const ignoredOutput = path.join(projectRoot, "ignored", "index.ts");
  writeFileSync(
    path.join(projectRoot, "build.hxml"),
    [
      "-lib genes-ts",
      `-cp ${sourceRoot}`,
      "-main Main",
      `-js ${ignoredOutput}`,
      "-D genes.ts",
      "-D js-source-map",
      "-D js-es=6",
      "-dce full",
      "",
    ].join("\n"),
    "utf8",
  );

  const events: DevelopmentEvent<Diagnostic>[] = [];
  const session = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "real-haxe-session-fixture",
    hxml: {
      entryFiles: ["build.hxml"],
      workingDirectory: projectRoot,
      allowedRoots: [projectRoot],
    },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: repositoryRoot,
      args: [path.join(projectRoot, "build.hxml")],
      compatibilityFacts: {
        fixture: "real-haxe-session",
        haxe: haxeVersion,
      },
    }),
    validate: async (tree) => {
      const entry = tree.files.find(
        (file) => file.logicalPath === "src-gen/index.ts",
      );
      return entry === undefined || readFileSync(entry.physicalPath).byteLength === 0
        ? {
            ok: false,
            diagnostic: {
              code: "MISSING_MAIN",
              message: "candidate did not contain a non-empty generated entry",
            },
          }
        : { ok: true };
    },
    validatorPolicyFacts: { fixture: "entry-contains-main" },
    debounceMs: 0,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 2_000,
  });
  session.subscribe((event) => events.push(event));
  try {
    await session.start();
    await session.waitForIdle();
    assert.equal(
      session.state.kind,
      "ready",
      `real Haxe session did not admit its first candidate: ${JSON.stringify(session.inspect())}`,
    );
    const first = await session.firstAccepted;
    assert.equal(first.generation, 1);
    assert.equal(first.compilerMode, "connected");
    assert.equal(
      readFileSync(path.join(projectRoot, "src-gen/index.ts")).byteLength > 0,
      true,
    );
    const sourceMapPath = path.join(projectRoot, "src-gen/index.ts.map");
    assert.equal(existsSync(sourceMapPath), true);
    for (const generated of [
      readFileSync(path.join(projectRoot, "src-gen/index.ts"), "utf8"),
      readFileSync(sourceMapPath, "utf8"),
    ]) {
      assert.equal(
        generated.includes("/.genes/dev/candidates/") ||
          generated.includes("\\.genes\\dev\\candidates\\"),
        false,
        "published output must not expose the private candidate path",
      );
    }

    session.invalidate({
      path: "src/Main.hx",
      impact: { rebuild: true },
    });
    await session.waitForIdle();
    assert.equal(session.inspect().accepted?.generation, 2);
    assert.equal(session.inspect().accepted?.compilerMode, "connected");
    assert.deepEqual(session.inspect().accepted?.files, {
      created: [],
      updated: [],
      deleted: [],
    });
    assert.equal(
      events.filter(
        (event) =>
          event.event.kind === "compiler-lifecycle" &&
          event.event.event.kind === "started",
      ).length,
      1,
      "the unchanged second build must reuse the owned Haxe server",
    );
  } finally {
    await session.close();
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("genes tooling development session real Haxe integration: ok");
