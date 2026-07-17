import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/string-literals");
const sourcePath = path.join(
  fixtureRoot,
  "src/literalevidence/Main.hx"
);

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function capture(command: string, args: ReadonlyArray<string>): string {
  return execFileSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(label: string, value: string): string {
  const units: string[] = [];
  for (let index = 0; index < value.length; index++) {
    units.push(value.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0"));
  }
  return `${label}:${value.length}:${units.join(",")}`;
}

const expected = [
  describe("ascii", "ASCII"),
  describe(
    "escapes",
    "quote:\" slash:\\ newline:\n carriage:\r tab:\t controls:\u0000\u001F"
  ),
  describe("latin1", "latin:é"),
  describe("bmp", "bmp:漢"),
  describe("emoji", "emoji:😀"),
  describe("combining", "combining:e\u0301"),
  describe("separators", "separators:\u2028\u2029"),
  describe("import-like", "./pkg/é😀.js"),
  describe("property-key", "property-é😀"),
  describe("property-value", "property-value-é😀")
].join("|");

function sourceLine(needle: string): number {
  const source = readFileSync(sourcePath, "utf8");
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Haxe source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function generatedLocation(source: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Generated source contains ${JSON.stringify(needle)}`);
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1) ?? "").length
  };
}

/**
 * Checks both literal bytes and provenance for one current Genes profile.
 *
 * Why: a successful runtime catches most corruption, but metadata and source
 * maps are compiler-owned outputs too. A future escaping rewrite must not
 * preserve execution by silently losing the original Haxe location.
 */
function assertGeneratedProfile(relativeSource: string): void {
  const generatedPath = path.join(fixtureRoot, relativeSource);
  const generated = readFileSync(generatedPath, "utf8");
  const directive = `${JSON.stringify("unicode-é-😀")};`;
  strictEqual(
    generated.split(/\r?\n/).find((line) => line.length > 0),
    directive,
    `${relativeSource} retains the Unicode module directive`
  );

  for (const spelling of [
    '"emoji:😀"',
    '"combining:é"',
    `"separators:\u2028\u2029"`,
    '"./pkg/é😀.js"',
    "\\x00\\x1F"
  ]) {
    ok(
      generated.includes(spelling),
      `${relativeSource} lost literal spelling ${JSON.stringify(spelling)}`
    );
  }

  const consumer = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap);

  const directiveOriginal = consumer.originalPositionFor({ line: 1, column: 0 });
  ok(
    directiveOriginal.source?.endsWith("src/literalevidence/Main.hx"),
    `${relativeSource} directive maps to its Haxe module`
  );
  strictEqual(
    directiveOriginal.line,
    sourceLine('@:genes.moduleDirective("unicode-é-😀")'),
    `${relativeSource} directive maps to its metadata line`
  );

  const emoji = generatedLocation(generated, '"emoji:😀"');
  const emojiOriginal = consumer.originalPositionFor({
    ...emoji,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND
  });
  ok(
    emojiOriginal.source?.endsWith("src/literalevidence/Main.hx"),
    `${relativeSource} expression literal maps to its Haxe module`
  );
  strictEqual(
    emojiOriginal.line,
    sourceLine('{label: "emoji", value: "emoji:😀"}'),
    `${relativeSource} expression literal maps to its source line`
  );
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

run("haxe", ["tests/string-literals/build-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/string-literals/tsconfig.json");
run("haxe", ["tests/string-literals/build-classic.hxml"]);
run("haxe", ["tests/string-literals/build-standard.hxml"]);

const transcripts = {
  genesTs: capture("node", ["tests/string-literals/out/ts/dist/index.js"]),
  classic: capture("node", ["tests/string-literals/out/classic/index.js"]),
  standard: capture("node", ["tests/string-literals/out/standard/index.cjs"])
};
deepStrictEqual(transcripts, {
  genesTs: expected,
  classic: expected,
  standard: expected
});

assertGeneratedProfile("out/ts/src-gen/literalevidence/Main.ts");
assertGeneratedProfile("out/classic/literalevidence/Main.js");

const vanillaRoot = path.resolve(repoRoot, "../genes-vanilla");
let vanillaStatus = "pinned-baseline-only";
if (existsSync(path.join(vanillaRoot, ".git"))) {
  const baselineUnknown: unknown = JSON.parse(readFileSync(
    path.join(repoRoot, "tests/output-modes/vanilla-baseline.json"),
    "utf8"
  ));
  ok(isRecord(baselineUnknown), "Vanilla baseline must be an object");
  const baselineCommit = baselineUnknown.commit;
  ok(typeof baselineCommit === "string", "Vanilla baseline must name a commit");
  strictEqual(
    capture("git", ["-C", vanillaRoot, "rev-parse", "HEAD"]),
    baselineCommit,
    "Live original Genes checkout drifted from its reviewed baseline"
  );
  run("haxe", ["tests/string-literals/build-vanilla.hxml"]);
  strictEqual(
    capture("node", ["tests/string-literals/out/vanilla/index.js"]),
    expected,
    "Original Genes changed the literal code-unit transcript"
  );
  vanillaStatus = "live-original-genes";
}

const reflaxeVendor = path.resolve(
  repoRoot,
  "../haxe.elixir.codex/vendor/genes/src/genes/es/ExprEmitter.hx"
);
let vendorStatus = "vendor-not-present";
if (existsSync(reflaxeVendor)) {
  run("haxe", ["tests/string-literals/build-reflaxe-vendor.hxml"]);
  strictEqual(
    capture("node", ["tests/string-literals/out/reflaxe-vendor/index.js"]),
    expected,
    "Reflaxe.Elixir's indexed compiler-time walk changed literal code units"
  );
  vendorStatus = "live-reflaxe-vendor";
}

console.log(
  `string-literals:ok (standard + classic + genes-ts TS5/6/7 + ${vanillaStatus} + ${vendorStatus})`
);
