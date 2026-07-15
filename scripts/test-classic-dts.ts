import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";

/**
 * Strictly consumes classic Genes declarations as an external TypeScript user.
 *
 * Runtime assertions cannot detect a declaration that widened `Null<T>` to
 * `any`: both valid and invalid consumer code would compile. This gate builds
 * classic output when necessary and then compiles a negative consumer with
 * `skipLibCheck: false`, so an unused `@ts-expect-error` exposes future
 * widening immediately.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

// Always rebuild: accepting a stale declaration tree would make the negative
// consumer pass or fail independently of the compiler revision under test.
run("haxe", ["test.hxml"]);

assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "tests/classic-dts/tsconfig.json",
  includePaths: [
    "bin/haxe/Constraints.d.ts",
    "bin/tests/publicsurface/SurfaceParent.d.ts",
    "bin/tests/nullish/NullishMatrix.d.ts"
  ],
  scope: "classic-dts-imap"
});

run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/classic-dts/tsconfig.json"
]);
