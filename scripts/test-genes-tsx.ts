import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
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

function parseTranscript(output: string): unknown {
  const line = output
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .at(-1);
  if (line === undefined) {
    throw new Error("JSX differential fixture produced no transcript");
  }
  return JSON.parse(line) as unknown;
}

function copyTsxFixtures(intoRelDir: string): void {
  const fixturesDir = path.join(repoRoot, "tests/genes-ts/snapshot/react/fixtures");
  const destDir = path.join(repoRoot, intoRelDir);

  // Copy required local TSX files into the generated source dir so `tsc`
  // can resolve local TS/TSX imports from genes output.
  function copyDir(src: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(destDir, path.relative(fixturesDir, srcPath));
      if (entry.isDirectory()) {
        copyDir(srcPath);
      } else if (entry.isFile()) {
        mkdirSync(path.dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath);
      }
    }
  }

  copyDir(fixturesDir);
}

/**
 * Keeps the React fixture genuinely negative, not merely type-checking.
 *
 * Each directive must suppress a real TypeScript error: a bad intrinsic event
 * handler, a bad component prop, an invalid intrinsic attribute, and an invalid
 * child. TypeScript reports unused `@ts-expect-error` directives, so the
 * following `tsc` run fails if any generated JSX surface widens enough to
 * accept those operations.
 */
function assertJsxNegativeConsumer(relFile: string): void {
  const source = readFileSync(path.join(repoRoot, relFile), "utf8");
  const directiveCount = source.match(/@ts-expect-error/g)?.length ?? 0;
  if (directiveCount !== 4) {
    throw new Error(`${relFile} must emit exactly four JSX negative-consumer directives; got ${directiveCount}.`);
  }
}

rmrf("tests/genes-ts/snapshot/react/out/tsx");
rmrf("tests/genes-ts/snapshot/react/out/tsx-jsx-source");
rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
rmrf("tests/genes-ts/snapshot/react/out/ts");
rmrf("tests/genes-ts/snapshot/react/out/dual-tsx");
rmrf("tests/genes-ts/snapshot/react/out/dual-classic");
rmrf("tests/genes-ts/snapshot/react/out/dual-disabled");

run("haxe", ["tests/genes-ts/snapshot/react/build-tsx.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
assertJsxNegativeConsumer("tests/genes-ts/snapshot/react/out/tsx/src-gen/Main.tsx");
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx/dist/index.js"]);

run("haxe", ["tests/genes-ts/snapshot/react/build-tsx-jsx-source.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
assertJsxNegativeConsumer("tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen/Main.tsx");
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx-jsx-source.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx-jsx-source/dist/index.js"]);

rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
run("haxe", ["tests/genes-ts/snapshot/react/build-tsx-classic.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx-classic/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx-classic/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
assertJsxNegativeConsumer("tests/genes-ts/snapshot/react/out/tsx-classic/src-gen/Main.tsx");
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx.classic.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx-classic/dist/index.js"]);

run("haxe", ["tests/genes-ts/snapshot/react/build-ts.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/ts/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/ts/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
assertJsxNegativeConsumer("tests/genes-ts/snapshot/react/out/ts/src-gen/Main.ts");
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.ts.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/ts/dist/index.js"]);

// One Haxe source file now owns a runtime differential between real TSX and
// classic ESM. Static intent remains readable TSX, while a runtime string tag
// deliberately exercises the shared createElement capability in both modes.
run("haxe", ["tests/genes-ts/snapshot/react/build-dual-tsx.hxml"]);
const dualTsxSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/dual-tsx/src-gen/DualJsxMain.tsx"),
  "utf8"
);
ok(dualTsxSource.includes("<main {...rootProps}>"));
ok(dualTsxSource.includes("React__genes_jsx.createElement(runtimeTag"));
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.dual-tsx.json"
);

run("haxe", ["tests/genes-ts/snapshot/react/build-dual-classic.hxml"]);
const dualClassicSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/dual-classic/DualJsxMain.js"),
  "utf8"
);
ok(dualClassicSource.includes('import * as React__genes_jsx from "react"'));
ok(dualClassicSource.includes("React__genes_jsx.createElement(\"main\""));
strictEqual(dualClassicSource.includes("Jsx.__jsx"), false);

const expectedTranscript = {
  staticHtml: '<main class="shared" id="root"><h1>dual</h1><span>A</span><span>B</span></main>',
  dynamicHtml: '<aside data-mode="dynamic">D</aside>',
  evaluatedHtml: '<div title="evaluated-once">E</div>',
  arrayPropHtml: '<div data-array="evaluated-once">P</div>',
  arrayChildHtml: '<div>evaluated-once</div>',
  propEvaluations: 3
};
const tsxTranscript = parseTranscript(
  capture("node", ["tests/genes-ts/snapshot/react/out/dual-tsx/dist/index.js"])
);
const classicTranscript = parseTranscript(
  capture("node", ["tests/genes-ts/snapshot/react/out/dual-classic/index.js"])
);
deepStrictEqual(tsxTranscript, expectedTranscript);
deepStrictEqual(classicTranscript, expectedTranscript);

// Disabling the required classic runtime is an explicit capability choice. It
// must diagnose the original Haxe source and commit no partial output tree.
const unsupported = spawnSync(
  "haxe",
  ["tests/genes-ts/snapshot/react/build-dual-classic-disabled.hxml"],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(unsupported.status === 0, false);
const unsupportedOutput = `${unsupported.stdout}${unsupported.stderr}`;
ok(unsupportedOutput.includes("[GTS-JSX-CAPABILITY-001]"));
ok(unsupportedOutput.includes("DualJsxMain.hx:"));
const disabledOutput = path.join(
  repoRoot,
  "tests/genes-ts/snapshot/react/out/dual-disabled"
);
if (existsSync(disabledOutput)) {
  deepStrictEqual(readdirSync(disabledOutput), []);
}
