import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
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

rmrf("tests/genes-ts/snapshot/minimal/out");

run("haxe", ["tests/genes-ts/snapshot/minimal/build.hxml"]);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/minimal/out/src-gen",
  fileExts: [".ts"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink"]
});

// Use a pinned TypeScript version for consistent behavior.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/minimal/tsconfig.json"
]);

run("node", ["tests/genes-ts/snapshot/minimal/out/dist/index.js"]);
