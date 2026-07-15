import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const reflectOutput = readFileSync(path.join(repoRoot, "tests/genes-ts/full/out/src-gen/Reflect.ts"), "utf8");
if (/unsafeCast<Rest</.test(reflectOutput)) {
  throw new Error("Reflect.fields emitted an unresolved Rest<T> cast instead of an array type.");
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

// Use a pinned TypeScript version for consistent behavior.
run("npx", ["-y", "--package", "typescript@5.5.4", "-c", "tsc -p tests/genes-ts/full/tsconfig.json"]);

run("node", ["tests/genes-ts/full/out/dist/index.js"]);
