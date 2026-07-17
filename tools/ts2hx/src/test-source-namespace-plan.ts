import fs from "fs";
import path from "path";
import ts from "./typescript-api.js";
import { emitProjectToHaxe, type TranslationMode } from "./haxe/emit.js";
import { planSourceNamespace } from "./haxe/source-namespace-plan.js";
import { loadProject } from "./project.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function resetDir(absDir: string): void {
  fs.rmSync(absDir, { recursive: true, force: true });
  fs.mkdirSync(absDir, { recursive: true });
}

function snapshotTree(absDir: string, relDir = ""): string[] {
  const current = path.join(absDir, relDir);
  if (!fs.existsSync(current)) return [];
  const result: string[] = [];
  for (const name of fs.readdirSync(current).sort((a, b) => a.localeCompare(b))) {
    const relative = path.join(relDir, name);
    const absolute = path.join(absDir, relative);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) result.push(...snapshotTree(absDir, relative));
    else result.push(`${relative.split(path.sep).join("/")}:${fs.readFileSync(absolute).toString("base64")}`);
  }
  return result;
}

function writeFixture(
  fixtureDir: string,
  files: Readonly<Record<string, string>>,
  include: readonly string[] = ["src/**/*.ts"]
): Extract<ReturnType<typeof loadProject>, { ok: true }> {
  resetDir(fixtureDir);
  const projectPath = path.join(fixtureDir, "tsconfig.json");
  fs.writeFileSync(projectPath, `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      rootDir: "src",
      strict: true,
      skipLibCheck: true
    },
    include
  }, null, 2)}\n`, "utf8");
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(fixtureDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  const loaded = loadProject(projectPath);
  if (!loaded.ok)
    throw new Error(`Could not load ${path.basename(fixtureDir)}: ${loaded.diagnostics.length} diagnostic(s).`);
  return loaded;
}

/**
 * Proves that source identity is validated before any generated file exists.
 *
 * Why: TypeScript permits both `foo-bar.ts` and `foo_bar.ts`, while the legacy
 * filename conversion maps both to `FooBar.hx`. Sequential staging used to let
 * the later source silently replace the earlier module even though translation
 * reported success for both files.
 *
 * What: strict and assisted modes must report every collider at its source,
 * publish no scaffold, and preserve the exact prior output tree. Assisted mode
 * cannot represent two source modules at one Haxe identity, so this boundary is
 * an error rather than an acknowledged lossy conversion.
 *
 * How: the fixture is built in a temporary project so its intentionally
 * colliding roots never enter normal snapshot inventories. Repeating the plan
 * also proves stable diagnostic and manifest ordering.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const fixtureDir = path.join(toolRoot, ".tmp", "source-namespace-plan-fixture");
  const project = writeFixture(fixtureDir, {
    "src/foo-bar.ts": "export const hyphen: number = 1;\n",
    "src/foo_bar.ts": "export const underscore: number = 2;\n"
  });

  function verify(mode: TranslationMode): void {
    const outDir = path.join(toolRoot, ".tmp", `source-namespace-plan-${mode}`);
    resetDir(outDir);
    fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "sentinel.txt"), "prior-tree\n", "utf8");
    fs.writeFileSync(path.join(outDir, "assets", "user-owned.txt"), "keep-me\n", "utf8");
    const before = snapshotTree(outDir);
    const options = {
      projectDir: project.projectDir,
      rootDir: project.rootDir,
      program: project.program,
      checker: project.checker,
      sourceFiles: project.sourceFiles,
      outDir,
      basePackage: "namespace_test",
      runtimeProfile: "standard-haxe-js" as const,
      mode,
      cleanOutDir: true
    };
    const result = emitProjectToHaxe(options);
    const repeated = emitProjectToHaxe(options);

    assert(result.status === "failed", `${mode}: collision status was ${result.status}`);
    assert(result.writtenFiles.length === 0, `${mode}: collision published files`);
    assert(result.manifest.plannedFiles.length === 0, `${mode}: collision planned publishable files`);
    assert(JSON.stringify(result.manifest) === JSON.stringify(repeated.manifest), `${mode}: plan was not deterministic`);
    assert(JSON.stringify(snapshotTree(outDir)) === JSON.stringify(before), `${mode}: collision changed the prior tree`);
    assert(result.diagnostics.length === 2, `${mode}: expected two collision diagnostics`);
    assert(result.diagnostics.every((entry) => entry.id === "TS2HX-SOURCE-NAMESPACE-COLLISION-001"),
      `${mode}: collision used an unexpected diagnostic`);
    assert(result.diagnostics.every((entry) => entry.severity === "error"),
      `${mode}: collision was incorrectly scaffoldable`);
    const diagnosticSources = result.diagnostics.map((entry) => entry.source.file).join(",");
    assert(diagnosticSources === "foo_bar.ts,foo-bar.ts",
      `${mode}: collision sources were not complete or deterministic: ${diagnosticSources}`);
    assert(result.diagnostics.every((entry) => entry.source.line === 1 && entry.source.column === 1),
      `${mode}: collision diagnostics lost their source position`);
    assert(result.diagnostics.every((entry) =>
      entry.message.includes("foo-bar.ts") && entry.message.includes("foo_bar.ts") && entry.message.includes("FooBar.hx")),
      `${mode}: collision message did not explain the shared identity`);
    assert(result.dispositions.every((entry) =>
      entry.status === "unsupported" && entry.outputFile === "namespace_test/FooBar.hx"),
      `${mode}: collision dispositions did not retain the proposed output identity`);
  }

  verify("strict-js");
  verify("assisted");

  function verifyIdentityFailure(
    name: string,
    files: Readonly<Record<string, string>>,
    basePackage: string,
    expectedId: string,
    expectedCount: number,
    include?: readonly string[]
  ): void {
    const projectDir = path.join(toolRoot, ".tmp", `source-namespace-${name}-fixture`);
    const failedProject = writeFixture(projectDir, files, include);
    const outDir = path.join(toolRoot, ".tmp", `source-namespace-${name}-output`);
    resetDir(outDir);
    fs.writeFileSync(path.join(outDir, "sentinel.txt"), `${name}-prior\n`, "utf8");
    const before = snapshotTree(outDir);
    const result = emitProjectToHaxe({
      projectDir: failedProject.projectDir,
      rootDir: failedProject.rootDir,
      program: failedProject.program,
      checker: failedProject.checker,
      sourceFiles: failedProject.sourceFiles,
      outDir,
      basePackage,
      runtimeProfile: "standard-haxe-js",
      mode: "assisted",
      cleanOutDir: true
    });
    assert(result.status === "failed", `${name}: invalid identity was scaffolded`);
    assert(result.writtenFiles.length === 0, `${name}: invalid identity published files`);
    assert(JSON.stringify(snapshotTree(outDir)) === JSON.stringify(before), `${name}: prior tree changed`);
    const matching = result.diagnostics.filter((entry) => entry.id === expectedId);
    assert(matching.length === expectedCount,
      `${name}: expected ${expectedCount} ${expectedId} diagnostics, got ${matching.length}`);
    assert(matching.every((entry) => entry.severity === "error" && entry.source.line === 1 && entry.source.column === 1),
      `${name}: identity failure was not source-positioned and non-scaffoldable`);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  verifyIdentityFailure(
    "base-package",
    { "src/Main.ts": "export const value: number = 1;\n" },
    "Bad..Package",
    "TS2HX-SOURCE-NAMESPACE-BASE-PACKAGE-001",
    1
  );
  verifyIdentityFailure(
    "directory-segment",
    { "src/bad-segment/Nested.ts": "export const value: number = 1;\n" },
    "namespace_test",
    "TS2HX-SOURCE-NAMESPACE-PACKAGE-SEGMENT-001",
    1
  );
  const virtualRoot = path.resolve(toolRoot, ".tmp", "source-namespace-case-virtual");
  const caseFoldedPlan = planSourceNamespace({
    rootDir: virtualRoot,
    outDir: path.join(toolRoot, ".tmp", "source-namespace-case-output"),
    basePackage: "namespace_test",
    sourceFiles: [
      ts.createSourceFile(
        path.join(virtualRoot, "fooBar", "Same.ts"),
        "export const mixedCase: number = 1;\n",
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS
      ),
      ts.createSourceFile(
        path.join(virtualRoot, "foobar", "Same.ts"),
        "export const lowerCase: number = 2;\n",
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS
      )
    ]
  });
  assert(caseFoldedPlan.problems.length === 2 && caseFoldedPlan.problems.every((problem) =>
    problem.id === "TS2HX-SOURCE-NAMESPACE-COLLISION-001"),
    "case-insensitive output collision was not rejected portably");
  verifyIdentityFailure(
    "module-name",
    {
      "src/123.ts": "export const numeric: number = 1;\n",
      "src/---.ts": "export const punctuation: number = 2;\n"
    },
    "namespace_test",
    "TS2HX-SOURCE-NAMESPACE-MODULE-NAME-001",
    2
  );
  verifyIdentityFailure(
    "outside-root",
    {
      "src/Main.ts": "export const inside: number = 1;\n",
      "outside.ts": "export const outside: number = 2;\n"
    },
    "namespace_test",
    "TS2HX-SOURCE-NAMESPACE-OUTSIDE-ROOT-001",
    1,
    ["src/**/*.ts", "outside.ts"]
  );

  const positiveDir = path.join(toolRoot, ".tmp", "source-namespace-positive-fixture");
  const positive = writeFixture(positiveDir, {
    "src/Main.ts":
      "import type { UserProfile } from \"./domain/user-profile.js\";\n"
      + "export function label(value: UserProfile): string { return value.name; }\n",
    "src/domain/user-profile.ts": "export interface UserProfile { name: string; }\n"
  });
  const positiveOut = path.join(toolRoot, ".tmp", "source-namespace-positive-output");
  resetDir(positiveOut);
  const immutablePlan = planSourceNamespace({
    rootDir: positive.rootDir,
    outDir: positiveOut,
    basePackage: "namespace_test",
    sourceFiles: positive.sourceFiles
  });
  assert(Object.isFrozen(immutablePlan) && Object.isFrozen(immutablePlan.entries),
    "source namespace plan or entry inventory is mutable");
  assert(immutablePlan.entries.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.packageSegments)),
    "source namespace entries are mutable");
  assert(immutablePlan.problems.length === 0, "valid nested sources produced namespace problems");
  const positiveResult = emitProjectToHaxe({
    projectDir: positive.projectDir,
    rootDir: positive.rootDir,
    program: positive.program,
    checker: positive.checker,
    sourceFiles: positive.sourceFiles,
    outDir: positiveOut,
    basePackage: "namespace_test",
    runtimeProfile: "standard-haxe-js",
    mode: "strict-js",
    cleanOutDir: true
  });
  assert(positiveResult.status === "success", `valid namespace status was ${positiveResult.status}`);
  assert(positiveResult.manifest.plannedFiles.includes("namespace_test/Main.hx"),
    "root source output was absent from the namespace-owned manifest");
  assert(positiveResult.manifest.plannedFiles.includes("namespace_test/domain/UserProfile.hx"),
    "nested source output was absent from the namespace-owned manifest");
  const mainHaxe = fs.readFileSync(path.join(positiveOut, "namespace_test", "Main.hx"), "utf8");
  const profileHaxe = fs.readFileSync(
    path.join(positiveOut, "namespace_test", "domain", "UserProfile.hx"),
    "utf8"
  );
  assert(mainHaxe.includes("import namespace_test.domain.UserProfile;"),
    "relative import did not reuse the planned target identity");
  assert(profileHaxe.startsWith("package namespace_test.domain;"),
    "nested source did not reuse its planned package identity");

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.rmSync(positiveDir, { recursive: true, force: true });
  console.log("ts2hx source namespace plan: ok");
}

main();
