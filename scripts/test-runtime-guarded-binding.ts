import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/runtime-guarded-binding");
const expectedTranscript = "enum-caught|class-caught|fallback";

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function read(relativeFile: string): string {
  return readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
}

function transcript(relativeFile: string): string {
  return execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function generatedPoint(
  source: string,
  needle: string
): { line: number; column: number } {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `generated source contains ${needle}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
run("haxe", ["tests/runtime-guarded-binding/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/runtime-guarded-binding/tsconfig.generated.json"
);
run("haxe", ["tests/runtime-guarded-binding/build-classic.hxml"]);
run("haxe", ["tests/runtime-guarded-binding/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/runtime-guarded-binding/out/ts/dist/index.js"),
    transcript("tests/runtime-guarded-binding/out/classic/index.js"),
    transcript("tests/runtime-guarded-binding/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript, expectedTranscript],
  "TypeScript-readable, classic, and standard JavaScript preserve catch behavior"
);

const implementation = read(
  "out/ts/src-gen/runtimeguard/GuardedCatch.ts"
);
const plannedBinding =
  "const failure: GuardedFailure = Register.unsafeCast<GuardedFailure>(_g1)";
ok(
  implementation.includes(plannedBinding),
  "the enum catch binding consumes the opaque runtime-guard decision"
);
strictEqual(
  implementation.match(/unsafeCast<GuardedFailure>/g)?.length,
  1,
  "only the exact guarded enum binding receives an identity assertion"
);
ok(
  implementation.includes(
    "if (Boot.__instanceof(_g1, GuardedFailure))"
  ),
  "Haxe's runtime guard remains the authority"
);
ok(
  implementation.includes(
    "const failure_1: NativeFailure = _g1"
  ),
  "the class catch narrowed by native instanceof remains direct"
);
ok(
  !implementation.includes("unsafeCast<NativeFailure>"),
  "native instanceof does not receive a redundant assertion"
);

for (const classicFile of [
  "out/classic/runtimeguard/GuardedCatch.js",
  "out/standard/index.cjs"
]) {
  ok(
    !read(classicFile).includes("unsafeCast<GuardedFailure>"),
    `${classicFile} has no TypeScript-only assertion syntax`
  );
}

const source = read("src/runtimeguard/GuardedCatch.hx");
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/runtimeguard/GuardedCatch.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(implementation, "Register.unsafeCast<GuardedFailure>")
);
ok(
  original.source?.endsWith("src/runtimeguard/GuardedCatch.hx"),
  "the planned wrapper maps back to GuardedCatch.hx"
);
strictEqual(
  original.line,
  sourceLine(source, 'return if (kind == "enum")'),
  "the wrapper preserves the guarded Haxe branch position"
);

process.stdout.write(
  "runtime-guarded-binding:ok "
    + "(TS5/6/7 + opaque/native controls + classic + standard + maps)\n"
);
