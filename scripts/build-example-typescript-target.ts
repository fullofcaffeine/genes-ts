import { doesNotMatch, match, strictEqual } from "node:assert";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const exampleRoot = path.join(repoRoot, "examples", "typescript-target");

function rmrf(relPath: string): void {
  rmSync(path.join(exampleRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  const cwd = opts.cwd ?? exampleRoot;
  execFileSync(cmd, [...args], {
    stdio: "inherit",
    ...opts,
    cwd
  });
}

function capture(cmd: string, args: ReadonlyArray<string>, cwd: string): string {
  return execFileSync(cmd, [...args], { cwd, encoding: "utf8" }).trim();
}

rmrf("src-gen");
rmrf("dist");
rmrf("classic-src-gen");

// Haxe must run from the repository root so the in-repo genes-ts haxelib can
// resolve `extraParams.hxml`. The checked-in profiles therefore use explicit
// repo-relative paths and remain the authoritative build contract.
run("haxe", ["examples/typescript-target/build.hxml"], { cwd: repoRoot });

runGeneratedTypeScriptMatrix(
  "examples/typescript-target/tsconfig.node-next.json"
);

const tsOutput = capture("node", ["dist/index.js"], exampleRoot);

// Build the identical Haxe source through classic Genes. This deliberately
// avoids `-D genes.ts`: the comparison proves that TypeScript annotations are a
// richer projection, not a requirement for executing the program as ESM JS.
run("haxe", ["examples/typescript-target/build.classic.hxml"], {
  cwd: repoRoot
});

runGeneratedTypeScriptMatrix(
  "examples/typescript-target/tsconfig.classic.json",
  { emit: false }
);
assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "examples/typescript-target/tsconfig.classic.json",
  ownershipInventories: [{
    outputRoot: "examples/typescript-target/classic-src-gen",
    outputIdentity: "index.js",
    classifications: [
      {
        file: "genes/Register.d.ts",
        disposition: "runtime-boundary",
        reason: "The Haxe runtime registry intentionally models reflective JavaScript values."
      },
      {
        file: "js/lib/Object.d.ts",
        disposition: "runtime-boundary",
        reason: "The Haxe JavaScript Object extern intentionally represents arbitrary host objects."
      },
      {
        file: "js/lib/Promise.d.ts",
        disposition: "runtime-boundary",
        reason: "The Haxe JavaScript Promise extern retains its host callback boundary."
      }
    ]
  }],
  scope: "example-typescript-target-classic"
});

const classicOutput = capture(
  "node",
  ["classic-src-gen/index.js"],
  exampleRoot
);
match(tsOutput, /Hello, World$/);
strictEqual(classicOutput, tsOutput);

const generatedTs = readFileSync(
  path.join(exampleRoot, "src-gen/my/app/Main.ts"),
  "utf8"
);
const generatedClassic = readFileSync(
  path.join(exampleRoot, "classic-src-gen/my/app/Main.js"),
  "utf8"
);
match(generatedTs, /let g: Greeter = new Greeter/);
match(generatedClassic, /let g = new Greeter/);
doesNotMatch(generatedClassic, /let g: Greeter/);

console.log("typescript-target example passed (ts-strict + classic-esm).");
