import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

rmrf("tests_ts_minimal/src-gen");
rmrf("tests_ts_minimal/dist");

run("haxe", ["tests_ts_minimal/build.hxml"]);

// Use a pinned TypeScript version for consistent behavior.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_ts_minimal/tsconfig.json"
]);

run("node", ["tests_ts_minimal/dist/index.js"]);
