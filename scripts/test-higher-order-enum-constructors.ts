import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(
  repoRoot,
  "tests/higher-order-enum-constructors"
);
const expectedTranscript = "left|planned|direct|lambda";

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
run("haxe", ["tests/higher-order-enum-constructors/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/higher-order-enum-constructors/tsconfig.generated.json"
);
run("haxe", ["tests/higher-order-enum-constructors/build-classic.hxml"]);
run("haxe", ["tests/higher-order-enum-constructors/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript(
      "tests/higher-order-enum-constructors/out/ts/dist/index.js"
    ),
    transcript(
      "tests/higher-order-enum-constructors/out/standard/index.cjs"
    )
  ],
  [expectedTranscript, expectedTranscript],
  "TypeScript-readable and standard JavaScript preserve enum behavior"
);

const implementation = read(
  "out/ts/src-gen/enumconstructors/Main.ts"
);
for (const reference of [
  "Choice.Left<A, B>",
  "Choice.Right<A, B>",
  "Choice.Left<string, PlannedMarker>"
]) {
  ok(
    implementation.includes(reference),
    `planned constructor reference keeps exact destination: ${reference}`
  );
}
ok(
  implementation.includes("return Choice.Left<A, B>(value);"),
  "ordinary lambda remains a function and calls its constructor normally"
);
ok(
  implementation.includes("return Choice.Right<A, B>(value);"),
  "second ordinary lambda remains a function and calls its constructor normally"
);
ok(
  implementation.includes("Choice.Left<string, number>(\"direct\")"),
  "direct enum call retains its existing destination-driven plan"
);
strictEqual(
  implementation.match(/Main\.map\(left, Choice\.Left<A, B>\)/g)?.length,
  1,
  "one bare constructor function value creates one instantiation expression"
);

const markerImport = implementation.match(
  /import type \{PlannedMarker\} from "\.\/marker\/PlannedMarker\.js"/g
);
strictEqual(
  markerImport?.length,
  1,
  "a type named only by the plan receives one type-only import"
);

for (const classicFile of [
  "out/classic/enumconstructors/Main.js",
  "out/standard/index.cjs"
]) {
  const source = read(classicFile);
  ok(
    !source.includes("Choice.Left<A, B>"),
    `${classicFile} contains no TypeScript instantiation expression`
  );
}

const haxeSource = read("src/enumconstructors/Main.hx");
const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/enumconstructors/Main.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(implementation, "Choice.Left<A, B>")
);
ok(
  original.source?.endsWith("src/enumconstructors/Main.hx"),
  "the instantiation expression maps back to Main.hx"
);
strictEqual(
  original.line,
  sourceLine(haxeSource, "map(left, Choice.Left)"),
  "the planned type arguments preserve the authored constructor line"
);

process.stdout.write(
  "higher-order-enum-constructors:ok "
    + "(TS5/6/7 + imports + classic + standard + maps)\n"
);
