import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.js";
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

type SnapshotSpec = {
  generatedDir: string;
  snapshotsDir: string;
  fileExts: ReadonlyArray<string>;
};

function assertSnapshots(spec: SnapshotSpec): void {
  assertDirSnapshots({
    repoRoot,
    generatedDir: spec.generatedDir,
    snapshotsDir: spec.snapshotsDir,
    fileExts: [...spec.fileExts],
    updateHint: "UPDATE_SNAPSHOTS=1 yarn build:example:todoapp"
  });
}

rmrf("web/src-gen");
rmrf("web/dist");
rmrf("server/src-gen");
rmrf("server/dist");

// Web: variants first (typecheck + snapshots), then build the default runnable app last.

// Variant: low-level React output (.ts + React.createElement).
run("haxe", ["examples/todoapp/web/build.lowlevel.hxml"]);
assertSnapshots({
  generatedDir: "examples/todoapp/web/src-gen",
  snapshotsDir: "examples/todoapp/web/dist-ts-lowlevel/src-gen",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/web/src-gen/todo",
  fileExts: [".ts"]
});
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/web/tsconfig.json"]);

// Variant: minimal runtime profile (still TSX output).
rmrf("web/src-gen");
run("haxe", ["examples/todoapp/web/build.minimal.hxml"]);
assertSnapshots({
  generatedDir: "examples/todoapp/web/src-gen",
  snapshotsDir: "examples/todoapp/web/dist-ts-minimal/src-gen",
  fileExts: [".ts", ".tsx"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/web/src-gen/todo",
  fileExts: [".ts", ".tsx"]
});
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/web/tsconfig.json"]);

// Default build (runnable + bundled).
rmrf("web/src-gen");
run("haxe", ["examples/todoapp/web/build.hxml"]);
assertSnapshots({
  generatedDir: "examples/todoapp/web/src-gen",
  snapshotsDir: "examples/todoapp/web/dist-ts/src-gen",
  fileExts: [".ts", ".tsx"]
});
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

// Server: minimal runtime is typechecked only (avoid overwriting the runnable build output).
rmrf("server/src-gen");
run("haxe", ["examples/todoapp/server/build.minimal.hxml"]);
assertSnapshots({
  generatedDir: "examples/todoapp/server/src-gen",
  snapshotsDir: "examples/todoapp/server/dist-ts-minimal/src-gen",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/src-gen/todo",
  fileExts: [".ts"]
});
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p examples/todoapp/server/tsconfig.json --noEmit"
]);

// Default server build (runnable; emits JS + d.ts into server/dist).
rmrf("server/src-gen");
run("haxe", ["examples/todoapp/server/build.hxml"]);
assertSnapshots({
  generatedDir: "examples/todoapp/server/src-gen",
  snapshotsDir: "examples/todoapp/server/dist-ts/src-gen",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/src-gen/todo",
  fileExts: [".ts"]
});
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p examples/todoapp/server/tsconfig.json"]);
