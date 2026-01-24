import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const exampleRoot = path.join(repoRoot, "examples", "todoapp");

function rmrf(relPath: string): void {
  rmSync(path.join(exampleRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

rmrf("web/src-gen");
rmrf("web/dist");
rmrf("server/src-gen");
rmrf("server/dist");

run("haxe", ["examples/todoapp/web/build.hxml"]);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/web/src-gen/todo",
  fileExts: [".ts", ".tsx"]
});
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/web/tsconfig.json"]);

mkdirSync(path.join(exampleRoot, "web", "dist", "assets"), { recursive: true });
copyFileSync(path.join(exampleRoot, "web", "index.html"), path.join(exampleRoot, "web", "dist", "index.html"));

run("npx", [
  "-y",
  "--package",
  "esbuild@0.20.2",
  "-c",
  [
    "esbuild",
    "examples/todoapp/web/src-gen/index.tsx",
    "--bundle",
    "--sourcemap",
    "--format=esm",
    "--platform=browser",
    "--outfile=examples/todoapp/web/dist/assets/app.js"
  ].join(" ")
]);

run("haxe", ["examples/todoapp/server/build.hxml"]);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/src-gen/todo",
  fileExts: [".ts"]
});
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/server/tsconfig.json"]);
