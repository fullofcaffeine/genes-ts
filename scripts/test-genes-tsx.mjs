import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
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

function copyTsxFixtures(intoRelDir) {
  const fixturesDir = path.join(repoRoot, "tests_tsx", "fixtures");
  const destDir = path.join(repoRoot, intoRelDir);

  // Copy required local TSX files into the generated source dir so `tsc`
  // can resolve local TS/TSX imports from genes output.
  const srcButton = path.join(fixturesDir, "components", "Button.tsx");
  const destButton = path.join(destDir, "components", "Button.tsx");
  mkdirSync(path.dirname(destButton), { recursive: true });
  cpSync(srcButton, destButton);
}

rmrf("tests_tsx/src-gen-tsx");
rmrf("tests_tsx/dist-tsx");
rmrf("tests_tsx/src-gen-ts");
rmrf("tests_tsx/dist-ts");

run("haxe", ["tests_tsx/build-tsx.hxml"]);
copyTsxFixtures("tests_tsx/src-gen-tsx");
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
copyTsxFixtures("tests_tsx/src-gen-tsx");
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_tsx/tsconfig.tsx.classic.json"
]);
run("node", ["tests_tsx/dist-tsx/index.js"]);

run("haxe", ["tests_tsx/build-ts.hxml"]);
copyTsxFixtures("tests_tsx/src-gen-ts");
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests_tsx/tsconfig.ts.json"
]);
run("node", ["tests_tsx/dist-ts/index.js"]);
