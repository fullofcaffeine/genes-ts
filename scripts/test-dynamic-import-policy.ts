import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import {
  compilerOutputSentinel,
  hashTree,
  leakedOutputStages,
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = "tests/dynamic-import-policy";
const generatedRoot = `${fixtureRoot}/out`;

/**
 * Proves that lazy imports use runtime filenames, not generated-source names.
 *
 * Why: `Genes.dynamicImport()` runs during Haxe typing, and the compilation
 * server may cache that typed expansion across `.ts`, `.tsx`, `.js`, `.jsx`,
 * and `.mjs` requests. A cold-only source assertion cannot expose stale
 * request policy or stale typed declarations.
 *
 * What/How: this harness builds every supported suffix profile cold, repeats a
 * profile-switching sequence through one owned Haxe server, and compares every
 * warm tree byte-for-byte with its cold counterpart. It also type-checks the
 * TS surfaces on TS 5/6/7, executes real `.mjs` output, checks exact authored
 * source-map provenance, and rejects leaked carrier/staging/sentinel artifacts.
 */
type ProfileName =
  | "classic-js"
  | "classic-mjs"
  | "classic-jsx"
  | "classic-no-extension"
  | "ts"
  | "tsx"
  | "ts-no-extension";

type Profile = {
  readonly name: ProfileName;
  readonly artifactExtension: "js" | "jsx" | "mjs" | "ts" | "tsx";
  readonly expectedRuntimeExtension: "" | ".js" | ".mjs";
  readonly defines: ReadonlyArray<string>;
};

const profiles: ReadonlyArray<Profile> = [
  {
    name: "classic-js",
    artifactExtension: "js",
    expectedRuntimeExtension: ".js",
    defines: []
  },
  {
    name: "classic-mjs",
    artifactExtension: "mjs",
    expectedRuntimeExtension: ".mjs",
    defines: []
  },
  {
    name: "classic-jsx",
    artifactExtension: "jsx",
    expectedRuntimeExtension: ".js",
    defines: []
  },
  {
    name: "classic-no-extension",
    artifactExtension: "js",
    expectedRuntimeExtension: "",
    defines: ["genes.no_extension"]
  },
  {
    name: "ts",
    artifactExtension: "ts",
    expectedRuntimeExtension: ".js",
    defines: ["genes.ts"]
  },
  {
    name: "tsx",
    artifactExtension: "tsx",
    expectedRuntimeExtension: ".js",
    defines: ["genes.ts"]
  },
  {
    name: "ts-no-extension",
    artifactExtension: "ts",
    expectedRuntimeExtension: "",
    defines: ["genes.ts", "genes.ts.no_extension"]
  }
];

function profile(name: ProfileName): Profile {
  const found = profiles.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Unknown dynamic-import test profile: ${name}`);
  }
  return found;
}

function outputRoot(mode: "cold" | "warm", current: Profile): string {
  return `${generatedRoot}/${mode}/${current.name}`;
}

function outputFile(mode: "cold" | "warm", current: Profile): string {
  return `${outputRoot(mode, current)}/index.${current.artifactExtension}`;
}

function moduleFile(mode: "cold" | "warm", current: Profile): string {
  return path.join(
    repoRoot,
    outputRoot(mode, current),
    "dynamicimportpolicy",
    `Main.${current.artifactExtension}`
  );
}

function generatedPoint(source: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Generated source contains ${needle}`);
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0
  };
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Haxe source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function buildArguments(
  mode: "cold" | "warm",
  current: Profile,
  port?: number
): string[] {
  return [
    ...(port === undefined ? [] : ["--connect", `127.0.0.1:${port}`]),
    "-lib", "genes-ts",
    "-cp", `${fixtureRoot}/src`,
    "--main", "dynamicimportpolicy.Main",
    "--macro", "include('dynamicimportpolicy.Target')",
    "-js", outputFile(mode, current),
    "-D", "js-es=6",
    "-debug",
    ...current.defines.flatMap((define) => ["-D", define])
  ];
}

function assertRequest(mode: "cold" | "warm", current: Profile): void {
  const source = readFileSync(moduleFile(mode, current), "utf8");
  const expected = `import("./Target${current.expectedRuntimeExtension}")`;
  ok(source.includes(expected),
    `${current.name} did not emit the runtime request ${expected}`);

  const wrongArtifactSuffix = `import("./Target.${current.artifactExtension}")`;
  if (current.expectedRuntimeExtension !== `.${current.artifactExtension}`) {
    ok(!source.includes(wrongArtifactSuffix),
      `${current.name} reused its source artifact extension at runtime`);
  }
  ok(!source.includes("DynamicImportMarker"),
    `${current.name} leaked the compiler-only dynamic-import carrier`);

  const mapPath = `${moduleFile(mode, current)}.map`;
  ok(existsSync(mapPath), `${current.name} did not publish its source map`);
  const authoredPath = path.join(
    repoRoot,
    fixtureRoot,
    "src/dynamicimportpolicy/Main.hx"
  );
  const authored = readFileSync(authoredPath, "utf8");
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(mapPath, "utf8")
  ) as RawSourceMap);
  const original = map.originalPositionFor({
    ...generatedPoint(source, expected),
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(original.source?.endsWith("src/dynamicimportpolicy/Main.hx"),
    `${current.name} dynamic request does not map to the authored macro call`);
  strictEqual(
    original.line,
    sourceLine(authored, "Genes.dynamicImport(Target ->"),
    `${current.name} dynamic request maps to the wrong Haxe source line`
  );
}

/**
 * Reconstructs the private Haxe output sentinel owned by `Generator`.
 *
 * The sentinel is outside the generated tree so Haxe cannot delete a last-good
 * public entrypoint after a custom-generator error. Its key is deterministic
 * from the absolute configured `-js` path, which lets this focused harness
 * prove cleanup without matching or deleting another compiler process's file.
 */
function compilerSentinel(
  mode: "cold" | "warm",
  current: Profile
): string {
  return compilerOutputSentinel(
    path.join(repoRoot, outputFile(mode, current))
  );
}

async function runWarmSequence(haxeBinary: string): Promise<void> {
  const compiler = selectedHaxeCompiler(repoRoot);
  strictEqual(compiler.binary, haxeBinary);
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();

  const sequence: ReadonlyArray<ProfileName> = [
    "ts",
    "ts",
    "classic-mjs",
    "classic-mjs",
    "classic-js",
    "classic-jsx",
    "tsx",
    "tsx",
    "ts-no-extension",
    "classic-no-extension",
    "ts"
  ];
  try {
    for (const name of sequence) {
      const current = profile(name);
      const result = await server.compile(
        buildArguments("warm", current),
        `Warm dynamic-import ${name}`,
        60_000
      );
      ok(
        result.code === 0,
        `Warm ${name} compilation failed`
        + `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        + `\nserver:\n${server.logs}`
      );
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      assertRequest("warm", current);
      deepStrictEqual(
        hashTree(path.join(repoRoot, outputRoot("warm", current))),
        hashTree(path.join(repoRoot, outputRoot("cold", current))),
        `Warm ${name} output differs from its isolated cold build`
      );
    }
  } finally {
    await server.stop();
  }
}

async function main(): Promise<void> {
  rmSync(path.join(repoRoot, generatedRoot), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  });
  const haxeBinary = selectedHaxeCompiler(repoRoot).binary;

  for (const current of profiles) {
    execFileSync(haxeBinary, buildArguments("cold", current), {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 60_000
    });
    assertRequest("cold", current);
  }

  runGeneratedTypeScriptMatrix(
    "tests/dynamic-import-policy/tsconfig.json",
    { emit: false }
  );
  await runWarmSequence(haxeBinary);

  // `dynamicImport()` names the runtime chunk but does not add a static Haxe
  // dependency. `buildArguments()` therefore roots Target explicitly, just as
  // an application or bundler build must retain its dynamic entry points.
  // Execute the compiler-generated module rather than a test-owned stub.
  const runtime = execFileSync(
    process.execPath,
    [path.join(repoRoot, outputFile("cold", profile("classic-mjs")))],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 }
  );
  ok(runtime.includes("dynamic-import-current"),
    `Classic .mjs runtime did not load the current module:\n${runtime}`);

  deepStrictEqual(
    leakedOutputStages(path.join(repoRoot, generatedRoot)),
    [],
    "Dynamic-import fixture left a private output-transaction stage");
  for (const mode of ["cold", "warm"] as const) {
    for (const current of profiles) {
      strictEqual(existsSync(compilerSentinel(mode, current)), false,
        `${mode} ${current.name} left its private Haxe output sentinel`);
    }
  }
  process.stdout.write("dynamic-import-policy:ok\n");
}

await main();
