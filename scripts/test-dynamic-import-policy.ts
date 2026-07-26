import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  execFileSync,
  spawn,
  type ChildProcess
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = "tests/dynamic-import-policy";
const generatedRoot = `${fixtureRoot}/out`;

/**
 * Proves that lazy imports use runtime filenames, not generated-source names.
 *
 * Why: `Genes.dynamicImport()` runs during Haxe typing, and the compilation
 * server may cache that typed expansion across `.ts`, `.tsx`, `.js`, `.jsx`,
 * and `.mjs` requests. A cold-only source assertion cannot expose stale
 * request policy or stale typed declarations.
 *
 * What/How: this harness builds every supported suffix profile cold, repeats a
 * profile-switching sequence through one owned Haxe server, and compares every
 * warm tree byte-for-byte with its cold counterpart. It also type-checks the
 * TS surfaces on TS 5/6/7, executes real `.mjs` output, checks exact authored
 * source-map provenance, and rejects leaked carrier/staging/sentinel artifacts.
 */
type ProfileName =
  | "classic-js"
  | "classic-mjs"
  | "classic-jsx"
  | "classic-no-extension"
  | "ts"
  | "tsx"
  | "ts-no-extension";

type Profile = {
  readonly name: ProfileName;
  readonly artifactExtension: "js" | "jsx" | "mjs" | "ts" | "tsx";
  readonly expectedRuntimeExtension: "" | ".js" | ".mjs";
  readonly defines: ReadonlyArray<string>;
};

type TreeEntry = {
  readonly path: string;
  readonly sha256: string;
};

const profiles: ReadonlyArray<Profile> = [
  {
    name: "classic-js",
    artifactExtension: "js",
    expectedRuntimeExtension: ".js",
    defines: []
  },
  {
    name: "classic-mjs",
    artifactExtension: "mjs",
    expectedRuntimeExtension: ".mjs",
    defines: []
  },
  {
    name: "classic-jsx",
    artifactExtension: "jsx",
    expectedRuntimeExtension: ".js",
    defines: []
  },
  {
    name: "classic-no-extension",
    artifactExtension: "js",
    expectedRuntimeExtension: "",
    defines: ["genes.no_extension"]
  },
  {
    name: "ts",
    artifactExtension: "ts",
    expectedRuntimeExtension: ".js",
    defines: ["genes.ts"]
  },
  {
    name: "tsx",
    artifactExtension: "tsx",
    expectedRuntimeExtension: ".js",
    defines: ["genes.ts"]
  },
  {
    name: "ts-no-extension",
    artifactExtension: "ts",
    expectedRuntimeExtension: "",
    defines: ["genes.ts", "genes.ts.no_extension"]
  }
];

function profile(name: ProfileName): Profile {
  const found = profiles.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Unknown dynamic-import test profile: ${name}`);
  }
  return found;
}

function selectedHaxeBinary(): string {
  const executable = process.platform === "win32" ? "haxe.exe" : "haxe";
  const explicitStdPath = process.env.HAXE_STD_PATH;
  const binary = explicitStdPath !== undefined
    ? path.join(path.dirname(explicitStdPath), executable)
    : path.join(
      homedir(),
      "haxe",
      "versions",
      execFileSync("haxe", ["--version"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim(),
      executable
    );
  ok(existsSync(binary), `Selected Haxe compiler does not exist: ${binary}`);
  return binary;
}

function outputRoot(mode: "cold" | "warm", current: Profile): string {
  return `${generatedRoot}/${mode}/${current.name}`;
}

function outputFile(mode: "cold" | "warm", current: Profile): string {
  return `${outputRoot(mode, current)}/index.${current.artifactExtension}`;
}

function moduleFile(mode: "cold" | "warm", current: Profile): string {
  return path.join(
    repoRoot,
    outputRoot(mode, current),
    "dynamicimportpolicy",
    `Main.${current.artifactExtension}`
  );
}

function generatedPoint(source: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Generated source contains ${needle}`);
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0
  };
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Haxe source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function buildArguments(
  mode: "cold" | "warm",
  current: Profile,
  port?: number
): string[] {
  return [
    ...(port === undefined ? [] : ["--connect", `127.0.0.1:${port}`]),
    "-lib", "genes-ts",
    "-cp", `${fixtureRoot}/src`,
    "--main", "dynamicimportpolicy.Main",
    "--macro", "include('dynamicimportpolicy.Target')",
    "-js", outputFile(mode, current),
    "-D", "js-es=6",
    "-debug",
    ...current.defines.flatMap((define) => ["-D", define])
  ];
}

function assertRequest(mode: "cold" | "warm", current: Profile): void {
  const source = readFileSync(moduleFile(mode, current), "utf8");
  const expected = `import("./Target${current.expectedRuntimeExtension}")`;
  ok(source.includes(expected),
    `${current.name} did not emit the runtime request ${expected}`);

  const wrongArtifactSuffix = `import("./Target.${current.artifactExtension}")`;
  if (current.expectedRuntimeExtension !== `.${current.artifactExtension}`) {
    ok(!source.includes(wrongArtifactSuffix),
      `${current.name} reused its source artifact extension at runtime`);
  }
  ok(!source.includes("DynamicImportMarker"),
    `${current.name} leaked the compiler-only dynamic-import carrier`);

  const mapPath = `${moduleFile(mode, current)}.map`;
  ok(existsSync(mapPath), `${current.name} did not publish its source map`);
  const authoredPath = path.join(
    repoRoot,
    fixtureRoot,
    "src/dynamicimportpolicy/Main.hx"
  );
  const authored = readFileSync(authoredPath, "utf8");
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(mapPath, "utf8")
  ) as RawSourceMap);
  const original = map.originalPositionFor({
    ...generatedPoint(source, expected),
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(original.source?.endsWith("src/dynamicimportpolicy/Main.hx"),
    `${current.name} dynamic request does not map to the authored macro call`);
  strictEqual(
    original.line,
    sourceLine(authored, "Genes.dynamicImport(Target ->"),
    `${current.name} dynamic request maps to the wrong Haxe source line`
  );
}

function hashTree(relativeRoot: string): ReadonlyArray<TreeEntry> {
  const root = path.join(repoRoot, relativeRoot);
  const entries: TreeEntry[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          sha256: createHash("sha256")
            .update(readFileSync(absolute))
            .digest("hex")
        });
      }
    }
  }

  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** Returns any private transaction stages still present below the fixture. */
function leakedStages(): ReadonlyArray<string> {
  const root = path.join(repoRoot, generatedRoot);
  const stages: string[] = [];

  function visit(directory: string): void {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (/^\.genes-output-.*\.stage$/.test(entry.name)) {
          stages.push(path.relative(root, absolute));
        } else {
          visit(absolute);
        }
      }
    }
  }

  visit(root);
  return stages.sort();
}

/**
 * Reconstructs the private Haxe output sentinel owned by `Generator`.
 *
 * The sentinel is outside the generated tree so Haxe cannot delete a last-good
 * public entrypoint after a custom-generator error. Its key is deterministic
 * from the absolute configured `-js` path, which lets this focused harness
 * prove cleanup without matching or deleting another compiler process's file.
 */
function compilerSentinel(
  mode: "cold" | "warm",
  current: Profile
): string {
  const destination = path.resolve(repoRoot, outputFile(mode, current))
    .split(path.sep).join("/");
  const key = createHash("sha256").update(destination).digest("hex")
    .slice(0, 20);
  return path.join(tmpdir(), `genes-haxe-output-${key}.tmp`);
}

async function unusedLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Port reservation did not return a TCP address"));
        return;
      }
      probe.close((error) => error === undefined
        ? resolve(address.port)
        : reject(error));
    });
  });
}

function runClient(
  haxeBinary: string,
  args: ReadonlyArray<string>,
  timeoutMs: number
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(haxeBinary, [...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-64_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(
        `Haxe client timed out after ${timeoutMs}ms:\n${stdout}${stderr}`
      ));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(
          `Haxe client exited with code ${String(code)}`
          + ` signal ${String(signal)}:\n${stdout}${stderr}`
        ));
      }
    });
  });
}

function waitForExit(server: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (server.exitCode !== null || server.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function stopOwnedServer(server: ChildProcess): Promise<void> {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    if (!await waitForExit(server, 2_000)) {
      server.kill("SIGKILL");
      ok(await waitForExit(server, 2_000),
        "Owned Haxe compiler server did not exit after SIGKILL");
    }
  }
  const pid = server.pid;
  if (pid !== undefined && process.platform !== "win32") {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    ok(!alive, `Owned Haxe compiler server process ${pid} is still alive`);
  }
}

function isStartupConnectionFailure(message: string): boolean {
  return /connect|connection|refused|reset|server/i.test(message);
}

async function compileWarm(
  haxeBinary: string,
  port: number,
  current: Profile,
  server: ChildProcess,
  serverLogs: () => string
): Promise<void> {
  const args = buildArguments("warm", current, port);
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const result = await runClient(haxeBinary, args, 60_000);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (server.exitCode !== null || server.signalCode !== null) {
        throw new Error(`Haxe server exited before ${current.name}:\n${serverLogs()}`);
      }
      if (Date.now() >= deadline || !isStartupConnectionFailure(message)) {
        throw new Error(
          `Warm ${current.name} compilation failed:\n${message}\n${serverLogs()}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function runWarmSequence(haxeBinary: string): Promise<void> {
  const port = await unusedLocalPort();
  let serverLog = "";
  const server = spawn(
    haxeBinary,
    ["--server-listen", `127.0.0.1:${port}`],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
  );
  server.stdout?.on("data", (chunk: Buffer) => {
    serverLog = `${serverLog}${chunk.toString("utf8")}`.slice(-64_000);
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverLog = `${serverLog}${chunk.toString("utf8")}`.slice(-64_000);
  });
  server.once("error", (error) => {
    serverLog = `${serverLog}\nserver error: ${String(error)}`.slice(-64_000);
  });

  const sequence: ReadonlyArray<ProfileName> = [
    "ts",
    "ts",
    "classic-mjs",
    "classic-mjs",
    "classic-js",
    "classic-jsx",
    "tsx",
    "tsx",
    "ts-no-extension",
    "classic-no-extension",
    "ts"
  ];
  try {
    for (const name of sequence) {
      const current = profile(name);
      await compileWarm(
        haxeBinary,
        port,
        current,
        server,
        () => serverLog
      );
      assertRequest("warm", current);
      deepStrictEqual(
        hashTree(outputRoot("warm", current)),
        hashTree(outputRoot("cold", current)),
        `Warm ${name} output differs from its isolated cold build`
      );
    }
  } finally {
    await stopOwnedServer(server);
  }
}

async function main(): Promise<void> {
  rmSync(path.join(repoRoot, generatedRoot), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  });
  const haxeBinary = selectedHaxeBinary();

  for (const current of profiles) {
    execFileSync(haxeBinary, buildArguments("cold", current), {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 60_000
    });
    assertRequest("cold", current);
  }

  runGeneratedTypeScriptMatrix(
    "tests/dynamic-import-policy/tsconfig.json",
    { emit: false }
  );
  await runWarmSequence(haxeBinary);

  // `dynamicImport()` names the runtime chunk but does not add a static Haxe
  // dependency. `buildArguments()` therefore roots Target explicitly, just as
  // an application or bundler build must retain its dynamic entry points.
  // Execute the compiler-generated module rather than a test-owned stub.
  const runtime = execFileSync(
    process.execPath,
    [path.join(repoRoot, outputFile("cold", profile("classic-mjs")))],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 }
  );
  ok(runtime.includes("dynamic-import-current"),
    `Classic .mjs runtime did not load the current module:\n${runtime}`);

  deepStrictEqual(leakedStages(), [],
    "Dynamic-import fixture left a private output-transaction stage");
  for (const mode of ["cold", "warm"] as const) {
    for (const current of profiles) {
      strictEqual(existsSync(compilerSentinel(mode, current)), false,
        `${mode} ${current.name} left its private Haxe output sentinel`);
    }
  }
  process.stdout.write("dynamic-import-policy:ok\n");
}

await main();
