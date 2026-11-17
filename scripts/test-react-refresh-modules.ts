import { deepStrictEqual, equal, match, ok } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Focused owner of `-D genes.react_refresh_modules`.
 *
 * It builds one fixture twice (with and without the define) and proves:
 * - the split file set and the exact generated source (snapshots);
 * - strict TypeScript accepts both builds (TS 5, 6 and 7 lanes);
 * - both builds load modules in the same order and render the same HTML;
 * - the React Fast Refresh rule accepts a hot update of each component
 *   module with the define, and rejects the split candidates without it;
 * - classic JavaScript output rejects the define.
 *
 * The Vite dev-server proof (a real hot update that keeps React state) needs
 * Vite in the test dependencies; it is recorded in tests/react-refresh-modules/README.md.
 */

type HotUpdates = Record<string, string>;
type Transcript = { loadOrder: string[]; html: string; hotUpdates: HotUpdates };

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const fixture = "tests/react-refresh-modules";
const fixtureRoot = path.join(repoRoot, fixture);

function run(command: string, args: ReadonlyArray<string>, options: ExecFileSyncOptions = {}): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit", ...options });
}

function probe(build: string): Transcript {
  const output = execFileSync("node", [`${fixture}/probe.mjs`, `${fixture}/out/${build}/dist`], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const line = output.trim().split(/\r?\n/).at(-1);
  if (line === undefined) throw new Error(`probe of ${build} printed nothing`);
  return JSON.parse(line) as Transcript;
}

function generatedFiles(build: string): string[] {
  return readdirSync(path.join(fixtureRoot, "out", build, "src-gen", "refresh")).sort();
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

// The define is TypeScript-only: a classic build must stop before output.
const classic = spawnSync("haxe", [`${fixture}/build-classic-negative.hxml`], {
  cwd: repoRoot,
  encoding: "utf8"
});
ok(classic.status !== 0, "classic build with genes.react_refresh_modules must fail");
match(`${classic.stdout}${classic.stderr}`, /GENES-REACT-REFRESH-001/);
ok(!existsSync(path.join(fixtureRoot, "out", "classic", "index.js")), "classic build published output");

run("haxe", [`${fixture}/build-tsx.hxml`]);
run("haxe", [`${fixture}/build-tsx-off.hxml`]);

// Split: modules with a component and another runtime declaration.
// Not split (ReactRefreshModulePlan.componentNames):
// - Greeting: only components and types;
// - Main: the entry module; LoadLog, CycleDep: no component;
// - Unsplit: a static initializer reads a component;
// - Transitive: a static initializer reaches a component through a helper;
// - Omitted: the owner class is omitted, so the sibling has no slot;
// - Cycle: a hoisted direct function reads a component, and CycleDep calls
//   it from `__init__` inside an import cycle.
const singleFiles = [
  "App.tsx",
  "Cycle.tsx",
  "CycleDep.tsx",
  "Greeting.tsx",
  "LoadLog.tsx",
  "Main.tsx",
  "Omitted.tsx",
  "Panel.tsx",
  "Transitive.tsx",
  "Unsplit.tsx"
];
deepStrictEqual(generatedFiles("tsx"), [...singleFiles, "App.fields.tsx", "Panel.fields.tsx"].sort());
deepStrictEqual(generatedFiles("tsx-off"), singleFiles);

// The sibling must not import its component file. With that import cycle,
// Vite loads the sibling again on each component update, and the re-exported
// values are then new objects, which Fast Refresh rejects.
for (const name of ["Panel", "App"]) {
  const sibling = readFileSync(path.join(fixtureRoot, `out/tsx/src-gen/refresh/${name}.fields.tsx`), "utf8");
  ok(!sibling.includes(`from "./${name}.js"`), `${name}.fields.tsx imports its component file`);
}

assertDirSnapshots({
  repoRoot,
  generatedDir: `${fixture}/out/tsx/src-gen/refresh`,
  snapshotsDir: `${fixture}/intended/refresh`,
  fileExts: [".tsx"],
  updateHint: "UPDATE_SNAPSHOTS=1 yarn test:react-refresh-modules"
});

runGeneratedTypeScriptMatrix(`${fixture}/tsconfig.tsx.json`);
runGeneratedTypeScriptMatrix(`${fixture}/tsconfig.tsx-off.json`);

const split = probe("tsx");
const single = probe("tsx-off");

// Cold-build semantics: the split changes neither load order nor output.
deepStrictEqual(split.loadOrder, single.loadOrder);
equal(split.html, single.html);
deepStrictEqual(split.loadOrder, [
  "Panel.Counter",
  "Main:fixture",
  "Transitive:true",
  "Omitted:true",
  "Cycle:true:2"
]);

// Red without the define, green with it.
deepStrictEqual(single.hotUpdates, {
  Panel: "incompatible:Counter",
  App: "incompatible:App_Fields_",
  Greeting: "accepted"
});
deepStrictEqual(split.hotUpdates, { Panel: "accepted", App: "accepted", Greeting: "accepted" });

console.log("react-refresh-modules:ok (split file set, snapshots, TS lanes, same runtime, Fast Refresh rule)");
