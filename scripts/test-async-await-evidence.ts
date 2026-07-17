import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
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

function lineContaining(source: string, needle: string): { line: number; column: number } {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  if (index < 0) throw new Error(`missing source line containing ${needle}`);
  return { line: index + 1, column: lines[index].indexOf("await") };
}

function assertAwaitMapping(
  generatedFile: string,
  mapFile: string,
  generatedNeedle: string,
  originalNeedle: string
): void {
  const generated = readFileSync(generatedFile, "utf8");
  const original = readFileSync(
    path.join(fixtureRoot, "src/asyncawaitevidence/Main.hx"),
    "utf8"
  );
  const generatedPosition = lineContaining(generated, generatedNeedle);
  const originalPosition = lineContaining(original, originalNeedle);
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
  strictEqual(source.includes("Promise.resolve().then"), false,
    `${profile}: emitted Promise-chain simulation instead of native await`);
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
const classicSource = readFileSync(classicSourcePath, "utf8");
const tsSource = readFileSync(tsSourcePath, "utf8");

assertNativeAsync(
  "standard Haxe anonymous function",
  readFileSync(standardAnonymousSourcePath, "utf8")
);
assertNativeAsync("classic Genes", classicSource);
assertNativeAsync("genes-ts", tsSource);
ok(tsSource.includes("static async staticAsync(value: number): Promise<number>"));
ok(tsSource.includes("async instanceAsync(value: number): Promise<number>"));
ok(tsSource.includes("async function (value: number)"));
ok(tsSource.includes("(await Main.tracked(\"property\", 10)).label"));
ok(tsSource.includes("(await Main.tracked(\"index\", 20)).values[1]"));
strictEqual(/\b(?:any|unknown)\b/.test(tsSource), false,
  "genes-ts weakened the generated user module");

runGeneratedTypeScriptMatrix("tests/async-await-evidence/tsconfig.json");

const expected = {
  staticValue: 42,
  instanceValue: 42,
  anonymousValue: 42,
  nestedValue: 42,
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
  classicSourcePath,
  `${classicSourcePath}.map`,
  "(await Main.tracked(\"index\", 20)).values[1]",
  "await(tracked(\"index\", 20))"
);

type InvalidCase = {
  readonly main: string;
  readonly diagnostic: string;
  readonly standardDiagnostic?: string;
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
    main: "asyncawaitinvalid.InvalidAuthoring",
    diagnostic: "[GENES-ASYNC-AUTHORING-001]"
  }
];

const invalidProfiles = [
  { id: "standard", extension: "cjs", defines: ["-D", "genes.disable"] },
  { id: "classic", extension: "js", defines: [] },
  { id: "ts", extension: "ts", defines: ["-D", "genes.ts"] }
] as const;

for (const profile of invalidProfiles) {
  for (const invalidCase of invalidCases) {
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

console.log("async-await-evidence:ok (classic + TS 5/6/7 + standard anonymous + named-method guard + diagnostics)");
