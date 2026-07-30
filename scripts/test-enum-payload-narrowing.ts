import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/enum-payload-narrowing");
const expectedTranscript = "elided|visible|planned";

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
run("haxe", ["tests/enum-payload-narrowing/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/enum-payload-narrowing/tsconfig.generated.json"
);
run("haxe", ["tests/enum-payload-narrowing/build-classic.hxml"]);
run("haxe", ["tests/enum-payload-narrowing/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript("tests/enum-payload-narrowing/out/ts/dist/index.js"),
    transcript("tests/enum-payload-narrowing/out/standard/index.cjs")
  ],
  [expectedTranscript, expectedTranscript],
  "TypeScript-readable and standard JavaScript preserve enum behavior"
);

const implementation = read("out/ts/src-gen/enumpayload/Main.ts");
const planned =
  "Register.unsafeCast<Reduction.Reduced<number, Never, Never, string>>(value).result";
strictEqual(
  implementation.match(new RegExp(
    planned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "g"
  ))?.length,
  1,
  "the erased match receives one exact constructor-specific projection"
);
strictEqual(
  implementation.match(/switch \(value\._hx_index\)/g)?.length,
  1,
  "the ordinary match retains one visible discriminant switch"
);
ok(
  implementation.includes(
    "Register.unsafeCast<Reduction.Reduced<number, Never, Never, PlannedMarker>>(Factory.read()).result"
  ),
  "the direct receiver is evaluated once with its imported payload type"
);
strictEqual(
  implementation.match(
    /import type \{PlannedMarker\} from "\.\/marker\/PlannedMarker\.js"/g
  )?.length,
  1,
  "a type named only by Main's plan receives one type-only import"
);
for (const directRead of [
  "const error: Failure = value.error;",
  "const error1: Failure = value.error;",
  "const result: string = value.result;"
]) {
  ok(
    implementation.includes(directRead),
    `ordinary switch keeps native TypeScript narrowing: ${directRead}`
  );
}
strictEqual(
  implementation.match(/unsafeCast<Reduction\./g)?.length,
  2,
  "no visible switch payload receives a redundant assertion"
);

const classic = read("out/classic/enumpayload/Main.js");
ok(
  !classic.includes("unsafeCast") && !classic.includes("Reduction.Reduced<"),
  "classic JavaScript contains no TypeScript-only boundary syntax"
);
ok(
  classic.includes("const result = value.result"),
  "classic JavaScript keeps the original direct payload read"
);

const sourceMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/enumpayload/Main.ts.map")
  ) as RawSourceMap
);
const original = sourceMap.originalPositionFor(
  generatedPoint(implementation, planned)
);
const authoredSource = read("src/enumpayload/Main.hx");
const authoredPatternOffset = authoredSource.indexOf("case Reduced(result)");
ok(authoredPatternOffset !== -1, "the Haxe fixture contains the Reduced pattern");
const authoredPatternLine =
  authoredSource.slice(0, authoredPatternOffset).split("\n").length;
ok(
  original.source?.endsWith("src/enumpayload/Main.hx"),
  "the planned wrapper maps back to the authored Haxe module"
);
strictEqual(
  original.line,
  authoredPatternLine,
  "the planned wrapper maps to the original Reduced payload occurrence"
);

process.stdout.write(
  "enum-payload-narrowing:ok "
    + "(typed AST + TS5/6/7 + runtime + classic + maps)\n"
);
