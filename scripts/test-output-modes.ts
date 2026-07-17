import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions
} from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

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

/**
 * Stages the same JSON module beside one generated profile.
 *
 * Why: the compiler owns import spelling, while the application build owns
 * resource placement. Keeping that split explicit lets this corpus execute the
 * exact same Haxe import through TypeScript and classic ESM without teaching
 * either emitter about fixture paths.
 *
 * What/How: copy the checked-in JSON module to the profile root before its
 * type-check/runtime stage. The Haxe module imports it from `../resources`, so
 * both generated directory layouts resolve the identical specifier.
 */
function stageProfileResource(relativeRoot: string): void {
  const targetDirectory = path.join(repoRoot, relativeRoot, "resources");
  mkdirSync(targetDirectory, { recursive: true });
  copyFileSync(
    path.join(fixtureRoot, "resources/profile.json"),
    path.join(targetDirectory, "profile.json")
  );
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

function generatedFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...generatedFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

const invalidImportAttributeCases = [
  ["import_attribute_arity", "GENES-IMPORT-ATTRIBUTE-ARITY-001"],
  ["import_attribute_nonliteral", "GENES-IMPORT-ATTRIBUTE-LITERAL-001"],
  ["import_attribute_empty", "GENES-IMPORT-ATTRIBUTE-EMPTY-001"]
] as const;

/**
 * Proves that a malformed loader contract cannot publish partial output.
 *
 * Why: treating invalid `@:genes.importAttributeType` metadata as if it were
 * absent produces valid-looking source that can fail only when the host tries
 * to load the resource. Both output profiles must reject that typo before they
 * replace an application's last known-good files.
 *
 * What/How: seed the public entrypoint with sentinel bytes, compile one invalid
 * metadata shape, and require a stable source diagnostic. A planning failure
 * must leave only the sentinel behind: no manifest, map, declaration, support
 * module, or partially generated implementation may escape.
 */
function assertImportAttributeFailure(
  profile: "classic" | "ts",
  define: string,
  diagnostic: string
): void {
  const extension = profile === "ts" ? "ts" : "js";
  const output = path.join(
    fixtureRoot,
    "out/invalid-import-attribute",
    `${profile}-${define}`,
    `index.${extension}`
  );
  const sentinel = `preserved:${profile}:${define}\n`;
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, sentinel, "utf8");

  const args = [
    "-lib", "genes-ts",
    "-cp", "tests/output-modes/src",
    "--main", "importattributeinvalid.Main",
    "-js", path.relative(repoRoot, output),
    "-D", define,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    ...(profile === "ts" ? ["-D", "genes.ts"] : ["-D", "dts"])
  ];
  const result = spawnSync("haxe", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  ok(
    result.status !== null && result.status !== 0,
    `${profile}/${define} must fail compilation`
  );
  const diagnostics = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  ok(
    diagnostics.includes(diagnostic),
    `${profile}/${define} reports ${diagnostic}\n${diagnostics}`
  );
  ok(
    /importattributeinvalid\/Main\.hx:\d+:/.test(diagnostics),
    `${profile}/${define} reports a source position\n${diagnostics}`
  );
  strictEqual(
    readFileSync(output, "utf8"),
    sentinel,
    `${profile}/${define} preserves prior public output`
  );
  deepStrictEqual(
    generatedFiles(path.dirname(output)),
    [output],
    `${profile}/${define} publishes no partial artifacts`
  );
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
  strictEqual(jsx.status, "supported-react-compatible-runtime");
  strictEqual(
    jsx.source,
    "tests/genes-ts/snapshot/react/src/DualJsxMain.hx"
  );
  strictEqual(jsx.gate, "yarn test:genes-ts:tsx");

  const outputQuality = requiredRecord(capabilities, "exactSourceMapsAndBudgets");
  strictEqual(outputQuality.owner, "genes-09r.6");
  strictEqual(
    outputQuality.status,
    "exact-token-stack-determinism-and-budget-gated"
  );
  strictEqual(
    outputQuality.manifest,
    "tests/output-modes/output-quality.json"
  );
  strictEqual(outputQuality.gate, "yarn test:output-quality");

  const loweringPlans = requiredRecord(capabilities, "loweringPlans");
  strictEqual(loweringPlans.owner, "genes-09r.11");
  strictEqual(loweringPlans.status, "shared-precomputed-and-budget-gated");
  strictEqual(loweringPlans.tempPlan, "src/genes/TempPlan.hx");
  strictEqual(loweringPlans.namePlan, "src/genes/NamePlan.hx");
  strictEqual(loweringPlans.gate, "yarn test:dual-output");

  const importAttributes = requiredRecord(capabilities, "importAttributes");
  strictEqual(importAttributes.owner, "genes-6cb");
  strictEqual(importAttributes.status, "paired-static-json-runtime");
  strictEqual(
    importAttributes.source,
    "tests/output-modes/src/dual/DualProfileResource.hx"
  );
  strictEqual(
    importAttributes.resource,
    "tests/output-modes/resources/profile.json"
  );
  strictEqual(importAttributes.gate, "yarn test:dual-output");

  const importAttributeValidation = requiredRecord(
    capabilities,
    "importAttributeValidation"
  );
  strictEqual(importAttributeValidation.owner, "genes-3vd");
  strictEqual(
    importAttributeValidation.status,
    "fail-closed-arity-literal-empty-transactional"
  );
  strictEqual(
    importAttributeValidation.source,
    "tests/output-modes/src/importattributeinvalid/Main.hx"
  );
  deepStrictEqual(
    requiredStringArray(importAttributeValidation, "diagnostics"),
    [
      "GENES-IMPORT-ATTRIBUTE-ARITY-001",
      "GENES-IMPORT-ATTRIBUTE-LITERAL-001",
      "GENES-IMPORT-ATTRIBUTE-EMPTY-001"
    ]
  );
  strictEqual(importAttributeValidation.gate, "yarn test:dual-output");

  const stringLiterals = requiredRecord(capabilities, "stringLiterals");
  strictEqual(stringLiterals.owner, "genes-7be.2");
  strictEqual(
    stringLiterals.status,
    "exact-code-unit-cross-profile-differential"
  );
  strictEqual(
    stringLiterals.source,
    "tests/string-literals/src/literalevidence/Main.hx"
  );
  strictEqual(stringLiterals.gate, "yarn test:string-literals");

  const asyncAwait = requiredRecord(capabilities, "asyncAwait");
  strictEqual(asyncAwait.owner, "genes-7be.4");
  strictEqual(
    asyncAwait.status,
    "typed-native-dual-profile-with-exact-standard-boundary"
  );
  strictEqual(
    asyncAwait.source,
    "tests/async-await-evidence/src/asyncawaitevidence/Main.hx"
  );
  strictEqual(
    asyncAwait.standardSource,
    "tests/async-await-evidence/src/asyncawaitevidence/AnonymousStandard.hx"
  );
  deepStrictEqual(requiredStringArray(asyncAwait, "diagnostics"), [
    "GENES-ASYNC-TARGET-001",
    "GENES-ASYNC-CONTEXT-001",
    "GENES-ASYNC-CONSTRUCTOR-001",
    "GENES-ASYNC-RETURN-001",
    "GENES-ASYNC-AUTHORING-001"
  ]);
  strictEqual(asyncAwait.gate, "yarn test:async-await:evidence");
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
stageProfileResource("tests/output-modes/out/ts/src-gen");
runGeneratedTypeScriptMatrix("tests/output-modes/tsconfig.generated.json");
run("haxe", ["tests/output-modes/build-classic.hxml"]);
stageProfileResource("tests/output-modes/out/classic");
runGeneratedTypeScriptMatrix("tests/output-modes/tsconfig.consumer.json", {
  emit: false
});
run("haxe", ["tests/output-modes/build-standard.hxml"]);

// A secondary `@:native` host global and its Haxe module's primary
// `@:jsRequire` value have independent dependency identities. One accidental
// package alias used to shadow `RegExp` and then redirect the legitimate path
// call through that alias as well. Both printers consume the same dependency
// plan, so assert the complete import/use shape in both generated profiles.
for (const [profile, relativePath] of [
  ["ts-strict", "tests/output-modes/out/ts/src-gen/dual/HelperScenario.ts"],
  ["classic-esm", "tests/output-modes/out/classic/dual/HelperScenario.js"]
] as const) {
  const generated = readFileSync(path.join(repoRoot, relativePath), "utf8");
  strictEqual(
    generated.match(/from "node:path"/g)?.length ?? 0,
    1,
    `${profile} must emit exactly the real package import`
  );
  ok(
    generated.includes('import * as MixedNativeImportOwner from "node:path"'),
    `${profile} lost the primary extern package binding`
  );
  ok(
    generated.includes('new RegExp("^portable$")'),
    `${profile} did not retain the explicit host-global constructor`
  );
  ok(
    generated.includes('MixedNativeImportOwner.basename("/dual/portable.txt")'),
    `${profile} redirected the package owner through a secondary alias`
  );
  ok(
    generated.includes(
      'from "../resources/profile.json" with { type: "json" }'
    ),
    `${profile} dropped the JSON import attribute`
  );
}

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
const classicApiDeclaration = readFileSync(
  path.join(fixtureRoot, "out/classic/dual/DualApi.d.ts"),
  "utf8"
);
const classicMapDeclaration = readFileSync(
  path.join(fixtureRoot, "out/classic/haxe/ds/StringMap.d.ts"),
  "utf8"
);
const classicMapRuntime = readFileSync(
  path.join(fixtureRoot, "out/classic/haxe/ds/StringMap.js"),
  "utf8"
);
const resourceTs = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/haxe/Resource.ts"),
  "utf8"
);
const bytesTs = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/haxe/io/Bytes.ts"),
  "utf8"
);
const stdTypesTs = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/StdTypes.ts"),
  "utf8"
);
ok(tsCore.includes('from "node:path"'));
ok(classicCore.includes('from "node:path"'));
ok(tsApi.includes('import type {DualTypeOnly}'));
for (const generated of [tsApi, classicApiDeclaration]) {
  ok(generated.includes("type JsonPrimitive = null | boolean | number | string"));
  ok(generated.includes("type JsonValue = JsonPrimitive | JsonObject | JsonArray"));
  ok(generated.includes("jsonIdentity(value: JsonPrimitive | JsonObject | JsonArray)"));
}
ok(
  !classicMapDeclaration.includes("implements IMap"),
  "classic application declarations must not promise a DCE-stripped interface"
);
ok(
  !classicMapRuntime.includes("copy("),
  "declaration coherence must not broaden compact classic application JS"
);
ok(resourceTs.includes("str?: string"));
ok(bytesTs.includes("(buf.buffer as ArrayBuffer)"));
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

for (const profile of ["classic", "ts"] as const) {
  for (const [define, diagnostic] of invalidImportAttributeCases) {
    assertImportAttributeFailure(profile, define, diagnostic);
  }
}

console.log(
  `dual-output:ok (TS + classic + standard Haxe${hasLiveVanilla ? " + live vanilla" : " + pinned vanilla baseline"})`
);
