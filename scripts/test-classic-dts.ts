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
const streamDeclaration = readFileSync(
  path.join(repoRoot, "bin/tink/streams/Stream.d.ts"),
  "utf8"
);
if (streamDeclaration.includes("export declare type any")) {
  throw new Error(
    "Classic declarations projected a declared enum name to the reserved any type."
  );
}
if (!streamDeclaration.includes("export declare type RegroupStatus<Quality>")) {
  throw new Error("Classic declarations lost the generic RegroupStatus name.");
}
if (!streamDeclaration.includes(
  "export declare type RegroupResult<In, Out, Quality>"
)) {
  throw new Error("Classic declarations lost the generic RegroupResult name.");
}

// Classic declarations expose the same legacy Dynamic-heavy stdlib and test
// dependencies as the full TypeScript profile. The audit config loads every
// owned declaration, while this exact list records the pre-existing contracts
// that genes-ofy must narrow or justify separately. A new declaration is not
// added here automatically: it is audited immediately.
const classicKnownSurfaceGaps = [
  "ANSI.d.ts",
  "Reflect.d.ts",
  "Std.d.ts",
  "Type.d.ts",
  "genes/Register.d.ts",
  "genes/ts/Json.d.ts",
  "genes/ts/JsonCodec.d.ts",
  "genes/ts/UnknownNarrow.d.ts",
  "haxe/Exception.d.ts",
  "haxe/PosInfos.d.ts",
  "haxe/ValueException.d.ts",
  "haxe/display/Diagnostic.d.ts",
  "haxe/display/Display.d.ts",
  "haxe/display/JsonModuleTypes.d.ts",
  "haxe/ds/EnumValueMap.d.ts",
  "haxe/macro/Compiler.d.ts",
  "haxe/macro/Expr.d.ts",
  "haxe/macro/PlatformConfig.d.ts",
  "js/lib/Map.d.ts",
  "js/lib/Object.d.ts",
  "js/lib/Promise.d.ts",
  "js/node/Assert.d.ts",
  "js/node/Buffer.d.ts",
  "js/node/ChildProcess.d.ts",
  "js/node/Fs.d.ts",
  "js/node/Util.d.ts",
  "js/node/stream/Writable.d.ts",
  "tests/TestAsyncAwait.d.ts",
  "tests/TestImportModule.d.ts",
  "tests/TestJsonValue.d.ts",
  "tests/TestTsTypes.d.ts",
  "tink/CoreApi.d.ts",
  "tink/core/Annex.d.ts",
  "tink/core/Any.d.ts",
  "tink/core/Error.d.ts",
  "tink/core/Future.d.ts",
  "tink/core/Promise.d.ts",
  "tink/streams/IdealStream.d.ts",
  "tink/streams/RealStream.d.ts",
  "tink/streams/Stream.d.ts",
  "tink/testrunner/Assertion.d.ts",
  "tink/testrunner/Assertions.d.ts",
  "tink/testrunner/Case.d.ts",
  "tink/testrunner/Reporter.d.ts",
  "tink/testrunner/Result.d.ts",
  "tink/testrunner/Runner.d.ts",
  "tink/testrunner/Suite.d.ts",
  "tink/unit/AssertionBuffer.d.ts",
  "tink/unit/TestCase.d.ts"
] as const;

assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "tests/classic-dts/audit-tsconfig.json",
  ownershipInventories: [{
    outputRoot: "bin",
    outputIdentity: "tests.js",
    classifications: classicKnownSurfaceGaps.map(file => ({
      file,
      disposition: "known-gap" as const,
      owner: "genes-ofy",
      reason: "Legacy Dynamic-heavy stdlib, host, or regression dependency surface tracked for separate semantic narrowing."
    }))
  }],
  scope: "classic-dts-owned-surfaces"
});

runGeneratedTypeScriptMatrix("tests/classic-dts/tsconfig.json", { emit: false });
runGeneratedTypeScriptMatrix("tests/classic-dts/regroup-tsconfig.json", {
  emit: false
});
