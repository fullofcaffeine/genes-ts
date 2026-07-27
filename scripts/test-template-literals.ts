import {deepStrictEqual, ok, strictEqual} from "node:assert";
import {Buffer} from "node:buffer";
import {execFileSync, spawnSync, type ExecFileSyncOptions} from "node:child_process";
import {existsSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runGeneratedTypeScriptMatrix} from "./toolchains.js";

/**
 * Why: source snapshots alone cannot prove TypeScript contextual typing or
 * same-source classic runtime behavior.
 *
 * What: this harness checks exact positive/negative source shapes, compiles a
 * strict external consumer on every supported TypeScript lane, compares TS and
 * classic runtime transcripts, and requires the invalid-authoring diagnostic.
 *
 * How: both profiles start from one Haxe module. Assertions reject carrier,
 * assertion, and ordinary-concatenation regressions before executing output.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/template-literals");

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
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .at(-1);
  if (line === undefined) {
    throw new Error("template-literal fixture produced no runtime report");
  }
  return JSON.parse(line);
}

/** Captures every published byte below one fixture output directory. */
function snapshotTree(root: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  function walk(directory: string): void {
    if (!existsSync(directory)) return;
    const entries = readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        result.set(path.relative(root, absolute).split(path.sep).join("/"),
          readFileSync(absolute));
      }
    }
  }
  walk(root);
  return result;
}

/**
 * Runs one late-materialization negative and returns its complete diagnostic.
 *
 * The optional blocker deliberately fails during implementation preflight.
 * A retained malformed template body must be diagnosed earlier, while a body
 * removed by Haxe DCE cannot become a late template-plan input.
 */
function lateFailure(hxml: string, keepMarker: boolean): string {
  const defines = ["-D", "late_template_blocker"];
  if (keepMarker) defines.push("-D", "late_template_keep_marker");
  const result = spawnSync("haxe", [hxml, ...defines], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  strictEqual(result.status, 1, `${hxml}: late characterization must fail`);
  return `${result.stdout}${result.stderr}`;
}

rmSync(path.join(fixtureRoot, "out"), {recursive: true, force: true});

run("haxe", ["tests/template-literals/build-ts.hxml"]);
run("haxe", ["tests/template-literals/build-classic.hxml"]);
run("haxe", ["tests/template-literals/build-late-materialization.hxml"]);
run("haxe", [
  "tests/template-literals/build-late-materialization-classic.hxml"
]);

const tsSource = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/template_literals/Main.ts"),
  "utf8"
);
const classicSource = readFileSync(
  path.join(fixtureRoot, "out/classic/template_literals/Main.js"),
  "utf8"
);

ok(
  tsSource.includes("return `/records/${encodeURIComponent(id)}`"),
  "genes-ts did not emit a native template literal"
);
ok(
  tsSource.includes('return "/records/" + encodeURIComponent(id)'),
  "ordinary Haxe interpolation control unexpectedly changed"
);
ok(
  tsSource.includes("return `${value}`"),
  "genes-ts rejected or rewrote a template with no static text"
);
ok(
  tsSource.includes("return `/${prefix + count}/end`"),
  "genes-ts split a compound interpolation into multiple template slots"
);
ok(
  classicSource.includes('"/records/" + (encodeURIComponent(id)) + ""'),
  "classic Genes did not emit ordered string concatenation"
);
ok(
  classicSource.includes('"" + (value) + ""'),
  "classic Genes rejected a template with no static text"
);
ok(
  classicSource.includes('"/" + (prefix + count) + "/end"'),
  "classic Genes reassociated a compound interpolation with template chunks"
);
for (const [profile, source] of [
  ["genes-ts", tsSource],
  ["classic", classicSource]
] as const) {
  ok(
    source.includes('return "/about"'),
    `${profile} did not erase the static template to a literal`
  );
}
for (const [profile, source] of [
  ["genes-ts", tsSource],
  ["classic", classicSource]
] as const) {
  strictEqual(
    source.includes("TemplateLiteral"),
    false,
    `${profile} leaked the compiler marker or helper dependency`
  );
  strictEqual(
    source.includes("Register.unsafeCast"),
    false,
    `${profile} introduced an assertion for a typed template`
  );
  strictEqual(
    /\b(?:any|unknown)\b/.test(source),
    false,
    `${profile} weakened the generated user module type surface`
  );
}

runGeneratedTypeScriptMatrix("tests/template-literals/tsconfig.json");

const expected = {
  href: "/records/a%20b%2Fc",
  staticHref: "/about",
  pureInterpolation: "whole",
  compoundInterpolation: "/item-7/end",
  escaped: "tick`|slash\\|literal ${brace}|line\nFIRST|SECOND",
  events: ["first", "second"]
};
const tsReport = parseReport(
  capture("node", ["tests/template-literals/out/ts/dist/out/ts/src-gen/index.js"])
);
const classicReport = parseReport(
  capture("node", ["tests/template-literals/out/classic/index.js"])
);
deepStrictEqual(tsReport, expected);
deepStrictEqual(classicReport, expected);

for (const profile of [
  {
    name: "genes-ts",
    hxml: "tests/template-literals/build-late-materialization.hxml",
    output: path.join(fixtureRoot, "out/late"),
    implementation: path.join(
      fixtureRoot,
      "out/late/template_late/ZLateOwner.ts"
    )
  },
  {
    name: "classic",
    hxml: "tests/template-literals/build-late-materialization-classic.hxml",
    output: path.join(fixtureRoot, "out/late-classic"),
    implementation: path.join(
      fixtureRoot,
      "out/late-classic/template_late/ZLateOwner.js"
    )
  }
] as const) {
  const source = readFileSync(profile.implementation, "utf8");
  ok(
    source.includes("class ZLateTemplate"),
    `${profile.name}: signature-only class was not materialized`
  );
  ok(
    !source.includes("malformed()") && !source.includes("TemplateLiteralMarker"),
    `${profile.name}: Haxe-DCE-removed method body entered late output`
  );

  const baseline = snapshotTree(profile.output);
  const removedBodyFailure = lateFailure(profile.hxml, false);
  ok(
    removedBodyFailure.includes("GENES-MODULE-FUNCTION-SHAPE-006"),
    `${profile.name}: control error did not reach implementation preflight`
  );
  ok(
    !removedBodyFailure.includes("GENES-TEMPLATE-LITERAL-MARKER-002"),
    `${profile.name}: removed body unexpectedly entered template planning`
  );
  deepStrictEqual(
    snapshotTree(profile.output),
    baseline,
    `${profile.name}: failed control build changed the published tree`
  );

  const retainedBodyFailure = lateFailure(profile.hxml, true);
  ok(
    retainedBodyFailure.includes("GENES-TEMPLATE-LITERAL-MARKER-002"),
    `${profile.name}: retained malformed body escaped initial template planning`
  );
  ok(
    !retainedBodyFailure.includes("GENES-MODULE-FUNCTION-SHAPE-006"),
    `${profile.name}: unrelated implementation preflight masked template validation`
  );
  deepStrictEqual(
    snapshotTree(profile.output),
    baseline,
    `${profile.name}: malformed retained body changed the published tree`
  );
}

const invalid = spawnSync("haxe", ["tests/template-literals/build-invalid.hxml"], {
  cwd: repoRoot,
  encoding: "utf8"
});
strictEqual(invalid.status, 1, "arbitrary String input unexpectedly compiled");
const invalidOutput = `${invalid.stdout}${invalid.stderr}`;
ok(
  invalidOutput.includes("GENES-TEMPLATE-LITERAL-AUTHORING-001"),
  `invalid input did not report the focused diagnostic:\n${invalidOutput}`
);

console.log(
  "template-literals:ok (typed TS + classic runtime + late-materialization boundary)"
);
