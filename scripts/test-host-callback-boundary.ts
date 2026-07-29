import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/host-callback-boundary");
const expectedTranscript = "user-callback";

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
run("haxe", ["tests/host-callback-boundary/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/host-callback-boundary/tsconfig.generated.json"
);
run("haxe", ["tests/host-callback-boundary/build-classic.hxml"]);
run("haxe", ["tests/host-callback-boundary/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/host-callback-boundary/out/ts/dist/index.js"),
    transcript("tests/host-callback-boundary/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript],
  "TypeScript-readable and standard JavaScript preserve callback behavior"
);

const implementation = read(
  "out/ts/src-gen/hostcallbacks/HostCallbacks.ts"
);
const plannedAssignment =
  "reader.onerror = Register.unsafeCast<typeof reader.onerror>(function (error: globalThis.Error)";
ok(
  implementation.includes(plannedAssignment),
  "opaque FileReader callback uses its authoritative TypeScript property type"
);
strictEqual(
  implementation.match(/reader\.onerror/g)?.length,
  2,
  "reader.onerror appears once as the runtime target and once in a non-evaluating type query"
);

for (const directAssignment of [
  "HostCallbacks.makeReader().onerror = function (_)",
  "target.onready = function (_: string)",
  "(target!).onready = function (_: string)",
  "target.onerror = function (value: string)"
]) {
  ok(
    implementation.includes(directAssignment),
    `unsupported or already precise callback stays direct: ${directAssignment}`
  );
}
ok(
  !implementation.includes(
    "unsafeCast<typeof HostCallbacks.makeReader().onerror>"
  ),
  "a call receiver is never duplicated into a TypeScript type query"
);
ok(
  !implementation.includes("unsafeCast<typeof target.onready>"),
  "concrete and nullable native callbacks do not receive the opaque callback bridge"
);
ok(
  !implementation.includes("unsafeCast<typeof target.onerror>"),
  "a user-owned opaque Function property does not receive the host bridge"
);
ok(
  !implementation.includes("typeof (target!).onready"),
  "a nullable receiver cannot form an illegal TypeScript type query"
);
for (const authoredOverride of [
  "target.onnumber = Register.unsafeCast<(value: number) => void>",
  "target.ontext = Register.unsafeCast<(value: string) => void>"
]) {
  ok(
    implementation.includes(authoredOverride),
    `authored field projection remains authoritative: ${authoredOverride}`
  );
}
ok(
  !implementation.includes("unsafeCast<typeof target.onnumber>"),
  "@:ts.type is not replaced by the generic host callback bridge"
);
ok(
  !implementation.includes("unsafeCast<typeof target.ontext>"),
  "@:genes.type is not replaced by the generic host callback bridge"
);

for (const classicFile of [
  "out/classic/hostcallbacks/HostCallbacks.js",
  "out/standard/index.cjs"
]) {
  ok(
    !read(classicFile).includes("unsafeCast<typeof"),
    `${classicFile} has no TypeScript-only type query`
  );
}

const source = read("src/hostcallbacks/HostCallbacks.hx");
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/hostcallbacks/HostCallbacks.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(implementation, "reader.onerror = Register.unsafeCast")
);
ok(
  original.source?.endsWith("src/hostcallbacks/HostCallbacks.hx"),
  "the planned wrapper maps back to HostCallbacks.hx"
);
strictEqual(
  original.line,
  sourceLine(source, "reader.onerror = function"),
  "the wrapper preserves the exact Haxe assignment line"
);

process.stdout.write(
  "host-callback-boundary:ok "
    + "(TS5/6/7 + native/user controls + classic + standard + maps)\n"
);
