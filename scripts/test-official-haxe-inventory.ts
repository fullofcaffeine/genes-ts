import {spawnSync} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

type ProfileId = "classic-esm" | "typescript";
type TestFamily = "unit" | "unitstd" | "issue";
type CapabilityPhase = "inventory" | "future-runtime";

interface SourcePin {
  repository: string;
  revision: string;
  license: string;
  licensePath: string;
}

interface InventoryDependency extends SourcePin {
  id: "hxnodejs";
  version: string;
  reason: string;
}

interface Profile {
  id: ProfileId;
  defines: string[];
}

type CapabilitySelector =
  | {kind: "all"}
  | {kind: "case"; value: string}
  | {kind: "case-prefix"; value: string};

interface CapabilityRule {
  id: string;
  phase: CapabilityPhase;
  selectors: CapabilitySelector[];
  reason: string;
}

interface SingleExclusion {
  id: "commented-test-case";
  caseId: string;
  source: string;
  reason: string;
}

interface SourceExclusions {
  id: "disabled-source-files";
  sources: string[];
  reason: string;
}

interface Manifest {
  schemaVersion: number;
  contract: string;
  disposition: "inventory-only";
  claim: string;
  haxe: SourcePin & {version: string};
  utest: SourcePin;
  inventoryDependencies: [InventoryDependency];
  profiles: [Profile, Profile];
  profileComparison: "identical-active-tests";
  compilerRequest: {
    target: "js";
    main: "unit.TestMain";
    dce: "full";
    debug: true;
    noOutput: true;
  };
  expected: {
    testsPerProfile: number;
    familiesPerProfile: Record<TestFamily, number>;
  };
  capabilityRules: CapabilityRule[];
  excludedRegistrations: [SingleExclusion, SourceExclusions];
}

interface RawTest {
  id: string;
  caseId: string;
  family: TestFamily;
  method: string;
  source: {file: string};
}

interface RawInventory {
  schemaVersion: number;
  profile: ProfileId;
  tests: RawTest[];
}

interface ActiveTest {
  id: string;
  caseId: string;
  family: TestFamily;
  method: string;
  source: string;
}

interface ReviewedInventory {
  schemaVersion: number;
  contract: "genes-official-haxe-profile-inventory";
  profile: ProfileId;
  defines: string[];
  haxeRevision: string;
  utestRevision: string;
  activeTests: ActiveTest[];
}

interface MaterializedSource {
  root: string;
  cacheHit: boolean;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests", "official-haxe-inventory");
const manifest = JSON.parse(readFileSync(
  path.join(fixtureRoot, "manifest.json"),
  "utf8"
)) as Manifest;
const cacheRoot = path.join(repoRoot, ".cache", "official-haxe-inventory");
const evidenceRoot = path.join(
  repoRoot,
  ".tmp",
  "official-haxe-inventory",
  `${process.pid}-${Date.now()}`
);
const writeReviewed = process.argv.includes("--write");
const injection = process.env.GENES_OFFICIAL_INVENTORY_INJECT;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  options: {quiet?: boolean} = {}
): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {...process.env, NO_COLOR: "1"},
    timeout: 120_000
  });
  if (result.error !== undefined) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error([
      `${command} exited with ${String(result.status)}`,
      result.stdout,
      result.stderr
    ].join("\n"));
  }
  if (!options.quiet && result.stderr.trim().length > 0) {
    process.stderr.write(result.stderr);
  }
  return result.stdout.trim();
}

function commitExists(repository: string, revision: string): boolean {
  if (!existsSync(path.join(repository, ".git"))) return false;
  const result = spawnSync(
    "git",
    ["-C", repository, "cat-file", "-e", `${revision}^{commit}`],
    {encoding: "utf8"}
  );
  return result.status === 0;
}

function materialize(
  id: string,
  pin: SourcePin,
  environmentName: string,
  nearbyRepositories: string[]
): MaterializedSource {
  const destination = path.join(cacheRoot, `${id}-${pin.revision}`);
  const marker = path.join(destination, ".genes-source.json");
  if (existsSync(marker)) {
    const recorded = JSON.parse(readFileSync(marker, "utf8")) as {
      repository: string;
      revision: string;
    };
    assert(recorded.repository === pin.repository && recorded.revision === pin.revision,
      `${id} cache marker differs from the reviewed pin`);
    return {root: destination, cacheHit: true};
  }

  mkdirSync(cacheRoot, {recursive: true});
  const staging = path.join(cacheRoot, `.${id}-${process.pid}-${Date.now()}`);
  const tree = path.join(staging, "tree");
  const archive = path.join(staging, `${id}.tar`);
  mkdirSync(tree, {recursive: true});

  const explicit = process.env[environmentName];
  const explicitRepository = explicit === undefined ? undefined : path.resolve(explicit);
  assert(explicitRepository === undefined || commitExists(explicitRepository, pin.revision),
    `${environmentName} does not contain reviewed ${id} revision ${pin.revision}`);
  const local = explicitRepository
    ?? nearbyRepositories.find((candidate) => commitExists(candidate, pin.revision));
  if (local !== undefined) {
    run("git", ["-C", local, "archive", "--format=tar", "-o", archive, pin.revision], repoRoot);
  } else {
    const clone = path.join(staging, "repository");
    run("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", pin.repository, clone], repoRoot);
    run("git", ["-C", clone, "fetch", "--quiet", "--depth=1", "origin", pin.revision], repoRoot);
    run("git", ["-C", clone, "archive", "--format=tar", "-o", archive, "FETCH_HEAD"], repoRoot);
  }
  run("tar", ["-xf", archive, "-C", tree], repoRoot);
  writeFileSync(markerPath(tree), JSON.stringify({
    repository: pin.repository,
    revision: pin.revision
  }, null, 2) + "\n");
  renameSync(tree, destination);
  rmSync(staging, {recursive: true, force: true});
  return {root: destination, cacheHit: false};
}

function markerPath(root: string): string {
  return path.join(root, ".genes-source.json");
}

function listRelativeFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, {withFileTypes: true})) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...listRelativeFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
  return files.sort(compareStrings);
}

function validateManifest(
  haxeRoot: string,
  utestRoot: string,
  hxnodejsRoot: string
): void {
  assert(manifest.schemaVersion === 1,
    "official Haxe inventory manifest schema must be 1");
  assert(manifest.contract === "genes-official-haxe-active-inventory",
    "official Haxe inventory contract changed unexpectedly");
  assert(manifest.disposition === "inventory-only",
    "inventory manifest must retain its no-runtime-claim boundary");
  assert(manifest.haxe.version === run("haxe", ["--version"], repoRoot, {quiet: true}),
    `inventory requires Haxe ${manifest.haxe.version}`);
  assert(manifest.profiles.map((profile) => profile.id).join(",")
    === "classic-esm,typescript",
  "inventory must keep classic and TypeScript profiles separate");
  assert(manifest.profileComparison === "identical-active-tests",
    "inventory must fail when the active profiles drift apart");
  assert(manifest.compilerRequest.target === "js"
    && manifest.compilerRequest.main === "unit.TestMain"
    && manifest.compilerRequest.dce === "full"
    && manifest.compilerRequest.debug === true
    && manifest.compilerRequest.noOutput === true,
  "inventory compiler request changed without review");
  assert(manifest.inventoryDependencies.length === 1
    && manifest.inventoryDependencies[0].id === "hxnodejs",
  "inventory must retain its explicit hxnodejs typing dependency");

  const roots: Array<[SourcePin, string, string]> = [
    [manifest.haxe, haxeRoot, "Haxe"],
    [manifest.utest, utestRoot, "utest"],
    [manifest.inventoryDependencies[0], hxnodejsRoot, "hxnodejs"]
  ];
  for (const [pin, root, label] of roots) {
    assert(existsSync(path.join(root, pin.licensePath)),
      `${label} source is missing its reviewed license file`);
  }

  const [single, disabled] = manifest.excludedRegistrations;
  assert(single.id === "commented-test-case" && disabled.id === "disabled-source-files",
    "excluded registrations must retain their reviewed categories");
  for (const source of [single.source, ...disabled.sources]) {
    assert(existsSync(path.join(haxeRoot, "tests", "unit", source)),
      `reviewed excluded source is missing: ${source}`);
  }
  const sourceRoot = path.join(haxeRoot, "tests", "unit");
  const disabledSources = listRelativeFiles(path.join(sourceRoot, "src"))
    .map((source) => `src/${source}`)
    .filter((source) => [".disabled", ".wtf", ".no"].some((suffix) =>
      source.endsWith(suffix)));
  assert(JSON.stringify(disabledSources) === JSON.stringify(disabled.sources),
    `disabled upstream source inventory drifted: ${JSON.stringify(disabledSources)}`);
}

function compileInventory(
  profile: Profile,
  haxeRoot: string,
  utestRoot: string,
  hxnodejsRoot: string
): ReviewedInventory {
  const profileRoot = path.join(evidenceRoot, profile.id);
  mkdirSync(profileRoot, {recursive: true});
  const rawPath = path.join(profileRoot, "raw.json");
  const outputPath = path.join(profileRoot, "unused.js");
  const args = [
    "-cp", "src",
    "-cp", path.join(utestRoot, "src"),
    "-cp", path.join(hxnodejsRoot, "src"),
    "-cp", path.join(fixtureRoot, "src"),
    "--main", manifest.compilerRequest.main,
    "-js", outputPath,
    ...(manifest.compilerRequest.debug ? ["--debug"] : []),
    ...(manifest.compilerRequest.noOutput ? ["--no-output"] : []),
    "--resource", "res1.txt@re/s?!%[]))(\"'1.txt",
    "--resource", "res2.bin@re/s?!%[]))(\"'1.bin",
    "--resource", "serializedValues.txt",
    "--macro", "Macro.init()",
    "--macro", "genesinventory.InventoryMacro.capture()",
    "--dce", manifest.compilerRequest.dce,
    "-D", "message.reporting=pretty",
    ...profile.defines.flatMap((define) => ["-D", define]),
    "-D", `genes.official_inventory_profile=${profile.id}`,
    "-D", `genes.official_inventory_output=${rawPath}`
  ];
  run("haxe", args, path.join(haxeRoot, "tests", "unit"));
  assert(existsSync(rawPath), `${profile.id} did not publish an inventory`);
  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawInventory;
  assert(raw.schemaVersion === 1 && raw.profile === profile.id,
    `${profile.id} raw inventory identity is invalid`);

  const activeTests = raw.tests.map((test): ActiveTest => ({
    id: test.id,
    caseId: test.caseId,
    family: test.family,
    method: test.method,
    source: test.source.file
  })).sort((left, right) => compareStrings(left.id, right.id));
  if (injection === "profile-drift" && profile.id === "typescript") {
    const replaced = activeTests[activeTests.length - 1];
    assert(replaced !== undefined, "profile-drift injection requires one active test");
    activeTests[activeTests.length - 1] = {
      id: `${replaced.caseId}.${replaced.method}InjectedInventoryDrift`,
      caseId: replaced.caseId,
      family: replaced.family,
      method: `${replaced.method}InjectedInventoryDrift`,
      source: replaced.source
    };
    activeTests.sort((left, right) => compareStrings(left.id, right.id));
  }
  assert(new Set(activeTests.map((test) => test.id)).size === activeTests.length,
    `${profile.id} active inventory contains duplicate IDs`);
  for (const test of activeTests) {
    assert(test.id === `${test.caseId}.${test.method}`,
      `${profile.id} test identity is not canonical: ${test.id}`);
    assert(existsSync(path.join(haxeRoot, "tests", "unit", test.source)),
      `${profile.id} test source is missing: ${test.source}`);
  }
  return {
    schemaVersion: 1,
    contract: "genes-official-haxe-profile-inventory",
    profile: profile.id,
    defines: profile.defines,
    haxeRevision: manifest.haxe.revision,
    utestRevision: manifest.utest.revision,
    activeTests
  };
}

function selected(selector: CapabilitySelector, test: ActiveTest): boolean {
  switch (selector.kind) {
    case "all": return true;
    case "case": return test.caseId === selector.value;
    case "case-prefix": return test.caseId.startsWith(selector.value);
  }
}

function validatePolicy(inventory: ReviewedInventory): void {
  assert(inventory.activeTests.length === manifest.expected.testsPerProfile,
    `${inventory.profile} has ${inventory.activeTests.length} tests; expected ${manifest.expected.testsPerProfile}`);
  const familyCounts: Record<TestFamily, number> = {unit: 0, unitstd: 0, issue: 0};
  for (const test of inventory.activeTests) familyCounts[test.family]++;
  assert(JSON.stringify(familyCounts) === JSON.stringify(manifest.expected.familiesPerProfile),
    `${inventory.profile} family counts drifted: ${JSON.stringify(familyCounts)}`);

  for (const rule of manifest.capabilityRules) {
    assert(rule.id.trim().length > 0 && rule.reason.trim().length > 0,
      "capability rules require stable IDs and reasons");
    for (const selector of rule.selectors) {
      assert(inventory.activeTests.some((test) => selected(selector, test)),
        `${inventory.profile} capability ${rule.id} selector matched no tests`);
    }
  }
  const [single, disabled] = manifest.excludedRegistrations;
  assert(!inventory.activeTests.some((test) => test.caseId === single.caseId),
    `${inventory.profile} unexpectedly activated excluded ${single.caseId}`);
  for (const source of disabled.sources) {
    assert(!inventory.activeTests.some((test) => test.source === source),
      `${inventory.profile} unexpectedly activated disabled source ${source}`);
  }
}

function stableJson(value: ReviewedInventory): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function compareOrWrite(inventory: ReviewedInventory): void {
  const reviewedPath = path.join(fixtureRoot, "inventories", `${inventory.profile}.json`);
  const generated = stableJson(inventory);
  if (writeReviewed) {
    mkdirSync(path.dirname(reviewedPath), {recursive: true});
    writeFileSync(reviewedPath, generated);
    return;
  }
  assert(existsSync(reviewedPath),
    `reviewed ${inventory.profile} inventory is missing; run yarn inventory:official-haxe`);
  assert(readFileSync(reviewedPath, "utf8") === generated,
    `${inventory.profile} active inventory differs from the reviewed file`);
}

assert(process.argv.slice(2).every((argument) => argument === "--write"),
  "usage: test-official-haxe-inventory.js [--write]");
assert(injection === undefined || injection === "profile-drift",
  `unknown GENES_OFFICIAL_INVENTORY_INJECT value: ${String(injection)}`);
const haxe = materialize(
  "haxe",
  manifest.haxe,
  "GENES_HAXE_SOURCE_REPOSITORY",
  [path.resolve(repoRoot, "../haxe")]
);
const utest = materialize(
  "utest",
  manifest.utest,
  "GENES_UTEST_SOURCE_REPOSITORY",
  [path.resolve(repoRoot, "../haxe.compilerdev.reference/utest")]
);
const hxnodejsPin = manifest.inventoryDependencies[0];
const hxnodejs = materialize(
  "hxnodejs",
  hxnodejsPin,
  "GENES_HXNODEJS_SOURCE_REPOSITORY",
  []
);
validateManifest(haxe.root, utest.root, hxnodejs.root);
const inventories = manifest.profiles.map((profile) => {
  const inventory = compileInventory(profile, haxe.root, utest.root, hxnodejs.root);
  validatePolicy(inventory);
  compareOrWrite(inventory);
  return inventory;
});
const [classic, typescript] = inventories;
assert(classic !== undefined && typescript !== undefined,
  "both official Haxe profile inventories are required");
assert(JSON.stringify(classic.activeTests) === JSON.stringify(typescript.activeTests),
  "classic and TypeScript active official Haxe inventories differ");
process.stdout.write(
  `official-haxe-inventory:ok (${classic.activeTests.length} tests/profile; `
  + `haxe cache ${haxe.cacheHit ? "hit" : "miss"}; `
  + `utest cache ${utest.cacheHit ? "hit" : "miss"}; `
  + `hxnodejs cache ${hxnodejs.cacheHit ? "hit" : "miss"})\n`
);
