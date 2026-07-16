import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";
import { emitProjectToHaxe, type TranslationDiagnostic } from "./haxe/emit.js";
import { loadProject } from "./project.js";
import {
  SEMANTIC_FAIL_CLOSED_CASES,
  SEMANTIC_SUPPORT_MATRIX,
  type SemanticFeatureId
} from "./semantic/ir.js";
import {
  runTypeScriptApiBridge,
  runTypeScriptGeneratedOutputLanes
} from "./toolchains.js";
import ts from "./typescript-api.js";

const TRACE_MARKER = "SEMANTIC_TRACE:";
const CONVERTED_TRACE_MARKER = "CONVERTED_TRACE:";
const BOUND_TRACE_MARKER = "BOUND_TRACE:";
const PACKAGE_TRACE_MARKER = "PACKAGE_TRACE:";

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

function convertedTrace(output: string, label: string): string {
  const marker = output.indexOf(CONVERTED_TRACE_MARKER);
  assert(marker >= 0, `${label}: no ${CONVERTED_TRACE_MARKER} marker in output:\n${output}`);
  return output.slice(marker + CONVERTED_TRACE_MARKER.length).split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function boundTrace(output: string, label: string): string {
  const marker = output.indexOf(BOUND_TRACE_MARKER);
  assert(marker >= 0, `${label}: no ${BOUND_TRACE_MARKER} marker in output:\n${output}`);
  return output.slice(marker + BOUND_TRACE_MARKER.length).split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function packageTrace(output: string, label: string): string {
  const marker = output.indexOf(PACKAGE_TRACE_MARKER);
  assert(marker >= 0, `${label}: no ${PACKAGE_TRACE_MARKER} marker in output:\n${output}`);
  assert(
    occurrenceCount(output, "TYPED_PACKAGE_INIT") === 1,
    `${label}: typed package did not initialize exactly once.`
  );
  assert(
    output.indexOf("TYPED_PACKAGE_INIT") < marker,
    `${label}: package initialization ran after its imported bindings.`
  );
  return output.slice(marker + PACKAGE_TRACE_MARKER.length).split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function occurrenceCount(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function runtimeImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/^import(?!\s+type\b).*?["']([^"']+)["']\s*;?$/gm)]
    .map((match) => match[1]);
}

function diagnosticSourceSummaries(diagnostics: readonly TranslationDiagnostic[]): string[] {
  return diagnostics
    .map((diagnostic) =>
      `${diagnostic.id}|${diagnostic.source.file}:${diagnostic.source.line}:${diagnostic.source.column}`
    )
    .sort();
}

function assertSideEffectOrder(output: string, label: string): void {
  const packageEffect = output.indexOf("TS2HX_SIDE_EFFECT:package");
  const supportEffect = output.indexOf("TS2HX_SIDE_EFFECT:support");
  const resourceEffect = output.indexOf("TS2HX_SIDE_EFFECT:resource");
  const semanticTrace = output.indexOf(TRACE_MARKER);
  assert(packageEffect >= 0, `${label}: package side effect did not run.`);
  assert(supportEffect > packageEffect, `${label}: bound Support request did not follow the package request.`);
  assert(resourceEffect > supportEffect, `${label}: staged resource did not follow the bound Support request.`);
  assert(semanticTrace > resourceEffect, `${label}: Main ran before its ordered runtime requests completed.`);
}

function assertBoundRequestOrder(source: string, label: string, verbatim: boolean): void {
  const expected = verbatim
    ? [
      "./Unused.js",
      "./UnusedDefaultEffect.js",
      "./UnusedNamespaceEffect.js",
      "./DefaultEffect.js",
      "./NamespaceEffect.js",
      "./EmptyEffect.js",
      "./InlineTypeEffect.js",
      "./MixedEffect.js",
      "./DefaultEmptyEffect.js",
      "./DefaultNamedEffect.js",
      "./DefaultNamespaceEffect.js",
      "./First.js",
      "./Second.js",
      "./State.js"
    ]
    : [
      "./DefaultEffect.js",
      "./NamespaceEffect.js",
      "./MixedEffect.js",
      "./DefaultEmptyEffect.js",
      "./DefaultNamedEffect.js",
      "./DefaultNamespaceEffect.js",
      "./First.js",
      "./Second.js",
      "./State.js"
    ];
  const runtimeRequests = runtimeImportSpecifiers(source);
  const fixtureRequests = runtimeRequests.filter((request) => request.startsWith("./"));
  assert(
    JSON.stringify(fixtureRequests) === JSON.stringify(expected),
    `${label}: effective request order differed. Expected ${expected.join(", ")}; got ${fixtureRequests.join(", ")}.`
  );
  for (const elided of [
    "./DeclarationTypeEffect.js",
    ...(verbatim ? [] : [
      "./Unused.js",
      "./UnusedDefaultEffect.js",
      "./UnusedNamespaceEffect.js",
      "./EmptyEffect.js",
      "./InlineTypeEffect.js"
    ])
  ]) {
    assert(!runtimeRequests.includes(elided), `${label}: retained runtime request ${elided}.`);
  }
  assert(
    runtimeRequests.filter((request) => request === "./First.js").length === 1,
    `${label}: duplicate First request was not coalesced.`
  );
  assert(!source.includes("__ts2hx_requests"), `${label}: request carrier leaked into generated output.`);
  assert(!source.includes("SideEffectImportMarker"), `${label}: compiler marker leaked into generated output.`);
  assert(!source.includes("EsmRequestFact"), `${label}: guarded request fact leaked into generated output.`);
  assert(!source.includes("genes.compilerInternal"), `${label}: compiler metadata leaked into generated output.`);
}

function installNodeRuntime(fixtureDir: string, outputDir: string, stagedRuntimeDir: string): void {
  const packageTarget = path.join(outputDir, "node_modules", "@ts2hx", "semantic-effect");
  fs.mkdirSync(path.dirname(packageTarget), { recursive: true });
  fs.cpSync(path.join(fixtureDir, "runtime", "package"), packageTarget, { recursive: true });
  const typedPackageTarget = path.join(outputDir, "node_modules", "@ts2hx", "typed-package");
  fs.cpSync(
    path.join(fixtureDir, "runtime", "typed-package"),
    typedPackageTarget,
    { recursive: true }
  );

  const runtimeTarget = path.join(outputDir, "ts2hx_semantic", "runtime");
  fs.mkdirSync(path.dirname(runtimeTarget), { recursive: true });
  fs.cpSync(stagedRuntimeDir, runtimeTarget, { recursive: true });
}

function compileOriginalTypeScript(opts: {
  repoRoot: string;
  fixtureDir: string;
  fixtureConfig: string;
  outputDir: string;
}): { semantic: string; converted: string; bound: string; packageBound: string } {
  resetDir(opts.outputDir);
  runTypeScriptApiBridge(opts.repoRoot, ["-p", opts.fixtureConfig, "--outDir", opts.outputDir]);
  const packageTarget = path.join(opts.outputDir, "node_modules", "@ts2hx", "semantic-effect");
  fs.mkdirSync(path.dirname(packageTarget), { recursive: true });
  fs.cpSync(path.join(opts.fixtureDir, "runtime", "package"), packageTarget, { recursive: true });
  const typedPackageTarget = path.join(
    opts.outputDir,
    "node_modules",
    "@ts2hx",
    "typed-package"
  );
  fs.cpSync(
    path.join(opts.fixtureDir, "runtime", "typed-package"),
    typedPackageTarget,
    { recursive: true }
  );
  const resourceTarget = path.join(opts.outputDir, "runtime", "after-support.mjs");
  fs.mkdirSync(path.dirname(resourceTarget), { recursive: true });
  fs.copyFileSync(path.join(opts.fixtureDir, "runtime", "after-support.mjs"), resourceTarget);
  fs.copyFileSync(path.join(opts.fixtureDir, "src", "runtime", "config.json"), path.join(opts.outputDir, "runtime", "config.json"));
  const semanticEntry = pathToFileURL(path.join(opts.outputDir, "Main.js")).href;
  const semantic = capture(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(semanticEntry)}).then((module) => module.main())`],
    opts.repoRoot
  );
  const convertedEntry = pathToFileURL(
    path.join(opts.outputDir, "converted", "ConvertedMain.js")
  ).href;
  const converted = capture(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(convertedEntry)}).then((module) => module.main())`],
    opts.repoRoot
  );
  const boundEntry = pathToFileURL(path.join(opts.outputDir, "bound", "BoundMain.js")).href;
  const bound = capture(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(boundEntry)}).then((module) => module.main())`],
    opts.repoRoot
  );
  const packageEntry = pathToFileURL(
    path.join(opts.outputDir, "packagebound", "PackageMain.js")
  ).href;
  const packageBound = capture(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(packageEntry)}).then((module) => module.main())`],
    opts.repoRoot
  );
  return { semantic, converted, bound, packageBound };
}

function compileClassicHaxe(opts: {
  haxeBin: string;
  repoRoot: string;
  haxeSourceDir: string;
  outputFile: string;
  mainClass: string;
  fixtureDir: string;
  stagedRuntimeDir: string;
  emitDts?: boolean;
}): string {
  resetDir(path.dirname(opts.outputFile));
  const args = [
    "-lib", "genes-ts",
    "-cp", opts.haxeSourceDir,
    "--macro", "genes.js.Async.enable()",
    "-dce", "full",
    "-main", opts.mainClass,
    "-js", opts.outputFile
  ];
  if (opts.emitDts) args.push("-D", "dts");
  run(opts.haxeBin, args, opts.repoRoot);
  installNodeRuntime(opts.fixtureDir, path.dirname(opts.outputFile), opts.stagedRuntimeDir);
  return capture(process.execPath, [opts.outputFile], opts.repoRoot);
}

function compileGenesTypeScript(opts: {
  haxeBin: string;
  repoRoot: string;
  haxeSourceDir: string;
  sourceDir: string;
  distDir: string;
  mainClass: string;
  fixtureDir: string;
  stagedRuntimeDir: string;
}): string {
  resetDir(opts.sourceDir);
  resetDir(opts.distDir);
  run(opts.haxeBin, [
    "-lib", "genes-ts",
    "-cp", opts.haxeSourceDir,
    "-main", opts.mainClass,
    "-js", path.join(opts.sourceDir, "index.ts"),
    "-D", "genes.ts",
    "-dce", "full"
  ], opts.repoRoot);

  const tsconfig = path.join(opts.sourceDir, "tsconfig.semantic.json");
  fs.writeFileSync(tsconfig, `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      resolveJsonModule: true,
      strict: true,
      noEmitOnError: true,
      outDir: opts.distDir,
      types: ["node"]
    },
    include: ["**/*.ts"]
  }, null, 2)}\n`, "utf8");
  installNodeRuntime(opts.fixtureDir, opts.sourceDir, opts.stagedRuntimeDir);
  runTypeScriptApiBridge(opts.repoRoot, ["-p", tsconfig]);
  installNodeRuntime(opts.fixtureDir, opts.distDir, opts.stagedRuntimeDir);
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
 * How: the test also validates the emitted schema-v3 feature/request manifest,
 * making the support/portability grades executable release evidence rather
 * than prose.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const haxeBin = resolveHaxeBin(toolRoot);
  const tmpRoot = path.join(toolRoot, ".tmp", "semantic-diff");
  const fixtureDir = path.join(toolRoot, "fixtures", "semantic-diff");
  const fixtureConfig = path.join(fixtureDir, "tsconfig.json");
  const verbatimFixtureConfig = path.join(fixtureDir, "tsconfig.verbatim.json");

  const originalOutput = compileOriginalTypeScript({
    repoRoot,
    fixtureDir,
    fixtureConfig,
    outputDir: path.join(tmpRoot, "original")
  });
  const originalTrace = semanticTrace(originalOutput.semantic, "original TypeScript");
  const originalConvertedTrace = convertedTrace(
    originalOutput.converted,
    "original converted-relative TypeScript"
  );
  const originalBoundTrace = boundTrace(originalOutput.bound, "original bound-only TypeScript");
  const originalPackageTrace = packageTrace(
    originalOutput.packageBound,
    "original bound-package TypeScript"
  );
  const originalVerbatimOutput = compileOriginalTypeScript({
    repoRoot,
    fixtureDir,
    fixtureConfig: verbatimFixtureConfig,
    outputDir: path.join(tmpRoot, "original-verbatim")
  });
  const originalVerbatimBoundTrace = boundTrace(
    originalVerbatimOutput.bound,
    "original verbatim bound-only TypeScript"
  );
  const originalVerbatimPackageTrace = packageTrace(
    originalVerbatimOutput.packageBound,
    "original verbatim bound-package TypeScript"
  );
  assert(
    originalConvertedTrace === "first,second|bound-first,bound-second",
    "original converted fixture has the wrong source order."
  );
  assert(
    originalBoundTrace
      === "default,namespace,mixed,default-empty,default-named,default-namespace,first,second|1:2:3:4:5:15:6:26:8:7:7",
    "non-verbatim TypeScript did not elide the unused bound request as expected."
  );
  assert(
    originalVerbatimBoundTrace
      === "unused,unused-default,unused-namespace,default,namespace,empty,inline-type,mixed,default-empty,default-named,default-namespace,first,second|4:5:8:9:10:20:11:31:13:12:12",
    "verbatim TypeScript did not retain the unused bound request in source order."
  );
  assert(
    originalPackageTrace === "Hello world|3|7|11|3.14|typed|true"
      && originalVerbatimPackageTrace === originalPackageTrace,
    "original TypeScript package fixture produced the wrong typed binding trace."
  );
  assertSideEffectOrder(originalOutput.semantic, "original TypeScript");

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
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true,
    runtimeModulesManifest: path.join(fixtureDir, "runtime-modules.json")
  });
  assert(translation.status === "success", `semantic-diff translation status was ${translation.status}.`);
  assert(translation.diagnostics.length === 0, "semantic-diff unexpectedly produced translation diagnostics.");
  const verbatimLoaded = loadProject(verbatimFixtureConfig);
  if (!verbatimLoaded.ok) {
    throw new Error(
      `verbatim semantic-diff fixture failed to load: ${verbatimLoaded.diagnostics.length} diagnostic(s).`
    );
  }
  const verbatimHaxeSourceDir = path.join(tmpRoot, "haxe-verbatim");
  const verbatimTranslation = emitProjectToHaxe({
    projectDir: verbatimLoaded.projectDir,
    rootDir: verbatimLoaded.rootDir,
    program: verbatimLoaded.program,
    checker: verbatimLoaded.checker,
    sourceFiles: verbatimLoaded.sourceFiles,
    outDir: verbatimHaxeSourceDir,
    basePackage: "ts2hx_semantic",
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true,
    runtimeModulesManifest: path.join(fixtureDir, "runtime-modules.json")
  });
  assert(
    verbatimTranslation.status === "success",
    `verbatim semantic-diff translation status was ${verbatimTranslation.status}.`
  );
  assert(
    verbatimTranslation.diagnostics.length === 0,
    "verbatim semantic-diff unexpectedly produced translation diagnostics."
  );
  assert(translation.manifest.schemaVersion === 3, "semantic manifest schema is not version 3.");
  assert(translation.manifest.targetProfile === "genes-esm", "semantic manifest lost its runtime profile.");
  assert(
    JSON.stringify(translation.manifest.requiredCompilerCapabilities)
      === JSON.stringify(["genes.esm-runtime-requests"]),
    "semantic manifest lost its required Genes capability."
  );
  assert(
    translation.manifest.compiler.typescriptEngine.version === ts.version,
    "semantic manifest recorded the wrong TypeScript engine."
  );
  assert(
    translation.manifest.moduleRequests.some(request => request.disposition === "runtime-request"),
    "semantic manifest lost its effective runtime-request evidence."
  );
  for (const [label, result] of [
    ["non-verbatim", translation],
    ["verbatim", verbatimTranslation]
  ] as const) {
    const requestSources = result.manifest.moduleRequests
      .filter(request => request.disposition === "runtime-request")
      .map(request => `${request.source.file}:${request.source.start}:${request.source.end}`)
      .sort();
    const requestFeature = result.manifest.features.find(
      feature => feature.id === "modules.esm-runtime-requests"
    );
    const featureSources = (requestFeature?.occurrences ?? [])
      .map(source => `${source.file}:${source.start}:${source.end}`)
      .sort();
    assert(
      JSON.stringify(featureSources) === JSON.stringify(requestSources),
      `${label} runtime-request feature provenance diverged from configured TypeScript emit.`
    );
  }
  const unusedDefaultRequest = translation.manifest.moduleRequests.find(request =>
    request.source.file.endsWith("bound/BoundMain.ts")
      && request.specifier === "./unused.js"
  );
  const unusedVerbatimRequest = verbatimTranslation.manifest.moduleRequests.find(request =>
    request.source.file.endsWith("bound/BoundMain.ts")
      && request.specifier === "./unused.js"
  );
  assert(
    unusedDefaultRequest?.disposition === "elided",
    "non-verbatim manifest did not record the unused import as TypeScript-elided."
  );
  assert(
    unusedVerbatimRequest?.disposition === "runtime-request"
      && unusedVerbatimRequest.emittedShape === "named",
    "verbatim manifest did not record the unused named runtime request."
  );
  const exercisedEsmShapes = new Set(
    verbatimTranslation.manifest.moduleRequests
      .filter((request) => request.disposition === "runtime-request" && request.moduleFormat === "esm")
      .map((request) => request.emittedShape)
  );
  for (const shape of [
    "bare",
    "empty",
    "named",
    "default",
    "namespace",
    "default-and-empty",
    "default-and-named",
    "default-and-namespace"
  ] as const) {
    assert(exercisedEsmShapes.has(shape), `three-runtime fixture does not exercise ESM shape ${shape}.`);
  }
  assert(translation.manifest.runtimeModules.length === 2, "semantic manifest lost its staged runtime modules.");
  assert(
    translation.manifest.runtimeModules[0]?.stagedFile
      === "ts2hx_semantic/runtime/after-support.mjs",
    "semantic manifest recorded the wrong staged runtime path."
  );
  const translationAgain = emitProjectToHaxe({
    projectDir: loaded.projectDir,
    rootDir: loaded.rootDir,
    program: loaded.program,
    checker: loaded.checker,
    sourceFiles: loaded.sourceFiles,
    outDir: haxeSourceDir,
    basePackage: "ts2hx_semantic",
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true,
    runtimeModulesManifest: path.join(fixtureDir, "runtime-modules.json")
  });
  assert(
    JSON.stringify(translationAgain.manifest) === JSON.stringify(translation.manifest),
    "runtime-module planning changed across two clean translations."
  );

  const standardTargetOutput = path.join(tmpRoot, "standard-target");
  resetDir(standardTargetOutput);
  const standardTargetSentinel = path.join(standardTargetOutput, "sentinel.txt");
  fs.writeFileSync(standardTargetSentinel, "prior-standard-tree\n", "utf8");
  const standardTargetRejected = emitProjectToHaxe({
    projectDir: loaded.projectDir,
    rootDir: loaded.rootDir,
    program: loaded.program,
    checker: loaded.checker,
    sourceFiles: loaded.sourceFiles,
    outDir: standardTargetOutput,
    basePackage: "ts2hx_semantic",
    runtimeProfile: "standard-haxe-js",
    mode: "strict-js",
    cleanOutDir: true,
    runtimeModulesManifest: path.join(fixtureDir, "runtime-modules.json")
  });
  assert(
    standardTargetRejected.status === "failed"
      && standardTargetRejected.writtenFiles.length === 0,
    "standard Haxe profile did not fail transactionally at its first effective request."
  );
  assert(
    fs.readFileSync(standardTargetSentinel, "utf8") === "prior-standard-tree\n",
    "standard Haxe target rejection modified the prior output tree."
  );
  assert(
    standardTargetRejected.diagnostics.length === 1
      && standardTargetRejected.diagnostics[0]?.id
        === "TS2HX-MODULES-ESM-RUNTIME-TARGET-001",
    "standard Haxe profile lost its canonical runtime-request capability diagnostic."
  );
  const firstEffectiveRequest = translation.manifest.moduleRequests.find(
    request => request.disposition === "runtime-request"
  );
  const standardTargetDiagnostic = standardTargetRejected.diagnostics[0];
  assert(
    firstEffectiveRequest !== undefined
      && standardTargetDiagnostic !== undefined
      && standardTargetDiagnostic.source.file === firstEffectiveRequest.source.file
      && standardTargetDiagnostic.source.line === firstEffectiveRequest.source.line
      && standardTargetDiagnostic.source.column === firstEffectiveRequest.source.column,
    "standard Haxe target rejection lost first-request provenance."
  );
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
    "exceptions.finally-outer-transfer",
    "this.class-and-lexical-arrow",
    "async.await",
    "modules.esm-bindings",
    "modules.esm-runtime-requests",
    "modules.side-effect-import"
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
  assert(
    translatedMain.includes("EsmRequestFact.external(\"@ts2hx/semantic-effect\", null)")
      && translatedMain.includes("EsmRequestFact.internal(moduleLabel)")
      && translatedMain.includes("EsmRequestFact.external(\"./runtime/after-support.mjs\", null)")
      && translatedMain.includes("EsmRequestFact.external(\"./runtime/config.json\", \"json\")"),
    "translated Haxe did not preserve the complete ordered runtime-import sequence."
  );
  const convertedHaxeDir = path.join(haxeSourceDir, "ts2hx_semantic", "converted");
  const convertedMainHaxe = fs.readFileSync(path.join(convertedHaxeDir, "ConvertedMain.hx"), "utf8");
  const transitiveBoundTargetHaxe = fs.readFileSync(
    path.join(convertedHaxeDir, "TransitiveBoundTarget.hx"),
    "utf8"
  );
  const firstHaxe = fs.readFileSync(path.join(convertedHaxeDir, "First.hx"), "utf8");
  const secondHaxe = fs.readFileSync(path.join(convertedHaxeDir, "Second.hx"), "utf8");
  const firstMarker = firstHaxe.match(/final (__ts2hx_init_[a-f0-9]{10}(?:_[0-9]+)?) = true;/)?.[1];
  const secondMarker = secondHaxe.match(/final (__ts2hx_init_[a-f0-9]{10}(?:_[0-9]+)?) = true;/)?.[1];
  assert(firstMarker !== undefined, "converted First target did not receive a deterministic marker.");
  assert(secondMarker !== undefined, "converted Second target did not receive a deterministic marker.");
  assert(
    firstMarker === "__ts2hx_init_380351706d_2",
    "converted target marker did not avoid the user-owned stable base name deterministically."
  );
  assert(
    firstHaxe.includes("@:keep\nfinal initialized = events.push(\"first\");")
      && secondHaxe.includes("@:keep\nfinal initialized = events.push(\"second\");"),
    "converted target initializers are not explicitly retained through full Haxe DCE."
  );
  const firstAnchor = `EsmRequestFact.internal(ts2hx_semantic.converted.First.${firstMarker})`;
  const secondAnchor = `EsmRequestFact.internal(ts2hx_semantic.converted.Second.${secondMarker})`;
  const stateAnchor = "EsmRequestFact.internal(events)";
  assert(
    convertedMainHaxe.indexOf(firstAnchor) >= 0
      && convertedMainHaxe.indexOf(secondAnchor) > convertedMainHaxe.indexOf(firstAnchor)
      && convertedMainHaxe.indexOf(stateAnchor) > convertedMainHaxe.indexOf(secondAnchor),
    "converted request carrier lost the source-ordered First, Second, State sequence."
  );
  assert(
    occurrenceCount(convertedMainHaxe, firstAnchor) === 2,
    "converted duplicate request provenance was lost before Genes projection."
  );
  assert(
    !convertedMainHaxe.includes('"./first.js"') && !convertedMainHaxe.includes('"./second.js"'),
    "converted request carrier preserved a deleted original JavaScript path."
  );
  const transitiveFirstAnchor = "EsmRequestFact.internal(first)";
  const transitiveSecondAnchor = "EsmRequestFact.internal(second)";
  assert(
    transitiveBoundTargetHaxe.indexOf(transitiveFirstAnchor) >= 0
      && transitiveBoundTargetHaxe.indexOf(transitiveSecondAnchor)
        > transitiveBoundTargetHaxe.indexOf(transitiveFirstAnchor),
    "bound-only transitive carrier lost TypeScript import-declaration order."
  );
  assert(
    transitiveBoundTargetHaxe.includes('("" + second + ":" + first)'),
    "transitive fixture no longer reads bindings in the order that exposes the dependency-order bug."
  );
  const boundMainHaxe = fs.readFileSync(
    path.join(haxeSourceDir, "ts2hx_semantic", "bound", "BoundMain.hx"),
    "utf8"
  );
  const verbatimBoundMainHaxe = fs.readFileSync(
    path.join(verbatimHaxeSourceDir, "ts2hx_semantic", "bound", "BoundMain.hx"),
    "utf8"
  );
  const packageMainHaxe = fs.readFileSync(
    path.join(haxeSourceDir, "ts2hx_semantic", "packagebound", "PackageMain.hx"),
    "utf8"
  );
  const verbatimPackageMainHaxe = fs.readFileSync(
    path.join(
      verbatimHaxeSourceDir,
      "ts2hx_semantic",
      "packagebound",
      "PackageMain.hx"
    ),
    "utf8"
  );
  const packageExtern = fs.readFileSync(
    path.join(haxeSourceDir, "ts2hx_semantic", "extern", "Ts2hxTypedPackage.hx"),
    "utf8"
  );
  assert(
    packageExtern.includes("static function add(arg0:Float, arg1:Float):Float;")
      && packageExtern.includes(
        '@:native("default") static function __default(arg0:String):String;'
      )
      && packageExtern.includes("static function notify(arg0:String):Void;")
      && packageExtern.includes("static var PI(default, never):Float;")
      && packageExtern.includes("static var label(default, never):String;")
      && packageExtern.includes("static var enabled(default, never):Bool;")
      && !packageExtern.includes("Dynamic")
      && !packageExtern.includes("static var unused"),
    "bound-package extern was not projected entirely from strong checker plans."
  );
  assert(
    occurrenceCount(
      packageMainHaxe,
      'EsmRequestFact.external("@ts2hx/typed-package", null)'
    ) === 3,
    "non-verbatim package carrier did not follow TypeScript import elision."
  );
  assert(
    occurrenceCount(
      verbatimPackageMainHaxe,
      'EsmRequestFact.external("@ts2hx/typed-package", null)'
    ) === 4,
    "verbatim package carrier did not retain the unused effective request."
  );
  const firstValueAnchor = "EsmRequestFact.internal(firstValue)";
  const secondValueAnchor = "EsmRequestFact.internal(secondValue)";
  const boundStateAnchor = "EsmRequestFact.internal(events)";
  const duplicateFirstAnchor = "EsmRequestFact.internal(firstAgain)";
  const unusedValueAnchor = "EsmRequestFact.internal(unusedValue)";
  const defaultAnchor = "EsmRequestFact.internal(defaultValue)";
  const namespaceAnchor = "EsmRequestFact.internal(ts2hx_semantic.bound.NamespaceEffect.__ts2hx_init_";
  const emptyAnchor = "EsmRequestFact.internal(ts2hx_semantic.bound.EmptyEffect.__ts2hx_init_";
  const inlineTypeAnchor = "EsmRequestFact.internal(ts2hx_semantic.bound.InlineTypeEffect.__ts2hx_init_";
  const mixedAnchor = "EsmRequestFact.internal(mixedValue)";
  const defaultEmptyAnchor = "EsmRequestFact.internal(defaultEmptyValue)";
  const defaultNamedAnchor = "EsmRequestFact.internal(defaultNamedValue)";
  const defaultNamespaceAnchor = "EsmRequestFact.internal(defaultNamespaceValue)";
  const unusedDefaultAnchor = "EsmRequestFact.internal(unusedDefaultValue)";
  const unusedNamespaceAnchor =
    "EsmRequestFact.internal(ts2hx_semantic.bound.UnusedNamespaceEffect.__ts2hx_init_";

  function assertCarrierOrder(source: string, anchors: readonly string[], label: string): void {
    let previous = -1;
    for (const anchor of anchors) {
      const position = source.indexOf(anchor);
      assert(position > previous, `${label}: carrier misplaced ${anchor}.`);
      previous = position;
    }
  }

  assertCarrierOrder(boundMainHaxe, [
    defaultAnchor,
    namespaceAnchor,
    mixedAnchor,
    defaultEmptyAnchor,
    defaultNamedAnchor,
    defaultNamespaceAnchor,
    firstValueAnchor,
    secondValueAnchor,
    boundStateAnchor,
    duplicateFirstAnchor
  ], "non-verbatim bound-only");
  for (const elidedAnchor of [
    unusedValueAnchor,
    unusedDefaultAnchor,
    unusedNamespaceAnchor,
    emptyAnchor,
    inlineTypeAnchor
  ]) {
    assert(
      !boundMainHaxe.includes(elidedAnchor),
      `non-verbatim carrier retained TypeScript-elided request ${elidedAnchor}.`
    );
  }
  assertCarrierOrder(verbatimBoundMainHaxe, [
    unusedValueAnchor,
    unusedDefaultAnchor,
    unusedNamespaceAnchor,
    defaultAnchor,
    namespaceAnchor,
    emptyAnchor,
    inlineTypeAnchor,
    mixedAnchor,
    defaultEmptyAnchor,
    defaultNamedAnchor,
    defaultNamespaceAnchor,
    firstValueAnchor,
    secondValueAnchor,
    boundStateAnchor,
    duplicateFirstAnchor
  ], "verbatim bound-only");
  assert(
    !verbatimBoundMainHaxe.includes("DeclarationTypeEffect.__ts2hx_init_"),
    "declaration-wide import type created a runtime request carrier."
  );
  const stagedResource = path.join(
    haxeSourceDir,
    "ts2hx_semantic",
    "runtime",
    "after-support.mjs"
  );
  assert(fs.existsSync(stagedResource), "runtime-module transaction did not stage the owned resource.");
  const stagedRuntimeDir = path.dirname(stagedResource);
  assert(
    fs.existsSync(path.join(stagedRuntimeDir, "config.json")),
    "runtime-module transaction did not stage the attributed JSON resource."
  );

  const cliOutput = path.join(tmpRoot, "runtime-modules-cli");
  run(process.execPath, [
    path.join(toolRoot, "dist", "cli.js"),
    "--project", fixtureConfig,
    "--out", cliOutput,
    "--base-package", "ts2hx_semantic",
    "--runtime-profile", "genes-esm",
    "--runtime-modules", path.join(fixtureDir, "runtime-modules.json"),
    "--clean"
  ], repoRoot);
  assert(
    fs.existsSync(path.join(cliOutput, "ts2hx_semantic", "runtime", "after-support.mjs")),
    "--runtime-modules did not stage the CLI-owned runtime file."
  );

  const invalidManifestRoot = path.join(tmpRoot, "invalid-runtime-manifest");
  resetDir(invalidManifestRoot);
  fs.mkdirSync(path.join(invalidManifestRoot, "runtime"), { recursive: true });
  fs.copyFileSync(
    path.join(fixtureDir, "runtime", "after-support.mjs"),
    path.join(invalidManifestRoot, "runtime", "after-support.mjs")
  );
  const invalidManifest = path.join(invalidManifestRoot, "runtime-modules.json");
  fs.writeFileSync(invalidManifest, `${JSON.stringify({
    schemaVersion: 1,
    modules: [{
      importer: "Main.ts",
      specifier: "./runtime/after-support.mjs",
      runtimeSpecifier: "./runtime/after-support.mjs",
      source: "runtime/after-support.mjs",
      stagedPath: "./runtime/after-support.mjs",
      owner: "invalid-hash-test",
      sha256: "0".repeat(64)
    }]
  }, null, 2)}\n`, "utf8");
  const invalidOutput = path.join(tmpRoot, "invalid-runtime-output");
  resetDir(invalidOutput);
  fs.writeFileSync(path.join(invalidOutput, "sentinel.txt"), "hash-prior\n", "utf8");
  let rejectedHash = false;
  try {
    emitProjectToHaxe({
      projectDir: loaded.projectDir,
      rootDir: loaded.rootDir,
      program: loaded.program,
      checker: loaded.checker,
      sourceFiles: loaded.sourceFiles,
      outDir: invalidOutput,
      basePackage: "ts2hx_semantic",
      runtimeProfile: "genes-esm",
      mode: "strict-js",
      cleanOutDir: true,
      runtimeModulesManifest: invalidManifest
    });
  } catch (error) {
    rejectedHash = error instanceof Error && error.message.includes("sha256 does not match");
  }
  assert(rejectedHash, "runtime-module manifest accepted stale source bytes.");
  assert(
    fs.readFileSync(path.join(invalidOutput, "sentinel.txt"), "utf8") === "hash-prior\n",
    "runtime-module manifest validation modified the prior output tree."
  );

  const classicOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    outputFile: path.join(tmpRoot, "classic", "index.js"),
    mainClass: "ts2hx_semantic.Main",
    fixtureDir,
    stagedRuntimeDir,
    emitDts: true
  });
  const genesTsOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-source"),
    distDir: path.join(tmpRoot, "genes-ts-dist"),
    mainClass: "ts2hx_semantic.Main",
    fixtureDir,
    stagedRuntimeDir
  });
  const classicConvertedOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    outputFile: path.join(tmpRoot, "classic-converted", "index.js"),
    mainClass: "ts2hx_semantic.converted.ConvertedMain",
    fixtureDir,
    stagedRuntimeDir
  });
  const genesTsConvertedOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-converted-source"),
    distDir: path.join(tmpRoot, "genes-ts-converted-dist"),
    mainClass: "ts2hx_semantic.converted.ConvertedMain",
    fixtureDir,
    stagedRuntimeDir
  });
  const classicBoundOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    outputFile: path.join(tmpRoot, "classic-bound", "index.js"),
    mainClass: "ts2hx_semantic.bound.BoundMain",
    fixtureDir,
    stagedRuntimeDir,
    emitDts: true
  });
  const genesTsBoundOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-bound-source"),
    distDir: path.join(tmpRoot, "genes-ts-bound-dist"),
    mainClass: "ts2hx_semantic.bound.BoundMain",
    fixtureDir,
    stagedRuntimeDir
  });
  const classicPackageOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    outputFile: path.join(tmpRoot, "classic-package", "index.js"),
    mainClass: "ts2hx_semantic.packagebound.PackageMain",
    fixtureDir,
    stagedRuntimeDir,
    emitDts: true
  });
  const genesTsPackageOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-package-source"),
    distDir: path.join(tmpRoot, "genes-ts-package-dist"),
    mainClass: "ts2hx_semantic.packagebound.PackageMain",
    fixtureDir,
    stagedRuntimeDir
  });
  runTypeScriptGeneratedOutputLanes(repoRoot, [
    "-p",
    path.join(tmpRoot, "genes-ts-package-source", "tsconfig.semantic.json"),
    "--noEmit"
  ]);
  const classicVerbatimBoundOutput = compileClassicHaxe({
    haxeBin,
    repoRoot,
    haxeSourceDir: verbatimHaxeSourceDir,
    outputFile: path.join(tmpRoot, "classic-verbatim-bound", "index.js"),
    mainClass: "ts2hx_semantic.bound.BoundMain",
    fixtureDir,
    stagedRuntimeDir,
    emitDts: true
  });
  const genesTsVerbatimBoundOutput = compileGenesTypeScript({
    haxeBin,
    repoRoot,
    haxeSourceDir: verbatimHaxeSourceDir,
    sourceDir: path.join(tmpRoot, "genes-ts-verbatim-bound-source"),
    distDir: path.join(tmpRoot, "genes-ts-verbatim-bound-dist"),
    mainClass: "ts2hx_semantic.bound.BoundMain",
    fixtureDir,
    stagedRuntimeDir
  });
  assert(
    !fs.existsSync(path.join(tmpRoot, "genes-ts-source", "genes", "js", "Coercion.ts")),
    "the macro-only coercion abstract leaked an empty runtime TypeScript module."
  );
  assert(
    !fs.readFileSync(path.join(tmpRoot, "classic", "index.js"), "utf8").includes("genes_js_Coercion"),
    "the macro-only coercion abstract leaked an empty runtime JavaScript helper."
  );
  const classicMain = fs.readFileSync(
    path.join(tmpRoot, "classic", "ts2hx_semantic", "Main.js"),
    "utf8"
  );
  const genesTsMain = fs.readFileSync(
    path.join(tmpRoot, "genes-ts-source", "ts2hx_semantic", "Main.ts"),
    "utf8"
  );
  for (const [label, source] of [["classic", classicMain], ["genes-ts", genesTsMain]] as const) {
    const packageRequest = source.indexOf("@ts2hx/semantic-effect");
    const supportRequest = source.indexOf("./Support.js");
    const resourceRequest = source.indexOf("./runtime/after-support.mjs");
    const attributedRequest = source.indexOf("./runtime/config.json");
    assert(packageRequest >= 0, `${label}: generated module lost the package request.`);
    assert(supportRequest > packageRequest, `${label}: generated bound request moved before the package request.`);
    assert(resourceRequest > supportRequest, `${label}: generated resource request moved before Support.`);
    assert(attributedRequest > resourceRequest, `${label}: generated attributed request moved before the resource.`);
    assert(source.includes('type: "json"'), `${label}: generated JSON request lost its import attribute.`);
    assert(!source.includes("SideEffectImportMarker"), `${label}: compiler marker leaked into generated output.`);
    assert(!source.includes("EsmRequestFact"), `${label}: guarded request fact leaked into generated output.`);
    assert(!source.includes("__ts2hx_requests"), `${label}: request carrier leaked into generated output.`);
    assert(
      source.includes("__Ts2hxFinallyAbrupt")
        && source.includes("FinallyCompletion.run")
        && source.includes("BreakTo")
        && source.includes("ContinueTo"),
      `${label}: typed finally completion implementation is missing.`
    );
    assert(
      !/^export\s+(?:type|const|function|class|\{)[^\n]*__Ts2hxFinallyAbrupt/m.test(source),
      `${label}: compiler-internal completion type became a module export.`
    );
    assert(
      !source.includes("setHxEnum") && !source.includes("hxEnums()["),
      `${label}: compiler-internal completion type entered the public enum registry.`
    );
    assert(
      !source.includes("ReturnValue(Register.unsafeCast"),
      `${label}: nullable completion payload required an unsafe generic cast.`
    );
  }
  const classicMainDts = fs.readFileSync(
    path.join(tmpRoot, "classic", "ts2hx_semantic", "Main.d.ts"),
    "utf8"
  );
  assert(
    !classicMainDts.includes("__Ts2hxFinallyAbrupt"),
    "classic declarations exposed the compiler-internal completion type."
  );
  const classicConvertedMain = fs.readFileSync(
    path.join(tmpRoot, "classic-converted", "ts2hx_semantic", "converted", "ConvertedMain.js"),
    "utf8"
  );
  const genesTsConvertedMain = fs.readFileSync(
    path.join(tmpRoot, "genes-ts-converted-source", "ts2hx_semantic", "converted", "ConvertedMain.ts"),
    "utf8"
  );
  for (const [label, source] of [
    ["classic converted", classicConvertedMain],
    ["genes-ts converted", genesTsConvertedMain]
  ] as const) {
    const firstRequest = source.indexOf("./First.js");
    const secondRequest = source.indexOf("./Second.js");
    const stateRequest = source.indexOf("./State.js");
    assert(firstRequest >= 0, `${label}: generated module lost the bare First request.`);
    assert(secondRequest > firstRequest, `${label}: generated Second request moved before First.`);
    assert(stateRequest > secondRequest, `${label}: generated bound State request moved before Second.`);
    assert(occurrenceCount(source, "./First.js") === 1, `${label}: duplicate First request was not coalesced.`);
    assert(!source.includes("./first.js"), `${label}: original converted JavaScript path leaked.`);
    assert(!source.includes("__ts2hx_init_"), `${label}: target marker leaked into generated output.`);
    assert(!source.includes("__ts2hx_requests"), `${label}: request carrier leaked into generated output.`);
    assert(!source.includes("SideEffectImportMarker"), `${label}: compiler marker leaked into generated output.`);
    assert(!source.includes("EsmRequestFact"), `${label}: guarded request fact leaked into generated output.`);
  }
  const classicTransitiveBoundTarget = fs.readFileSync(
    path.join(
      tmpRoot,
      "classic-converted",
      "ts2hx_semantic",
      "converted",
      "TransitiveBoundTarget.js"
    ),
    "utf8"
  );
  const genesTsTransitiveBoundTarget = fs.readFileSync(
    path.join(
      tmpRoot,
      "genes-ts-converted-source",
      "ts2hx_semantic",
      "converted",
      "TransitiveBoundTarget.ts"
    ),
    "utf8"
  );
  for (const [label, source] of [
    ["classic transitive bound-only", classicTransitiveBoundTarget],
    ["genes-ts transitive bound-only", genesTsTransitiveBoundTarget]
  ] as const) {
    const firstRequest = source.indexOf("./TransitiveBoundFirst.js");
    const secondRequest = source.indexOf("./TransitiveBoundSecond.js");
    assert(firstRequest >= 0, `${label}: generated module lost the first bound request.`);
    assert(secondRequest > firstRequest, `${label}: value-use order replaced import-declaration order.`);
    assert(!source.includes("__ts2hx_requests"), `${label}: request carrier leaked into generated output.`);
    assert(!source.includes("SideEffectImportMarker"), `${label}: compiler marker leaked into generated output.`);
    assert(!source.includes("EsmRequestFact"), `${label}: guarded request fact leaked into generated output.`);
  }
  const boundGeneratedSources = [
    {
      label: "classic bound-only",
      file: path.join(tmpRoot, "classic-bound", "ts2hx_semantic", "bound", "BoundMain.js"),
      verbatim: false
    },
    {
      label: "genes-ts bound-only",
      file: path.join(tmpRoot, "genes-ts-bound-source", "ts2hx_semantic", "bound", "BoundMain.ts"),
      verbatim: false
    },
    {
      label: "classic verbatim bound-only",
      file: path.join(
        tmpRoot,
        "classic-verbatim-bound",
        "ts2hx_semantic",
        "bound",
        "BoundMain.js"
      ),
      verbatim: true
    },
    {
      label: "genes-ts verbatim bound-only",
      file: path.join(
        tmpRoot,
        "genes-ts-verbatim-bound-source",
        "ts2hx_semantic",
        "bound",
        "BoundMain.ts"
      ),
      verbatim: true
    }
  ] as const;
  for (const generated of boundGeneratedSources) {
    assertBoundRequestOrder(
      fs.readFileSync(generated.file, "utf8"),
      generated.label,
      generated.verbatim
    );
  }
  for (const generated of [
    {
      label: "classic bound package",
      file: path.join(
        tmpRoot,
        "classic-package",
        "ts2hx_semantic",
        "packagebound",
        "PackageMain.js"
      )
    },
    {
      label: "genes-ts bound package",
      file: path.join(
        tmpRoot,
        "genes-ts-package-source",
        "ts2hx_semantic",
        "packagebound",
        "PackageMain.ts"
      )
    }
  ] as const) {
    const source = fs.readFileSync(generated.file, "utf8");
    assert(
      runtimeImportSpecifiers(source)
        .filter((specifier) => specifier === "@ts2hx/typed-package").length === 1,
      `${generated.label}: duplicate package requests were not coalesced.`
    );
    assert(
      source.includes('import * as Ts2hxTypedPackage from "@ts2hx/typed-package"'),
      `${generated.label}: package binding did not attach to the first request slot.`
    );
    for (const forbidden of ["__ts2hx_requests", "EsmRequestFact", "Dynamic", " any", "unknown"]) {
      assert(!source.includes(forbidden), `${generated.label}: generated source leaked ${forbidden}.`);
    }
  }
  for (const declarationFile of [
    path.join(tmpRoot, "classic-bound", "ts2hx_semantic", "bound", "BoundMain.d.ts"),
    path.join(
      tmpRoot,
      "classic-verbatim-bound",
      "ts2hx_semantic",
      "bound",
      "BoundMain.d.ts"
    )
  ]) {
    const declaration = fs.readFileSync(declarationFile, "utf8");
    for (const forbidden of [
      "__ts2hx_requests",
      "SideEffectImportMarker",
      "EsmRequestFact",
      "genes.compilerInternal"
    ]) {
      assert(!declaration.includes(forbidden), `bound-only declaration leaked ${forbidden}.`);
    }
  }
  assertSideEffectOrder(classicOutput, "translated classic Genes JavaScript");
  assertSideEffectOrder(genesTsOutput, "translated genes-ts output");
  assert(
    semanticTrace(classicOutput, "translated classic JavaScript") === originalTrace,
    "classic translated trace differs from original TypeScript."
  );
  assert(
    semanticTrace(genesTsOutput, "translated genes-ts output") === originalTrace,
    "genes-ts translated trace differs from original TypeScript."
  );
  assert(
    convertedTrace(classicConvertedOutput, "translated classic converted-relative output")
      === originalConvertedTrace,
    "classic converted-relative initialization differs from original TypeScript."
  );
  assert(
    convertedTrace(genesTsConvertedOutput, "translated genes-ts converted-relative output")
      === originalConvertedTrace,
    "genes-ts converted-relative initialization differs from original TypeScript."
  );
  assert(
    boundTrace(classicBoundOutput, "translated classic bound-only output") === originalBoundTrace,
    "classic bound-only initialization differs from non-verbatim TypeScript."
  );
  assert(
    boundTrace(genesTsBoundOutput, "translated genes-ts bound-only output") === originalBoundTrace,
    "genes-ts bound-only initialization differs from non-verbatim TypeScript."
  );
  assert(
    boundTrace(classicVerbatimBoundOutput, "translated classic verbatim bound-only output")
      === originalVerbatimBoundTrace,
    "classic bound-only initialization differs from verbatim TypeScript."
  );
  assert(
    boundTrace(genesTsVerbatimBoundOutput, "translated genes-ts verbatim bound-only output")
      === originalVerbatimBoundTrace,
    "genes-ts bound-only initialization differs from verbatim TypeScript."
  );
  assert(
    packageTrace(classicPackageOutput, "translated classic bound-package output")
      === originalPackageTrace,
    "classic bound-package execution differs from original TypeScript."
  );
  assert(
    packageTrace(genesTsPackageOutput, "translated genes-ts bound-package output")
      === originalPackageTrace,
    "genes-ts bound-package execution differs from original TypeScript."
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
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(rejected.status === "failed", `unsupported semantic project status was ${rejected.status}.`);
  assert(rejected.writtenFiles.length === 0, "unsupported semantic project committed partial output.");
  assert(
    fs.readFileSync(path.join(unsupportedOutput, "sentinel.txt"), "utf8") === "prior-tree\n",
    "unsupported semantic project modified the prior output tree."
  );
  const targetDiagnosticId = "TS2HX-MODULES-ESM-RUNTIME-TARGET-001";
  const unsupportedFailClosedCases = SEMANTIC_FAIL_CLOSED_CASES.filter(
    failure => failure.diagnosticId !== targetDiagnosticId
  );
  const expectedUnsupportedDiagnosticIds = unsupportedFailClosedCases
    .map((failure) => failure.diagnosticId)
    .sort();
  const diagnosticIds = rejected.diagnostics.map((diagnostic) => diagnostic.id).sort();
  assert(
    JSON.stringify(diagnosticIds) === JSON.stringify(expectedUnsupportedDiagnosticIds),
    `unsupported semantic diagnostics changed: ${JSON.stringify(diagnosticIds)}.`
  );
  const expectedDiagnosticSources = [
    "TS2HX-EXCEPTIONS-FINALLY-OUTER-TRANSFER-001|finallyTransfer.ts:2:3",
    "TS2HX-MODULES-ESM-BINDINGS-LIVE-001|mutableBinding.ts:1:1",
    "TS2HX-MODULES-ESM-RUNTIME-MODULE-KIND-001|commonjs/commonjsRequest.ts:1:1",
    "TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001|packageBound.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001|unsupportedAttribute.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001|effect.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-EXTERNAL-RELATIVE-001|externalRelative.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001|reexportOrder.ts:3:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNCONVERTED-SOURCE-001|unconvertedSource.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-UNRESOLVED-001|unresolvedSideEffect.ts:1:1",
    "TS2HX-PROTOTYPES-DYNAMIC-MUTATION-001|prototype.ts:8:3",
    "TS2HX-SWITCH-CONTINUE-001|switchContinue.ts:7:9"
  ].sort();
  assert(
    JSON.stringify(diagnosticSourceSummaries(rejected.diagnostics))
      === JSON.stringify(expectedDiagnosticSources),
    "canonical fail-closed diagnostics lost their stable source positions."
  );
  for (const failure of SEMANTIC_FAIL_CLOSED_CASES) {
    const manifest = failure.diagnosticId === targetDiagnosticId
      ? standardTargetRejected.manifest
      : rejected.manifest;
    const feature = manifest.features.find((entry) => entry.id === failure.featureId);
    assert(feature !== undefined, `${failure.featureId}: missing fail-closed feature contract.`);
    assert(
      feature.occurrences.length > 0,
      `${failure.featureId}: ${failure.variant} has no source provenance.`
    );
  }

  const assistedOutput = path.join(tmpRoot, "unsupported-assisted");
  const assisted = emitProjectToHaxe({
    projectDir: unsupportedProject.projectDir,
    rootDir: unsupportedProject.rootDir,
    program: unsupportedProject.program,
    checker: unsupportedProject.checker,
    sourceFiles: unsupportedProject.sourceFiles,
    outDir: assistedOutput,
    basePackage: "ts2hx_unsupported",
    runtimeProfile: "genes-esm",
    mode: "assisted",
    cleanOutDir: true
  });
  assert(assisted.status === "assisted", "side-effect boundary losses did not mark assisted output.");
  assert(
    JSON.stringify(assisted.diagnostics.map((diagnostic) => diagnostic.id).sort())
      === JSON.stringify(expectedUnsupportedDiagnosticIds),
    "assisted side-effect diagnostics diverged from strict mode."
  );
  assert(
    fs.readFileSync(path.join(assistedOutput, "ts2hx-manifest.json"), "utf8")
      .includes('"status": "assisted"'),
    "assisted side-effect losses were not committed with their manifest."
  );

  const moduleBoundaryConfig = path.join(
    toolRoot,
    "fixtures",
    "semantic-module-boundaries",
    "tsconfig.json"
  );
  const moduleBoundaryProject = loadProject(moduleBoundaryConfig);
  if (!moduleBoundaryProject.ok) {
    throw new Error(
      `semantic-module-boundaries fixture failed to load: ${moduleBoundaryProject.diagnostics.length} diagnostic(s).`
    );
  }
  const moduleBoundaryOutput = path.join(tmpRoot, "module-boundaries");
  resetDir(moduleBoundaryOutput);
  fs.writeFileSync(path.join(moduleBoundaryOutput, "sentinel.txt"), "module-prior\n", "utf8");
  const moduleBoundaryRejected = emitProjectToHaxe({
    projectDir: moduleBoundaryProject.projectDir,
    rootDir: moduleBoundaryProject.rootDir,
    program: moduleBoundaryProject.program,
    checker: moduleBoundaryProject.checker,
    sourceFiles: moduleBoundaryProject.sourceFiles,
    outDir: moduleBoundaryOutput,
    basePackage: "ts2hx_module_boundaries",
    runtimeProfile: "genes-esm",
    mode: "strict-js",
    cleanOutDir: true
  });
  const expectedModuleBoundarySources = [
    "TS2HX-MODULES-ESM-BINDINGS-LIVE-001|mutableAlias.ts:1:1",
    "TS2HX-MODULES-ESM-BINDINGS-LIVE-001|mutableNamespace.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001|attributeConverted.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001|cycleBoundA.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001|cycleSelf.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001|reexportNamed.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001|reexportNamespace.ts:1:1",
    "TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001|reexportStar.ts:1:1"
  ].sort();
  assert(
    moduleBoundaryRejected.status === "failed"
      && moduleBoundaryRejected.writtenFiles.length === 0,
    "module boundary project did not fail transactionally."
  );
  assert(
    fs.readFileSync(path.join(moduleBoundaryOutput, "sentinel.txt"), "utf8") === "module-prior\n",
    "module boundary failure modified the prior output tree."
  );
  assert(
    JSON.stringify(diagnosticSourceSummaries(moduleBoundaryRejected.diagnostics))
      === JSON.stringify(expectedModuleBoundarySources),
    "cycle/re-export/attribute boundary diagnostics changed."
  );

  const moduleBoundaryAssistedOutput = path.join(tmpRoot, "module-boundaries-assisted");
  const moduleBoundaryAssisted = emitProjectToHaxe({
    projectDir: moduleBoundaryProject.projectDir,
    rootDir: moduleBoundaryProject.rootDir,
    program: moduleBoundaryProject.program,
    checker: moduleBoundaryProject.checker,
    sourceFiles: moduleBoundaryProject.sourceFiles,
    outDir: moduleBoundaryAssistedOutput,
    basePackage: "ts2hx_module_boundaries",
    runtimeProfile: "genes-esm",
    mode: "assisted",
    cleanOutDir: true
  });
  assert(
    moduleBoundaryAssisted.status === "assisted"
      && JSON.stringify(diagnosticSourceSummaries(moduleBoundaryAssisted.diagnostics))
        === JSON.stringify(expectedModuleBoundarySources),
    "assisted module boundary losses diverged from strict diagnostics."
  );
  const moduleBoundaryManifest = fs.readFileSync(
    path.join(moduleBoundaryAssistedOutput, "ts2hx-manifest.json"),
    "utf8"
  );
  assert(
    moduleBoundaryManifest.includes('"status": "assisted"')
      && moduleBoundaryManifest.includes("reexportTypeOnly.ts"),
    "assisted module boundary manifest lost its status or type-only re-export disposition."
  );

  process.stdout.write(
    `Semantic differential OK (${expectedFeatures.length} exercised contracts, ${SEMANTIC_FAIL_CLOSED_CASES.length} fail-closed contracts, 3 runtimes)\n`
  );
}

main();
