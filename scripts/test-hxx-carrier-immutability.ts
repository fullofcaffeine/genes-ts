import {deepStrictEqual, ok, strictEqual} from "node:assert";
import {execFileSync, spawnSync, type ExecFileSyncOptions} from "node:child_process";
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runGeneratedTypeScriptMatrix} from "./toolchains.js";

/**
 * Why: HXX carrier records contain both runtime values and compile-time JSX
 * structure. If authored code changes or shares one after construction,
 * `JsxPlan` could validate one property name while JavaScript observes another.
 *
 * What: this harness proves untouched local carriers still evaluate once in
 * both output profiles. It also checks direct property/child mutation and
 * mutation through a marker-bound alias. Every unsafe case must fail with one
 * stable diagnostic before an existing output file is replaced.
 *
 * How: positive builds are type-checked and executed. Negative builds reuse a
 * sentinel output path; byte equality after each failure demonstrates that the
 * normal compiler output transaction remained in control.
 */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repoRoot, "tests/hxx-carrier-immutability");
const sentinel = "existing output must survive\n";

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

function runtimeJson(relativeFile: string): string {
  const output = execFileSync("node", [relativeFile], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);
  if (line === undefined) {
    throw new Error(`${relativeFile} produced no runtime report`);
  }
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`${relativeFile} produced no JSON object: ${line}`);
  }
  return line.slice(jsonStart);
}

rmSync(path.join(fixtureRoot, "out"), {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 50
});

run("haxe", ["tests/hxx-carrier-immutability/build-ts.hxml"]);
run("haxe", ["tests/hxx-carrier-immutability/build-classic.hxml"]);
runGeneratedTypeScriptMatrix("tests/hxx-carrier-immutability/tsconfig.json");

const expected = {
  html: '<div title="kept">carrier child</div>',
  evaluations: 1
};
deepStrictEqual(
  JSON.parse(runtimeJson("tests/hxx-carrier-immutability/out/ts/dist/index.js")),
  expected
);
deepStrictEqual(
  JSON.parse(runtimeJson("tests/hxx-carrier-immutability/out/classic/index.js")),
  expected
);

const invalidSource = readFileSync(
  path.join(fixtureRoot, "invalid/Invalid.hx"),
  "utf8"
).split(/\r?\n/);
const cases = [
  ["hxx_carrier_mutate_name", "props.__genesJsxPropName"],
  ["hxx_carrier_mutate_value", "props.__genesJsxPropValue"],
  ["hxx_carrier_mutate_child", "children.__genesJsxChildValue"],
  ["hxx_carrier_mutate_alias", "sharedProps.__genesJsxPropName"]
] as const;
const invalidProfiles = [
  {
    name: "genes-ts",
    hxml: "tests/hxx-carrier-immutability/build-invalid.hxml",
    output: path.join(fixtureRoot, "out/invalid/index.ts")
  },
  {
    name: "classic",
    hxml: "tests/hxx-carrier-immutability/build-invalid-classic.hxml",
    output: path.join(fixtureRoot, "out/invalid-classic/index.js")
  }
] as const;

for (const [define, sourceText] of cases) {
  const sourceLine = invalidSource.findIndex((line) =>
    line.includes(sourceText)
  ) + 1;
  ok(sourceLine > 0, `${define} has no '${sourceText}' source line`);
  for (const profile of invalidProfiles) {
    mkdirSync(path.dirname(profile.output), {recursive: true});
    writeFileSync(profile.output, sentinel);

    const result = spawnSync(
      "haxe",
      [profile.hxml, "-D", define],
      {cwd: repoRoot, encoding: "utf8"}
    );
    const label = `${profile.name} ${define}`;
    strictEqual(result.status === 0, false, `${label} unexpectedly compiled`);
    const output = `${result.stdout}${result.stderr}`;
    ok(
      output.includes("[GTS-JSX-INTENT-010]"),
      `${label} did not report the carrier-ownership diagnostic:\n${output}`
    );
    ok(
      output.includes(`Invalid.hx:${sourceLine}:`),
      `${label} did not point to the unsafe carrier use on line ${sourceLine}:\n${output}`
    );
    strictEqual(
      readFileSync(profile.output, "utf8"),
      sentinel,
      `${label} changed the prior public output despite failing`
    );
  }
}

console.log(
  "hxx-carrier-immutability:ok (typed TS + classic runtime; prop/child/alias mutation rejection; rollback)"
);
