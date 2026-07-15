import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runTypeScript } from "./toolchains.js";

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

rmrf("src-gen");
rmrf("dist");

// Run Haxe from the repo root so `-lib genes-ts` resolves its `extraParams.hxml`
// include correctly (the in-repo `haxe_libraries/genes-ts.hxml` uses a relative
// include).
run(
  "haxe",
  [
    "-lib",
    "genes-ts",
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

runTypeScript("legacyFloor", [
  "-p",
  "examples/typescript-target/tsconfig.node-next.json"
]);

run("node", ["dist/index.js"]);
