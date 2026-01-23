import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function rmrf(relPath) {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

rmrf("tests_ts/src-gen");
run("haxe", ["tests_ts/build.hxml"]);
assertDirSnapshots({
  repoRoot,
  generatedDir: "tests_ts/src-gen",
  snapshotsDir: "tests_snapshots/tests_ts",
  fileExts: [".ts"]
});

rmrf("tests_ts_minimal/src-gen");
run("haxe", ["tests_ts_minimal/build.hxml"]);
assertDirSnapshots({
  repoRoot,
  generatedDir: "tests_ts_minimal/src-gen",
  snapshotsDir: "tests_snapshots/tests_ts_minimal",
  fileExts: [".ts"]
});

