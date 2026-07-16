import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject } from "./project.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function resetDir(absDir: string): void {
  fs.rmSync(absDir, { recursive: true, force: true });
  fs.mkdirSync(absDir, { recursive: true });
}

function runCli(toolRoot: string, args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [path.join(toolRoot, "dist", "cli.js"), ...args], {
    cwd: toolRoot,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr };
}

/**
 * Proves the translation boundary is fail closed and output commits are atomic.
 *
 * The fixture contains one supported declaration followed by a top-level call
 * that the current Haxe lowering cannot preserve. Strict mode must diagnose the
 * call and leave an existing tree untouched; assisted mode may write the
 * declaration only when the source marker and machine-readable loss manifest
 * are committed in the same transaction. CLI exit codes exercise the same
 * contract used by CI and migration automation.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const fixtureDir = path.join(toolRoot, "fixtures", "unsupported-top-level");
  const projectPath = path.join(fixtureDir, "tsconfig.json");
  const loaded = loadProject(projectPath);
  if (!loaded.ok)
    throw new Error(`Could not load strict-diagnostics fixture: ${loaded.diagnostics.length} diagnostic(s).`);

  const strictOut = path.join(toolRoot, ".tmp", "strict-diagnostics-api");
  resetDir(strictOut);
  const sentinel = path.join(strictOut, "sentinel.txt");
  fs.writeFileSync(sentinel, "prior-tree\n", "utf8");
  const strictOptions = {
    projectDir: loaded.projectDir,
    rootDir: loaded.rootDir,
    program: loaded.program,
    checker: loaded.checker,
    sourceFiles: loaded.sourceFiles,
    outDir: strictOut,
    basePackage: "strict_diag",
    runtimeProfile: "standard-haxe-js" as const,
    mode: "strict-js" as const,
    cleanOutDir: true
  };
  const strict = emitProjectToHaxe(strictOptions);
  const strictAgain = emitProjectToHaxe(strictOptions);

  assert(strict.status === "failed", `strict API status was ${strict.status}`);
  assert(strict.writtenFiles.length === 0, "strict API wrote files after a translation loss");
  assert(fs.readFileSync(sentinel, "utf8") === "prior-tree\n", "strict API changed the prior output tree");
  assert(!fs.existsSync(path.join(strictOut, "strict_diag", "Main.hx")), "strict API committed partial Haxe");
  assert(JSON.stringify(strict.manifest) === JSON.stringify(strictAgain.manifest), "strict diagnostics are not deterministic");
  assert(strict.diagnostics.length === 2, `expected two strict diagnostics, got ${strict.diagnostics.length}`);
  const diagnostic = strict.diagnostics[0];
  assert(diagnostic?.id === "TS2HX-UNSUPPORTED-LOWERING-001", "unexpected strict diagnostic ID");
  assert(diagnostic?.source.file === "Main.ts" && diagnostic.source.line === 5, "strict diagnostic lost its source span");
  assert(diagnostic?.syntaxKind === "ExpressionStatement", "strict diagnostic lost its syntax kind");
  assert(strict.diagnostics[1]?.source.line === 6, "a later unsupported top-level statement was silently skipped");

  const assistedOut = path.join(toolRoot, ".tmp", "strict-diagnostics-assisted");
  resetDir(assistedOut);
  fs.writeFileSync(path.join(assistedOut, "stale.txt"), "stale\n", "utf8");
  const assisted = emitProjectToHaxe({ ...strictOptions, outDir: assistedOut, mode: "assisted" });
  const assistedHaxe = path.join(assistedOut, "strict_diag", "Main.hx");
  const assistedManifest = path.join(assistedOut, "ts2hx-manifest.json");
  assert(assisted.status === "assisted", `assisted API status was ${assisted.status}`);
  assert(!fs.existsSync(path.join(assistedOut, "stale.txt")), "clean assisted transaction retained a stale file");
  assert(fs.readFileSync(assistedHaxe, "utf8").includes("TS2HX-UNSUPPORTED-LOWERING-001"), "assisted source has no loss marker");
  assert(fs.readFileSync(assistedManifest, "utf8").includes('"status": "assisted"'), "assisted manifest is missing its status");

  const cliStrictOut = path.join(toolRoot, ".tmp", "strict-diagnostics-cli");
  const cliJson = path.join(toolRoot, ".tmp", "strict-diagnostics-cli.json");
  resetDir(cliStrictOut);
  fs.writeFileSync(path.join(cliStrictOut, "sentinel.txt"), "cli-prior\n", "utf8");
  const strictCli = runCli(toolRoot, [
    "--project", projectPath,
    "--out", cliStrictOut,
    "--base-package", "strict_diag",
    "--runtime-profile", "standard-haxe-js",
    "--clean",
    "--diagnostics-json", cliJson
  ]);
  assert(strictCli.status === 1, `strict CLI exit was ${strictCli.status}: ${strictCli.stderr}`);
  assert(strictCli.stderr.includes("failed closed"), "strict CLI did not explain its no-write result");
  assert(fs.readFileSync(path.join(cliStrictOut, "sentinel.txt"), "utf8") === "cli-prior\n", "strict CLI modified prior output");
  assert(fs.readFileSync(cliJson, "utf8").includes("TS2HX-UNSUPPORTED-LOWERING-001"), "strict CLI JSON omitted diagnostics");

  const assistedCliOut = path.join(toolRoot, ".tmp", "strict-diagnostics-cli-assisted");
  const assistedArgs = [
    "--project", projectPath,
    "--out", assistedCliOut,
    "--base-package", "strict_diag",
    "--runtime-profile", "standard-haxe-js",
    "--clean",
    "--mode", "assisted"
  ];
  const assistedCli = runCli(toolRoot, assistedArgs);
  assert(assistedCli.status === 3, `assisted CLI exit was ${assistedCli.status}: ${assistedCli.stderr}`);
  const allowedCli = runCli(toolRoot, [...assistedArgs, "--allow-loss"]);
  assert(allowedCli.status === 0, `assisted --allow-loss exit was ${allowedCli.status}: ${allowedCli.stderr}`);

  process.stdout.write("Strict diagnostics OK (API + CLI + transactional output)\n");
}

main();
