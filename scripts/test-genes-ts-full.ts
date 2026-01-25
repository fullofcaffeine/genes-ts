import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

function ensureClassicTestArtifacts(): void {
  const jsPath = path.join(repoRoot, "bin", "tests.js");
  const dtsPath = path.join(repoRoot, "bin", "tests.d.ts");

  if (existsSync(jsPath) && existsSync(dtsPath)) return;

  // `tests/genes-ts/full` reuses some of the classic Genes tests (e.g. TestExpose)
  // which assert against the generated `bin/tests.js` + `bin/tests.d.ts`.
  // When running in CI with `SKIP_CLASSIC=1`, those artifacts may not exist yet.
  // Compile them here (without executing the runtime test suite).
  run("haxe", ["test.hxml"]);
}

ensureClassicTestArtifacts();

rmrf("tests/genes-ts/full/out");

run("haxe", ["tests/genes-ts/full/build.hxml"]);

// Runtime fixtures needed for dynamic `@:jsRequire('../../tests/…')` modules.
// These must be present both for `tsc` module resolution and for Node at runtime.
const outRoot = path.join(repoRoot, "tests/genes-ts/full/out");
mkdirSync(path.join(outRoot, "tests"), { recursive: true });
cpSync(path.join(repoRoot, "tests/genes-ts/full/tests"), path.join(outRoot, "tests"), {
  recursive: true
});

// Use a pinned TypeScript version for consistent behavior.
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p tests/genes-ts/full/tsconfig.json"]);

run("node", ["tests/genes-ts/full/out/dist/index.js"]);
