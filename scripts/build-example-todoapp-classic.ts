import { doesNotMatch, match, ok } from "node:assert";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { assertNoUnsafeTypes } from "./typing-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Builds the fullstack todoapp directly as modern classic Genes ESM.
 *
 * Why: the todoapp is the real-world proof that `genes.ts` enriches one Haxe
 * program rather than creating a TypeScript-only dialect. Its existing TS/TSX
 * profiles were strong, but they did not continuously prove the same React,
 * npm interop, server, and shared-domain source could erase to runnable JS.
 *
 * What: web and server compile into isolated classic trees, declarations are
 * consumed by every supported TypeScript lane, and the browser entry is bundled
 * with the same authored TSX dependencies as the TS profile.
 *
 * How: shared JSX intent lowers to `React.createElement`; `genes.ts.Imports`
 * becomes ordinary ESM imports; raw TS type metadata affects only `.d.ts` and
 * disappears from JavaScript. Runtime parity is owned by `qa-todoapp.ts`.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const exampleRoot = path.join(repoRoot, "examples", "todoapp");

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

function clean(relativePath: string): void {
  rmSync(path.join(exampleRoot, relativePath), {
    recursive: true,
    force: true
  });
}

clean("web/classic-src-gen");
clean("web/classic-dist");
clean("server/classic-src-gen");

run("haxe", ["examples/todoapp/web/build.classic.hxml"]);
run("haxe", ["examples/todoapp/server/build.classic.hxml"]);

assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/web/classic-src-gen/todo",
  fileExts: [".ts"]
});
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "examples/todoapp/server/classic-src-gen/todo",
  fileExts: [".ts"]
});

runGeneratedTypeScriptMatrix("examples/todoapp/tsconfig.classic.json", {
  emit: false
});
assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "examples/todoapp/tsconfig.classic.json",
  ownershipInventories: [
    {
      outputRoot: "examples/todoapp/web/classic-src-gen",
      outputIdentity: "index.js",
      classifications: [
        ...[
          "genes/Register.d.ts",
          "haxe/Exception.d.ts",
          "haxe/ValueException.d.ts",
          "js/html/FontFaceSetIteratorResult.d.ts",
          "js/html/FormDataIterator.d.ts",
          "js/html/HeadersIterator.d.ts",
          "js/html/MediaKeyStatusMapIterator.d.ts",
          "js/html/NotificationOptions.d.ts",
          "js/html/RequestInit.d.ts",
          "js/html/ResponseInit.d.ts",
          "js/html/URLSearchParamsIterator.d.ts",
          "js/lib/Object.d.ts",
          "js/lib/Promise.d.ts"
        ].map(file => ({
          file,
          disposition: "runtime-boundary" as const,
          reason: "Haxe JavaScript runtime or browser-host declaration intentionally models a dynamic foreign boundary."
        })),
        {
          file: "todo/extern/Fetch.d.ts",
          disposition: "fixture-boundary" as const,
          reason: "The todoapp fixture keeps a direct fetch interop facade to exercise host-boundary declarations."
        },
        {
          file: "todo/web/ReactTypes.d.ts",
          disposition: "fixture-boundary" as const,
          reason: "The todoapp fixture deliberately exposes React's foreign element boundary."
        }
      ]
    },
    {
      outputRoot: "examples/todoapp/server/classic-src-gen",
      outputIdentity: "index.js",
      classifications: [
        ...[
          "genes/Register.d.ts",
          "haxe/Exception.d.ts",
          "haxe/ValueException.d.ts",
          "js/lib/Object.d.ts",
          "js/lib/Promise.d.ts",
          "js/node/Util.d.ts",
          "js/node/stream/Writable.d.ts"
        ].map(file => ({
          file,
          disposition: "runtime-boundary" as const,
          reason: "Haxe JavaScript runtime or Node-host declaration intentionally models a dynamic foreign boundary."
        })),
        {
          file: "todo/extern/Express.d.ts",
          disposition: "fixture-boundary" as const,
          reason: "The todoapp fixture keeps a direct Express interop facade to exercise server-host declarations."
        }
      ]
    }
  ],
  scope: "todoapp-classic-public-surface"
});

const classicWeb = readFileSync(
  path.join(
    exampleRoot,
    "web/classic-src-gen/todo/web/pages/TodoListPage.js"
  ),
  "utf8"
);
const classicServer = readFileSync(
  path.join(exampleRoot, "server/classic-src-gen/todo/server/Main.js"),
  "utf8"
);
const classicReactTypes = readFileSync(
  path.join(exampleRoot, "web/classic-src-gen/todo/web/ReactTypes.d.ts"),
  "utf8"
);
const classicComponentDeclaration = readFileSync(
  path.join(exampleRoot, "web/classic-src-gen/todo/web/App.d.ts"),
  "utf8"
);
const classicDomainDeclaration = readFileSync(
  path.join(exampleRoot, "web/classic-src-gen/todo/shared/Todo.d.ts"),
  "utf8"
);

match(classicWeb, /React__genes_jsx\.createElement\("h2"/);
match(classicWeb, /from "\.\.\/\.\.\/\.\.\/\.\.\/src-ts\/components\/PrettyButton"/);
match(classicWeb, /from "\.\.\/\.\.\/\.\.\/\.\.\/src-ts\/interop\/haxeInterop"/);
doesNotMatch(classicWeb, /genes\.react\.internal\.Jsx/);
doesNotMatch(classicWeb, /@:ts\.|satisfies\s/);
match(classicReactTypes, /^import type \{JSX\} from "react"\n/);
match(classicComponentDeclaration, /^import type \{JSX\} from "react"\n/);
doesNotMatch(classicDomainDeclaration, /^import type \{JSX\} from "react"\n/m);
match(classicServer, /import Express from "express"/);
match(classicServer, /TODOAPP_WEB_DIST/);
ok(
  readFileSync(
    path.join(exampleRoot, "server/classic-src-gen/todo/server/Store.d.ts"),
    "utf8"
  ).includes("get(id: string): Todo | null")
);

run("npx", [
  "-y",
  "--package",
  "esbuild@0.20.2",
  "-c",
  [
    "esbuild",
    "examples/todoapp/web/classic-src-gen/index.js",
    "--bundle",
    "--sourcemap",
    "--format=esm",
    "--platform=browser",
    "--outfile=examples/todoapp/web/classic-dist/assets/app.js"
  ].join(" ")
]);

mkdirSync(path.join(exampleRoot, "web/classic-dist"), {recursive: true});
copyFileSync(
  path.join(exampleRoot, "web/index.html"),
  path.join(exampleRoot, "web/classic-dist/index.html")
);

console.log("todoapp classic profile built (web + server + declarations).");
