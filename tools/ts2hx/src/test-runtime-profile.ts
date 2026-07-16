import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject, type LoadProjectResult } from "./project.js";
import ts from "./typescript-api.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resetDir(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function loadedProject(projectPath: string): Extract<LoadProjectResult, { ok: true }> {
  const loaded = loadProject(projectPath);
  if (!loaded.ok) {
    throw new Error(
      `Could not load ${projectPath}: ${loaded.diagnostics.length} TypeScript diagnostic(s)`
    );
  }
  return loaded;
}

function haxeBinary(repoRoot: string): string {
  const configured = process.env.HAXE_BIN;
  if (configured) return configured;
  const local = path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "haxe.cmd" : "haxe"
  );
  return fs.existsSync(local) ? local : "haxe";
}

/**
 * Resolves the process that must own a long-lived Haxe compile server.
 *
 * Why: Lix's ordinary Node shim adds a private version-selection argument to
 * each `--connect` call; a raw Haxe server does not accept that argument.
 * What/How: probe the selected compiler version and use Lix's corresponding
 * downloaded native binary when present. Non-Lix environments keep their
 * configured `HAXE_BIN` or PATH candidate unchanged.
 */
function haxeServerBinary(repoRoot: string): string {
  const candidate = haxeBinary(repoRoot);
  const versionResult = spawnSync(candidate, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (versionResult.error) throw versionResult.error;
  const version = (versionResult.stdout ?? "").trim();
  const executable = process.platform === "win32" ? "haxe.exe" : "haxe";
  const lixCompiler = path.join(os.homedir(), "haxe", "versions", version, executable);
  return fs.existsSync(lixCompiler) ? lixCompiler : candidate;
}

function runCli(toolRoot: string, args: string[]): {
  readonly status: number | null;
  readonly transcript: string;
} {
  const result = spawnSync(
    process.execPath,
    [path.join(toolRoot, "dist", "cli.js"), ...args],
    { cwd: toolRoot, encoding: "utf8" }
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    transcript: `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function availableTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a local Haxe compile-server port"));
        return;
      }
      probe.close(error => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, wait(1_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.race([exited, wait(1_000)]);
}

/**
 * Proves the generator capability is compilation-local under Haxe server reuse.
 *
 * Why: the first compilation defines `genes.generator.active` from a macro. If
 * that private define leaked through the compiler server, a later standard-Haxe
 * build could accept and erase a Genes-only ESM request instead of failing.
 *
 * What: one server first compiles the guarded tree with Genes, then compiles the
 * same tree with `genes.disable`. The first build must succeed; the second must
 * report the stable macro diagnostic and publish no JavaScript.
 *
 * How: connection-refused responses are retried only while the newly spawned
 * server starts. Both real compilations use the same address and process, and a
 * `finally` block owns server shutdown so the test cannot leave a watcher behind.
 */
async function assertGeneratorCapabilityIsolation(opts: {
  haxeBin: string;
  repoRoot: string;
  guardOut: string;
  tmpRoot: string;
}): Promise<void> {
  const port = await availableTcpPort();
  const address = `127.0.0.1:${port}`;
  const server = spawn(opts.haxeBin, ["--server-listen", address], {
    cwd: opts.repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverTranscript = "";
  server.stdout?.on("data", chunk => { serverTranscript += String(chunk); });
  server.stderr?.on("data", chunk => { serverTranscript += String(chunk); });

  const compile = async (args: string[]): Promise<{
    status: number | null;
    transcript: string;
  }> => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = spawnSync(opts.haxeBin, ["--connect", address, ...args], {
        cwd: opts.repoRoot,
        encoding: "utf8"
      });
      if (result.error) throw result.error;
      const transcript = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (!transcript.includes("Couldn't connect")) {
        return { status: result.status, transcript };
      }
      if (server.exitCode !== null || server.signalCode !== null) {
        throw new Error(`Haxe compile server exited during startup:\n${serverTranscript}`);
      }
      await wait(50);
    }
    throw new Error(`Haxe compile server did not accept connections:\n${serverTranscript}`);
  };

  try {
    const genesOutput = path.join(opts.tmpRoot, "server-genes", "index.js");
    const genes = await compile([
      "-lib", "genes-ts",
      "-cp", opts.guardOut,
      "-dce", "full",
      "-main", "ts2hx_guard.Main",
      "-js", genesOutput
    ]);
    assert(
      genes.status === 0 && fs.existsSync(genesOutput),
      `compile server rejected the Genes capability build:\n${genes.transcript}`
    );

    const standardOutput = path.join(opts.tmpRoot, "server-standard-must-not-write.js");
    fs.rmSync(standardOutput, { force: true });
    const standard = await compile([
      "-cp", opts.guardOut,
      "-cp", path.join(opts.repoRoot, "src"),
      "-D", "genes.disable",
      "-dce", "full",
      "-main", "ts2hx_guard.Main",
      "-js", standardOutput
    ]);
    assert(standard.status !== 0, "compile server leaked the Genes capability into standard Haxe");
    assert(
      standard.transcript.includes("GENES-ESM-REQUEST-TARGET-001"),
      `compile-server standard build lost the target diagnostic:\n${standard.transcript}`
    );
    assert(!fs.existsSync(standardOutput), "failed compile-server build published JavaScript");
  } finally {
    await stopChild(server);
  }
}

/**
 * Proves the selected runtime profile is an executable compiler contract.
 *
 * Why: source imports are not enough to decide whether JavaScript still makes
 * a module request after configured TypeScript elision. Once a request remains,
 * standard Haxe cannot preserve its ESM initialization order and must not be
 * allowed to publish a plausible-looking tree.
 *
 * What: the test checks schema-v3 compiler/request evidence, first-request
 * provenance, strict and assisted transaction safety, request-free standard
 * translation, and the second-line Haxe macro guard on a miscompiled Genes tree.
 *
 * How: a small bound-import fixture is translated under both profiles, then a
 * bare-package fixture writes a guarded typed carrier. The standard profile
 * keeps a sentinel tree byte-identical, and the carrier is intentionally
 * compiled without `genes.Generator.use()` so it must fail before JavaScript is
 * emitted.
 */
async function main(): Promise<void> {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const tmpRoot = path.join(toolRoot, ".tmp", "runtime-profile");
  const fixture = loadedProject(
    path.join(toolRoot, "fixtures", "minimal-codegen", "tsconfig.json")
  );

  const standardOut = path.join(tmpRoot, "standard");
  resetDir(standardOut);
  const sentinel = path.join(standardOut, "sentinel.txt");
  fs.writeFileSync(sentinel, "prior-tree\n", "utf8");
  const standardOptions = {
    projectDir: fixture.projectDir,
    rootDir: fixture.rootDir,
    program: fixture.program,
    checker: fixture.checker,
    sourceFiles: fixture.sourceFiles,
    outDir: standardOut,
    basePackage: "ts2hx_profile",
    runtimeProfile: "standard-haxe-js" as const,
    mode: "strict-js" as const,
    cleanOutDir: true
  };
  const rejected = emitProjectToHaxe(standardOptions);
  const rejectedAgain = emitProjectToHaxe(standardOptions);
  assert(rejected.status === "failed", `standard profile status was ${rejected.status}`);
  assert(rejected.writtenFiles.length === 0, "standard profile wrote a partial output tree");
  assert(fs.readFileSync(sentinel, "utf8") === "prior-tree\n", "standard profile changed prior output");
  assert(
    JSON.stringify(rejected.manifest) === JSON.stringify(rejectedAgain.manifest),
    "standard profile diagnostic or manifest is not deterministic"
  );
  assert(rejected.manifest.schemaVersion === 3, "runtime profile did not use manifest schema v3");
  assert(rejected.manifest.targetProfile === "standard-haxe-js", "manifest lost the selected target");
  assert(
    JSON.stringify(rejected.manifest.requiredCompilerCapabilities)
      === JSON.stringify(["genes.esm-runtime-requests"]),
    "manifest lost the required Genes runtime-request capability"
  );
  assert(
    rejected.manifest.compiler.typescriptEngine.version === ts.version,
    "manifest did not record the TypeScript engine that planned requests"
  );
  assert(
    rejected.manifest.compiler.typescriptBridge.package === "@typescript/typescript6",
    "manifest did not distinguish the TypeScript API bridge"
  );
  assert(
    /^[0-9a-f]{64}$/.test(rejected.manifest.compiler.optionsHash),
    "manifest compiler option identity is not a SHA-256 hash"
  );
  const firstRequest = rejected.manifest.moduleRequests.find(
    request => request.disposition === "runtime-request"
  );
  assert(firstRequest?.specifier === "./math.js", "manifest lost the first effective request");
  assert(firstRequest.ordinal === 0, "manifest lost the first request ordinal");
  assert(
    firstRequest.source.file === "Main.ts" && firstRequest.source.line === 1,
    "manifest lost original request provenance"
  );
  const requestFeature = rejected.manifest.features.find(
    feature => feature.id === "modules.esm-runtime-requests"
  );
  assert(
    requestFeature?.occurrences.length === 1
      && requestFeature.occurrences[0]?.file === "Main.ts"
      && requestFeature.occurrences[0]?.line === 1,
    "runtime-request feature contract lost its exact effective-request provenance"
  );
  assert(Array.isArray(rejected.manifest.runtimeModules), "schema v3 removed runtime resource ownership");
  assert(rejected.diagnostics.length === 1, "standard profile did not stop at one target diagnostic");
  const diagnostic = rejected.diagnostics[0];
  assert(
    diagnostic?.id === "TS2HX-MODULES-ESM-RUNTIME-TARGET-001",
    "standard profile emitted the wrong target diagnostic"
  );
  assert(diagnostic.severity === "error", "target capability failure is not an error");
  assert(
    diagnostic.source.file === "Main.ts" && diagnostic.source.line === 1,
    "target diagnostic lost first-request provenance"
  );

  const projectPath = path.join(
    toolRoot,
    "fixtures",
    "minimal-codegen",
    "tsconfig.json"
  );
  const missingProfile = runCli(toolRoot, [
    "--project", projectPath,
    "--out", path.join(tmpRoot, "cli-missing-profile")
  ]);
  assert(missingProfile.status === 2, "CLI accepted emission without a runtime profile");
  assert(
    missingProfile.transcript.includes("--runtime-profile is required"),
    "CLI did not explain its mandatory runtime profile"
  );

  const cliStandardOut = path.join(tmpRoot, "cli-standard");
  resetDir(cliStandardOut);
  const cliSentinel = path.join(cliStandardOut, "sentinel.txt");
  fs.writeFileSync(cliSentinel, "cli-prior\n", "utf8");
  const cliRejected = runCli(toolRoot, [
    "--project", projectPath,
    "--out", cliStandardOut,
    "--base-package", "ts2hx_profile",
    "--runtime-profile", "standard-haxe-js",
    "--clean"
  ]);
  assert(cliRejected.status === 1, "CLI did not fail closed at the effective request");
  assert(
    cliRejected.transcript.includes("TS2HX-MODULES-ESM-RUNTIME-TARGET-001"),
    "CLI omitted the stable runtime target diagnostic"
  );
  assert(
    fs.readFileSync(cliSentinel, "utf8") === "cli-prior\n",
    "CLI runtime-profile failure changed the prior tree"
  );

  const assistedOut = path.join(tmpRoot, "assisted");
  resetDir(assistedOut);
  const assistedSentinel = path.join(assistedOut, "sentinel.txt");
  fs.writeFileSync(assistedSentinel, "assisted-prior\n", "utf8");
  const assisted = emitProjectToHaxe({
    ...standardOptions,
    outDir: assistedOut,
    mode: "assisted"
  });
  assert(assisted.status === "failed", "assisted mode weakened the runtime target boundary");
  assert(assisted.diagnostics[0]?.severity === "error", "assisted target failure became a loss");
  assert(
    fs.readFileSync(assistedSentinel, "utf8") === "assisted-prior\n",
    "assisted target failure modified the prior tree"
  );

  const genesOut = path.join(tmpRoot, "genes");
  const genes = emitProjectToHaxe({
    ...standardOptions,
    outDir: genesOut,
    runtimeProfile: "genes-esm"
  });
  assert(genes.status === "success", `Genes runtime profile status was ${genes.status}`);
  assert(
    JSON.stringify(genes.manifest.requiredCompilerCapabilities)
      === JSON.stringify(["genes.esm-runtime-requests"]),
    "Genes profile did not record its required request capability"
  );

  const guardSource = path.join(tmpRoot, "guard-source");
  resetDir(guardSource);
  fs.mkdirSync(path.join(guardSource, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(guardSource, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmitOnError: true,
        noUncheckedSideEffectImports: false,
        rootDir: "src",
        outDir: "dist",
        types: ["node"]
      },
      include: ["src/**/*.ts"]
    }, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(guardSource, "src", "Main.ts"),
    'import "@fixture/effect";\n\nexport function main(): void {}\n',
    "utf8"
  );
  const guardFixture = loadedProject(path.join(guardSource, "tsconfig.json"));
  const guardOut = path.join(tmpRoot, "guard-haxe");
  const guarded = emitProjectToHaxe({
    projectDir: guardFixture.projectDir,
    rootDir: guardFixture.rootDir,
    program: guardFixture.program,
    checker: guardFixture.checker,
    sourceFiles: guardFixture.sourceFiles,
    outDir: guardOut,
    basePackage: "ts2hx_guard",
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(guarded.status === "success", "guard fixture did not translate for Genes");
  const generatedMain = fs.readFileSync(
    path.join(guardOut, "ts2hx_guard", "Main.hx"),
    "utf8"
  );
  assert(
    generatedMain.includes(
      'genes.internal.EsmRequestFact.external("@fixture/effect", null)'
    ),
    "Genes profile did not emit its guarded request fact"
  );
  assert(
    !generatedMain.includes("SideEffectImportMarker"),
    "generated Haxe bypassed the guarded request API"
  );

  const invalidJs = path.join(tmpRoot, "standard-compiler-must-not-write.js");
  const haxe = spawnSync(haxeBinary(repoRoot), [
    "-cp", guardOut,
    "-cp", path.join(repoRoot, "src"),
    "-dce", "full",
    "-main", "ts2hx_guard.Main",
    "-js", invalidJs
  ], { cwd: repoRoot, encoding: "utf8" });
  if (haxe.error) throw haxe.error;
  const compilerTranscript = `${haxe.stdout ?? ""}\n${haxe.stderr ?? ""}`;
  assert(haxe.status !== 0, "standard Haxe accepted a Genes ESM request carrier");
  assert(
    compilerTranscript.includes("GENES-ESM-REQUEST-TARGET-001"),
    `standard Haxe did not report the stable request target diagnostic:\n${compilerTranscript}`
  );
  assert(!fs.existsSync(invalidJs), "failed standard compilation published JavaScript");
  await assertGeneratorCapabilityIsolation({
    haxeBin: haxeServerBinary(repoRoot),
    repoRoot,
    guardOut,
    tmpRoot
  });

  fs.appendFileSync(
    path.join(guardSource, "src", "Main.ts"),
    '\nconst typeError: number = "not a number";\n',
    "utf8"
  );
  const typeErrorOut = path.join(tmpRoot, "type-error-output");
  resetDir(typeErrorOut);
  const typeErrorSentinel = path.join(typeErrorOut, "sentinel.txt");
  fs.writeFileSync(typeErrorSentinel, "typed-prior\n", "utf8");
  const typeErrorResult = runCli(toolRoot, [
    "--project", path.join(guardSource, "tsconfig.json"),
    "--out", typeErrorOut,
    "--runtime-profile", "genes-esm",
    "--clean"
  ]);
  assert(typeErrorResult.status === 2, "CLI planned Haxe for a TypeScript-error project");
  assert(
    typeErrorResult.transcript.includes(
      "TypeScript project must type-check before effective module requests can be planned"
    ),
    "CLI did not explain the clean-TypeScript request precondition"
  );
  assert(
    fs.readFileSync(typeErrorSentinel, "utf8") === "typed-prior\n",
    "TypeScript diagnostic failure changed the prior output tree"
  );

  const requestFree = loadedProject(
    path.join(toolRoot, "fixtures", "statement-coverage", "tsconfig.json")
  );
  const requestFreeOut = path.join(tmpRoot, "request-free");
  const standardSuccess = emitProjectToHaxe({
    projectDir: requestFree.projectDir,
    rootDir: requestFree.rootDir,
    program: requestFree.program,
    checker: requestFree.checker,
    sourceFiles: requestFree.sourceFiles,
    outDir: requestFreeOut,
    basePackage: "ts2hx_request_free",
    runtimeProfile: "standard-haxe-js",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(standardSuccess.status === "success", "request-free standard profile stopped working");
  assert(
    standardSuccess.manifest.requiredCompilerCapabilities.length === 0,
    "request-free translation claimed a Genes ESM capability"
  );
  assert(
    standardSuccess.manifest.moduleRequests.length === 0,
    "request-free translation invented module requests"
  );
  assert(
    standardSuccess.manifest.features.find(
      feature => feature.id === "modules.esm-runtime-requests"
    )?.occurrences.length === 0,
    "request-free translation claimed the Genes runtime-request feature"
  );

  process.stdout.write(
    "Runtime profile OK (schema v3 + transactional target guard + request-free standard Haxe)\n"
  );
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
