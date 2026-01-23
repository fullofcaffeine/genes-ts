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

rmrf("tests_tsx/src-gen-tsx");
rmrf("tests_tsx/dist-tsx");
rmrf("tests_tsx/src-gen-ts");
rmrf("tests_tsx/dist-ts");

run("haxe", ["tests_tsx/build-tsx.hxml"]);
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_tsx/tsconfig.tsx.json"
]);
run("node", ["tests_tsx/dist-tsx/index.js"]);

rmrf("tests_tsx/src-gen-tsx");
rmrf("tests_tsx/dist-tsx");
run("haxe", ["tests_tsx/build-tsx.hxml", "-D", "genes.ts.jsx_classic"]);
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_tsx/tsconfig.tsx.classic.json"
]);
run("node", ["tests_tsx/dist-tsx/index.js"]);

run("haxe", ["tests_tsx/build-ts.hxml"]);
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_tsx/tsconfig.ts.json"
]);
run("node", ["tests_tsx/dist-ts/index.js"]);
