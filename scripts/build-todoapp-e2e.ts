import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";
import { runTypeScript } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const e2eRoot = path.join(repoRoot, "examples", "todoapp", "e2e");

function rmrf(relPath: string): void {
  rmSync(path.join(e2eRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

rmrf("src-gen");
rmrf("dist");

run("haxe", ["examples/todoapp/e2e/build.hxml"]);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/e2e/src-gen/tests/todo",
  fileExts: [".ts"]
});

runTypeScript("legacyFloor", ["-p", "examples/todoapp/e2e/tsconfig.json"]);
