import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import {
  hashTree,
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Proves the typed async authoring layer rather than its generated appearance.
 *
 * Why: the Reflaxe.Elixir fork recognized a magic local variable and removed
 * it in the classic printer. Modern Genes instead owns async intent in a build
 * macro, but that design is only superior when both output profiles preserve
 * ordering, typing, diagnostics, and provenance.
 *
 * What: one source module runs through classic Genes and genes-ts/TypeScript
 * 5, 6, and 7. Standard-Haxe builds prove that anonymous functions retain
 * their explicit syntax lowering while named async methods fail clearly before
 * replacing output when the Genes generator is absent.
 *
 * How: source assertions require native async/await and no marker, runtime
 * JSON reports must match exactly, and each implementation source map must map
 * an emitted await back to the corresponding Haxe expression.
 */

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "../..");
const fixtureRoot = path.join(repoRoot, "tests/async-await-evidence");

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

function parseReport(output: string): unknown {
  const last = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .at(-1);
  if (last === undefined) throw new Error("async fixture produced no report");
  const report: unknown = JSON.parse(last);
  return report;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSourceMap(file: string): RawSourceMap {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  ok(isRecord(parsed), `${file}: expected a source-map object`);
  ok(parsed.version === 3, `${file}: expected source-map version 3`);
  ok(typeof parsed.file === "string", `${file}: expected file`);
  ok(typeof parsed.sourceRoot === "string", `${file}: expected sourceRoot`);
  ok(Array.isArray(parsed.sources) && parsed.sources.every(value => typeof value === "string"),
    `${file}: expected string sources`);
  ok(Array.isArray(parsed.names) && parsed.names.every(value => typeof value === "string"),
    `${file}: expected string names`);
  ok(typeof parsed.mappings === "string", `${file}: expected mappings`);
  return {
    // source-map@0.6 types the JSON version as a string even though the v3
    // wire format stores the number 3. The value was validated above; this
    // conversion satisfies that legacy library type without a type assertion.
    version: "3",
    file: parsed.file,
    sourceRoot: parsed.sourceRoot,
    sources: parsed.sources,
    names: parsed.names,
    mappings: parsed.mappings
  };
}

function lineContaining(
  source: string,
  needle: string,
  token = "await"
): { line: number; column: number } {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  if (index < 0) throw new Error(`missing source line containing ${needle}`);
  return { line: index + 1, column: lines[index].indexOf(token) };
}

function assertAwaitMapping(
  generatedFile: string,
  mapFile: string,
  generatedNeedle: string,
  originalNeedle: string,
  token = "await"
): void {
  const generated = readFileSync(generatedFile, "utf8");
  const original = readFileSync(
    path.join(fixtureRoot, "src/asyncawaitevidence/Main.hx"),
    "utf8"
  );
  const generatedPosition = lineContaining(generated, generatedNeedle, token);
  const originalPosition = lineContaining(original, originalNeedle, token);
  const consumer = new SourceMapConsumer(parseSourceMap(mapFile));
  const mapped = consumer.originalPositionFor(generatedPosition);
  ok(mapped.source?.endsWith("src/asyncawaitevidence/Main.hx"),
    `${mapFile}: await mapped to ${mapped.source ?? "no source"}`);
  strictEqual(mapped.line, originalPosition.line,
    `${mapFile}: await no longer maps to its Haxe expression`);
}

function assertNativeAsync(profile: string, source: string): void {
  ok(/\basync\b/.test(source), `${profile}: missing native async`);
  ok(/\bawait\b/.test(source), `${profile}: missing native await`);
  strictEqual(source.includes("__async_marker__"), false,
    `${profile}: leaked the vendored marker protocol`);
  strictEqual(source.includes("genes.asyncContext"), false,
    `${profile}: leaked compiler-only async ownership metadata`);
  strictEqual(source.includes("genes/internal/NativeAsyncMarker"), false,
    `${profile}: imported the compiler-only native-async carrier`);
  strictEqual(source.includes("NativeAsyncMarker.returnValue"), false,
    `${profile}: leaked the compiler-only return bridge`);
  strictEqual(source.includes("Promise.resolve().then"), false,
    `${profile}: emitted Promise-chain simulation instead of native await`);
}

type WarmProfile = {
  readonly name: "ts" | "classic" | "tsx";
  readonly extension: "ts" | "js" | "tsx";
  readonly defines: ReadonlyArray<string>;
  readonly coldRoot: string;
  readonly warmRoot: string;
};

function comparableTree(root: string): ReturnType<typeof hashTree> {
  return hashTree(root).filter(entry => !entry.path.includes(".genes-output-index"));
}

function warmArguments(profile: WarmProfile): string[] {
  return [
    "-lib", "genes-ts",
    "-cp", "tests/async-await-evidence/src",
    "-main", "asyncawaitevidence.Main",
    "-js", `${profile.warmRoot}/index.${profile.extension}`,
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    "--macro", "asyncawaitevidence.NativeAsyncInventoryProbe.install()",
    ...profile.defines.flatMap(define => ["-D", define])
  ];
}

async function assertCompilerServerReuse(): Promise<void> {
  const profiles: ReadonlyArray<WarmProfile> = [
    {
      name: "ts",
      extension: "ts",
      defines: ["genes.ts"],
      coldRoot: path.join(fixtureRoot, "out/ts/src-gen"),
      warmRoot: path.join(fixtureRoot, "out/warm-ts/src-gen")
    },
    {
      name: "classic",
      extension: "js",
      defines: ["dts"],
      coldRoot: path.join(fixtureRoot, "out/classic"),
      warmRoot: path.join(fixtureRoot, "out/warm-classic")
    },
    {
      name: "tsx",
      extension: "tsx",
      defines: ["genes.ts"],
      coldRoot: path.join(fixtureRoot, "out/tsx/src-gen"),
      warmRoot: path.join(fixtureRoot, "out/warm-tsx/src-gen")
    }
  ];
  const compiler = selectedHaxeCompiler(repoRoot);
  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  try {
    for (const profile of profiles) {
      const result = await server.compile(
        warmArguments(profile),
        `Warm native-async ${profile.name}`,
        120_000
      );
      strictEqual(result.code, 0,
        `warm ${profile.name} failed:\n${result.stdout}\n${result.stderr}\n${server.logs}`);
      deepStrictEqual(
        comparableTree(profile.warmRoot),
        comparableTree(profile.coldRoot),
        `warm ${profile.name} output differs from its cold tree`
      );
    }

    const classic = profiles[1];
    const warmClassicRoot = classic.warmRoot;
    const lastGood = comparableTree(warmClassicRoot);
    const failed = await server.compile([
      "-lib", "genes-ts",
      "-cp", "tests/async-await-evidence/src",
      "-main", "asyncawaitinvalid.NonFunctionMarker",
      "-js", `${warmClassicRoot}/index.js`,
      "-D", "js-es=6"
    ], "Warm native-async rollback", 120_000);
    ok(failed.code !== 0,
      "warm compiler server accepted a detached function marker");
    ok(`${failed.stdout}${failed.stderr}`.includes("GENES-NATIVE-ASYNC-PLAN-001"),
      "warm compiler server missed the marker diagnostic");
    deepStrictEqual(comparableTree(warmClassicRoot), lastGood,
      "failed warm native-async request replaced the last-good tree");

    const recovered = await server.compile(
      warmArguments(classic),
      "Warm native-async recovery",
      120_000
    );
    strictEqual(recovered.code, 0,
      `warm recovery failed:\n${recovered.stdout}\n${recovered.stderr}\n${server.logs}`);
    deepStrictEqual(comparableTree(warmClassicRoot), lastGood,
      "warm recovery changed the deterministic classic tree");
  } finally {
    await server.stop();
  }
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
const standardSourcePath = path.join(fixtureRoot, "out/standard/index.cjs");
mkdirSync(path.dirname(standardSourcePath), { recursive: true });
writeFileSync(standardSourcePath, "sentinel\n");
const standardResult = spawnSync(
  "haxe",
  ["tests/async-await-evidence/build-standard.hxml"],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(standardResult.status, 1,
  "standard Haxe unexpectedly accepted Genes async authoring helpers");
const standardDiagnostics = `${standardResult.stdout}${standardResult.stderr}`;
ok(standardDiagnostics.includes("[GENES-ASYNC-TARGET-001]"),
  `standard Haxe missed the target diagnostic:\n${standardDiagnostics}`);
strictEqual(readFileSync(standardSourcePath, "utf8"), "sentinel\n",
  "failed standard-Haxe build replaced prior output");

run("haxe", ["tests/async-await-evidence/build-standard-anonymous.hxml"]);
run("haxe", ["tests/async-await-evidence/build-classic.hxml"]);
run("haxe", ["tests/async-await-evidence/build-ts.hxml"]);
run("haxe", ["tests/async-await-evidence/build-tsx.hxml"]);

const standardAnonymousSourcePath = path.join(
  fixtureRoot,
  "out/standard-anonymous/index.cjs"
);
const classicSourcePath = path.join(
  fixtureRoot,
  "out/classic/asyncawaitevidence/Main.js"
);
const tsSourcePath = path.join(
  fixtureRoot,
  "out/ts/src-gen/asyncawaitevidence/Main.ts"
);
const tsxSourcePath = path.join(
  fixtureRoot,
  "out/tsx/src-gen/asyncawaitevidence/Main.tsx"
);
const classicSource = readFileSync(classicSourcePath, "utf8");
const tsSource = readFileSync(tsSourcePath, "utf8");
const tsxSource = readFileSync(tsxSourcePath, "utf8");

assertNativeAsync(
  "standard Haxe anonymous function",
  readFileSync(standardAnonymousSourcePath, "utf8")
);
assertNativeAsync("classic Genes", classicSource);
assertNativeAsync("genes-ts", tsSource);
assertNativeAsync("genes-ts TSX", tsxSource);
ok(tsSource.includes(
  "static async staticAsync(value: number): globalThis.Promise<number>"
));
ok(tsSource.includes(
  "async instanceAsync(value: number): globalThis.Promise<number>"
));
ok(tsSource.includes("async function (value: number)"));
strictEqual(
  tsSource.match(/return globalThis\.Promise\.resolve\(value\)/g)?.length,
  2,
  "named and anonymous async functions retain direct promised returns"
);
ok(tsSource.includes(
  "static async widenedAsync(): globalThis.Promise<number>"
), "native async preserves Haxe's valid Int-to-Float return widening");
ok(tsSource.includes("NativeAsyncMarker.functionValue(value)"),
  "a same-named user member was incorrectly erased as compiler evidence");
ok(tsSource.includes("const raw: (() => globalThis.Promise<number>) = async function"),
  "the copied raw async template did not remain ordinary authored syntax");
ok(tsSource.includes("(await Main.tracked(\"property\", 10)).label"));
ok(tsSource.includes("(await Main.tracked(\"index\", 20)).values[1]"));
strictEqual(/\b(?:any|unknown)\b/.test(tsSource), false,
  "genes-ts weakened the generated user module");

runGeneratedTypeScriptMatrix("tests/async-await-evidence/tsconfig.json");
runGeneratedTypeScriptMatrix("tests/async-await-evidence/tsconfig-tsx.json");
for (const markerFile of [
  path.join(fixtureRoot, "out/classic/genes/internal/NativeAsyncMarker.js"),
  path.join(fixtureRoot, "out/ts/src-gen/genes/internal/NativeAsyncMarker.ts"),
  path.join(fixtureRoot, "out/tsx/src-gen/genes/internal/NativeAsyncMarker.tsx")
]) {
  strictEqual(existsSync(markerFile), false,
    `${markerFile}: DCE retained the compiler-only native-async owner`);
}
for (const declarationFile of [
  path.join(fixtureRoot, "out/classic/asyncawaitevidence/Main.d.ts"),
  path.join(fixtureRoot, "out/ts/dist/asyncawaitevidence/Main.d.ts"),
  path.join(fixtureRoot, "out/tsx/dist/asyncawaitevidence/Main.d.ts")
]) {
  const declaration = readFileSync(declarationFile, "utf8");
  strictEqual(declaration.includes("NativeAsyncMarker.returnValue"), false,
    `${declarationFile}: declaration leaked the return carrier`);
  strictEqual(declaration.includes("genes/internal/NativeAsyncMarker"), false,
    `${declarationFile}: declaration imported the compiler-only marker`);
}
await assertCompilerServerReuse();

const expected = {
  staticValue: 42,
  instanceValue: 42,
  anonymousValue: 42,
  nestedValue: 42,
  promisedValue: 42,
  anonymousPromisedValue: 42,
  widenedValue: 42,
  // A targetless Haxe cast is an erased assertion, not a runtime conversion.
  authoredCastValue: "42",
  nestedSyncValue: "42",
  defaultValue: 42,
  copiedNameValue: 42,
  copiedRawValue: 42,
  propertyAndIndex: "property:21",
  recoveredError: "async-error",
  voidCompleted: true,
  evaluations: 2,
  events: [
    "static:before",
    "static:after",
    "evaluate:property",
    "between:property:index",
    "evaluate:index",
    "void:effect"
  ]
};
strictEqual(capture("node", [standardAnonymousSourcePath]).trim(), "42");
deepStrictEqual(
  parseReport(capture("node", [path.join(fixtureRoot, "out/classic/index.js")])),
  expected
);
deepStrictEqual(
  parseReport(capture("node", [path.join(fixtureRoot, "out/ts/dist/index.js")])),
  expected
);

assertAwaitMapping(
  tsSourcePath,
  `${tsSourcePath}.map`,
  "(await Main.tracked(\"index\", 20)).values[1]",
  "await(tracked(\"index\", 20))"
);
assertAwaitMapping(
  tsSourcePath,
  `${tsSourcePath}.map`,
  "async function (value: number)",
  "final increment = @:async function",
  "async"
);
assertAwaitMapping(
  classicSourcePath,
  `${classicSourcePath}.map`,
  "(await Main.tracked(\"index\", 20)).values[1]",
  "await(tracked(\"index\", 20))"
);

type InvalidCase = {
  readonly main: string;
  readonly diagnostic: string;
  readonly standardDiagnostic?: string;
  readonly genesOnly?: boolean;
};

const invalidCases: ReadonlyArray<InvalidCase> = [
  {
    main: "asyncawaitinvalid.MetadataOutside",
    diagnostic: "[GENES-ASYNC-CONTEXT-001]"
  },
  {
    main: "asyncawaitinvalid.DirectOutside",
    diagnostic: "[GENES-ASYNC-CONTEXT-001]"
  },
  {
    main: "asyncawaitinvalid.NestedSynchronous",
    diagnostic: "[GENES-ASYNC-CONTEXT-001]",
    standardDiagnostic: "[GENES-ASYNC-TARGET-001]"
  },
  {
    main: "asyncawaitinvalid.Constructor",
    diagnostic: "[GENES-ASYNC-CONSTRUCTOR-001]"
  },
  {
    main: "asyncawaitinvalid.MissingReturn",
    diagnostic: "[GENES-ASYNC-RETURN-001]"
  },
  {
    main: "asyncawaitinvalid.WrongReturnType",
    diagnostic: "String should be Int",
    standardDiagnostic: "[GENES-ASYNC-TARGET-001]"
  },
  {
    main: "asyncawaitinvalid.InvalidAuthoring",
    diagnostic: "[GENES-ASYNC-AUTHORING-001]"
  },
  {
    main: "asyncawaitinvalid.DetachedReturnMarker",
    diagnostic: "GENES-NATIVE-ASYNC-PLAN-002",
    genesOnly: true
  },
  {
    main: "asyncawaitinvalid.NonFunctionMarker",
    diagnostic: "GENES-NATIVE-ASYNC-PLAN-001",
    genesOnly: true
  }
];

const invalidProfiles = [
  { id: "standard", extension: "cjs", defines: ["-D", "genes.disable"] },
  { id: "classic", extension: "js", defines: [] },
  { id: "ts", extension: "ts", defines: ["-D", "genes.ts"] }
] as const;

for (const profile of invalidProfiles) {
  for (const invalidCase of invalidCases) {
    if (profile.id === "standard" && invalidCase.genesOnly === true) continue;
    const caseName = invalidCase.main.split(".").at(-1) ?? "invalid";
    const output = path.join(
      fixtureRoot,
      "out/invalid",
      profile.id,
      caseName,
      `index.${profile.extension}`
    );
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, "sentinel\n");
    const result = spawnSync("haxe", [
      "-lib", "genes-ts",
      "-cp", "tests/async-await-evidence/src",
      "-main", invalidCase.main,
      "-js", path.relative(repoRoot, output),
      "-D", "js-es=6",
      ...profile.defines
    ], { cwd: repoRoot, encoding: "utf8" });
    strictEqual(result.status, 1,
      `${profile.id}/${caseName}: invalid async authoring compiled`);
    const diagnostics = `${result.stdout}${result.stderr}`;
    const expectedDiagnostic = profile.id === "standard"
      ? (invalidCase.standardDiagnostic ?? invalidCase.diagnostic)
      : invalidCase.diagnostic;
    ok(diagnostics.includes(expectedDiagnostic),
      `${profile.id}/${caseName}: missing ${expectedDiagnostic}:\n${diagnostics}`);
    strictEqual(readFileSync(output, "utf8"), "sentinel\n",
      `${profile.id}/${caseName}: failed build replaced prior output`);
  }
}

console.log("async-await-evidence:ok (classic declarations + TS/TSX 5/6/7 + cold/warm rollback + stock anonymous + diagnostics)");
