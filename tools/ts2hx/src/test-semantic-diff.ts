import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject } from "./project.js";
import {
  SEMANTIC_FAIL_CLOSED_CASES,
  SEMANTIC_SUPPORT_MATRIX,
  type SemanticFeatureId
} from "./semantic/ir.js";
import { runTypeScriptApiBridge } from "./toolchains.js";

const TRACE_MARKER = "SEMANTIC_TRACE:";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resetDir(absDir: string): void {
  fs.rmSync(absDir, { recursive: true, force: true });
  fs.mkdirSync(absDir, { recursive: true });
}

function resolveHaxeBin(toolRoot: string): string {
  const configured = process.env.HAXE_BIN;
  if (configured) return configured;
  const local = path.resolve(
    toolRoot,
    "..",
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "haxe.cmd" : "haxe"
  );
  return fs.existsSync(local) ? local : "haxe";
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function capture(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

function semanticTrace(output: string, label: string): string {
  const marker = output.indexOf(TRACE_MARKER);
  assert(marker >= 0, `${label}: no ${TRACE_MARKER} marker in output:\n${output}`);
  const trace = output.slice(marker + TRACE_MARKER.length).split(/\r?\n/, 1)[0]?.trim() ?? "";
  const parsed: unknown = JSON.parse(trace);
  assert(Array.isArray(parsed), `${label}: semantic trace is not a JSON array.`);
  return JSON.stringify(parsed);
}

function compileOriginalTypeScript(opts: {
  repoRoot: string;
  fixtureConfig: string;
  outputDir: string;
}): string {
  resetDir(opts.outputDir);
  runTypeScriptApiBridge(opts.repoRoot, ["-p", opts.fixtureConfig, "--outDir", opts.outputDir]);
  const entry = pathToFileURL(path.join(opts.outputDir, "Main.js")).href;
  return capture(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(entry)}).then((module) => module.main())`],
    opts.repoRoot
  );
}

function compileClassicHaxe(opts: {
  haxeBin: string;
  repoRoot: string;
  haxeSourceDir: string;
  outputFile: string;
}): string {
  run(opts.haxeBin, [
    "-cp", opts.haxeSourceDir,
    "-cp", path.join(opts.repoRoot, "src"),
    "--macro", "genes.js.Async.enable()",
    "-main", "ts2hx_semantic.Main",
    "-js", opts.outputFile
  ], opts.repoRoot);
  return capture(process.execPath, [opts.outputFile], opts.repoRoot);
}

function compileGenesTypeScript(opts: {
  haxeBin: string;
  repoRoot: string;
  haxeSourceDir: string;
  sourceDir: string;
  distDir: string;
}): string {
  resetDir(opts.sourceDir);
  resetDir(opts.distDir);
  run(opts.haxeBin, [
    "-lib", "genes-ts",
    "-cp", opts.haxeSourceDir,
    "-main", "ts2hx_semantic.Main",
    "-js", path.join(opts.sourceDir, "index.ts"),
    "-D", "genes.ts"
  ], opts.repoRoot);

  const tsconfig = path.join(opts.sourceDir, "tsconfig.semantic.json");
  fs.writeFileSync(tsconfig, `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmitOnError: true,
      outDir: opts.distDir,
      types: ["node"]
    },
    include: ["**/*.ts"]
  }, null, 2)}\n`, "utf8");
  runTypeScriptApiBridge(opts.repoRoot, ["-p", tsconfig]);
  return capture(process.execPath, [path.join(opts.distDir, "index.js")], opts.repoRoot);
}

/**
 * Proves each advertised strict-js semantic contract against the original TS.
 *
 * Why: snapshots and successful compilation cannot detect a default argument
 * treating null as absence, a skipped for-loop increment, lost switch
 * fallthrough, or reordered side effects.
 *
 * What: the same source emits one stable event trace as original TypeScript,
 * translated Haxe through classic Genes JavaScript, and translated Haxe through
 * genes-ts TypeScript. A companion project proves known unsupported semantics
 * produce feature-specific, source-positioned strict failures.
 *
 * How: the test also validates the emitted schema-v2 feature manifest, making
 * the support/portability grades executable release evidence rather than prose.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const haxeBin = resolveHaxeBin(toolRoot);
  const tmpRoot = path.join(toolRoot, ".tmp", "semantic-diff");
  const fixtureDir = path.join(toolRoot, "fixtures", "semantic-diff");
  const fixtureConfig = path.join(fixtureDir, "tsconfig.json");

  const originalOutput = compileOriginalTypeScript({
    repoRoot,
    fixtureConfig,
    outputDir: path.join(tmpRoot, "original")
  });
  const originalTrace = semanticTrace(originalOutput, "original TypeScript");

  const loaded = loadProject(fixtureConfig);
  if (!loaded.ok)
    throw new Error(`semantic-diff fixture failed to load: ${loaded.diagnostics.length} diagnostic(s).`);
  const haxeSourceDir = path.join(tmpRoot, "haxe");
  const translation = emitProjectToHaxe({
    projectDir: loaded.projectDir,
    rootDir: loaded.rootDir,
    program: loaded.program,
    checker: loaded.checker,
    sourceFiles: loaded.sourceFiles,
    outDir: haxeSourceDir,
    basePackage: "ts2hx_semantic",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(translation.status === "success", `semantic-diff translation status was ${translation.status}.`);
  assert(translation.diagnostics.length === 0, "semantic-diff unexpectedly produced translation diagnostics.");
  assert(translation.manifest.schemaVersion === 2, "semantic manifest schema is not version 2.");
  assert(
    translation.manifest.features.length === SEMANTIC_SUPPORT_MATRIX.length,
    "semantic manifest does not contain the complete support matrix."
  );
  assert(
    new Set(translation.manifest.features.map((feature) => feature.id)).size
      === translation.manifest.features.length,
    "semantic support matrix contains a duplicate stable feature ID."
  );
  const onDiskManifest = JSON.parse(
    fs.readFileSync(path.join(haxeSourceDir, "ts2hx-manifest.json"), "utf8")
  ) as unknown;
  assert(
    JSON.stringify(onDiskManifest) === JSON.stringify(translation.manifest),
    "committed semantic manifest differs from the validated in-memory plan."
  );

  const expectedFeatures: SemanticFeatureId[] = [
    "values.explicit-undefined",
    "parameters.undefined-default",
    "locals.uninitialized",
    "coercion.truthiness",
    "coercion.strict-equality",
    "coercion.unary-plus",
    "evaluation.compound-assignment",
    "loops.for-continue-step",
    "switch.fallthrough",
    "switch.continue",
    "exceptions.try-catch",
    "exceptions.finally",
    "this.class-and-lexical-arrow",
    "async.await",
    "modules.esm-bindings"
  ];
  const exercised = translation.manifest.features
    .filter((feature) => feature.occurrences.length > 0)
    .map((feature) => feature.id)
    .sort();
  assert(
    JSON.stringify(exercised) === JSON.stringify(expectedFeatures.slice().sort()),
    `semantic feature inventory changed: ${JSON.stringify(exercised)}.`
  );
  const translatedMain = fs.readFileSync(
    path.join(haxeSourceDir, "ts2hx_semantic", "Main.hx"),
    "utf8"
  );
  assert(
    translatedMain.includes("genes.js.Coercion.toNumber("),
    "unary plus did not lower through the named typed coercion boundary."
  );

  const classicOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    outputFile: path.join(tmpRoot, "classic.js")
  });
  const genesTsOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-source"),
    distDir: path.join(tmpRoot, "genes-ts-dist")
  });
  assert(
    !fs.existsSync(path.join(tmpRoot, "genes-ts-source", "genes", "js", "Coercion.ts")),
    "the macro-only coercion abstract leaked an empty runtime TypeScript module."
  );
  assert(
    !fs.readFileSync(path.join(tmpRoot, "classic.js"), "utf8").includes("genes_js_Coercion"),
    "the macro-only coercion abstract leaked an empty runtime JavaScript helper."
  );
  assert(
    semanticTrace(classicOutput, "translated classic JavaScript") === originalTrace,
    "classic translated trace differs from original TypeScript."
  );
  assert(
    semanticTrace(genesTsOutput, "translated genes-ts output") === originalTrace,
    "genes-ts translated trace differs from original TypeScript."
  );

  const unsupportedConfig = path.join(toolRoot, "fixtures", "semantic-unsupported", "tsconfig.json");
  const unsupportedProject = loadProject(unsupportedConfig);
  if (!unsupportedProject.ok)
    throw new Error(
      `semantic-unsupported fixture failed to load: ${unsupportedProject.diagnostics.length} diagnostic(s).`
    );
  const unsupportedOutput = path.join(tmpRoot, "unsupported");
  resetDir(unsupportedOutput);
  fs.writeFileSync(path.join(unsupportedOutput, "sentinel.txt"), "prior-tree\n", "utf8");
  const rejected = emitProjectToHaxe({
    projectDir: unsupportedProject.projectDir,
    rootDir: unsupportedProject.rootDir,
    program: unsupportedProject.program,
    checker: unsupportedProject.checker,
    sourceFiles: unsupportedProject.sourceFiles,
    outDir: unsupportedOutput,
    basePackage: "ts2hx_unsupported",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(rejected.status === "failed", `unsupported semantic project status was ${rejected.status}.`);
  assert(rejected.writtenFiles.length === 0, "unsupported semantic project committed partial output.");
  assert(
    fs.readFileSync(path.join(unsupportedOutput, "sentinel.txt"), "utf8") === "prior-tree\n",
    "unsupported semantic project modified the prior output tree."
  );
  const expectedDiagnosticIds = SEMANTIC_FAIL_CLOSED_CASES
    .map((failure) => failure.diagnosticId)
    .sort();
  const diagnosticIds = rejected.diagnostics.map((diagnostic) => diagnostic.id).sort();
  assert(
    JSON.stringify(diagnosticIds) === JSON.stringify(expectedDiagnosticIds),
    `unsupported semantic diagnostics changed: ${JSON.stringify(diagnosticIds)}.`
  );
  for (const failure of SEMANTIC_FAIL_CLOSED_CASES) {
    const feature = rejected.manifest.features.find((entry) => entry.id === failure.featureId);
    assert(feature !== undefined, `${failure.featureId}: missing fail-closed feature contract.`);
    assert(
      feature.occurrences.length > 0,
      `${failure.featureId}: ${failure.variant} has no source provenance.`
    );
  }

  process.stdout.write(
    `Semantic differential OK (${expectedFeatures.length} exercised contracts, ${expectedDiagnosticIds.length} fail-closed contracts, 3 runtimes)\n`
  );
}

main();
