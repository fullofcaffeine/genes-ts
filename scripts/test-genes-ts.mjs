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

rmrf("tests_ts/src-gen");
rmrf("tests_ts/dist");

run("haxe", ["tests_ts/build.hxml"]);

// Use a pinned TypeScript version for consistent behavior.
// Note: `npx typescript@X tsc -p ...` is ambiguous in some npm versions.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_ts/tsconfig.json"
]);

run("node", ["tests_ts/dist/index.js"]);
