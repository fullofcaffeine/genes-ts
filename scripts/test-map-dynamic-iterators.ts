import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashTree,
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";
import { SourceMapConsumer, type RawSourceMap } from "source-map";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/map-dynamic-iterators");
const expectedDynamic = [
  "string-values=1,2;string-entries=first=1,second=2",
  "int-values=one,two;int-entries=1=one,2=two",
  "object-values=3,4;object-entries=left=3,right=4"
].join("|");
const expectedTyped = "typed:first=1";

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

function transcript(relativeFile: string): string {
  return execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function source(relativeFile: string): string {
  return readFileSync(path.join(fixtureRoot, relativeFile), "utf8");
}

function generatedPoint(text: string, needle: string): {
  line: number;
  column: number;
} {
  const offset = text.indexOf(needle);
  ok(offset !== -1, `generated source contains ${needle}`);
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

function sourceLine(text: string, needle: string): number {
  const offset = text.lastIndexOf(needle);
  ok(offset !== -1, `authored source contains ${needle}`);
  return text.slice(0, offset).split("\n").length;
}

function genesArguments(
  main: "mapdynamic.Main" | "mapdynamic.TypedOnly",
  output: string,
  typescript: boolean
): string[] {
  return [
    "extraParams.hxml",
    "-lib", "helder.set",
    "-cp", "src",
    "-cp", "tests/map-dynamic-iterators/src",
    "--main", main,
    "-js", output,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-debug",
    "-dce", "full",
    ...(typescript ? ["-D", "genes.ts"] : [])
  ];
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
for (const build of [
  "build-classic.hxml",
  "build-ts.hxml",
  "build-typed-classic.hxml",
  "build-typed-ts.hxml"
]) {
  run("haxe", [`tests/map-dynamic-iterators/${build}`]);
}
runGeneratedTypeScriptMatrix(
  "tests/map-dynamic-iterators/tsconfig.generated.json"
);

deepStrictEqual(
  [
    transcript("tests/map-dynamic-iterators/out/classic/index.js"),
    transcript(
      "tests/map-dynamic-iterators/out/ts-dist/ts-dynamic/src-gen/index.js"
    )
  ],
  [expectedDynamic, expectedDynamic]
);
deepStrictEqual(
  [
    transcript("tests/map-dynamic-iterators/out/typed-classic/index.js"),
    transcript(
      "tests/map-dynamic-iterators/out/ts-dist/ts-typed/src-gen/index.js"
    )
  ],
  [expectedTyped, expectedTyped]
);

for (const profile of ["classic", "ts-dynamic/src-gen"]) {
  for (const mapType of ["StringMap", "IntMap", "ObjectMap"]) {
    const extension = profile === "classic" ? "js" : "ts";
    ok(
      source(`out/${profile}/haxe/ds/${mapType}.${extension}`)
        .includes("keyValueIterator()"),
      `${profile} ${mapType} keeps the dynamic key/value iterator method`
    );
  }
}

const authoredStringMap = readFileSync(
  path.join(repoRoot, "src/haxe/ds/StringMap.hx"),
  "utf8"
);
const authoredMethodLine = sourceLine(
  authoredStringMap,
  "@:runtime public inline function keyValueIterator"
);
for (const generated of [
  "out/classic/haxe/ds/StringMap.js",
  "out/ts-dynamic/src-gen/haxe/ds/StringMap.ts"
]) {
  const generatedSource = source(generated);
  const consumer = await new SourceMapConsumer(
    JSON.parse(source(`${generated}.map`)) as RawSourceMap
  );
  const original = consumer.originalPositionFor(
    generatedPoint(generatedSource, "keyValueIterator()")
  );
  ok(
    original.source?.endsWith("src/haxe/ds/StringMap.hx"),
    `${generated} maps the runtime method to the StringMap facade`
  );
  strictEqual(
    original.line,
    authoredMethodLine,
    `${generated} maps the runtime method to its authored declaration`
  );
}

const typedClassicMain = source("out/typed-classic/mapdynamic/TypedOnly.js");
const typedTypeScriptMain = source(
  "out/ts-typed/src-gen/mapdynamic/TypedOnly.ts"
);
ok(
  !typedClassicMain.includes(".keyValueIterator("),
  "classic typed Map iteration remains inline"
);
ok(
  !typedTypeScriptMain.includes(".keyValueIterator("),
  "TypeScript typed Map iteration remains inline"
);
ok(
  !source("out/typed-classic/haxe/ds/StringMap.js")
    .includes("keyValueIterator()"),
  "classic output omits the runtime method without a dynamic field read"
);

const server = await OwnedHaxeCompilerServer.start(
  repoRoot,
  selectedHaxeCompiler(repoRoot)
);
server.installSignalCleanup();
try {
  const warmClassicRoot = path.join(fixtureRoot, "out/warm-classic");
  const warmClassic = await server.compile(
    genesArguments(
      "mapdynamic.Main",
      path.join(warmClassicRoot, "index.js"),
      false
    ),
    "Warm classic dynamic Map build",
    60_000
  );
  ok(
    warmClassic.code === 0,
    `Warm classic build failed\n${warmClassic.stdout}\n${warmClassic.stderr}`
  );
  deepStrictEqual(
    hashTree(warmClassicRoot),
    hashTree(path.join(fixtureRoot, "out/classic")),
    "warm and cold classic Map output differ"
  );

  const warmTsRoot = path.join(fixtureRoot, "out/warm-ts/src-gen");
  const warmTs = await server.compile(
    genesArguments(
      "mapdynamic.Main",
      path.join(warmTsRoot, "index.ts"),
      true
    ),
    "Warm TypeScript dynamic Map build",
    60_000
  );
  ok(
    warmTs.code === 0,
    `Warm TypeScript build failed\n${warmTs.stdout}\n${warmTs.stderr}`
  );
  deepStrictEqual(
    hashTree(warmTsRoot),
    hashTree(path.join(fixtureRoot, "out/ts-dynamic/src-gen")),
    "warm and cold TypeScript Map output differ"
  );
} finally {
  await server.stop();
}

process.stdout.write(
  "map-dynamic-iterators:ok (3 map types × 2 profiles + typed and warm controls)\n"
);
