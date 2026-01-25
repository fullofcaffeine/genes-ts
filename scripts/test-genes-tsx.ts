import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";

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
  const srcButton = path.join(fixturesDir, "components", "Button.tsx");
  const destButton = path.join(destDir, "components", "Button.tsx");
  mkdirSync(path.dirname(destButton), { recursive: true });
  cpSync(srcButton, destButton);
}

rmrf("tests/genes-ts/snapshot/react/out/tsx");
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
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/react/tsconfig.tsx.json"
]);
run("node", ["tests/genes-ts/snapshot/react/out/tsx/dist/index.js"]);

rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
run("haxe", ["tests/genes-ts/snapshot/react/build-tsx-classic.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx-classic/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx-classic/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/react/tsconfig.tsx.classic.json"
]);
run("node", ["tests/genes-ts/snapshot/react/out/tsx-classic/dist/index.js"]);

run("haxe", ["tests/genes-ts/snapshot/react/build-ts.hxml"]);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/ts/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/ts/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/react/tsconfig.ts.json"
]);
run("node", ["tests/genes-ts/snapshot/react/out/ts/dist/index.js"]);
