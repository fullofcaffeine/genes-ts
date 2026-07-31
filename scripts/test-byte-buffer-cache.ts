import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/byte-buffer-cache");
const expectedTranscript = "true|true|42|true|7|true|2|2";

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
run("haxe", ["tests/byte-buffer-cache/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/byte-buffer-cache/tsconfig.generated.json"
);
run("haxe", ["tests/byte-buffer-cache/build-negative-ts.hxml"]);
run("haxe", ["tests/byte-buffer-cache/build-classic.hxml"]);
run("haxe", ["tests/byte-buffer-cache/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/byte-buffer-cache/out/ts/dist/index.js"),
    transcript("tests/byte-buffer-cache/out/classic/index.js"),
    transcript("tests/byte-buffer-cache/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript, expectedTranscript],
  "TypeScript-readable, classic, and standard JavaScript preserve byte-cache behavior"
);

const mainTs = read("out/ts/src-gen/bytecache/Main.ts");
ok(
  mainTs.includes("return data.hxBytes;")
    && !mainTs.includes("data.bytes!"),
  "an arbitrary native-buffer read receives no initialization assertion"
);
ok(
  mainTs.includes(
    "return Register.unsafeCast<ArrayBuffer>(bytes.b.bufferValue!);"
  ),
  "the backing-buffer cache receives one presence and exact-destination assertion"
);

const bytesTs = read("out/ts/src-gen/haxe/io/Bytes.ts");
strictEqual(
  bytesTs.match(/unsafeCast<Bytes \| null>\(\(b\.hxBytes \?\? null\)\)/g)
    ?.length,
  1,
  "Haxe Bytes.ofData consumes one nullable-wrapper decision"
);

const nodeBufferTs = read("out/ts/src-gen/js/node/buffer/Buffer.ts");
for (const write of [
  "b.bufferValue = b;",
  "b.hxBytes = o;",
  "b.bytes = b;"
]) {
  ok(
    nodeBufferTs.includes(write),
    `hxnodejs keeps its exact runtime cache write: ${write}`
  );
}
strictEqual(
  nodeBufferTs.match(/return Register\.unsafeCast<Bytes>\(o\);/g)?.length,
  1,
  "the object created from Bytes.prototype receives one return-boundary identity assertion"
);

const stdTypes = read("out/ts/src-gen/StdTypes.ts");
ok(
  stdTypes.includes(
    "interface Uint8Array { bufferValue?: ArrayBuffer | Uint8Array; hxBytes?: object; bytes?: Uint8Array }"
  ),
  "Uint8Array and true subclasses expose all three runtime-written cache names"
);
ok(
  stdTypes.includes(
    "interface ArrayBuffer { hxBytes?: object; bytes?: Uint8Array }"
  ),
  "ArrayBuffer exposes only the two properties Haxe writes to it"
);
ok(
  !stdTypes.includes("[key: string]"),
  "byte-cache compatibility does not add a broad global index signature"
);

const namedFields = read(
  "out/ts/src-gen/bytecache/NamedFieldControl.ts"
);
ok(
  !namedFields.includes("unsafeCast") && !namedFields.includes("!!"),
  "same-spelled user fields do not consume native byte-cache decisions"
);

const negativeTs = read(
  "out/negative/src-gen/bytecache/negative/Main.ts"
);
const negativeBufferTs = read(
  "out/negative/src-gen/js/node/buffer/Buffer.ts"
);
ok(
  negativeTs.includes("Object.create(Array.prototype)"),
  "the negative control creates a different prototype"
);
ok(
  !negativeTs.includes("unsafeCast<Bytes>")
    && !negativeBufferTs.includes("unsafeCast<Bytes>"),
  "mismatched and exact-owner-but-reassigned prototypes receive no Bytes identity assertion"
);
ok(
  negativeBufferTs.includes("value = {}")
    && negativeBufferTs.includes("return value;"),
  "the exact helper-owner control reassigns its prototype-backed local before return"
);
ok(
  negativeTs.includes("return data.bytes[0]!;")
    && !negativeTs.includes("data.bytes!"),
  "a fresh ArrayBuffer receives no byte-cache presence assertion"
);
const negativeCheck = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, "scripts/run-typescript.mjs"),
    "legacyFloor",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--noUncheckedIndexedAccess",
    "--types",
    "node",
    "--verbatimModuleSyntax",
    "--skipLibCheck",
    "false",
    "--noEmit",
    "tests/byte-buffer-cache/out/negative/src-gen/index.ts"
  ],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(
  negativeCheck.status,
  1,
  "the unsupported mismatched-prototype program remains a strict-TypeScript failure"
);
ok(
  `${negativeCheck.stdout}${negativeCheck.stderr}`.includes("TS2741")
    && `${negativeCheck.stdout}${negativeCheck.stderr}`.includes("TS18048"),
  "the negative failures retain both structural and absent-cache diagnostics"
);

const bytesSourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/haxe/io/Bytes.ts.map")
  ) as RawSourceMap
);
const bytesOriginal = bytesSourceMap.originalPositionFor(
  generatedPoint(bytesTs, "Register.unsafeCast<Bytes | null>")
);
ok(
  bytesOriginal.source?.endsWith("src/haxe/io/Bytes.js.hx"),
  "the nullable wrapper bridge maps back to Genes' reviewed Bytes overlay"
);
strictEqual(
  bytesOriginal.line,
  sourceLine(
    readFileSync(
      path.join(repoRoot, "src/haxe/io/Bytes.js.hx"),
      "utf8"
    ),
    "var hb = untyped b.hxBytes;"
  ),
  "the nullable wrapper bridge preserves the Bytes.ofData source line"
);

const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/bytecache/Main.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(mainTs, "Register.unsafeCast<ArrayBuffer>")
);
ok(
  original.source?.endsWith("src/bytecache/Main.hx"),
  "the nullable cache bridge maps back to the authored Haxe file"
);
strictEqual(
  original.line,
  sourceLine(read("src/bytecache/Main.hx"), "return untyped @:privateAccess bytes.b.bufferValue;"),
  "the backing-buffer bridge preserves the authored source line"
);

for (const classicFile of [
  "out/classic/haxe/io/Bytes.js",
  "out/classic/js/node/buffer/Buffer.js",
  "out/standard/index.cjs"
]) {
  const source = read(classicFile);
  ok(
    !source.includes("unsafeCast<Bytes"),
    `${classicFile} contains no TypeScript identity assertion`
  );
}

process.stdout.write(
  "byte-buffer-cache:ok "
    + "(TS5/6/7 + Haxe/hxnodejs runtime + negative + maps)\n"
);
