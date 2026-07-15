import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
 * handler, a bad component prop, and an invalid intrinsic attribute. TypeScript
 * reports unused `@ts-expect-error` directives, so the following `tsc` run
 * fails if any generated JSX surface widens enough to accept those operations.
 */
function assertJsxNegativeConsumer(relFile: string): void {
  const source = readFileSync(path.join(repoRoot, relFile), "utf8");
  const directiveCount = source.match(/@ts-expect-error/g)?.length ?? 0;
  if (directiveCount !== 3) {
    throw new Error(`${relFile} must emit exactly three JSX negative-consumer directives; got ${directiveCount}.`);
  }
}

rmrf("tests/genes-ts/snapshot/react/out/tsx");
rmrf("tests/genes-ts/snapshot/react/out/tsx-jsx-source");
rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
rmrf("tests/genes-ts/snapshot/react/out/ts");

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
