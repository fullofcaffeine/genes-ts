import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const exampleRoot = path.join(repoRoot, "examples", "typescript-target");

function rmrf(relPath) {
  rmSync(path.join(exampleRoot, relPath), { recursive: true, force: true });
}

function run(cmd, args, opts = {}) {
  const cwd = opts.cwd ?? exampleRoot;
  const { cwd: _cwdIgnored, ...rest } = opts;
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    ...rest
  });
}

rmrf("src-gen");
rmrf("dist");

// Run Haxe from the repo root so `-lib genes` resolves its `extraParams.hxml`
// include correctly (the in-repo `haxe_libraries/genes.hxml` uses a relative
// include).
run(
  "haxe",
  [
    "-lib",
    "genes",
    "-cp",
    "examples/typescript-target/src",
    "--main",
    "my.app.Main",
    "-js",
    "examples/typescript-target/src-gen/index.ts",
    "-D",
    "genes.ts"
  ],
  { cwd: repoRoot }
);

// Use a pinned TypeScript version for consistent behavior.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tsconfig.node-next.json"
]);

run("node", ["dist/index.js"]);
