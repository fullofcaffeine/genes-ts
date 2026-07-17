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

  // A successful translation and its requested external manifest are one CLI
  // publication result. If the external target cannot be installed, exit 2
  // must leave the previously published Haxe tree intact and remove every
  // transaction artifact. This exercises the success path; strict translation
  // failures already avoid opening the output-tree transaction above.
  const publicationFixture = path.join(toolRoot, ".tmp", "diagnostics-publication-fixture");
  const publicationProject = path.join(publicationFixture, "tsconfig.json");
  const publicationOut = path.join(toolRoot, ".tmp", "diagnostics-publication-output");
  const invalidDiagnosticsTarget = path.join(toolRoot, ".tmp", "diagnostics-publication-target");
  resetDir(publicationFixture);
  fs.writeFileSync(path.join(publicationFixture, "Main.ts"),
    "export function answer(): number { return 42; }\n", "utf8");
  fs.writeFileSync(publicationProject, `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true
    },
    include: ["Main.ts"]
  }, null, 2)}\n`, "utf8");
  resetDir(publicationOut);
  const publicationSentinel = path.join(publicationOut, "sentinel.txt");
  fs.writeFileSync(publicationSentinel, "prior-publication-tree\n", "utf8");
  resetDir(invalidDiagnosticsTarget);
  const publicationParent = path.dirname(publicationOut);
  const publicationArtifactPrefixes = [publicationOut, invalidDiagnosticsTarget]
    .map(target => `.${path.basename(target)}.ts2hx-`);
  const publicationArtifactsBefore = fs.readdirSync(publicationParent)
    .filter(name => publicationArtifactPrefixes.some(prefix => name.startsWith(prefix)))
    .sort();
  const publicationCli = runCli(toolRoot, [
    "--project", publicationProject,
    "--out", publicationOut,
    "--base-package", "diagnostics_publication",
    "--runtime-profile", "standard-haxe-js",
    "--clean",
    "--diagnostics-json", invalidDiagnosticsTarget
  ]);
  const publicationArtifactsAfter = fs.readdirSync(publicationParent)
    .filter(name => publicationArtifactPrefixes.some(prefix => name.startsWith(prefix)))
    .sort();
  assert(publicationCli.status === 2,
    `diagnostics publication CLI exit was ${publicationCli.status}: ${publicationCli.stderr}`);
  assert(fs.readFileSync(publicationSentinel, "utf8") === "prior-publication-tree\n",
    "failed external diagnostics publication replaced the prior output tree");
  assert(JSON.stringify(publicationArtifactsAfter) === JSON.stringify(publicationArtifactsBefore),
    "failed external diagnostics publication left stage or backup artifacts");

  const validDiagnosticsTarget = path.join(toolRoot, ".tmp", "diagnostics-publication.json");
  fs.writeFileSync(validDiagnosticsTarget, "prior-external-manifest\n", "utf8");
  const successfulPublicationCli = runCli(toolRoot, [
    "--project", publicationProject,
    "--out", publicationOut,
    "--base-package", "diagnostics_publication",
    "--runtime-profile", "standard-haxe-js",
    "--clean",
    "--diagnostics-json", validDiagnosticsTarget
  ]);
  assert(successfulPublicationCli.status === 0,
    `successful diagnostics publication exit was ${successfulPublicationCli.status}: ${successfulPublicationCli.stderr}`);
  assert(!fs.existsSync(publicationSentinel),
    "successful diagnostics publication retained the prior clean output tree");
  assert(fs.existsSync(path.join(publicationOut, "diagnostics_publication", "Main.hx")),
    "successful diagnostics publication omitted generated Haxe");
  assert(fs.readFileSync(validDiagnosticsTarget, "utf8").includes('"status": "success"'),
    "successful diagnostics publication did not replace the external manifest");
  assert(!fs.readdirSync(path.dirname(validDiagnosticsTarget))
    .some(name => name.startsWith(`.${path.basename(validDiagnosticsTarget)}.ts2hx-`)),
    "successful diagnostics publication left an external stage or backup artifact");

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

  // A completion may be nested under syntax the statement printer never
  // enters. Function-level preflight must still retain the precise try span and
  // atomic no-write contract instead of falling back to a generic declaration
  // diagnostic. `for...in` is intentionally outside the first completion
  // boundary; supported loops are while, do/while, lowered for, and for-of.
  const completionFixture = path.join(toolRoot, ".tmp", "completion-excluded-fixture");
  const completionSource = path.join(completionFixture, "Main.ts");
  const completionConfig = path.join(completionFixture, "tsconfig.json");
  resetDir(completionFixture);
  fs.writeFileSync(completionConfig, `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true
    },
    include: ["Main.ts"]
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(completionSource, `export function unsupportedLoop(values: Record<string, number>): void {
  for (const key in values) {
    try {
      continue;
    } finally {}
  }
}
`, "utf8");
  try {
    const completionProject = loadProject(completionConfig);
    if (!completionProject.ok)
      throw new Error(
        `Could not load completion exclusion fixture: ${completionProject.diagnostics.length} diagnostic(s).`
      );
    const completionOut = path.join(toolRoot, ".tmp", "completion-excluded-output");
    resetDir(completionOut);
    const completionSentinel = path.join(completionOut, "sentinel.txt");
    fs.writeFileSync(completionSentinel, "prior-completion-tree\n", "utf8");
    const completionRejected = emitProjectToHaxe({
      projectDir: completionProject.projectDir,
      rootDir: completionProject.rootDir,
      program: completionProject.program,
      checker: completionProject.checker,
      sourceFiles: completionProject.sourceFiles,
      outDir: completionOut,
      basePackage: "completion_excluded",
      runtimeProfile: "standard-haxe-js",
      mode: "strict-js",
      cleanOutDir: true
    });
    assert(completionRejected.status === "failed",
      `unsupported completion status was ${completionRejected.status}`);
    assert(completionRejected.writtenFiles.length === 0,
      "unsupported completion committed partial output");
    assert(fs.readFileSync(completionSentinel, "utf8") === "prior-completion-tree\n",
      "unsupported completion changed the prior tree");
    const completionDiagnostic = completionRejected.diagnostics[0];
    assert(completionRejected.diagnostics.length === 1
      && completionDiagnostic?.id === "TS2HX-EXCEPTIONS-FINALLY-OUTER-TRANSFER-001",
      "unsupported completion lost its stable diagnostic");
    assert(completionDiagnostic?.source.file === "Main.ts"
      && completionDiagnostic.source.line === 3
      && completionDiagnostic.source.column === 5,
      "unsupported completion lost the source try position");
  } finally {
    fs.rmSync(completionFixture, { recursive: true, force: true });
  }

  process.stdout.write("Strict diagnostics OK (API + CLI + transactional output)\n");
}

main();
