import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
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
const helderSourceRoot = realpathSync.native(
  execFileSync("haxelib", ["path", "helder.set"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .find((line) => line.length > 0 && !line.startsWith("-"))!,
);

try {
  const sourceRoot = path.join(projectRoot, "src");
  mkdirSync(sourceRoot);
  const fixtureGenesSourceRoot = path.join(projectRoot, "genes-src");
  const fixtureHelderSourceRoot = path.join(projectRoot, "helder-src");
  cpSync(path.join(repositoryRoot, "src"), fixtureGenesSourceRoot, {
    recursive: true,
  });
  cpSync(helderSourceRoot, fixtureHelderSourceRoot, { recursive: true });
  writeFileSync(
    path.join(projectRoot, "genes-extraParams.hxml"),
    readFileSync(path.join(repositoryRoot, "extraParams.hxml")),
  );
  writeFileSync(
    path.join(sourceRoot, "Main.hx"),
    [
      "package;",
      "class Main {",
      "  static function main():Void trace(SourceOnly.value);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const blockedOutput = path.join(projectRoot, "blocked-gen/index.ts");
  mkdirSync(path.dirname(blockedOutput), { recursive: true });
  writeFileSync(blockedOutput, "// public sentinel\n", "utf8");
  writeFileSync(
    path.join(projectRoot, "malicious-child.hxml"),
    [
      `-D genes.output=${blockedOutput}`,
      "--next",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    path.join(projectRoot, "malicious.hxml"),
    "malicious-child.hxml\n",
    "utf8",
  );
  const blockedSession = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "real-haxe-session-forbidden-hxml",
    hxml: {
      allowedRoots: [projectRoot],
    },
    publicOutputFile: "blocked-gen/index.ts",
    stateDirectory: ".genes/blocked-dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: projectRoot,
      args: ["malicious.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "forbidden-effective-hxml" },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "must-not-run" },
    debounceMs: 0,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 2_000,
  });
  try {
    await blockedSession.start();
    assert.equal(blockedSession.state.kind, "blocked");
    assert.equal(
      readFileSync(blockedOutput, "utf8"),
      "// public sentinel\n",
      "nested output and multi-compilation flags must fail before real Haxe can mutate public output",
    );
    await assert.rejects(blockedSession.firstAccepted, /fatal session failure/u);
  } finally {
    await blockedSession.close();
  }

  const policyCases: readonly {
    readonly name: string;
    readonly hxml: string;
    readonly env?: Readonly<Record<string, string>>;
  }[] = [
    { name: "quoted-xml", hxml: '"--xml escaped.xml"\n' },
    {
      name: "percent-option",
      hxml: "%EFFECT%\nescaped.xml\n",
      env: { EFFECT: "--xml" },
    },
    { name: "short-command", hxml: "-cmd touch escaped-command\n" },
    { name: "equals-command", hxml: "--cmd=touch escaped-command\n" },
    { name: "equals-target", hxml: "--js=escaped-target.js\n" },
    { name: "generated-hx", hxml: "-D gen_hx_classes\n" },
  ];
  for (const fixture of policyCases) {
    const relativeOutput = `policy-${fixture.name}/index.ts`;
    const absoluteOutput = path.join(projectRoot, relativeOutput);
    mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteOutput, "// policy sentinel\n", "utf8");
    const hxmlName = `policy-${fixture.name}.hxml`;
    writeFileSync(path.join(projectRoot, hxmlName), fixture.hxml, "utf8");
    const session = createGenesDevelopmentSession<Diagnostic>({
      projectRoot,
      projectIdentity: `real-haxe-session-policy-${fixture.name}`,
      hxml: { allowedRoots: [projectRoot] },
      publicOutputFile: relativeOutput,
      stateDirectory: `.genes/policy-${fixture.name}`,
      resolveInvocation: () => ({
        executable: haxeExecutable,
        cwd: projectRoot,
        args: [hxmlName],
        env: fixture.env,
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { fixture: fixture.name },
      }),
      validate: async () => ({ ok: true }),
      validatorPolicyFacts: { fixture: "must-not-run" },
      debounceMs: 0,
      pollIntervalMs: 20,
      shutdownTimeoutMs: 2_000,
    });
    try {
      await session.start();
      assert.equal(session.state.kind, "blocked");
      assert.equal(readFileSync(absoluteOutput, "utf8"), "// policy sentinel\n");
      await assert.rejects(session.firstAccepted, /fatal session failure/u);
    } finally {
      await session.close();
    }
  }

  const libraryBlockedOutput = path.join(
    projectRoot,
    "blocked-library-gen/index.ts",
  );
  mkdirSync(path.dirname(libraryBlockedOutput), { recursive: true });
  writeFileSync(libraryBlockedOutput, "// library sentinel\n", "utf8");
  const attackerRoot = path.join(projectRoot, "attacker-library");
  const attackerSource = path.join(attackerRoot, "src");
  mkdirSync(attackerSource, { recursive: true });
  writeFileSync(
    path.join(attackerSource, "Attack.hx"),
    "class Attack { static function main():Void trace('attack'); }\n",
    "utf8",
  );
  const attackerHxml = path.join(attackerRoot, "extraParams.hxml");
  writeFileSync(
    attackerHxml,
    [
      `-cp ${attackerSource}`,
      "-main Attack",
      `-js ${libraryBlockedOutput}`,
      "--next",
      "",
    ].join("\n"),
    "utf8",
  );
  mkdirSync(path.join(projectRoot, ".haxelib"));
  execFileSync("haxelib", ["dev", "attacker", attackerRoot], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const sourceOnlyRoot = path.join(projectRoot, "source-only-library");
  const sourceOnlyClassPath = path.join(sourceOnlyRoot, "src");
  mkdirSync(sourceOnlyClassPath, { recursive: true });
  writeFileSync(
    path.join(sourceOnlyRoot, "haxelib.json"),
    `${JSON.stringify({
      name: "sourceonly",
      url: "https://example.invalid/sourceonly",
      license: "MIT",
      tags: [],
      description: "DevelopmentSession source-root fixture",
      version: "1.0.0",
      classPath: "src",
      releasenote: "fixture",
      contributors: ["maintainer"],
    })}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(sourceOnlyClassPath, "SourceOnly.hx"),
    "class SourceOnly { public static final value = 1; }\n",
    "utf8",
  );
  execFileSync("haxelib", ["dev", "sourceonly", sourceOnlyRoot], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  writeFileSync(
    path.join(projectRoot, "malicious-library.hxml"),
    [
      "-lib attacker",
      `-cp ${sourceRoot}`,
      "-main Main",
      "",
    ].join("\n"),
    "utf8",
  );
  const libraryBlockedSession = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "real-haxe-session-forbidden-library-hxml",
    hxml: {
      allowedRoots: [projectRoot],
      resolveLibrary: (request) => {
        assert.equal(request.name, "attacker");
        return {
          arguments: [attackerHxml],
          provenanceFiles: [attackerHxml],
        };
      },
    },
    publicOutputFile: "blocked-library-gen/index.ts",
    stateDirectory: ".genes/blocked-library-dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: projectRoot,
      args: ["malicious-library.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "forbidden-library-hxml" },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "must-not-run" },
    debounceMs: 0,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 2_000,
  });
  try {
    await libraryBlockedSession.start();
    assert.equal(libraryBlockedSession.state.kind, "blocked");
    assert.equal(
      readFileSync(libraryBlockedOutput, "utf8"),
      "// library sentinel\n",
      "library-expanded multi-compilation must fail before real Haxe can mutate public output",
    );
    await assert.rejects(
      libraryBlockedSession.firstAccepted,
      /fatal session failure/u,
    );
  } finally {
    await libraryBlockedSession.close();
  }

  const inactiveOutput = path.join(projectRoot, "inactive-gen/index.ts");
  mkdirSync(path.dirname(inactiveOutput), { recursive: true });
  writeFileSync(inactiveOutput, "// inactive Genes sentinel\n", "utf8");
  const inactiveSource = path.join(projectRoot, "inactive-src");
  mkdirSync(inactiveSource);
  writeFileSync(
    path.join(inactiveSource, "InactiveMain.hx"),
    "class InactiveMain { static function main():Void trace('plain Haxe'); }\n",
    "utf8",
  );
  writeFileSync(
    path.join(projectRoot, "inactive.hxml"),
    [`-cp ${inactiveSource}`, "-main InactiveMain", ""].join("\n"),
    "utf8",
  );
  const inactiveSession = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "real-haxe-session-inactive-genes",
    hxml: { allowedRoots: [projectRoot] },
    publicOutputFile: "inactive-gen/index.ts",
    stateDirectory: ".genes/inactive-dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      cwd: projectRoot,
      args: ["inactive.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "inactive-genes-private-haxe-target" },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "must-not-publish" },
    debounceMs: 0,
    pollIntervalMs: 20,
    shutdownTimeoutMs: 2_000,
  });
  try {
    await inactiveSession.start();
    await inactiveSession.waitForIdle();
    assert.equal(inactiveSession.state.kind, "blocked");
    assert.equal(
      readFileSync(inactiveOutput, "utf8"),
      "// inactive Genes sentinel\n",
      "ordinary Haxe output must stay private when Genes does not produce a candidate manifest",
    );
  } finally {
    await inactiveSession.close();
  }

  writeFileSync(
    path.join(projectRoot, "repeated-flags.hxml"),
    "--define=session-repeated\n",
    "utf8",
  );
  writeFileSync(
    path.join(projectRoot, "build.hxml"),
    [
      path.join(projectRoot, "genes-extraParams.hxml"),
      "repeated-flags.hxml",
      "repeated-flags.hxml",
      `--class-path=${fixtureGenesSourceRoot}`,
      `--class-path=${fixtureHelderSourceRoot}`,
      `--class-path=${sourceRoot}`,
      "-lib sourceonly",
      "-main Main",
      "--define=genes.ts",
      "--define=js-source-map",
      "--define=js-es=6",
      "--dce=full",
      "",
    ].join("\n"),
    "utf8",
  );

  const events: DevelopmentEvent<Diagnostic>[] = [];
  const session = createGenesDevelopmentSession<Diagnostic>({
    projectRoot,
    projectIdentity: "real-haxe-session-fixture",
    hxml: {
      allowedRoots: [projectRoot],
      resolveLibrary: (request, context) => {
        assert.equal(context.environment("PATH") !== null, true);
        assert.equal(request.name, "sourceonly");
        return {
          arguments: ["-cp", sourceOnlyClassPath],
          provenanceFiles: [path.join(sourceOnlyRoot, "haxelib.json")],
        };
      },
    },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    resolveInvocation: () => ({
      executable: haxeExecutable,
      // The session inventories this exact working directory and HXML. Keeping
      // the real invocation identical proves the compiler cannot gain hidden
      // command-line inputs after the watch set was chosen.
      cwd: projectRoot,
      args: ["build.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
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
    writeFileSync(
      path.join(sourceOnlyClassPath, "SourceOnly.hx"),
      "class SourceOnly { public static final value = 2; }\n",
      "utf8",
    );
    const deadline = Date.now() + 3_000;
    while (
      (session.inspect().accepted?.generation ?? 0) < 3 &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await session.waitForIdle();
    }
    assert.equal(
      session.inspect().accepted?.generation,
      3,
      "editing a source-only Haxelib class path must trigger a real rebuild",
    );
  } finally {
    await session.close();
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("genes tooling development session real Haxe integration: ok");
