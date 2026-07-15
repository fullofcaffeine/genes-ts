import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/output-modes");

type JsonRecord = Record<string, unknown>;

function run(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: ExecFileSyncOptions = {}
): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function capture(cmd: string, args: ReadonlyArray<string>): string {
  return execFileSync(cmd, [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function requiredRecord(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`Expected ${key} to be an object`);
  }
  return value;
}

function requiredString(parent: JsonRecord, key: string): string {
  const value = parent[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }
  return value;
}

function requiredStringArray(parent: JsonRecord, key: string): string[] {
  const value = parent[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${key} to be an array of strings`);
  }
  return value;
}

function parseJsonLine(output: string, profile: string): unknown {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`${profile} produced no runtime transcript`);
  }
  try {
    return JSON.parse(last);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${profile} produced invalid JSON: ${message}\n${output}`);
  }
}

function directFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) {
    return [];
  }
  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join("dual", entry.name))
    .sort();
}

function assertProfileOwnership(manifestUnknown: unknown): void {
  if (!isRecord(manifestUnknown)) {
    throw new Error("profile-ownership.json must contain an object");
  }
  strictEqual(manifestUnknown.schemaVersion, 1);
  strictEqual(manifestUnknown.sourceRoot, "tests/output-modes/src");
  const profiles = manifestUnknown.profiles;
  if (!Array.isArray(profiles)) {
    throw new Error("profile ownership must list profiles");
  }
  const expectedIds = [
    "classic-dts",
    "classic-esm",
    "standard-haxe-js-oracle",
    "ts-strict",
    "vanilla-genes-core-oracle"
  ];
  const actualIds: string[] = [];
  for (const profile of profiles) {
    if (!isRecord(profile)) {
      throw new Error("Every profile entry must be an object");
    }
    const id = requiredString(profile, "id");
    actualIds.push(id);
    for (const owner of ["build", "typecheck", "runtime", "snapshot", "sourceMaps"]) {
      const value = requiredString(profile, owner);
      if (value.length === 0) {
        throw new Error(`${id} has an empty ${owner} owner`);
      }
    }
  }
  actualIds.sort();
  deepStrictEqual(actualIds, expectedIds);

  const capabilities = requiredRecord(manifestUnknown, "capabilities");
  const jsx = requiredRecord(capabilities, "jsx");
  strictEqual(jsx.owner, "genes-09r.5");
  strictEqual(jsx.status, "excluded-until-capability-policy");
}

function assertSourceMap(
  mapRelativePath: string,
  generatedRelativePath: string
): void {
  const mapPath = path.join(repoRoot, mapRelativePath);
  const generatedPath = path.join(repoRoot, generatedRelativePath);
  ok(existsSync(mapPath), `Missing source map ${mapRelativePath}`);
  ok(existsSync(generatedPath), `Missing generated file ${generatedRelativePath}`);

  const parsed: unknown = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${mapRelativePath} must contain a source-map object`);
  }
  const sources = requiredStringArray(parsed, "sources");
  ok(
    sources.some((source) => source.replaceAll("\\", "/").endsWith("/src/dual/CoreScenario.hx")),
    `${mapRelativePath} does not reference CoreScenario.hx`
  );

  const generated = readFileSync(generatedPath, "utf8");
  ok(
    generated.includes(`//# sourceMappingURL=${path.basename(mapRelativePath)}`),
    `${generatedRelativePath} does not link its source map`
  );
}

const manifestUnknown = readJson("tests/output-modes/profile-ownership.json");
assertProfileOwnership(manifestUnknown);

const expectedUnknown = readJson("tests/output-modes/expected-trace.json");
if (!isRecord(expectedUnknown)) {
  throw new Error("expected-trace.json must contain an object");
}
const expectedCore = requiredStringArray(expectedUnknown, "core");
requiredStringArray(expectedUnknown, "helpers");

const shapeUnknown = readJson("tests/output-modes/expected-shape.json");
if (!isRecord(shapeUnknown)) {
  throw new Error("expected-shape.json must contain an object");
}

const vanillaUnknown = readJson("tests/output-modes/vanilla-baseline.json");
if (!isRecord(vanillaUnknown)) {
  throw new Error("vanilla-baseline.json must contain an object");
}
deepStrictEqual(requiredStringArray(vanillaUnknown, "core"), expectedCore);
ok(requiredStringArray(vanillaUnknown, "acceptedDivergences").length >= 3);

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

run("haxe", ["tests/output-modes/build-ts.hxml"]);
run("node", [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tests/output-modes/tsconfig.generated.json"
]);
run("haxe", ["tests/output-modes/build-classic.hxml"]);
run("node", [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tests/output-modes/tsconfig.consumer.json"
]);
run("haxe", ["tests/output-modes/build-standard.hxml"]);

const tsTrace = parseJsonLine(
  capture("node", ["tests/output-modes/out/ts/dist/index.js"]),
  "ts-strict"
);
const classicTrace = parseJsonLine(
  capture("node", ["tests/output-modes/out/classic/index.js"]),
  "classic-esm"
);
const standardTrace = parseJsonLine(
  capture("node", ["tests/output-modes/out/standard/index.cjs"]),
  "standard-haxe-js-oracle"
);
deepStrictEqual(tsTrace, expectedUnknown);
deepStrictEqual(classicTrace, expectedUnknown);
deepStrictEqual(standardTrace, expectedUnknown);

const tsFiles = directFiles("tests/output-modes/out/ts/src-gen/dual")
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
const classicFiles = directFiles("tests/output-modes/out/classic/dual");
const classicModules = classicFiles.filter((file) => file.endsWith(".js"));
const classicDeclarations = classicFiles.filter((file) => file.endsWith(".d.ts"));
deepStrictEqual(tsFiles, requiredStringArray(shapeUnknown, "tsModules"));
deepStrictEqual(classicModules, requiredStringArray(shapeUnknown, "classicModules"));
deepStrictEqual(
  classicDeclarations,
  requiredStringArray(shapeUnknown, "classicDeclarations")
);

const standardArtifacts = readdirSync(
  path.join(repoRoot, "tests/output-modes/out/standard"),
  { withFileTypes: true }
)
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
deepStrictEqual(
  standardArtifacts,
  requiredStringArray(shapeUnknown, "standardArtifacts")
);

ok(existsSync(path.join(fixtureRoot, "out/ts/src-gen/dual/DualTypeOnly.ts")));
ok(existsSync(path.join(fixtureRoot, "out/classic/dual/DualTypeOnly.d.ts")));
ok(!existsSync(path.join(fixtureRoot, "out/classic/dual/DualTypeOnly.js")));
for (const forbidden of [
  "out/ts/src-gen/dual/DeadCode.ts",
  "out/classic/dual/DeadCode.js",
  "out/classic/dual/DeadCode.d.ts"
]) {
  ok(!existsSync(path.join(fixtureRoot, forbidden)), `DCE emitted ${forbidden}`);
}

const tsCore = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/dual/CoreScenario.ts"),
  "utf8"
);
const classicCore = readFileSync(
  path.join(fixtureRoot, "out/classic/dual/CoreScenario.js"),
  "utf8"
);
const tsApi = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/dual/DualApi.ts"),
  "utf8"
);
const resourceTs = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/haxe/Resource.ts"),
  "utf8"
);
const stdTypesTs = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/StdTypes.ts"),
  "utf8"
);
ok(tsCore.includes('from "node:path"'));
ok(classicCore.includes('from "node:path"'));
ok(tsApi.includes('import type {DualTypeOnly}'));
ok(resourceTs.includes("str?: string"));
ok(stdTypesTs.includes("interface Uint8Array { bufferValue?: ArrayBuffer }"));
ok(stdTypesTs.includes("interface ArrayBuffer { hxBytes?: object; bytes?: Uint8Array }"));

assertSourceMap(
  "tests/output-modes/out/ts/src-gen/dual/CoreScenario.ts.map",
  "tests/output-modes/out/ts/src-gen/dual/CoreScenario.ts"
);
assertSourceMap(
  "tests/output-modes/out/classic/dual/CoreScenario.js.map",
  "tests/output-modes/out/classic/dual/CoreScenario.js"
);
assertSourceMap(
  "tests/output-modes/out/standard/index.cjs.map",
  "tests/output-modes/out/standard/index.cjs"
);

const vanillaRoot = path.resolve(repoRoot, "../genes-vanilla");
const hasLiveVanilla = existsSync(path.join(vanillaRoot, ".git"));
if (hasLiveVanilla) {
  const expectedCommit = requiredString(vanillaUnknown, "commit");
  const actualCommit = capture("git", [
    "-C",
    vanillaRoot,
    "rev-parse",
    "HEAD"
  ]).trim();
  strictEqual(actualCommit, expectedCommit);
  run("haxe", ["tests/output-modes/build-vanilla.hxml"]);
  const vanillaTrace = parseJsonLine(
    capture("node", ["tests/output-modes/out/vanilla/index.js"]),
    "vanilla-genes-core-oracle"
  );
  deepStrictEqual(vanillaTrace, expectedCore);

  const vanillaModules = directFiles("tests/output-modes/out/vanilla/dual")
    .filter((file) => file.endsWith(".js"));
  deepStrictEqual(vanillaModules, requiredStringArray(vanillaUnknown, "modules"));
  deepStrictEqual(vanillaModules, requiredStringArray(shapeUnknown, "vanillaModules"));

  const vanillaCore = readFileSync(
    path.join(fixtureRoot, "out/vanilla/dual/CoreScenario.js"),
    "utf8"
  );
  const shapeFacts = requiredRecord(vanillaUnknown, "shapeFacts");
  ok(classicCore.includes(requiredString(shapeFacts, "currentRegistry")));
  ok(vanillaCore.includes(requiredString(shapeFacts, "vanillaRegistry")));
  ok(classicCore.includes(requiredString(shapeFacts, "currentMapImport")));
  ok(vanillaCore.includes(requiredString(shapeFacts, "vanillaMapImport")));
  assertSourceMap(
    "tests/output-modes/out/vanilla/dual/CoreScenario.js.map",
    "tests/output-modes/out/vanilla/dual/CoreScenario.js"
  );
} else {
  deepStrictEqual(
    requiredStringArray(vanillaUnknown, "modules"),
    requiredStringArray(shapeUnknown, "vanillaModules")
  );
}

console.log(
  `dual-output:ok (TS + classic + standard Haxe${hasLiveVanilla ? " + live vanilla" : " + pinned vanilla baseline"})`
);
