import {ok, strictEqual} from "node:assert";
import {execFileSync, spawnSync, type ExecFileSyncOptions} from "node:child_process";
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {assertNoUnsafeTypes} from "./typing-policy.js";
import {runGeneratedTypeScriptMatrix} from "./toolchains.js";

/**
 * Verifies the safe direction of React event callback variance in HXX.
 *
 * Why: HXX must retain phantom React generic arguments, but exact equality is
 * stricter than JavaScript callback safety requires. A handler may accept a
 * broader event family or target element; it may not require a narrower one.
 *
 * What: positive builds prove broad handlers in both output profiles. Negative
 * builds cover narrower and sibling families/targets with exact Haxe source
 * diagnostics and output rollback.
 *
 * How: generated TypeScript is checked on every supported TS lane and both
 * outputs are executed. The source assertions ensure the compiler keeps
 * canonical React and browser types instead of weakening the callback.
 */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repoRoot, "tests/hxx-event-variance");
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

function runtimeReport(relativeFile: string): string {
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

run("haxe", ["tests/hxx-event-variance/build-ts.hxml"]);
run("haxe", ["tests/hxx-event-variance/build-classic.hxml"]);
runGeneratedTypeScriptMatrix("tests/hxx-event-variance/tsconfig.json");

const generated = readFileSync(
  path.join(fixtureRoot, "out/ts/src-gen/hxx_event_variance/Main.tsx"),
  "utf8"
);
ok(generated.includes("SyntheticEvent<HTMLElement>"),
  "the broad family/target handler keeps React's canonical generic type");
ok(generated.includes("MouseEvent<HTMLElement>"),
  "the broad target handler keeps React's canonical mouse-event type");
ok(generated.includes("SyntheticEvent<HTMLAnchorElement>"),
  "the broad family handler keeps the exact anchor target");
ok(generated.includes("SyntheticEvent<GeneralTarget>"),
  "ordinary Haxe target inheritance remains visible in the React type");
ok(generated.includes("SyntheticEvent<TargetView<string>>"),
  "generic interface target inheritance remains visible in the React type");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/hxx-event-variance/out/ts/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js"]
});

const expected = JSON.stringify({
  html: "<div><a>family and target</a><a>target</a>"
    + "<a>family</a><a>standard target</a>"
    + "<span>nominal target</span>"
    + "<span>generic interface target</span></div>"
});
strictEqual(
  runtimeReport("tests/hxx-event-variance/out/ts/dist/index.js"),
  expected
);
strictEqual(
  runtimeReport("tests/hxx-event-variance/out/classic/index.js"),
  expected
);

const invalidSource = readFileSync(
  path.join(fixtureRoot, "invalid/Invalid.hx"),
  "utf8"
).split(/\r?\n/);
const cases = [
  ["hxx_event_narrow_target", "<div onClick={needsAnchor}"],
  ["hxx_event_narrow_family", "<form onSubmit={needsMouse}"],
  ["hxx_event_sibling_family", "<button onClick={needsChange}"],
  ["hxx_event_sibling_target", "<a onClick={needsInput}"],
  ["hxx_event_generic_interface_mismatch",
    "<InterfaceEventSink onEvent={needsWrongInterface}"]
] as const;
const profiles = [
  {
    name: "genes-ts",
    hxml: "tests/hxx-event-variance/build-invalid.hxml",
    output: path.join(fixtureRoot, "out/invalid/index.tsx")
  },
  {
    name: "classic",
    hxml: "tests/hxx-event-variance/build-invalid-classic.hxml",
    output: path.join(fixtureRoot, "out/invalid-classic/index.js")
  }
] as const;

for (const [define, sourceText] of cases) {
  const sourceLine = invalidSource.findIndex((line) =>
    line.includes(sourceText)
  ) + 1;
  ok(sourceLine > 0, `${define} has no '${sourceText}' source line`);
  for (const profile of profiles) {
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
    ok(output.includes("[GTS-HXX-PROP-002]"),
      `${label} did not report callback incompatibility:\n${output}`);
    ok(output.includes(`Invalid.hx:${sourceLine}:`),
      `${label} did not point to authored HXX line ${sourceLine}:\n${output}`);
    strictEqual(readFileSync(profile.output, "utf8"), sentinel,
      `${label} changed the prior public output despite failing`);
  }
}

console.log(
  "hxx-event-variance:ok (broader family/target acceptance; narrow/sibling rejection; TS 5/6/7; dual runtime; rollback)"
);
