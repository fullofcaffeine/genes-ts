import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertExportedSurfacePolicy,
  type ExportedSurfaceOwnedFileClassification
} from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function ensureClassicTestArtifacts(): void {
  const jsPath = path.join(repoRoot, "bin", "tests.js");
  const dtsPath = path.join(repoRoot, "bin", "tests.d.ts");

  if (existsSync(jsPath) && existsSync(dtsPath)) return;

  // `tests/genes-ts/full` reuses some of the classic Genes tests (e.g. TestExpose)
  // which assert against the generated `bin/tests.js` + `bin/tests.d.ts`.
  // When running in CI with `SKIP_CLASSIC=1`, those artifacts may not exist yet.
  // Compile them here (without executing the runtime test suite).
  run("haxe", ["test.hxml"]);
}

ensureClassicTestArtifacts();

rmrf("tests/genes-ts/full/out");

run("haxe", ["tests/genes-ts/full/build.hxml"]);

if (!existsSync(path.join(
  repoRoot,
  "tests/genes-ts/full/out/src-gen/tests/typeonly/TypeOnlyHelper.ts"
))) {
  throw new Error("Type-only DCE dependency was not retained in TS output.");
}

// A closed generated interface must expose the complete declaration-time Haxe
// contract while rejecting arbitrary members. Successful `tsc` alone would not
// prove this if the emitter reintroduced a catch-all index signature.
writeFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/InterfaceSurfaceConsumer.ts"),
  [
    'import type {IMap} from "./haxe/Constraints.js";',
    "declare const map: IMap<string, number>;",
    'map.set("one", 1);',
    'const maybe: number | null = map.get("one");',
    'const exists: boolean = map.exists("one");',
    'const removed: boolean = map.remove("one");',
    "const keys = map.keys();",
    "const values = map.iterator();",
    "const entries = map.keyValueIterator();",
    "const copied: IMap<string, number> = map.copy();",
    "const rendered: string = map.toString();",
    "map.clear();",
    "void maybe; void exists; void removed; void keys; void values;",
    "void entries; void copied; void rendered;",
    "// @ts-expect-error ordinary Haxe interfaces are closed contracts",
    "map.nonexistentMember();",
    "export {};",
    ""
  ].join("\n")
);

// The same immutable public plan owns generic parent applications in TS
// implementation interfaces. Negative calls prove `SurfaceParent<Array<T>>`
// was not widened or reconstructed differently by this printer.
writeFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/PublicSurfaceConsumer.ts"),
  [
    'import type {SurfaceChild} from "./tests/publicsurface/SurfaceParent.js";',
    "declare const child: SurfaceChild<string>;",
    'const inherited: string[] = child.inherited(["surface"]);',
    'const own: string = child.own("surface");',
    "// @ts-expect-error SurfaceChild<T> applies Array<T> to its parent.",
    "child.inherited([1]);",
    "// @ts-expect-error the ordinary Haxe interface remains closed",
    "child.nonexistentMember();",
    "void inherited; void own;",
    "export {};",
    ""
  ].join("\n")
);

// Nullish contracts need negative programs under exact optional-property
// semantics. Ordinary `strict` compilation would still accept explicit
// `undefined` assignments to every `?` property and could not distinguish the
// `@:ts.optional` projection from an explicit `Undefinable<T>` value union.
mkdirSync(
  path.join(repoRoot, "tests/genes-ts/full/out/nullish-consumer"),
  { recursive: true }
);
writeFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/nullish-consumer/consumer.ts"),
  [
    'import {NullishMatrix, type NullishMatrixShape} from "../dist/tests/nullish/NullishMatrix.js";',
    "const required = {nullable: null, undefinable: undefined} as const;",
    "const valid: NullishMatrixShape = {...required, typescriptOptional: undefined, optionalUndefinable: undefined};",
    "const nullable: string | null = valid.nullable;",
    "const undefinable: string | undefined = valid.undefinable;",
    "const ordinaryOptional: string | null | undefined = valid.ordinaryOptional;",
    "const typescriptOptional: string | undefined = valid.typescriptOptional;",
    "const optionalUndefinable: string | undefined = valid.optionalUndefinable;",
    "const omittedParameter: string | undefined = NullishMatrix.optionalUndefined();",
    "declare const iterator: IterableIterator<string>;",
    "const step: IteratorResult<string, undefined> = NullishMatrix.next(iterator);",
    "// @ts-expect-error Haxe Null<T> does not include JavaScript undefined.",
    "const invalidNullable: NullishMatrixShape = {...required, nullable: undefined};",
    "// @ts-expect-error Undefinable<T> deliberately excludes null.",
    "const invalidUndefinable: NullishMatrixShape = {...required, undefinable: null};",
    "// @ts-expect-error the TS optional projection permits undefined but rejects null.",
    "const invalidTsOptional: NullishMatrixShape = {...required, typescriptOptional: null};",
    "// @ts-expect-error ordinary optional T | null also rejects an explicit undefined write.",
    "const invalidOrdinaryOptional: NullishMatrixShape = {...required, ordinaryOptional: undefined};",
    "// @ts-expect-error an explicit undefined parameter must not silently acquire null.",
    "NullishMatrix.optionalUndefined(null);",
    "void nullable; void undefinable; void ordinaryOptional;",
    "void typescriptOptional; void optionalUndefinable; void omittedParameter; void step;",
    "void invalidNullable; void invalidUndefinable; void invalidTsOptional;",
    "void invalidOrdinaryOptional;",
    "export {};",
    ""
  ].join("\n")
);

/**
 * Gives a small, named group of generated files one documented audit role.
 *
 * The full profile deliberately compiles standard-library, host-library, and
 * third-party APIs that already use Haxe `Dynamic`. Genes must preserve those
 * source contracts; silently replacing them with a made-up narrower type would
 * be incorrect. Grouping the exact owned files here keeps that exception easy
 * to review and makes a renamed or removed file fail the gate as stale.
 */
function classifyOwnedSurfaceFiles(
  files: ReadonlyArray<string>,
  disposition: "runtime-boundary" | "fixture-boundary",
  reason: string
): ReadonlyArray<ExportedSurfaceOwnedFileClassification> {
  return files.map(file => ({ file, disposition, reason }));
}

// These modules implement Haxe's JavaScript runtime behavior. Reflection,
// exceptions, and map lookups genuinely receive values whose concrete type is
// known only while the program runs. The compiler may contain that boundary,
// but it must not invent a stronger public contract than the Haxe standard
// library declares.
const fullProfileHaxeRuntimeBoundaryFiles = [
  "Reflect.ts",
  "Std.ts",
  "Type.ts",
  "haxe/Exception.ts",
  "haxe/PosInfos.ts",
  "haxe/ValueException.ts",
  "haxe/ds/EnumValueMap.ts",
  "js/Boot.ts",
  "js/lib/Map.ts"
] as const;

// These declarations come from hxnodejs and describe flexible Node APIs such
// as callbacks, option bags, and writable streams. They are runtime boundaries
// owned by that host extern contract, not evidence that ordinary generated
// application modules may expose `any`.
const fullProfileNodeRuntimeBoundaryFiles = [
  "js/node/Assert.ts",
  "js/node/ChildProcess.ts",
  "js/node/Util.ts",
  "js/node/stream/Writable.ts"
] as const;

// The full regression fixture imports Haxe's compiler/display data structures
// to exercise difficult compiler types. These are compile-time fixture inputs,
// not a public runtime API that genes-ts promises to redesign.
const fullProfileCompilerApiFixtureFiles = [
  "haxe/display/Diagnostic.ts",
  "haxe/display/Display.ts",
  "haxe/display/JsonModuleTypes.ts",
  "haxe/macro/Compiler.ts",
  "haxe/macro/Expr.ts",
  "haxe/macro/PlatformConfig.ts"
] as const;

// These files intentionally exercise raw interop or legacy Dynamic behavior.
// Their runtime and negative assertions are the evidence; their deliberately
// weak fixture signatures must not grant an exemption to unrelated modules.
const fullProfileRegressionFixtureFiles = [
  "ANSI.ts",
  "tests/TestAsyncAwait.ts",
  "tests/TestImportModule.ts",
  "tests/TestTsTypes.ts"
] as const;

// Tink is compiled here as a demanding third-party compatibility fixture.
// Its source-level `Any`/`Dynamic` contracts belong to Tink. This gate proves
// that Genes preserves and compiles them; it does not silently rewrite that
// external library's published API.
const fullProfileTinkFixtureFiles = [
  "tink/CoreApi.ts",
  "tink/core/Annex.ts",
  "tink/core/Any.ts",
  "tink/core/Error.ts",
  "tink/core/Future.ts",
  "tink/core/Promise.ts",
  "tink/core/Signal.ts",
  "tink/streams/IdealStream.ts",
  "tink/streams/RealStream.ts",
  "tink/streams/Stream.ts",
  "tink/streams/nodejs/NodejsStream.ts",
  "tink/streams/nodejs/WrappedReadable.ts",
  "tink/testrunner/Assertion.ts",
  "tink/testrunner/Assertions.ts",
  "tink/testrunner/Case.ts",
  "tink/testrunner/Reporter.ts",
  "tink/testrunner/Result.ts",
  "tink/testrunner/Runner.ts",
  "tink/testrunner/Suite.ts",
  "tink/unit/AssertionBuffer.ts",
  "tink/unit/TestCase.ts"
] as const;

// The external negative consumers prove important APIs reject invalid access.
// The semantic audit separately enrolls every compiler-owned TypeScript module
// from the output manifest, so a future file cannot evade inspection merely
// because this script did not know its path yet.
assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "tests/genes-ts/full/tsconfig.json",
  ownershipInventories: [{
    outputRoot: "tests/genes-ts/full/out/src-gen",
    outputIdentity: "index.ts",
    classifications: [
      ...classifyOwnedSurfaceFiles(
        fullProfileHaxeRuntimeBoundaryFiles,
        "runtime-boundary",
        "Haxe's JavaScript runtime intentionally accepts values whose concrete type is known only at runtime."
      ),
      ...classifyOwnedSurfaceFiles(
        fullProfileNodeRuntimeBoundaryFiles,
        "runtime-boundary",
        "The generated module preserves an hxnodejs host-API contract whose callbacks or option values are intentionally dynamic."
      ),
      ...classifyOwnedSurfaceFiles(
        fullProfileCompilerApiFixtureFiles,
        "fixture-boundary",
        "The full regression fixture imports Haxe compiler/display structures to test code generation; it does not publish them as a Genes application API."
      ),
      ...classifyOwnedSurfaceFiles(
        fullProfileRegressionFixtureFiles,
        "fixture-boundary",
        "This regression module deliberately exercises raw interop or Dynamic behavior and is bounded by its focused compile/runtime assertions."
      ),
      ...classifyOwnedSurfaceFiles(
        fullProfileTinkFixtureFiles,
        "fixture-boundary",
        "Tink is a third-party compatibility fixture; Genes preserves its declared Any/Dynamic API instead of inventing a different contract."
      )
    ]
  }],
  scope: "genes-ts-full-owned-surfaces",
  boundaryManifestPath: "tests/typing-policy/exported-surface-boundaries.json"
});

const dynamicImportOutput = readFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/tests/TestImportModule.ts"),
  "utf8"
);
if (/function \((module|modules): any/.test(dynamicImportOutput)) {
  throw new Error("Genes.dynamicImport emitted an unsafe `any` callback parameter.");
}
if (!dynamicImportOutput.includes('as typeof import("./ExternalClass.js")')) {
  throw new Error("Genes.dynamicImport did not emit a typed import cast for module reads.");
}

// The assertion macro supplies `tink.Error` only as an inferred enum type
// argument inside executable code. TypeScript has a global `Error`, so a
// missing import still compiles while meaning the wrong type. Require both the
// explicit type-only alias and its use to prove dependency planning follows the
// typed Haxe result instead of accidentally accepting the host global.
const abstractOutput = readFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/tests/TestAbstract.ts"),
  "utf8"
);
if (!abstractOutput.includes('import type {Error as Error__1} from "../tink/CoreApi.js"')) {
  throw new Error("Inferred enum type arguments did not retain the authored tink.Error import.");
}
if (!abstractOutput.includes("Yield.Data<Assertion, Error__1>")) {
  throw new Error("Inferred enum type arguments resolved through the JavaScript Error global.");
}

const reflectOutput = readFileSync(path.join(repoRoot, "tests/genes-ts/full/out/src-gen/Reflect.ts"), "utf8");
if (/unsafeCast<Rest</.test(reflectOutput)) {
  throw new Error("Reflect.fields emitted an unresolved Rest<T> cast instead of an array type.");
}

// Registry names come from runtime metadata and are not limited to friendly
// identifiers. The implementation must therefore use a prototype-free map,
// while its generated API keeps the heterogeneous values behind HxRegistry.
const registerOutput = readFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/genes/Register.ts"),
  "utf8"
);
if (!registerOutput.includes("declare static globals: {[key: string]: HxRegistry};")) {
  throw new Error("The runtime registry index lost its HxRegistry value type.");
}
if (!registerOutput.includes("Object.create(null)")) {
  throw new Error("The runtime registry no longer uses a prototype-free dictionary.");
}
if (
  registerOutput.includes("Register.globals = {}") ||
  registerOutput.includes("let created: HxRegistry = {}")
) {
  throw new Error("The runtime registry regressed to an inherited JavaScript object.");
}

// `Register.bind` remains one documented dynamic runtime boundary, but the
// compiler must recover the precise callable type at every user-module use.
// A visually narrower Object/Function helper signature would not prove that.
for (const relativeFile of ["TestBind.ts", "TestRuntimeRegistry.ts"]) {
  const userOutput = readFileSync(
    path.join(repoRoot, "tests/genes-ts/full/out/src-gen/tests", relativeFile),
    "utf8"
  );
  if (/\b(?:any|unknown)\b/.test(userOutput)) {
    throw new Error(`${relativeFile} leaked the runtime registry/bind boundary into user typing.`);
  }
}

// `IReadable` is a secondary extern declared in the same Haxe module as the
// `@:jsRequire("stream", "Readable")` owner. Its use in a signature must reuse
// that package export as a type-only alias instead of becoming an unresolved
// bare identifier (the generic form of genes-ast).
const wrappedReadableOutput = readFileSync(
  path.join(repoRoot, "tests/genes-ts/full/out/src-gen/tink/streams/nodejs/WrappedReadable.ts"),
  "utf8"
);
if (!wrappedReadableOutput.includes('import type {Readable as IReadable} from "stream"')) {
  throw new Error("Secondary extern signature type did not reuse its module owner's package import.");
}

// Runtime fixtures needed for dynamic `@:jsRequire('../../tests/…')` modules.
// These must be present both for `tsc` module resolution and for Node at runtime.
const outRoot = path.join(repoRoot, "tests/genes-ts/full/out");
mkdirSync(path.join(outRoot, "tests"), { recursive: true });
cpSync(path.join(repoRoot, "tests/genes-ts/full/tests"), path.join(outRoot, "tests"), {
  recursive: true
});

runGeneratedTypeScriptMatrix("tests/genes-ts/full/tsconfig.json");
runGeneratedTypeScriptMatrix("tests/genes-ts/full/tsconfig.nullish.json", {
  emit: false
});

run("node", ["tests/genes-ts/full/out/dist/index.js"]);
