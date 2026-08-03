import { deepStrictEqual, match, ok } from "node:assert";
import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions
} from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDts2hxBridge } from "./dts2hx-bridge.js";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/genes-ts/package-shapes");
const packageNames = [
  "genes-export-equals-fixture",
  "genes-namespace-secondary-fixture",
];
const expectedTranscript = {
  version: "fixture-1",
  label: "genes",
  closed: "closed:genes",
  secondaryLabel: "genes",
  secondaryClosed: "secondary:genes",
};

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

function capture(command: string, args: ReadonlyArray<string>): string {
  return execFileSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

/**
 * Installs the checked-in package declaration beside one generated profile.
 *
 * Why: the fixture must exercise real NodeNext package resolution and runtime
 * loading without downloading or depending on a mutable npm package.
 * What/How: copy the tiny `export =` package into the profile's isolated
 * `node_modules`; both TypeScript and Node then resolve the same package.json,
 * declarations, conditional exports, and runtime implementations.
 */
function installFixturePackage(profileRoot: string): void {
  for (const packageName of packageNames) {
    const destination = path.join(profileRoot, "node_modules", packageName);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(fixtureRoot, "packages", packageName), destination, {
      recursive: true
    });
  }
}

function parseTranscript(output: string, profile: string): unknown {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`${profile} produced no package-shape transcript`);
  }
  try {
    return JSON.parse(last);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${profile} emitted invalid JSON: ${message}\n${output}`);
  }
}

function typeConsumer(importPath: string): string {
  return [
    `import {Main} from ${JSON.stringify(importPath)};`,
    'const host = new Main("genes");',
    "const label: string = host.driver.label;",
    "const closed: string = host.driver.close();",
    "const currentLabel: string = host.current().label;",
    "const processLabel: string = host.process.label;",
    "const processClosed: string = host.process.close();",
    "// @ts-expect-error the export-equals instance surface is closed and typed",
    "host.driver.nonexistentMember();",
    "// @ts-expect-error label is a string, not an unsafe or namespace-shaped value",
    "const invalid: number = host.driver.label;",
    "void label; void closed; void currentLabel; void processLabel; void processClosed; void invalid;",
    ""
  ].join("\n");
}

/** Proves invalid projection metadata stops compilation with a stable reason. */
function assertInvalidMetadataFailsClosed(): void {
  const outputPath = path.join(fixtureRoot, "out/invalid/index.ts");
  const result = spawnSync(
    "haxe",
    [
      "-lib", "genes-ts",
      "-cp", "tests/genes-ts/package-shapes/invalid",
      "-main", "MissingRequireMain",
      "-js", outputPath,
      "-D", "genes.ts",
      "-D", "no-deprecation-warnings",
      "-dce", "no"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  ok(
    result.status !== 0,
    "invalid @:ts.instanceType metadata compiled successfully"
  );
  match(
    `${result.stdout}${result.stderr}`,
    /@:ts\.instanceType requires an external @:jsRequire binding/
  );
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
assertInvalidMetadataFailsClosed();

run("haxe", ["tests/genes-ts/package-shapes/build-ts.hxml"]);
const tsRoot = path.join(fixtureRoot, "out/ts");
installFixturePackage(tsRoot);
writeFileSync(
  path.join(tsRoot, "src-gen/consumer.ts"),
  typeConsumer("./package_shapes/Main.js")
);

const generatedTs = readFileSync(
  path.join(tsRoot, "src-gen/package_shapes/Main.ts"),
  "utf8"
);
match(
  generatedTs,
  /import ExportEqualsConstructor from "genes-export-equals-fixture"/
);
match(
  generatedTs,
  /driver: InstanceType<typeof ExportEqualsConstructor>/
);
match(
  generatedTs,
  /current\(\): InstanceType<typeof ExportEqualsConstructor>/
);
match(
  generatedTs,
  /import type \{NamespaceProcess\} from "genes-namespace-secondary-fixture"/
);
match(generatedTs, /process: NamespaceProcess/);
ok(
  !/import type \* as NamespaceProcess\b/.test(generatedTs),
  "a module namespace leaked into the secondary extern's type position"
);
ok(
  !/driver: ExportEqualsConstructor(?:\W|$)/.test(generatedTs),
  "export-equals constructor value leaked into a direct TS instance type"
);

assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "tests/genes-ts/package-shapes/tsconfig.ts.json",
  ownershipInventories: [{
    outputRoot: "tests/genes-ts/package-shapes/out/ts/src-gen",
    outputIdentity: "index.ts",
    classifications: [
      {
        file: "genes/Register.ts",
        disposition: "runtime-boundary",
        reason: "Haxe's reflection registry intentionally contains heterogeneous host values."
      }
    ]
  }],
  scope: "genes-ts-export-equals-package-shape"
});
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/package-shapes/tsconfig.ts.json"
);
deepStrictEqual(
  parseTranscript(
    capture("node", ["tests/genes-ts/package-shapes/out/ts/dist/index.js"]),
    "ts-strict"
  ),
  expectedTranscript
);

run("haxe", ["tests/genes-ts/package-shapes/build-classic.hxml"]);
const classicRoot = path.join(fixtureRoot, "out/classic");
installFixturePackage(classicRoot);
writeFileSync(
  path.join(classicRoot, "consumer.ts"),
  typeConsumer("./src-gen/package_shapes/Main.js")
);

const classicDeclaration = readFileSync(
  path.join(classicRoot, "src-gen/package_shapes/Main.d.ts"),
  "utf8"
);
match(
  classicDeclaration,
  /driver: InstanceType<typeof ExportEqualsConstructor>/
);
match(
  classicDeclaration,
  /current\(\): InstanceType<typeof ExportEqualsConstructor>/
);
match(
  classicDeclaration,
  /import \{NamespaceProcess\} from "genes-namespace-secondary-fixture"/
);
match(classicDeclaration, /process: NamespaceProcess/);
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/package-shapes/tsconfig.classic-consumer.json",
  { emit: false }
);
deepStrictEqual(
  parseTranscript(
    capture("node", ["tests/genes-ts/package-shapes/out/classic/src-gen/index.js"]),
    "classic-esm"
  ),
  expectedTranscript
);

runDts2hxBridge({ repoRoot, fixtureRoot });

console.log(
  "Package-shape interop checks passed " +
  "(manual const/namespace CJS + dts2hx ESM/subpath/conditional/CJS bridge)."
);
