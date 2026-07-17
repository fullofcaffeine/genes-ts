import { deepStrictEqual, match, ok } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix, toolchains } from "./toolchains.js";
import ts from "./typescript-api.js";

const packageNames = [
  "genes-dts2hx-esm-fixture",
  "genes-dts2hx-cjs-fixture"
] as const;
const entryPoints = [
  "genes-dts2hx-esm-fixture",
  "genes-dts2hx-esm-fixture/feature",
  "genes-dts2hx-cjs-fixture"
] as const;
const expectedTranscript = {
  esmVersion: "esm-fixture-1",
  formatted: "genes:bridge",
  featureName: "root",
  featureScore: 4,
  subpathName: "subpath",
  cjsVersion: "cjs-fixture-1",
  cjsLabel: "genes",
  cjsClosed: "closed:genes"
};

type FileEvidence = {
  readonly path: string;
  readonly sha256: string;
};

type PackageIdentity = {
  readonly name: string;
  readonly version: string;
};

export type Dts2hxBridgeOptions = {
  readonly repoRoot: string;
  readonly fixtureRoot: string;
};

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function collectFileEvidence(root: string, prefix = ""): ReadonlyArray<FileEvidence> {
  const evidence: FileEvidence[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = normalizePath(path.relative(root, absolutePath));
        evidence.push({
          path: prefix.length > 0 ? `${prefix}/${relativePath}` : relativePath,
          sha256: sha256(readFileSync(absolutePath))
        });
      }
    }
  }

  visit(root);
  return evidence.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function hashEvidence(files: ReadonlyArray<FileEvidence>): string {
  return sha256(files.map((file) => `${file.path}\0${file.sha256}`).join("\n"));
}

function readPackageIdentity(packageJsonPath: string): PackageIdentity {
  const value: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  ok(value !== null && typeof value === "object", `${packageJsonPath} is not an object`);
  const record = value as Record<string, unknown>;
  ok(typeof record.name === "string", `${packageJsonPath} has no package name`);
  ok(typeof record.version === "string", `${packageJsonPath} has no package version`);
  return { name: record.name, version: record.version };
}

function run(repoRoot: string, command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function capture(repoRoot: string, command: string, args: ReadonlyArray<string>): string {
  return execFileSync(command, [...args], { cwd: repoRoot, encoding: "utf8" });
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

function installPackages(fixtureRoot: string, profileRoot: string): void {
  for (const packageName of packageNames) {
    const destination = path.join(profileRoot, "node_modules", packageName);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(fixtureRoot, "packages", packageName), destination, {
      recursive: true
    });
  }
}

/** Proves the local conditional package's CommonJS branch and subpath load. */
function assertConditionalRequireBranch(generatorProjectRoot: string): void {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      [
        'const root = require("genes-dts2hx-esm-fixture");',
        'const feature = require("genes-dts2hx-esm-fixture/feature");',
        'const formatter = new root.Formatter("require");',
        "process.stdout.write(JSON.stringify({",
        "version: root.version,",
        'formatted: formatter.format("branch"),',
        'score: feature.createFeature("require").score',
        "}));"
      ].join(""),
    ],
    { cwd: generatorProjectRoot, encoding: "utf8" }
  );
  deepStrictEqual(JSON.parse(output), {
    version: "esm-fixture-1",
    formatted: "require:branch",
    score: 7
  });
}

/**
 * Resolves the shared package contract through the repository's TS API seam.
 *
 * Why: dts2hx intentionally owns its TS 5.9 converter API while genes tooling
 * owns a TS6 adapter. What/How: resolve the exact same declaration entrypoints
 * with the genes adapter before conversion, then let dts2hx resolve them with
 * its pinned compiler. This compares a stable package boundary without sharing
 * conversion ASTs or importing either tool's internals into the other.
 */
function assertPackageResolution(generatorProjectRoot: string): void {
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: false
  };
  const host = ts.createCompilerHost(compilerOptions);
  const expected = new Map<string, string>([
    ["genes-dts2hx-esm-fixture", "node_modules/genes-dts2hx-esm-fixture/index.d.ts"],
    [
      "genes-dts2hx-esm-fixture/feature",
      "node_modules/genes-dts2hx-esm-fixture/feature.d.ts"
    ],
    ["genes-dts2hx-cjs-fixture", "node_modules/genes-dts2hx-cjs-fixture/index.d.ts"]
  ]);
  const containingFile = path.join(generatorProjectRoot, "bridge-consumer.ts");

  for (const entryPoint of entryPoints) {
    const resolved = ts.resolveModuleName(
      entryPoint,
      containingFile,
      compilerOptions,
      host
    ).resolvedModule;
    ok(resolved !== undefined, `TS6 could not resolve ${entryPoint}`);
    const relativePath = normalizePath(
      path.relative(generatorProjectRoot, resolved.resolvedFileName)
    );
    deepStrictEqual(relativePath, expected.get(entryPoint));
    deepStrictEqual(resolved.extension, ts.Extension.Dts);
  }
}

/**
 * Runs the pinned declaration converter and rejects diagnostic-shaped success.
 *
 * Why: dts2hx 0.34.0 can emit files after reporting a TypeScript diagnostic,
 * so an exit code alone is not a sufficient bridge contract. What/How: the
 * harness invokes the locally locked distribution, captures both streams, and
 * fails on any `Error:` or `Warning:` record before generated externs are used.
 */
function generateExterns(
  repoRoot: string,
  generatorProjectRoot: string,
  outputRoot: string
): void {
  const cliPath = path.join(repoRoot, "node_modules/dts2hx/dist/dts2hx.js");
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      ...entryPoints,
      "--moduleSearchPath", normalizePath(path.relative(repoRoot, generatorProjectRoot)),
      "--tsconfig", "tests/genes-ts/package-shapes/dts2hx.tsconfig.json",
      "--moduleResolution", "NodeNext",
      "--output", normalizePath(path.relative(repoRoot, outputRoot)),
      "--noLibWrap",
      "--skipDependencies",
      "--modular",
      "--noColor"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  const log = `${result.stdout}${result.stderr}`;
  ok(result.status === 0, `dts2hx exited with ${result.status}\n${log}`);
  ok(!/(?:Error|Warning):/.test(log), `dts2hx reported a lossy diagnostic\n${log}`);
}

function assertNoWeakGeneratedExterns(
  files: ReadonlyArray<FileEvidence>,
  externRoot: string
): void {
  for (const file of files) {
    if (!file.path.endsWith(".hx")) continue;
    const source = readFileSync(path.join(externRoot, file.path), "utf8");
    ok(
      !/\b(?:Dynamic|Any)\b/.test(source),
      `dts2hx generated a weak boundary in ${file.path}`
    );
  }
}

/** Creates timestamp-free evidence suitable for CI comparison and reporting. */
function buildManifest(
  repoRoot: string,
  fixtureRoot: string,
  externFiles: ReadonlyArray<FileEvidence>
): Record<string, unknown> {
  const generator = readPackageIdentity(
    path.join(repoRoot, "node_modules/dts2hx/package.json")
  );
  const generatorTypeScript = readPackageIdentity(
    path.join(repoRoot, "node_modules/dts2hx/node_modules/typescript/package.json")
  );
  deepStrictEqual(generator, {
    name: toolchains.dts2hx.dependency,
    version: toolchains.dts2hx.version
  });
  deepStrictEqual(generatorTypeScript, {
    name: "typescript",
    version: toolchains.dts2hx.typescriptVersion
  });

  const inputs = packageNames.flatMap((packageName) =>
    collectFileEvidence(path.join(fixtureRoot, "packages", packageName), packageName)
  );
  const packages = packageNames.map((packageName) =>
    readPackageIdentity(path.join(fixtureRoot, "packages", packageName, "package.json"))
  );

  return {
    schemaVersion: 1,
    generator: {
      package: generator.name,
      version: generator.version,
      distribution: "locked npm tarball",
      sourceAuditRevision: toolchains.dts2hx.sourceAuditRevision,
      typescriptVersion: generatorTypeScript.version
    },
    haxe: {
      testedVersion: capture(repoRoot, "haxe", ["--version"]).trim(),
      minimumGeneratedExternVersion: "4.3"
    },
    invocation: {
      entryPoints: [...entryPoints],
      moduleResolution: "NodeNext",
      modular: true,
      skipDependencies: true,
      libraryWrapper: false
    },
    resolutionAdapters: [
      "genes TypeScript 6 API seam",
      "dts2hx TypeScript 5.9 converter API"
    ],
    packages,
    inputs: {
      treeSha256: hashEvidence(inputs),
      files: inputs
    },
    generatedExterns: {
      treeSha256: hashEvidence(externFiles),
      files: externFiles
    },
    lossPolicy: {
      weakGeneratedTypes: "forbidden",
      diagnostics: "fail closed"
    },
    knownLosses: [
      {
        id: "DTS2HX-CONST-NAMESPACE-EXPORT-EQUALS",
        disposition: "precise manual extern fixture retained",
        detail:
          "dts2hx 0.34.0 does not merge a const-plus-namespace Instance surface into the constructed Haxe class; the separate genes-export-equals-fixture covers that shape without Dynamic"
      }
    ],
    capabilitiesNotExercised: [
      {
        id: "DTS2HX-HAXE5-JS-IMPORT",
        detail:
          "@:js.import generation is reserved for the nonblocking Haxe 5 lane; the stable Haxe 4.3 bridge uses @:jsRequire and genes emits ESM"
      }
    ],
    runtimeConditions: [
      "import through generated genes TS and classic ESM",
      "require through direct CommonJS root and subpath smoke"
    ],
    profiles: ["genes-ts ts-strict", "classic genes ESM plus declarations"]
  };
}

function assertManifest(
  fixtureRoot: string,
  outputRoot: string,
  manifest: Record<string, unknown>
): void {
  const manifestPath = path.join(fixtureRoot, "dts2hx", "manifest.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.env.UPDATE_DTS2HX_MANIFEST === "1") {
    writeFileSync(manifestPath, serialized);
  }
  deepStrictEqual(JSON.parse(readFileSync(manifestPath, "utf8")), manifest);
  writeFileSync(path.join(outputRoot, "manifest.json"), serialized);
}

function typeConsumer(importPath: string): string {
  return [
    `import {Main} from ${JSON.stringify(importPath)};`,
    'const host = new Main("consumer");',
    'const formatted: string = host.formatter.format("value");',
    "const prefix: string = host.formatter.prefix;",
    "const label: string = host.driver.label;",
    "const closed: string = host.driver.close();",
    "// @ts-expect-error the generated ESM class surface must stay closed",
    "host.formatter.nonexistentMember();",
    "// @ts-expect-error the generated export-equals instance is not weakly typed",
    "const invalid: number = host.driver.label;",
    "void formatted; void prefix; void label; void closed; void invalid;",
    ""
  ].join("\n");
}

/**
 * Runs the declaration-ingestion bridge from package resolution to both outputs.
 *
 * The function owns only generic fixtures and generated evidence. It does not
 * expose dts2hx internals to genes, and it leaves output under the ignored
 * fixture tree so the checked-in manifest is the sole generated baseline.
 */
export function runDts2hxBridge(options: Dts2hxBridgeOptions): void {
  const { repoRoot, fixtureRoot } = options;
  const bridgeRoot = path.join(fixtureRoot, "dts2hx");
  const outputRoot = path.join(bridgeRoot, "out");
  rmSync(outputRoot, { recursive: true, force: true });

  const generatorProjectRoot = path.join(outputRoot, "generator-project");
  installPackages(fixtureRoot, generatorProjectRoot);
  assertPackageResolution(generatorProjectRoot);
  assertConditionalRequireBranch(generatorProjectRoot);
  const externRootA = path.join(outputRoot, "externs-a");
  const externRootB = path.join(outputRoot, "externs-b");
  generateExterns(repoRoot, generatorProjectRoot, externRootA);
  generateExterns(repoRoot, generatorProjectRoot, externRootB);

  const externFilesA = collectFileEvidence(externRootA);
  const externFilesB = collectFileEvidence(externRootB);
  deepStrictEqual(
    externFilesB,
    externFilesA,
    "two clean dts2hx generations produced different extern trees"
  );
  assertNoWeakGeneratedExterns(externFilesA, externRootA);
  assertManifest(
    fixtureRoot,
    outputRoot,
    buildManifest(repoRoot, fixtureRoot, externFilesA)
  );

  run(repoRoot, "haxe", ["tests/genes-ts/package-shapes/dts2hx/build-ts.hxml"]);
  const tsRoot = path.join(outputRoot, "ts");
  installPackages(fixtureRoot, tsRoot);
  writeFileSync(
    path.join(tsRoot, "src-gen/consumer.ts"),
    typeConsumer("./dts2hx_shapes/Main.js")
  );

  const generatedTs = readFileSync(
    path.join(tsRoot, "src-gen/dts2hx_shapes/Main.ts"),
    "utf8"
  );
  match(
    generatedTs,
    /import type \{Feature\} from "\.\.\/genes_dts2hx_esm_fixture\/Feature\.js"/
  );
  match(generatedTs, /import \{Formatter\} from "genes-dts2hx-esm-fixture"/);
  match(
    generatedTs,
    /import \* as FeatureModule from "genes-dts2hx-esm-fixture\/feature"/
  );
  match(
    generatedTs,
    /import GenesDts2hxCjsFixture from "genes-dts2hx-cjs-fixture"/
  );
  assertExportedSurfacePolicy({
    repoRoot,
    tsconfigPath: "tests/genes-ts/package-shapes/dts2hx/tsconfig.ts.json",
    ownershipInventories: [{
      outputRoot: "tests/genes-ts/package-shapes/dts2hx/out/ts/src-gen",
      outputIdentity: "index.ts",
      classifications: [
        {
          file: "genes/Register.ts",
          disposition: "runtime-boundary",
          reason: "Haxe's reflection registry intentionally contains heterogeneous host values."
        },
        {
          file: "js/node/Util.ts",
          disposition: "fixture-boundary",
          reason: "The dts2hx bridge transitively emits the Haxe Node extern's open inspect-options host contract."
        },
        {
          file: "js/node/stream/Writable.ts",
          disposition: "fixture-boundary",
          reason: "The dts2hx bridge transitively emits the Haxe Node writable-options host contract."
        }
      ]
    }],
    scope: "genes-dts2hx-generated-extern-bridge"
  });
  runGeneratedTypeScriptMatrix(
    "tests/genes-ts/package-shapes/dts2hx/tsconfig.ts.json"
  );
  deepStrictEqual(
    parseTranscript(
      capture(repoRoot, "node", [
        "tests/genes-ts/package-shapes/dts2hx/out/ts/dist/index.js"
      ]),
      "dts2hx-ts-strict"
    ),
    expectedTranscript
  );

  run(repoRoot, "haxe", ["tests/genes-ts/package-shapes/dts2hx/build-classic.hxml"]);
  const classicRoot = path.join(outputRoot, "classic");
  installPackages(fixtureRoot, classicRoot);
  writeFileSync(
    path.join(classicRoot, "consumer.ts"),
    typeConsumer("./src-gen/dts2hx_shapes/Main.js")
  );

  const classicDeclaration = readFileSync(
    path.join(classicRoot, "src-gen/dts2hx_shapes/Main.d.ts"),
    "utf8"
  );
  match(
    classicDeclaration,
    /import \{Formatter\} from "genes-dts2hx-esm-fixture"/
  );
  match(
    classicDeclaration,
    /import GenesDts2hxCjsFixture from "genes-dts2hx-cjs-fixture"/
  );
  runGeneratedTypeScriptMatrix(
    "tests/genes-ts/package-shapes/dts2hx/tsconfig.classic-consumer.json",
    { emit: false }
  );
  deepStrictEqual(
    parseTranscript(
      capture(repoRoot, "node", [
        "tests/genes-ts/package-shapes/dts2hx/out/classic/src-gen/index.js"
      ]),
      "dts2hx-classic-esm"
    ),
    expectedTranscript
  );
}
