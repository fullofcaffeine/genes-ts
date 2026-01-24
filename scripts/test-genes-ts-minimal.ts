import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.js";

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

rmrf("tests_ts_minimal/src-gen");
rmrf("tests_ts_minimal/dist");

run("haxe", ["tests_ts_minimal/build.hxml"]);
assertDirSnapshots({
  repoRoot,
  generatedDir: "tests_ts_minimal/src-gen",
  snapshotsDir: "tests_snapshots/tests_ts_minimal",
  fileExts: [".ts"]
});

// Use a pinned TypeScript version for consistent behavior.
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p tests_ts_minimal/tsconfig.json"]);

run("node", ["tests_ts_minimal/dist/index.js"]);

