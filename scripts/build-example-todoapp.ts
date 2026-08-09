import assert from "node:assert/strict";
import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions
} from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.js";
import { assertNoUnsafeTypes } from "./typing-policy.js";
import {
  runGeneratedTypeScriptMatrix,
  runTypeScript
} from "./toolchains.js";

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

/**
 * Guards React 19's module-scoped JSX namespace without blanket imports.
 *
 * `ReactTypes` has no HXX expression of its own: its exported raw type
 * projections are the only reason that module needs `JSX`. `Todo` is the
 * negative control proving that configuring a JSX import source does not add
 * the type-only import to unrelated generated modules.
 */
function assertPreciseJsxNamespaceImport(extension: ".ts" | ".tsx"): void {
  const generated = path.join(exampleRoot, "web", "src-gen", "todo");
  const reactTypes = readFileSync(
    path.join(generated, "web", `ReactTypes${extension}`),
    "utf8"
  );
  const todo = readFileSync(
    path.join(generated, "shared", `Todo${extension}`),
    "utf8"
  );
  assert.match(reactTypes, /^import type \{JSX\} from "react"\n/);
  assert.doesNotMatch(todo, /^import type \{JSX\} from "react"\n/m);
}

/**
 * Proves the Todo externs follow React Router 8's canonical package boundary.
 *
 * Router 8 removed `react-router-dom`. A stale extern can still type-check
 * against an old transitive install, so every generated web variant must show
 * the new `react-router` request and must not retain the removed package name.
 */
function assertReactRouter8Imports(extension: ".ts" | ".tsx"): void {
  const generated = path.join(exampleRoot, "web", "src-gen", "todo");
  const modules = [
    path.join(generated, "web", `App${extension}`),
    path.join(generated, "web", `Router${extension}`),
    path.join(generated, "web", "pages", `TodoDetailPage${extension}`),
    path.join(generated, "web", "pages", `TodoListPage${extension}`)
  ].map(file => readFileSync(file, "utf8")).join("\n");

  assert.match(modules, /from "react-router"/);
  assert.doesNotMatch(modules, /react-router-dom/);
}

/**
 * The HTTP decoder guarantees that every update has at least one checked,
 * non-null field. Keep the generated Store surface from exposing an internal
 * nullable helper that would let TypeScript callers bypass that guarantee.
 */
function assertClosedStoreUpdateSurface(): void {
  const store = readFileSync(
    path.join(exampleRoot, "server", "src-gen", "todo", "server", "Store.ts"),
    "utf8"
  );
  assert.doesNotMatch(store, /\bupdateFields\s*\(/);
  assert.match(store, /\bupdateTitle\(id: string, title: string\)/);
  assert.match(store, /\bupdateCompleted\(id: string, completed: boolean\)/);
  assert.match(
    store,
    /\bupdateBoth\(id: string, title: string, completed: boolean\)/
  );
}

/**
 * Public Client methods own concrete Todo routes. A generic method/url/body
 * helper would let generated-TypeScript consumers bypass those checked shapes.
 */
function assertClosedClientRequestSurface(extension: ".ts" | ".tsx"): void {
  const client = readFileSync(
    path.join(exampleRoot, "web", "src-gen", "todo", "web", `Client${extension}`),
    "utf8"
  );
  assert.doesNotMatch(client, /\brequestJson\s*</);
  assert.match(client, /\bupdateTodoTitle\(id: string, title: string\)/);
  assert.match(client, /\bupdateTodoCompleted\(id: string, completed: boolean\)/);
}

/**
 * Haxe's ordinary JS mode permits null unless a project opts into null safety.
 * This negative compilation proves the maintained Todoapp does opt in and that
 * callers cannot send null through the concrete update helpers.
 */
function assertHaxeRejectsNullUpdate(): void {
  const outputFile = path.join(
    exampleRoot,
    "contracts",
    "null-update-negative.ts"
  );
  rmSync(outputFile, { force: true });
  try {
    const result = spawnSync(
      "haxe",
      ["examples/todoapp/contracts/build-null-update-negative.hxml"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.notEqual(result.status, 0, "null update unexpectedly compiled in Haxe");
    assert.match(output, /NullUpdateNegative[.]hx/);
    assert.match(output, /Null safety: Cannot pass nullable value/);
  } finally {
    rmSync(outputFile, { force: true });
  }
}

rmrf("web/src-gen");
rmrf("web/dist");
rmrf("server/src-gen");
rmrf("server/dist");
assertHaxeRejectsNullUpdate();

// Web: variants first (typecheck + snapshots), then build the default runnable app last.

// Variant: low-level React output (.ts + React.createElement).
run("haxe", ["examples/todoapp/web/build.lowlevel.hxml"]);
assertPreciseJsxNamespaceImport(".ts");
assertReactRouter8Imports(".ts");
assertClosedClientRequestSurface(".ts");
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
runTypeScript("legacyFloor", ["-p", "examples/todoapp/web/tsconfig.json"]);

// Variant: minimal runtime profile (still TSX output).
rmrf("web/src-gen");
run("haxe", ["examples/todoapp/web/build.minimal.hxml"]);
assertPreciseJsxNamespaceImport(".tsx");
assertReactRouter8Imports(".tsx");
assertClosedClientRequestSurface(".tsx");
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
runTypeScript("legacyFloor", ["-p", "examples/todoapp/web/tsconfig.json"]);

// Default build (runnable + bundled).
rmrf("web/src-gen");
run("haxe", ["examples/todoapp/web/build.hxml"]);
assertPreciseJsxNamespaceImport(".tsx");
assertReactRouter8Imports(".tsx");
assertClosedClientRequestSurface(".tsx");
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
runGeneratedTypeScriptMatrix("examples/todoapp/web/tsconfig.json");

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
    "--tsconfig=examples/todoapp/web/tsconfig.json",
    "--metafile=examples/todoapp/web/dist/esbuild-meta.json",
    "--outfile=examples/todoapp/web/dist/assets/app.js"
  ].join(" ")
]);

const typedBundleMetadata = readFileSync(
  path.join(exampleRoot, "web/dist/esbuild-meta.json"),
  "utf8"
);
assert.ok(
  typedBundleMetadata.includes(
    "examples/todoapp/web/src-gen/todo/shared/TodoText.tsx"
  ),
  "The TypeScript bundle must load TodoText from src-gen"
);
assert.ok(
  !typedBundleMetadata.includes("examples/todoapp/web/classic-src-gen/"),
  "The TypeScript bundle must not read the classic profile's generated tree"
);
rmSync(path.join(exampleRoot, "web/dist/esbuild-meta.json"));

// Server: minimal runtime is typechecked only (avoid overwriting the runnable build output).
rmrf("server/src-gen");
run("haxe", ["examples/todoapp/server/build.minimal.hxml"]);
assertClosedStoreUpdateSurface();
assertSnapshots({
  generatedDir: "examples/todoapp/server/src-gen",
  snapshotsDir: "examples/todoapp/server/dist-ts-minimal/src-gen",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/src-gen/todo",
  fileExts: [".ts"],
  // Express declares the transport value as unknown; ApiRequestDecoder is the
  // only application module allowed to inspect and narrow that value.
  allowUnsafeTypeFiles: [
    "extern/Express.ts",
    "server/ApiRequestDecoder.ts"
  ]
});
runTypeScript("legacyFloor", [
  "-p",
  "examples/todoapp/server/tsconfig.json",
  "--noEmit"
]);

// Default server build (runnable; emits JS + d.ts into server/dist).
rmrf("server/src-gen");
run("haxe", ["examples/todoapp/server/build.hxml"]);
assertClosedStoreUpdateSurface();
assertSnapshots({
  generatedDir: "examples/todoapp/server/src-gen",
  snapshotsDir: "examples/todoapp/server/dist-ts/src-gen",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/src-gen/todo",
  fileExts: [".ts"],
  allowUnsafeTypeFiles: [
    "extern/Express.ts",
    "server/ApiRequestDecoder.ts"
  ]
});
runGeneratedTypeScriptMatrix("examples/todoapp/server/tsconfig.json");
