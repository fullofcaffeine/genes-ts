import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

// Use a pinned TypeScript version for consistent behavior.
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/e2e/tsconfig.json"]);

