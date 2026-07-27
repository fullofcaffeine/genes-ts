import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import {
  compilerOutputSentinel,
  hashTree,
  leakedOutputStages,
  OwnedHaxeCompilerServer,
  runBoundedProcess,
  selectedHaxeCompiler,
  terminateOwnedChild,
  type ProcessResult,
  type TreeEntry
} from "./compiler-server-lifecycle.js";
import {
  runGeneratedTypeScriptMatrix,
  runTypeScript,
  toolchains
} from "./toolchains.js";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/compiler-server");
const tempRoot = path.join(fixtureRoot, ".tmp");
const outputRoot = path.join(tempRoot, "out");
const genesVersion = (
  JSON.parse(
    readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")
  ) as { readonly version: string }
).version;

type ProjectName = "project-a" | "project-b";
type Mode = "cold" | "warm";
type ArtifactExtension = "ts" | "tsx" | "js" | "mjs";

type Profile = {
  readonly extension: ArtifactExtension;
  readonly defines: ReadonlyArray<string>;
};

type Scenario = {
  readonly id: string;
  readonly project: ProjectName;
  readonly profile: Profile;
  readonly defines?: ReadonlyArray<string>;
};

const tsProfile: Profile = {
  extension: "ts",
  defines: ["genes.ts"]
};
const tsxProfile: Profile = {
  extension: "tsx",
  defines: ["genes.ts"]
};
const classicProfile: Profile = {
  extension: "mjs",
  defines: ["dts"]
};
const classicDeclarationProfile: Profile = {
  extension: "js",
  defines: ["dts"]
};

function workspace(project: ProjectName): string {
  return path.join(tempRoot, "workspace", project);
}

function scenarioRoot(mode: Mode, scenario: Scenario): string {
  return path.join(outputRoot, mode, scenario.id);
}

function scenarioOutput(mode: Mode, scenario: Scenario): string {
  return path.join(
    scenarioRoot(mode, scenario),
    `index.${scenario.profile.extension}`
  );
}

function moduleFile(mode: Mode, scenario: Scenario): string {
  return path.join(
    scenarioRoot(mode, scenario),
    "servercase",
    `Main.${scenario.profile.extension}`
  );
}

function projectTemplate(project: ProjectName): string {
  return path.join(fixtureRoot, "templates", project);
}

function resetProject(project: ProjectName): void {
  const target = workspace(project);
  rmSync(target, { recursive: true, force: true });
  cpSync(projectTemplate(project), target, { recursive: true });
}

/**
 * Restores authored files without replacing the active project directory.
 *
 * Why: a compiler-server request uses the project directory as its compilation
 * context. Editors replace or rewrite individual files; deleting that entire
 * directory while the server owns it is a different lifecycle operation.
 *
 * What/How: copy the reviewed template back over the live fixture. This
 * restores edited and deleted source files while preserving the exact `--cwd`
 * identity used by every request for that project.
 */
function restoreProject(project: ProjectName): void {
  cpSync(projectTemplate(project), workspace(project), {
    recursive: true,
    force: true
  });
}

function replaceInFile(
  file: string,
  before: string,
  after: string
): void {
  const source = readFileSync(file, "utf8");
  ok(source.includes(before), `${file} does not contain ${before}`);
  writeFileSync(file, source.replace(before, after), "utf8");
}

/** Copies test-owned runtime modules beside one generated Haxe module. */
function installRuntime(mode: Mode, scenario: Scenario): void {
  const target = path.join(
    scenarioRoot(mode, scenario),
    "servercase",
    "runtime"
  );
  mkdirSync(target, { recursive: true });
  cpSync(
    path.join(workspace(scenario.project), "runtime"),
    target,
    { recursive: true }
  );
}

function buildArguments(mode: Mode, scenario: Scenario): string[] {
  return [
    "-cp",
    path.join(repoRoot, "src"),
    "-lib",
    "helder.set",
    "-D",
    `genes-ts=${genesVersion}`,
    "--macro",
    "genes.Generator.use()",
    "--macro",
    "genes.js.Async.enable()",
    "--macro",
    "genes.react.InlineMarkup.enable()",
    "--macro",
    "addMetadata('@:genes.disableNativeAccessors', 'haxe.Exception')",
    "-cp",
    path.join(workspace(scenario.project), "src"),
    "--main",
    "servercase.Main",
    "-js",
    scenarioOutput(mode, scenario),
    "-D",
    "js-es=6",
    "-D",
    "no-deprecation-warnings",
    // Haxe's server selects native typed-module caches by compilation
    // signature, not by classpath identity. Keep the two same-name fixture
    // projects in separate Haxe caches so this test isolates Genes'
    // process-persistent macro state instead of exercising an upstream
    // cross-project module-name collision.
    "-D",
    `genes_server_fixture_project=${scenario.project}`,
    "-dce",
    "full",
    "-debug",
    ...[...scenario.profile.defines, ...(scenario.defines ?? [])]
      .flatMap((define) => ["-D", define])
  ];
}

function resultText(result: ProcessResult): string {
  return `${result.stdout}${result.stderr}`;
}

function assertSuccess(result: ProcessResult, label: string, server = ""): void {
  ok(
    result.code === 0,
    `${label} failed with code ${String(result.code)}`
    + ` signal ${String(result.signal)}`
    + `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    + (server.length === 0 ? "" : `\nserver:\n${server}`)
  );
}

function assertNoPrivateDebris(mode: Mode, scenario: Scenario): void {
  deepStrictEqual(
    leakedOutputStages(scenarioRoot(mode, scenario)),
    [],
    `${mode} ${scenario.id} left a private transaction stage`
  );
  strictEqual(
    existsSync(compilerOutputSentinel(scenarioOutput(mode, scenario))),
    false,
    `${mode} ${scenario.id} left its private Haxe output sentinel`
  );
}

function assertManifest(mode: Mode, scenario: Scenario): void {
  const entries = readdirSync(scenarioRoot(mode, scenario));
  ok(
    entries.some((entry) =>
      entry.startsWith(".genes-output-") && entry.endsWith(".manifest")),
    `${mode} ${scenario.id} did not publish an ownership manifest`
  );
}

async function compileCold(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  scenario: Scenario,
  timeoutMs: number
): Promise<ProcessResult> {
  installRuntime("cold", scenario);
  return await runBoundedProcess(
    compiler.binary,
    buildArguments("cold", scenario),
    {
      cwd: workspace(scenario.project),
      timeoutMs,
      label: `Cold ${scenario.id}`
    }
  );
}

async function compileWarm(
  server: OwnedHaxeCompilerServer,
  scenario: Scenario,
  timeoutMs: number
): Promise<ProcessResult> {
  installRuntime("warm", scenario);
  return await server.compile(
    buildArguments("warm", scenario),
    `Warm ${scenario.id}`,
    timeoutMs,
    workspace(scenario.project)
  );
}

async function compilePair(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  server: OwnedHaxeCompilerServer,
  scenario: Scenario,
  timeoutMs: number
): Promise<ReadonlyArray<TreeEntry>> {
  rmSync(scenarioRoot("cold", scenario), { recursive: true, force: true });
  rmSync(scenarioRoot("warm", scenario), { recursive: true, force: true });
  const cold = await compileCold(compiler, scenario, timeoutMs);
  assertSuccess(cold, `Cold ${scenario.id}`);
  const warm = await compileWarm(server, scenario, timeoutMs);
  assertSuccess(warm, `Warm ${scenario.id}`, server.logs);
  assertManifest("cold", scenario);
  assertManifest("warm", scenario);
  assertNoPrivateDebris("cold", scenario);
  assertNoPrivateDebris("warm", scenario);
  const coldTree = hashTree(scenarioRoot("cold", scenario));
  const warmTree = hashTree(scenarioRoot("warm", scenario));
  deepStrictEqual(
    warmTree,
    coldTree,
    `Warm ${scenario.id} output differs from its isolated cold build`
  );
  return warmTree;
}

function assertContains(file: string, text: string): void {
  const source = readFileSync(file, "utf8");
  ok(source.includes(text), `${file} does not contain ${text}`);
}

function assertNotContains(file: string, text: string): void {
  const source = readFileSync(file, "utf8");
  ok(!source.includes(text), `${file} unexpectedly contains ${text}`);
}

function generatedPoint(source: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const offset = source.indexOf(needle);
  ok(offset >= 0, `Generated source does not contain ${needle}`);
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0
  };
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset >= 0, `Authored source does not contain ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function assertModuleFunctionSourceMap(scenario: Scenario): void {
  const sourcePath = moduleFile("cold", scenario);
  const source = readFileSync(sourcePath, "utf8");
  const needle = "function serverTransformA";
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${sourcePath}.map`, "utf8")
  ) as RawSourceMap);
  const original = map.originalPositionFor({
    ...generatedPoint(source, needle),
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(
    original.source?.endsWith("src/servercase/Main.hx"),
    "Module-function token does not map to the current project source"
  );
  const authored = readFileSync(
    path.join(workspace("project-a"), "src/servercase/Main.hx"),
    "utf8"
  );
  strictEqual(
    original.line,
    sourceLine(authored, "public static function transform<T>"),
    "Module-function token maps to the wrong authored line"
  );
}

function writeTypeScriptConfigs(): {
  readonly matrix: string;
  readonly runtime: string;
} {
  const matrix = path.join(tempRoot, "tsconfig.matrix.json");
  const runtime = path.join(tempRoot, "tsconfig.runtime.json");
  const declarationConsumer = path.join(
    tempRoot,
    "classic-declaration-consumer.ts"
  );
  writeFileSync(declarationConsumer, `
import {LibraryApi as ProjectAApi} from "./out/cold/a-classic-library/servercase/Main.js";
import {SharedValue as ProjectAValue} from "./out/cold/a-classic-library/servercase/SharedValue.js";
import {LibraryApi as ProjectBApi} from "./out/cold/b-classic/servercase/Main.js";
import {SharedValue as ProjectBValue} from "./out/cold/b-classic/servercase/SharedValue.js";

const projectAResult: string =
  new ProjectAApi().label(new ProjectAValue("current-a"));
const projectBResult: number =
  new ProjectBApi().count(new ProjectBValue(21));

// @ts-expect-error Project A must not inherit Project B's numeric value type.
new ProjectAValue(21);
// @ts-expect-error Project B must not inherit Project A's string value type.
new ProjectBValue("stale-b");

void [projectAResult, projectBResult];
`.trimStart(), "utf8");
  writeFileSync(matrix, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      resolveJsonModule: true,
      verbatimModuleSyntax: true,
      allowSyntheticDefaultImports: true,
      jsx: "preserve",
      types: []
    },
    include: [
      "out/cold/a-ts-baseline/**/*.ts",
      "out/cold/a-tsx/**/*.tsx",
      "out/cold/a-library/**/*.ts",
      "out/cold/a-explicit-witness-int/**/*.ts",
      "out/cold/a-imports/**/*.ts",
      "out/cold/b-ts/**/*.ts",
      "out/cold/a-return-final/**/*.ts",
      "out/cold/a-classic-library/**/*.d.ts",
      "out/cold/b-classic/**/*.d.ts",
      "classic-declaration-consumer.ts"
    ]
  }, null, 2), "utf8");
  writeFileSync(runtime, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: false,
      rootDir: "out/cold/a-ts-baseline",
      outDir: "runtime-dist",
      sourceMap: true,
      verbatimModuleSyntax: true,
      types: []
    },
    include: ["out/cold/a-ts-baseline/**/*.ts"]
  }, null, 2), "utf8");
  return { matrix, runtime };
}

async function runRuntimeEvidence(
  classicScenario: Scenario,
  configs: ReturnType<typeof writeTypeScriptConfigs>
): Promise<void> {
  const classic = runBoundedProcess(
    process.execPath,
    [scenarioOutput("cold", classicScenario)],
    {
      cwd: repoRoot,
      timeoutMs: 60_000,
      label: "Classic compiler-server runtime"
    }
  );
  const runtimeDist = path.join(tempRoot, "runtime-dist");
  rmSync(runtimeDist, { recursive: true, force: true });
  runTypeScript("legacyFloor", ["-p", configs.runtime]);
  const runtimeTarget = path.join(runtimeDist, "servercase", "runtime");
  mkdirSync(runtimeTarget, { recursive: true });
  cpSync(
    path.join(workspace("project-a"), "runtime"),
    runtimeTarget,
    { recursive: true }
  );
  const typed = runBoundedProcess(
    process.execPath,
    [path.join(runtimeDist, "index.js")],
    {
      cwd: repoRoot,
      timeoutMs: 60_000,
      label: "TypeScript compiler-server runtime"
    }
  );

  const results = await Promise.all([classic, typed]);
  for (const [index, result] of results.entries()) {
    assertSuccess(
      result,
      index === 0
        ? "Classic compiler-server runtime"
        : "TypeScript compiler-server runtime"
    );
    ok(
      resultText(result).includes("project-a:a1:extra-a-v1"),
      `Runtime ${index} did not execute the current Project A tree`
    );
  }
}

async function assertFailureRollback(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  server: OwnedHaxeCompilerServer,
  timeoutMs: number
): Promise<void> {
  const profiles = [
    { id: "ts", profile: tsProfile },
    { id: "classic", profile: classicDeclarationProfile }
  ] as const;
  const failures = [
    {
      id: "diagnostic",
      define: "genes.output_transaction_test_fail_before_commit",
      message: "Genes output transaction test failure before publication"
    },
    {
      id: "raw",
      define: "genes.output_transaction_test_raw_throw_before_commit",
      message: "Genes raw output transaction test failure before publication"
    }
  ] as const;

  for (const profile of profiles) {
    const good: Scenario = {
      id: `failure-state-${profile.id}`,
      project: "project-a",
      profile: profile.profile
    };
    rmSync(scenarioRoot("cold", good), { recursive: true, force: true });
    rmSync(scenarioRoot("warm", good), { recursive: true, force: true });
    const coldInitial = await compileCold(compiler, good, timeoutMs);
    const warmInitial = await compileWarm(server, good, timeoutMs);
    assertSuccess(coldInitial, `Cold ${profile.id} transaction baseline`);
    assertSuccess(
      warmInitial,
      `Warm ${profile.id} transaction baseline`,
      server.logs
    );
    assertManifest("cold", good);
    assertManifest("warm", good);
    assertNoPrivateDebris("cold", good);
    assertNoPrivateDebris("warm", good);
    const coldBefore = hashTree(scenarioRoot("cold", good));
    const warmBefore = hashTree(scenarioRoot("warm", good));
    if (compiler.version === toolchains.haxe.stable) {
      deepStrictEqual(
        warmBefore,
        coldBefore,
        `Stable warm ${profile.id} baseline differs from its cold build`
      );
    }

    for (const failure of failures) {
      const failing: Scenario = {
        ...good,
        defines: [failure.define]
      };
      const coldFailure = await runBoundedProcess(
        compiler.binary,
        buildArguments("cold", failing),
        {
          cwd: workspace(failing.project),
          timeoutMs,
          label: `Cold ${profile.id} ${failure.id} transaction failure`
        }
      );
      const warmFailure = await server.compile(
        buildArguments("warm", failing),
        `Warm ${profile.id} ${failure.id} transaction failure`,
        timeoutMs,
        workspace(failing.project)
      );
      for (const [mode, result] of [
        ["cold", coldFailure],
        ["warm", warmFailure]
      ] as const) {
        ok(
          result.code !== 0,
          `${mode} ${profile.id} ${failure.id} failure succeeded`
        );
        ok(
          resultText(result).includes(failure.message),
          `${mode} ${profile.id} ${failure.id} failure omitted its diagnostic`
          + `:\n${resultText(result)}`
        );
      }
      deepStrictEqual(
        hashTree(scenarioRoot("cold", good)),
        coldBefore,
        `Cold ${profile.id} ${failure.id} failure changed the prior tree`
      );
      deepStrictEqual(
        hashTree(scenarioRoot("warm", good)),
        warmBefore,
        `Warm ${profile.id} ${failure.id} failure changed the prior tree`
      );
      assertNoPrivateDebris("cold", good);
      assertNoPrivateDebris("warm", good);
    }

    const coldRecovery = await compileCold(compiler, good, timeoutMs);
    const warmRecovery = await compileWarm(server, good, timeoutMs);
    assertSuccess(coldRecovery, `Cold ${profile.id} transaction recovery`);
    assertSuccess(
      warmRecovery,
      `Warm ${profile.id} transaction recovery`,
      server.logs
    );
    assertNoPrivateDebris("cold", good);
    assertNoPrivateDebris("warm", good);
    deepStrictEqual(
      hashTree(scenarioRoot("cold", good)),
      coldBefore,
      `Corrected cold ${profile.id} request differs from its last-good tree`
    );
    deepStrictEqual(
      hashTree(scenarioRoot("warm", good)),
      warmBefore,
      `Corrected warm ${profile.id} request differs from its last-good tree`
    );
    if (compiler.version === toolchains.haxe.stable) {
      deepStrictEqual(
        hashTree(scenarioRoot("warm", good)),
        hashTree(scenarioRoot("cold", good)),
        `Corrected warm ${profile.id} request differs from corrected cold output`
      );
    }
  }
}

async function assertCapabilityIsolation(
  compiler: ReturnType<typeof selectedHaxeCompiler>,
  server: OwnedHaxeCompilerServer,
  timeoutMs: number
): Promise<void> {
  const scenario: Scenario = {
    id: "capability-disabled",
    project: "project-a",
    profile: { extension: "mjs", defines: [] },
    defines: ["server_import_matrix", "genes.disable"]
  };
  rmSync(scenarioRoot("cold", scenario), { recursive: true, force: true });
  rmSync(scenarioRoot("warm", scenario), { recursive: true, force: true });
  const cold = await runBoundedProcess(
    compiler.binary,
    buildArguments("cold", scenario),
    {
      cwd: workspace(scenario.project),
      timeoutMs,
      label: "Cold disabled capability"
    }
  );
  const warm = await server.compile(
    buildArguments("warm", scenario),
    "Warm disabled capability",
    timeoutMs,
    workspace(scenario.project)
  );
  const authored = readFileSync(
    path.join(workspace("project-a"), "src/servercase/Main.hx"),
    "utf8"
  );
  const expectedLine = sourceLine(
    authored,
    'Imports.sideEffect("./runtime/side-effect.js")'
  );
  for (const [label, result] of [["cold", cold], ["warm", warm]] as const) {
    const output = resultText(result);
    ok(result.code !== 0, `${label} disabled capability unexpectedly compiled`);
    ok(
      output.includes("GENES-SIDE-EFFECT-IMPORT-TARGET-001"),
      `${label} disabled capability omitted its diagnostic:\n${output}`
    );
    ok(
      output.includes(`Main.hx:${expectedLine}:`),
      `${label} disabled capability lost the authored source range:\n${output}`
    );
  }
  ok(
    !existsSync(scenarioOutput("cold", scenario)),
    "Cold disabled capability published an entrypoint"
  );
  ok(
    !existsSync(scenarioOutput("warm", scenario)),
    "Warm disabled capability published an entrypoint"
  );
  assertNoPrivateDebris("cold", scenario);
  assertNoPrivateDebris("warm", scenario);
}

type UnrelatedListener = {
  readonly server: Server;
  readonly connections: () => number;
};

async function listeningServer(): Promise<UnrelatedListener> {
  const server = createServer();
  let connections = 0;
  server.on("connection", (socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, connections: () => connections };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function assertBoundedClientTimeout(): Promise<void> {
  let failed = false;
  try {
    await runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        cwd: repoRoot,
        timeoutMs: 100,
        label: "Lifecycle timeout probe"
      }
    );
  } catch (error: unknown) {
    failed = true;
    ok(String(error).includes("timed out after 100ms"));
  }
  ok(failed, "Bounded process helper did not time out a hung client");
}

async function killSignalProbeGroup(
  child: ChildProcess,
  label: string
): Promise<void> {
  const pid = child.pid;
  ok(pid !== undefined, `${label} has no process ID`);
  try {
    // The probe is its own process-group leader. Haxe inherits that group, so
    // this failure path cannot bypass the probe's handler and orphan Haxe.
    process.kill(-pid, "SIGKILL");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
  // Group termination protects the Haxe grandchild; the shared bounded
  // terminator then reaps and proves death of the exact Node group leader.
  await terminateOwnedChild(child, label);
}

function waitForSignalProbe(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      void killSignalProbeGroup(child, "Signal cleanup startup probe").then(
        () => reject(new Error(
          `Signal cleanup probe did not report its server PID`
          + `\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )),
        reject
      );
    }, 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = /SERVER_PID=(\d+)/.exec(stdout);
      if (match === null) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForChildExit(child: ChildProcess): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void killSignalProbeGroup(child, "Signal cleanup exit probe").then(
        () => reject(new Error("Signal cleanup probe did not exit")),
        reject
      );
    }, 10_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function assertSignalCleanup(): Promise<void> {
  if (process.platform === "win32") return;
  const child = spawn(process.execPath, [scriptFile, "--signal-probe"], {
    cwd: repoRoot,
    // A private process group lets timeout/error cleanup terminate both this
    // Node probe and its owned Haxe child even if the Node handler is wedged.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const serverPid = await waitForSignalProbe(child);
  child.kill("SIGTERM");
  const exit = await waitForChildExit(child);
  ok(
    exit.signal === "SIGTERM" || exit.code === 143,
    `Signal probe exited with code ${String(exit.code)}`
    + ` signal ${String(exit.signal)}`
  );
  let serverAlive = true;
  try {
    process.kill(serverPid, 0);
  } catch {
    serverAlive = false;
  }
  ok(!serverAlive, `Signal cleanup left Haxe server ${serverPid} alive`);
}

async function runSignalProbe(): Promise<void> {
  const server = await OwnedHaxeCompilerServer.start(repoRoot);
  server.installSignalCleanup();
  process.stdout.write(`SERVER_PID=${String(server.process.pid)}\n`);
  await new Promise(() => {
    // The parent sends SIGTERM after it has captured the exact server PID.
  });
}

/**
 * Runs only the generation-failure contract on the selected Haxe lane.
 *
 * Why: Haxe preview currently has a separately documented cold/warm typed-AST
 * variance in `genes/Register.ts`. The complete server matrix must keep
 * reporting that difference, but it should not prevent us from observing
 * whether preview wraps a raw thrown value and lets Genes restore each
 * process's own last-good output.
 *
 * What/How: both TS and classic declaration profiles establish independent
 * cold and warm baselines, fail after private staging, compare each tree with
 * its own baseline, then compile successfully again. Stable Haxe additionally
 * requires cold and warm trees to be identical.
 */
async function runRollbackProbe(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  resetProject("project-a");
  const compiler = selectedHaxeCompiler(repoRoot);
  const timeoutMs = compiler.version === toolchains.haxe.preview
    ? 120_000
    : 60_000;
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  try {
    await assertFailureRollback(compiler, server, timeoutMs);
  } finally {
    await server.stop();
  }
  deepStrictEqual(
    leakedOutputStages(outputRoot),
    [],
    "Rollback probe left a private output stage"
  );
  process.stdout.write(
    `compiler-server-rollback:ok (Haxe ${compiler.version}; `
    + "TS/classic, structured/raw throws, cold/warm recovery)\n"
  );
}

async function main(): Promise<void> {
  rmSync(tempRoot, { recursive: true, force: true });
  resetProject("project-a");
  resetProject("project-b");
  await assertBoundedClientTimeout();
  await assertSignalCleanup();

  const compiler = selectedHaxeCompiler(repoRoot);
  const timeoutMs = compiler.version === toolchains.haxe.preview
    ? 120_000
    : 60_000;
  const unrelated = await listeningServer();
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();

  const baseline: Scenario = {
    id: "a-ts-baseline",
    project: "project-a",
    profile: tsProfile
  };
  let baselineTree: ReadonlyArray<TreeEntry> = [];
  let classicRuntime: Scenario | null = null;
  try {
    baselineTree = await compilePair(compiler, server, baseline, timeoutMs);
    assertContains(moduleFile("cold", baseline), '"server-project-a-v1"');
    assertContains(moduleFile("cold", baseline), "function serverTransformA");
    assertContains(moduleFile("cold", baseline), "identity<string>");
    assertModuleFunctionSourceMap(baseline);

    deepStrictEqual(
      await compilePair(compiler, server, baseline, timeoutMs),
      baselineTree,
      "Identical warm TypeScript request changed generated bytes"
    );

    classicRuntime = {
      id: "a-classic",
      project: "project-a",
      profile: classicProfile
    };
    await compilePair(compiler, server, classicRuntime, timeoutMs);
    assertContains(moduleFile("cold", classicRuntime), '"server-project-a-v1"');
    assertContains(
      path.join(
        scenarioRoot("cold", classicRuntime),
        "servercase",
        "Main.d.ts"
      ),
      "transform<T>(value: T): T"
    );

    const tsx: Scenario = {
      id: "a-tsx",
      project: "project-a",
      profile: tsxProfile
    };
    await compilePair(compiler, server, tsx, timeoutMs);
    ok(existsSync(moduleFile("cold", tsx)), "TSX request emitted no .tsx module");

    const moved: Scenario = {
      id: "a-ts-moved-root",
      project: "project-a",
      profile: tsProfile
    };
    await compilePair(compiler, server, moved, timeoutMs);

    const mainPath = path.join(
      workspace("project-a"),
      "src/servercase/Main.hx"
    );
    const extraPath = path.join(
      workspace("project-a"),
      "src/servercase/Extra.hx"
    );
    replaceInFile(mainPath, "server-project-a-v1", "server-project-a-v2");
    replaceInFile(mainPath, "serverTransformA", "serverTransformZ");
    replaceInFile(mainPath, 'REVISION = "a1"', 'REVISION = "a2"');
    replaceInFile(extraPath, "extra-a-v1", "extra-a-v2");
    const edited: Scenario = {
      id: "a-edited",
      project: "project-a",
      profile: tsProfile
    };
    await compilePair(compiler, server, edited, timeoutMs);
    assertContains(moduleFile("cold", edited), '"server-project-a-v2"');
    assertContains(moduleFile("cold", edited), "function serverTransformZ");
    assertContains(
      path.join(scenarioRoot("cold", edited), "servercase", "Extra.ts"),
      '"extra-a-v2"'
    );
    assertNotContains(moduleFile("cold", edited), "serverTransformA");

    restoreProject("project-a");
    const withRemoved: Scenario = {
      id: "a-with-removed",
      project: "project-a",
      profile: tsProfile,
      defines: ["server_removed"]
    };
    await compilePair(compiler, server, withRemoved, timeoutMs);
    ok(
      existsSync(path.join(
        scenarioRoot("cold", withRemoved),
        "servercase",
        "Removed.ts"
      )),
      "Referenced removable module was not emitted"
    );
    rmSync(
      path.join(workspace("project-a"), "src/servercase/Removed.hx")
    );
    const afterDelete: Scenario = {
      id: "a-after-delete",
      project: "project-a",
      profile: tsProfile
    };
    await compilePair(compiler, server, afterDelete, timeoutMs);
    ok(
      !existsSync(path.join(
        scenarioRoot("warm", afterDelete),
        "servercase",
        "Removed.ts"
      )),
      "Warm request retained a deleted, unreachable module"
    );

    restoreProject("project-a");
    const alternateWitness: Scenario = {
      id: "a-explicit-witness-int",
      project: "project-a",
      profile: tsProfile,
      defines: ["server_numeric_witness"]
    };
    await compilePair(compiler, server, alternateWitness, timeoutMs);
    assertContains(
      moduleFile("cold", alternateWitness),
      "identity<number>"
    );
    assertNotContains(
      moduleFile("cold", alternateWitness),
      "identity<string>"
    );

    const restored: Scenario = {
      ...baseline,
      id: "a-restored"
    };
    deepStrictEqual(
      await compilePair(compiler, server, restored, timeoutMs),
      baselineTree,
      "Edit/delete/restore did not reproduce the first generated tree"
    );

    const library: Scenario = {
      id: "a-library",
      project: "project-a",
      profile: tsProfile,
      defines: ["genes.library"]
    };
    await compilePair(compiler, server, library, timeoutMs);
    assertContains(
      moduleFile("cold", library),
      "export class LibraryApi"
    );
    assertContains(
      path.join(
        scenarioRoot("cold", library),
        "servercase",
        "SharedValue.ts"
      ),
      "declare label: string"
    );

    const classicLibrary: Scenario = {
      id: "a-classic-library",
      project: "project-a",
      profile: classicDeclarationProfile,
      defines: ["genes.library"]
    };
    await compilePair(compiler, server, classicLibrary, timeoutMs);
    assertContains(
      path.join(
        scenarioRoot("cold", classicLibrary),
        "servercase",
        "SharedValue.d.ts"
      ),
      "label: string"
    );

    const imports: Scenario = {
      id: "a-imports",
      project: "project-a",
      profile: tsProfile,
      defines: ["server_import_matrix"]
    };
    await compilePair(compiler, server, imports, timeoutMs);
    const importSource = readFileSync(moduleFile("cold", imports), "utf8");
    ok(importSource.includes(
      'import * as DefaultMarker from "./runtime/package.js"'
    ));
    ok(importSource.includes(
      'import {identity, NamedMarker} from "./runtime/package.js"'
    ));
    ok(importSource.includes(
      'import ConfigMarker from "./runtime/config.json" with { type: "json" }'
    ));
    ok(importSource.includes('import "./runtime/side-effect.js"'));

    const projectB: Scenario = {
      id: "b-ts",
      project: "project-b",
      profile: tsProfile,
      defines: ["genes.library"]
    };
    await compilePair(compiler, server, projectB, timeoutMs);
    assertContains(moduleFile("cold", projectB), '"server-project-b-v1"');
    assertContains(moduleFile("cold", projectB), "function serverTransformB");
    assertContains(moduleFile("cold", projectB), "identity<number>");
    assertContains(
      path.join(
        scenarioRoot("cold", projectB),
        "servercase",
        "SharedValue.ts"
      ),
      "declare count: number"
    );
    assertNotContains(moduleFile("cold", projectB), "server-project-a");

    const projectBClassic: Scenario = {
      id: "b-classic",
      project: "project-b",
      profile: classicDeclarationProfile,
      defines: ["genes.library"]
    };
    await compilePair(compiler, server, projectBClassic, timeoutMs);

    await assertFailureRollback(compiler, server, timeoutMs);
    await assertCapabilityIsolation(compiler, server, timeoutMs);

    const finalReturn: Scenario = {
      ...baseline,
      id: "a-return-final"
    };
    deepStrictEqual(
      await compilePair(compiler, server, finalReturn, timeoutMs),
      baselineTree,
      "Project B or failed requests contaminated the final Project A tree"
    );
  } finally {
    await server.stop();
    ok(
      unrelated.server.listening,
      "Owned Haxe cleanup terminated the unrelated listener"
    );
    strictEqual(
      unrelated.connections(),
      0,
      "Compiler-server harness contacted an unrelated local listener"
    );
    await closeServer(unrelated.server);
  }

  ok(classicRuntime !== null, "Classic runtime scenario was not built");
  const configs = writeTypeScriptConfigs();
  runGeneratedTypeScriptMatrix(
    path.relative(repoRoot, configs.matrix),
    { emit: false }
  );
  await runRuntimeEvidence(classicRuntime, configs);
  deepStrictEqual(
    leakedOutputStages(outputRoot),
    [],
    "Compiler-server fixture left a private output stage"
  );
  process.stdout.write(
    `compiler-server:ok (Haxe ${compiler.version}; `
    + "cold/warm profiles, typed witnesses, edits, projects, rollback, "
    + "capability, cleanup)\n"
  );
}

if (process.argv.includes("--signal-probe")) {
  await runSignalProbe();
} else if (process.argv.includes("--rollback-only")) {
  await runRollbackProbe();
} else {
  await main();
}
