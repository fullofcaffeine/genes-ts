import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

interface SelectionReport {
  selectionMode: string;
  docsOnly: boolean;
  unknownFiles: string[];
  ambiguousFiles: Array<{file: string; rules: string[]}>;
  affectedSurfaces: Array<{id: string; label: string; reasons: string[]}>;
  coveredSurfaces: Array<{id: string; label: string; selectedGateIds: string[]}>;
  selected: Array<{
    id: string;
    command: string;
    reasons: string[];
    coveredSurfaceIds: string[];
  }>;
  omitted: Array<{id: string; reason: string}>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runner = path.join(repoRoot, "scripts", "dist", "test-plan.js");
const report = path.join(
  repoRoot,
  ".tmp",
  "test-evidence",
  "test-plan",
  "selection.json"
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function explain(changed: string): SelectionReport {
  return runExplain(["--changed", changed]);
}

function runExplain(
  arguments_: string[],
  environment: NodeJS.ProcessEnv = process.env
): SelectionReport {
  const result = spawnSync(process.execPath, [
    runner,
    "explain",
    ...arguments_
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: environment,
    timeout: 30_000
  });
  assert(result.status === 0,
    `Selection explain failed:\n${result.stdout}${result.stderr}`);
  return JSON.parse(readFileSync(report, "utf8")) as SelectionReport;
}

function ids(result: SelectionReport): Set<string> {
  return new Set(result.selected.map((entry) => entry.id));
}

function requires(result: SelectionReport, ...expected: string[]): void {
  const selected = ids(result);
  for (const id of expected)
    assert(selected.has(id),
      `Expected selection to include ${id}; selected ${[...selected].join(", ")}`);
  assert(result.omitted.length > 0, "Selection must explain omitted gates");
  assert(result.selected.every((entry) => entry.reasons.length > 0),
    "Every selected gate must state its rule or ownership path");
}

function surfaceIds(
  values: ReadonlyArray<{id: string}>
): Set<string> {
  return new Set(values.map((entry) => entry.id));
}

function exactSurfaces(
  result: SelectionReport,
  ...expected: string[]
): void {
  const actual = [...surfaceIds(result.affectedSurfaces)].sort();
  const wanted = [...expected].sort();
  assert(actual.join(",") === wanted.join(","),
    `Expected affected surfaces ${wanted.join(", ")}; found ${actual.join(", ")}`);
}

/**
 * Locks the high-risk impact-map examples from the testing policy.
 *
 * The selector remains observation-only. These cases prove its explanations
 * are deterministic, unknown ownership expands to the full backstop, and the
 * ordinary documentation fast path cannot accidentally classify testing,
 * compatibility, release, or agent policy as non-executable prose.
 */
function main(): void {
  const compiler = explain("src/genes/Generator.hx");
  requires(compiler,
    "portable-haxe-smoke",
    "classic-core",
    "typescript-full",
    "dual-output-semantics",
    "full-ci");
  exactSurfaces(compiler,
    "classic-js-runtime", "typescript-source-runtime", "declarations-packages",
    "react-hxx-compiler");
  assert(!surfaceIds(compiler.affectedSurfaces).has("browser-framework-runtime")
    && surfaceIds(compiler.coveredSurfaces).has("browser-framework-runtime"),
  "The broad full gate laundered covered browser evidence into an affected surface");

  const typescript = explain("src/genes/ts/TsModuleEmitter.hx");
  requires(typescript,
    "typescript-full",
    "classic-declarations",
    "source-maps",
    "portable-haxe-smoke");
  exactSurfaces(typescript,
    "typescript-source-runtime", "declarations-packages");

  const declarations = explain("src/genes/dts/TypeEmitter.hx");
  requires(declarations,
    "typescript-full",
    "classic-declarations",
    "source-maps");
  exactSurfaces(declarations, "declarations-packages");

  const sharedEmitter = explain("src/genes/es/ExprEmitter.hx");
  requires(sharedEmitter,
    "classic-core",
    "typescript-full",
    "dual-output-semantics",
    "hxx-tsx",
    "source-maps");
  exactSurfaces(sharedEmitter,
    "classic-js-runtime", "typescript-source-runtime", "react-hxx-compiler");

  const react = explain("src/genes/react/JSX.hx");
  requires(react,
    "hxx-tsx",
    "hxx-carrier-immutability",
    "react-hooks",
    "examples-dual-profile-e2e");
  assert(react.ambiguousFiles.some((entry) =>
    entry.file === "src/genes/react/JSX.hx"
    && entry.rules.includes("compiler-core")
    && entry.rules.includes("react-hxx-browser")),
  "Overlapping compiler/React ownership was not reported as ambiguous");
  assert(ids(react).has("full-ci"),
    "Ambiguous compiler/React ownership did not expand to the full backstop");
  exactSurfaces(react,
    "react-hxx-compiler", "browser-framework-runtime");

  const reactFixture = explain("tests/genes-ts/snapshot/react/src/DualJsxMain.hx");
  requires(reactFixture,
    "hxx-tsx",
    "react-hooks",
    "examples-dual-profile-e2e");
  exactSurfaces(reactFixture,
    "typescript-source-runtime", "react-hxx-compiler");
  assert(!surfaceIds(reactFixture.affectedSurfaces).has("browser-framework-runtime")
    && surfaceIds(reactFixture.coveredSurfaces).has("browser-framework-runtime"),
  "A compiler-only React fixture laundered covered browser evidence into an affected surface");

  const sharedFixture = explain(
    "tests/genes-ts/package-shapes/build-ts.hxml"
  );
  assert(sharedFixture.ambiguousFiles.some((entry) =>
    entry.file === "tests/genes-ts/package-shapes/build-ts.hxml"
    && entry.rules.includes("owner:package-imports")
    && entry.rules.includes("owner:binding-identity")),
  "Overlapping gate owners were not reported as ambiguous");
  assert(ids(sharedFixture).has("full-ci"),
    "Overlapping gate owners did not expand to the full backstop");

  const harness = explain("scripts/test-plan.ts");
  requires(harness,
    "test-plan-validation",
    "test-tool-preparation",
    "portable-haxe-failure-propagation",
    "full-ci");
  assert(harness.affectedSurfaces.length === 9,
    "Test-harness policy must conservatively affect every scorecard");

  const composedRunner = explain("scripts/test-template-literals.ts");
  requires(composedRunner, "dual-output-semantics", "full-ci");

  const adapterInjection = explain(
    "tests/portable-haxe-smoke/src/utest/Assert.hx"
  );
  requires(adapterInjection,
    "portable-haxe-smoke",
    "portable-haxe-failure-propagation",
    "full-ci");
  assert(adapterInjection.selected
    .find((entry) => entry.id === "portable-haxe-failure-propagation")
    ?.reasons.some((reason) => reason.includes(" -> declared owner ")),
  "Adapter fault injection reaches its failure gate only as an always-run sentinel");

  const agentGuide = explain("tools/ts2hx/AGENTS.md");
  requires(agentGuide, "agent-guides", "ts2hx", "full-ci");

  const browserExample = explain("examples/todoapp/e2e");
  requires(browserExample, "examples-dual-profile-e2e");
  assert(browserExample.selected
    .find((entry) => entry.id === "examples-dual-profile-e2e")
    ?.command === "yarn test:examples --playwright",
  "Selected browser example gate omitted its declared Playwright argument");
  exactSurfaces(browserExample,
    "classic-js-runtime", "typescript-source-runtime", "declarations-packages",
    "react-hxx-compiler", "browser-framework-runtime", "example-portfolio");

  const capabilityExample = explain("examples/typescript-target/src/Main.hx");
  requires(capabilityExample,
    "examples-dual-profile-e2e",
    "portable-haxe-smoke",
    "acceptance");
  exactSurfaces(capabilityExample,
    "classic-js-runtime", "typescript-source-runtime", "example-portfolio");

  const executableOwner = explain("scripts/probe-binding-identity.ts");
  assert(!executableOwner.docsOnly,
    "An executable owner-only path must not use the docs-only fast path");
  requires(executableOwner, "binding-identity", "portable-haxe-smoke");

  const release = explain("scripts/release/package-haxelib.cjs");
  requires(release,
    "release-contract",
    "package-imports",
    "portable-haxe-smoke",
    "full-ci");
  exactSurfaces(release, "declarations-packages", "distribution-adoption");

  const lockfile = explain("yarn.lock");
  requires(lockfile,
    "release-contract",
    "compatibility-inventory",
    "portable-haxe-smoke",
    "acceptance",
    "full-ci");
  exactSurfaces(lockfile,
    "classic-js-runtime", "typescript-source-runtime", "declarations-packages",
    "react-hxx-compiler", "browser-framework-runtime", "host-tooling",
    "ts2hx-migration", "distribution-adoption");

  const migration = explain("tools/ts2hx/src/project.ts");
  requires(migration, "ts2hx", "portable-haxe-smoke");
  exactSurfaces(migration, "ts2hx-migration");

  const docs = explain("docs/TROUBLESHOOTING.md");
  assert(docs.docsOnly, "Ordinary documentation did not use the docs-only path");
  assert(docs.affectedSurfaces.length === 0,
    "Ordinary documentation must not claim that a product behavior changed");
  assert(ids(docs).has("agent-guides"), "Docs-only path omitted guide validation");
  assert(!ids(docs).has("portable-haxe-smoke"),
    "Ordinary documentation unnecessarily selected executable smoke");

  const testingDocs = explain("docs/TESTING_STRATEGY.md");
  assert(!testingDocs.docsOnly,
    "Testing policy must never use the ordinary docs-only fast path");
  requires(testingDocs, "test-plan-validation", "full-ci");

  for (const [executablePolicyDoc, owner] of [
    ["docs/NULL_SAFETY.md", "null-safety-policy"],
    ["docs/BRANCH_PROTECTION.md", "ci-protection-policy"]
  ] as const) {
    const policyDoc = explain(executablePolicyDoc);
    assert(!policyDoc.docsOnly,
      `${executablePolicyDoc} must not use the ordinary docs-only fast path`);
    requires(policyDoc, owner, "portable-haxe-smoke");
  }

  for (const compatibilityReport of [
    "docs/COMPATIBILITY_REPORT.md",
    "docs/COMPATIBILITY_REPORT.json"
  ]) {
    const compatibilityClaim = explain(compatibilityReport);
    assert(!compatibilityClaim.docsOnly,
      `${compatibilityReport} must not use the ordinary docs-only path`);
    requires(compatibilityClaim,
      "compatibility-inventory",
      "test-plan-validation",
      "full-ci");
    assert(compatibilityClaim.selected
      .find((entry) => entry.id === "compatibility-inventory")
      ?.reasons.some((reason) => reason.includes(" -> declared owner ")),
    `${compatibilityReport} does not select its focused checker owner`);
  }

  for (const policyPath of [".audit/genes-brxy.tsv", ".gitignore"]) {
    const policy = explain(policyPath);
    assert(policy.unknownFiles.length === 0,
      `${policyPath} must be classified as test-harness policy`);
    requires(policy, "test-plan-validation", "full-ci");
  }

  const unknown = explain("future/unknown-owner.file");
  assert(unknown.unknownFiles.length === 1,
    "Unknown path was not reported as unknown");
  requires(unknown, "full-ci", "portable-haxe-smoke");
  assert(unknown.affectedSurfaces.length === 9,
    "Unknown ownership must conservatively affect every scorecard");
  assert(unknown.selectionMode === "observation",
    "Selector was promoted without the required observation window");

  const unreadableMergeBase = runExplain([], {
    ...process.env,
    GENES_TEST_PLAN_MERGE_BASE:
      "refs/heads/genes-test-plan-deliberately-missing"
  });
  assert(unreadableMergeBase.unknownFiles.some((file) =>
    file.startsWith("<unreadable-merge-base:")),
  "An unreadable merge-base diff was not reported as unknown ownership");
  requires(unreadableMergeBase, "full-ci", "portable-haxe-smoke");

  console.log(
    "test-plan-selection:ok "
    + "(compiler/TS/React/harness/release/docs/policy/owners/arguments/"
    + "unknown/ambiguous/merge-base)"
  );
}

main();
