import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/nullable-temp-receivers");
const expectedTranscript = "1|1|7,8|true";

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
run("haxe", ["tests/nullable-temp-receivers/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/nullable-temp-receivers/tsconfig.generated.json"
);
run("haxe", ["tests/nullable-temp-receivers/build-classic.hxml"]);
run("haxe", ["tests/nullable-temp-receivers/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/nullable-temp-receivers/out/ts/dist/index.js"),
    transcript("tests/nullable-temp-receivers/out/classic/index.js"),
    transcript("tests/nullable-temp-receivers/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript, expectedTranscript],
  "TypeScript-readable, classic, and standard JavaScript preserve evaluation order and behavior"
);

const implementation = read(
  "out/ts/src-gen/tempreads/Main.ts"
);
ok(
  implementation.includes(
    "const _this: Receiver | null = this.receiver;"
  ),
  "the evaluate-once temporary keeps its honest nullable declaration"
);
strictEqual(
  implementation.match(/_this!\.values\.push\(value1\);/g)?.length,
  1,
  "only the exact Haxe-retagged temporary read receives one non-null assertion"
);
ok(
  implementation.includes("(this.receiver!).values.push(value);")
    && implementation.includes(
      "return (this.receiver!).values.join(\",\");"
    ),
  "direct receiver reads retain their established Haxe non-null projections"
);
ok(
  implementation.includes("let local: Receiver | null = value;")
    && implementation.includes("local = null;")
    && implementation.includes("return local;")
    && !implementation.includes("local!"),
  "an ordinary nullable local, its reassignment, and its later read remain nullable"
);
ok(
  !implementation.includes("unsafeCast<Receiver>"),
  "the read-level proof needs no printed target type or runtime helper"
);

const haxeSource = read("src/tempreads/Main.hx");
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/tempreads/Main.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(implementation, "_this!.values.push(value1)")
);
ok(
  original.source?.endsWith("src/tempreads/Main.hx"),
  "the asserted read maps back to the authored Haxe file"
);
strictEqual(
  original.line,
  sourceLine(haxeSource, "receiver.push(build(value));"),
  "the asserted temporary read preserves the authored call line"
);

for (const classicFile of [
  "out/classic/tempreads/Main.js",
  "out/standard/index.cjs"
]) {
  const source = read(classicFile);
  ok(
    !source.includes("_this!")
      && !source.includes("unsafeCast<Receiver>"),
    `${classicFile} contains no TypeScript-only assertion`
  );
}

process.stdout.write(
  "nullable-temp-receivers:ok "
    + "(TS5/6/7 + runtime + negative + classic + standard + maps)\n"
);
