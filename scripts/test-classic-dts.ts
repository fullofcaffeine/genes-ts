import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertExportedSurfacePolicy,
  type ExportedSurfaceOwnedFileClassification
} from "./exported-surface-policy.js";
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

// Classic implementation and declaration output share the registry contract
// with genes-ts. The private construction helper must stay out of the public
// declaration, while the named registry values remain strongly classified.
const registerImplementation = readFileSync(
  path.join(repoRoot, "bin/genes/Register.js"),
  "utf8"
);
const registerDeclaration = readFileSync(
  path.join(repoRoot, "bin/genes/Register.d.ts"),
  "utf8"
);
if (!registerImplementation.includes("Object.create(null)")) {
  throw new Error("Classic Genes no longer creates prototype-free runtime registries.");
}
if (!registerDeclaration.includes("static global(name: string): HxRegistry")) {
  throw new Error("Classic declarations lost the typed HxRegistry return contract.");
}
if (!registerDeclaration.includes("export type HxRegistry = {[key: string]: unknown}")) {
  throw new Error("Classic declarations widened heterogeneous registry values.");
}
if (registerDeclaration.includes("nullPrototypeDictionary")) {
  throw new Error("The private registry construction helper leaked into classic declarations.");
}
if (!registerDeclaration.includes("static bind(o: any, m: any): any | null")) {
  throw new Error(
    "The documented dynamic bind boundary changed without corresponding runtime/type evidence."
  );
}

/**
 * Gives a small, named group of generated declarations one documented role.
 *
 * Classic `.d.ts` output includes Haxe runtime modules and compatibility
 * fixtures whose source APIs already use `Dynamic`. Genes must describe those
 * real contracts honestly. The exact file inventory keeps the exception local:
 * a new compiler-owned declaration is audited unless a reviewer classifies it.
 */
function classifyOwnedSurfaceFiles(
  files: ReadonlyArray<string>,
  disposition: "runtime-boundary" | "fixture-boundary",
  reason: string
): ReadonlyArray<ExportedSurfaceOwnedFileClassification> {
  return files.map(file => ({ file, disposition, reason }));
}

// These declarations describe Haxe's JavaScript runtime. Reflection,
// exception payloads, and native collection adapters receive values that Haxe
// itself does not know statically, so a narrow invented type would be unsound.
const classicHaxeRuntimeBoundaryFiles = [
  "Reflect.d.ts",
  "Std.d.ts",
  "Type.d.ts",
  "haxe/Exception.d.ts",
  "haxe/PosInfos.d.ts",
  "haxe/ValueException.d.ts",
  "haxe/ds/EnumValueMap.d.ts",
  "js/lib/Map.d.ts",
  "js/lib/Object.d.ts",
  "js/lib/Promise.d.ts"
] as const;

// hxnodejs mirrors flexible Node callbacks, buffers, option objects, and
// streams. These are host-library contracts rather than permission for user
// declarations to expose broad types.
const classicNodeRuntimeBoundaryFiles = [
  "js/node/Assert.d.ts",
  "js/node/Buffer.d.ts",
  "js/node/ChildProcess.d.ts",
  "js/node/Fs.d.ts",
  "js/node/Util.d.ts",
  "js/node/stream/Writable.d.ts"
] as const;

// The full classic fixture imports compiler/display structures only to stress
// declaration generation. They are not part of the ordinary runtime surface
// offered by genes-ts applications.
const classicCompilerApiFixtureFiles = [
  "haxe/display/Diagnostic.d.ts",
  "haxe/display/Display.d.ts",
  "haxe/display/JsonModuleTypes.d.ts",
  "haxe/macro/Compiler.d.ts",
  "haxe/macro/Expr.d.ts",
  "haxe/macro/PlatformConfig.d.ts"
] as const;

// These declarations belong to tests that intentionally exercise raw interop
// or Dynamic source APIs. Their focused assertions contain that weak surface.
const classicRegressionFixtureFiles = [
  "ANSI.d.ts",
  "tests/TestAsyncAwait.d.ts",
  "tests/TestImportModule.d.ts",
  "tests/TestJsonValue.d.ts",
  "tests/TestTsTypes.d.ts"
] as const;

// Tink is an external compatibility fixture. The compiler must preserve its
// published Haxe types, including deliberate Any/Dynamic seams, rather than
// silently claiming a different third-party API in generated declarations.
const classicTinkFixtureFiles = [
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
    classifications: [
      ...classifyOwnedSurfaceFiles(
        classicHaxeRuntimeBoundaryFiles,
        "runtime-boundary",
        "Haxe's JavaScript runtime intentionally accepts values whose concrete type is known only at runtime."
      ),
      ...classifyOwnedSurfaceFiles(
        classicNodeRuntimeBoundaryFiles,
        "runtime-boundary",
        "The declaration preserves an hxnodejs host-API contract whose callbacks or option values are intentionally dynamic."
      ),
      ...classifyOwnedSurfaceFiles(
        classicCompilerApiFixtureFiles,
        "fixture-boundary",
        "The regression fixture imports Haxe compiler/display structures to test declaration generation, not as a Genes application API."
      ),
      ...classifyOwnedSurfaceFiles(
        classicRegressionFixtureFiles,
        "fixture-boundary",
        "This test declaration deliberately exercises raw interop or Dynamic behavior and is bounded by focused compile/runtime assertions."
      ),
      ...classifyOwnedSurfaceFiles(
        classicTinkFixtureFiles,
        "fixture-boundary",
        "Tink is a third-party compatibility fixture; Genes preserves its declared Any/Dynamic API instead of inventing a different contract."
      )
    ]
  }],
  scope: "classic-dts-owned-surfaces",
  boundaryManifestPath: "tests/typing-policy/exported-surface-boundaries.json"
});

runGeneratedTypeScriptMatrix("tests/classic-dts/tsconfig.json", { emit: false });
runGeneratedTypeScriptMatrix("tests/classic-dts/regroup-tsconfig.json", {
  emit: false
});
