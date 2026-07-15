import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

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

const declarationOnlyJs = path.join(
  repoRoot,
  "bin/tests/typeonly/DeclarationOnlyShape.js"
);
const declarationOnlyDts = path.join(
  repoRoot,
  "bin/tests/typeonly/DeclarationOnlyShape.d.ts"
);
const declarationOnlyJsMap = `${declarationOnlyJs}.map`;

// Remove stale artifacts before the build. The declaration-only dependency is
// expected to gain a `.d.ts` through DependencyPlan without broadening classic
// runtime DCE and recreating its `.js` implementation.
rmSync(declarationOnlyJs, { force: true });
rmSync(declarationOnlyJsMap, { force: true });
rmSync(declarationOnlyDts, { force: true });

// Always rebuild: accepting a stale declaration tree would make the negative
// consumer pass or fail independently of the compiler revision under test.
run("haxe", ["test.hxml"]);

if (!existsSync(declarationOnlyDts)) {
  throw new Error("Declaration-only DCE dependency did not receive a .d.ts module.");
}
if (existsSync(declarationOnlyJs)) {
  throw new Error("Declaration-only reachability incorrectly broadened classic JS DCE.");
}
if (existsSync(declarationOnlyJsMap)) {
  throw new Error("Declaration-only reachability emitted an orphan classic JS source map.");
}

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

runGeneratedTypeScriptMatrix("tests/classic-dts/tsconfig.json", { emit: false });
