import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
run("haxe", [
  "test.hxml",
  "--macro",
  "include('tests.classicdts')"
]);

if (!existsSync(declarationOnlyDts)) {
  throw new Error("Declaration-only DCE dependency did not receive a .d.ts module.");
}
if (existsSync(declarationOnlyJs)) {
  throw new Error("Declaration-only reachability incorrectly broadened classic JS DCE.");
}
if (existsSync(declarationOnlyJsMap)) {
  throw new Error("Declaration-only reachability emitted an orphan classic JS source map.");
}

// `Gen.Single` is nullary but belongs to a generic enum. With no constructor
// payload available for inference, classic declarations must use TypeScript's
// bottom type rather than widening the unconstrained argument to `any`.
const genericEnumDeclaration = readFileSync(
  path.join(repoRoot, "bin/tests/TestEnum.d.ts"),
  "utf8"
);
if (!genericEnumDeclaration.includes("export const Single: Single<string, never>")) {
  throw new Error(
    "Classic declarations no longer preserve the typed nullary generic enum contract."
  );
}
const constructorGenericDeclaration = readFileSync(
  path.join(repoRoot, "bin/tests/classicdts/ConstructorGeneric.d.ts"),
  "utf8"
);
if (!constructorGenericDeclaration.includes("export type Payload<B, A, T = never>")) {
  throw new Error(
    "Classic declarations no longer declare constructor-local enum type parameters."
  );
}
if (!constructorGenericDeclaration.includes("left: A, right: B, value: T")) {
  throw new Error(
    "Classic declarations no longer preserve the constructor-local enum payload type."
  );
}
const constrainedEnumDeclaration = readFileSync(
  path.join(repoRoot, "bin/tests/TestTsTypes.d.ts"),
  "utf8"
);
if (!constrainedEnumDeclaration.includes(
  "export type CTor<T extends __A, A extends __A = never>"
)) {
  throw new Error(
    "Classic declarations no longer preserve constructor-local enum constraints."
  );
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
