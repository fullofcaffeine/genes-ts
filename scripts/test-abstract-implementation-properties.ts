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
  "tests/abstract-implementation-properties"
);
const expectedTranscript = "read|7|after|9|static-control|value";

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
run("haxe", ["tests/abstract-implementation-properties/build-ts.hxml"]);
runGeneratedTypeScriptMatrix(
  "tests/abstract-implementation-properties/tsconfig.generated.json"
);
run("haxe", ["tests/abstract-implementation-properties/build-classic.hxml"]);
run("haxe", ["tests/abstract-implementation-properties/build-standard.hxml"]);

deepStrictEqual(
  [
    transcript(
      "tests/abstract-implementation-properties/out/ts/dist/index.js"
    ),
    transcript(
      "tests/abstract-implementation-properties/out/classic/index.js"
    ),
    transcript(
      "tests/abstract-implementation-properties/out/standard/index.cjs"
    )
  ],
  [expectedTranscript, expectedTranscript, expectedTranscript]
);

const properties = [
  {
    owner: "Readable",
    property: "readable",
    helper: "static get_readable<T>(this1: T[]): T"
  },
  {
    owner: "Writable",
    property: "writable",
    helper: "static set_writable<T>(this1: T[], value: T): T"
  },
  {
    owner: "ReadWrite",
    property: "current",
    helper: "static get_current<T>(this1: T[]): T"
  },
  {
    owner: "Plain",
    property: "plain",
    helper: "static get_plain(this1: number[]): number"
  }
];

for (const { owner, property, helper } of properties) {
  const implementation = read(`out/ts/src-gen/abstractproperties/${owner}.ts`);
  ok(
    !implementation.includes(`declare static ${property}:`),
    `${owner}.${property} does not leak as a synthetic static TS property`
  );
  ok(
    implementation.includes(helper),
    `${owner}.${property} keeps its typed receiver helper`
  );

  const generatedDeclaration = read(
    `out/ts/dist/abstractproperties/${owner}.d.ts`
  );
  ok(
    !generatedDeclaration.includes(`static ${property}:`),
    `${owner}.${property} stays absent from the TS implementation declaration`
  );

  const classicDeclaration = read(
    `out/classic/abstractproperties/${owner}.d.ts`
  );
  ok(
    classicDeclaration.includes(`static readonly ${property}:`)
      || classicDeclaration.includes(`static ${property}:`),
    `${owner}.${property} remains present in the existing public declaration surface`
  );
}

const staticControl = read(
  "out/ts/src-gen/abstractproperties/StaticControl.ts"
);
ok(
  staticControl.includes("declare static label: string;"),
  "a genuine abstract static property remains declared"
);
ok(
  staticControl.includes("static get_label(): string"),
  "a similarly named static accessor without an abstract receiver remains emitted"
);

const readableTs = read("out/ts/src-gen/abstractproperties/Readable.ts");
const readableHaxe = read("src/abstractproperties/Readable.hx");
const readableMap = new SourceMapConsumer(
  JSON.parse(
    read("out/ts/src-gen/abstractproperties/Readable.ts.map")
  ) as RawSourceMap
);
const accessorOriginal = readableMap.originalPositionFor(
  generatedPoint(readableTs, "static get_readable<T>")
);
ok(
  accessorOriginal.source?.endsWith(
    "src/abstractproperties/Readable.hx"
  ),
  "the retained helper maps back to Readable.hx"
);
strictEqual(
  accessorOriginal.line,
  sourceLine(readableHaxe, "function get_readable"),
  "the retained helper keeps its exact Haxe declaration line"
);

for (const relativeFile of [
  "out/classic/abstractproperties/Readable.js",
  "out/standard/index.cjs"
]) {
  const generated = read(relativeFile);
  ok(
    !generated.includes("declare static"),
    `${relativeFile} remains free of TypeScript-only declaration syntax`
  );
}

process.stdout.write(
  "abstract-implementation-properties:ok "
    + "(typed ownership + TS5/6/7 + classic + standard)\n"
);
