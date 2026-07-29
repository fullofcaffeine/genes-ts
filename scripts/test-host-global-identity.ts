import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/host-global-identity");
const expectedTranscript =
  "local-promise|local-error|host-error|true|true|true|true|true|resolved";

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function transcript(relativeFile: string): string {
  return execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function read(relativeFile: string): string {
  return readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
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
run("haxe", ["tests/host-global-identity/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/host-global-identity/tsconfig.generated.json"
);
run("haxe", ["tests/host-global-identity/build-classic.hxml"]);
run("haxe", ["tests/host-global-identity/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/host-global-identity/out/ts/dist/index.js"),
    transcript("tests/host-global-identity/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript],
  "TypeScript-readable and standard Haxe JavaScript preserve host behavior"
);

const implementation = read("out/ts/src-gen/hostglobals/HostGlobals.ts");
for (const localDeclaration of [
  "export class Promise {",
  "export class Error {",
  'return Promise.marker() + "|" + Error.marker();'
]) {
  ok(
    implementation.includes(localDeclaration),
    `user-authored collision remains local: ${localDeclaration}`
  );
}

for (const hostUse of [
  "value: globalThis.Promise<string>",
  "): globalThis.Promise<string>",
  "new globalThis.Promise(",
  "globalThis.Promise.resolve(value)",
  "return globalThis.Promise;",
  "): globalThis.Error",
  "new globalThis.Error(message)",
  "return globalThis.Error;",
  "instanceof globalThis.Error",
  "Register.inherits(globalThis.Error) as typeof globalThis.Error",
  "globalThis.Error.call(this, message)"
]) {
  ok(
    implementation.includes(hostUse),
    `exact host reference stays collision-proof: ${hostUse}`
  );
}

ok(
  !/^import .*\\b(?:Promise|Error)\\b/m.test(implementation),
  "host Promise and Error do not allocate ESM imports"
);

const exceptionImplementation = read("out/ts/src-gen/haxe/Exception.ts");
ok(
  exceptionImplementation.includes(
    "Register.inherits(globalThis.Error) as typeof globalThis.Error"
  ),
  "Haxe's private native Error alias is qualified in its superclass thunk"
);
ok(
  exceptionImplementation.includes("return globalThis.Error"),
  "Haxe exception reflection returns the host Error constructor"
);

const emittedDeclaration = read("out/ts/dist/hostglobals/HostGlobals.d.ts");
for (const annotation of [
  "value: globalThis.Promise<string>",
  "): globalThis.Promise<string>",
  "): globalThis.Error"
]) {
  ok(
    emittedDeclaration.includes(annotation),
    `TypeScript declaration keeps the host annotation: ${annotation}`
  );
}

const classicDeclaration = read("out/classic/hostglobals/HostGlobals.d.ts");
ok(
  classicDeclaration.includes(
    "class NativeFailure extends globalThis.Error"
  ),
  "classic declaration output uses the same collision-proof host type"
);
ok(
  classicDeclaration.includes(
    "acceptPromise(value: globalThis.Promise<string>): globalThis.Promise<string>"
  ),
  "classic declaration output qualifies the host Promise type"
);

for (const classicJavaScript of [
  "out/classic/hostglobals/HostGlobals.js",
  "out/classic/haxe/Exception.js"
]) {
  ok(
    !read(classicJavaScript).includes("globalThis."),
    `${classicJavaScript} keeps its established JavaScript spelling`
  );
}

const source = read("src/hostglobals/HostGlobals.hx");
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/hostglobals/HostGlobals.ts.map")
  ) as RawSourceMap
);
const promiseOriginal = sourceMap.originalPositionFor(
  generatedPoint(implementation, "return new globalThis.Promise")
);
ok(
  promiseOriginal.source?.endsWith("src/hostglobals/HostGlobals.hx"),
  "qualified host Promise maps back to HostGlobals.hx"
);
strictEqual(
  promiseOriginal.line,
  sourceLine(source, "return new js.lib.Promise"),
  "qualification preserves the exact Haxe source line"
);

process.stdout.write(
  "host-global-identity:ok "
    + "(local controls + TS5/6/7 + declarations + classic + standard + maps)\n"
);
