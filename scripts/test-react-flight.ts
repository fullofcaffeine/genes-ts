import {deepStrictEqual, ok, strictEqual} from "node:assert";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runGeneratedTypeScriptMatrix} from "./toolchains.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/react-flight");

function run(command: string, arguments_: ReadonlyArray<string>): void {
  execFileSync(command, [...arguments_], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
}

function source(relativePath: string): string {
  return readFileSync(path.join(fixtureRoot, relativePath), "utf8");
}

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, {withFileTypes: true})
    .flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() ? files(child) : [child];
    })
    .sort((left, right) => left.localeCompare(right));
}

function digestTree(root: string): string[] {
  return files(root).map((file) => {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${relative}:${digest}`;
  });
}

function expectFlightFailure(
  main: string,
  pathNeedle: string,
  reasonNeedle: string
): void {
  const result = spawnSync(
    "haxe",
    [
      "-lib",
      "genes-ts",
      "-cp",
      "tests/react-flight/src",
      "-main",
      `react_flight.${main}`,
      "-js",
      `tests/react-flight/out/negative/${main}.ts`,
      "-D",
      "genes.ts",
      "-D",
      "js-es=6",
      "-dce",
      "full"
    ],
    {cwd: repositoryRoot, encoding: "utf8"}
  );
  strictEqual(result.status, 1, `${main} must fail before output`);
  const output = `${result.stdout}${result.stderr}`;
  ok(output.includes("GTS-REACT-FLIGHT-001"),
    `${main} reports the host fixture diagnostic`);
  ok(output.includes("FlightFixtureTypes.hx"),
    `${main} reports the rejected Haxe field rather than the macro call`);
  ok(output.includes(pathNeedle), `${main} reports the nested value path`);
  ok(output.includes(reasonNeedle), `${main} reports the exact rejection`);
  ok(!existsSync(path.join(fixtureRoot, "out", "negative", `${main}.ts`)),
    `${main} publishes no invalid output`);
}

function expectTypeFailure(
  main: string,
  sourceNeedle: string,
  reasonNeedle: string
): void {
  const result = spawnSync(
    "haxe",
    [
      "-lib",
      "genes-ts",
      "-cp",
      "tests/react-flight/src",
      "-main",
      `react_flight.${main}`,
      "-js",
      `tests/react-flight/out/negative/${main}.ts`,
      "-D",
      "genes.ts",
      "-D",
      "js-es=6",
      "-dce",
      "full"
    ],
    {cwd: repositoryRoot, encoding: "utf8"}
  );
  strictEqual(result.status, 1, `${main} must fail during Haxe typing`);
  const output = `${result.stdout}${result.stderr}`;
  ok(output.includes(sourceNeedle), `${main} reports the authored Haxe source`);
  ok(output.includes(reasonNeedle), `${main} reports the rejected assignment`);
  ok(!existsSync(path.join(fixtureRoot, "out", "negative", `${main}.ts`)),
    `${main} publishes no invalid output`);
}

rmSync(path.join(fixtureRoot, "out"), {recursive: true, force: true});

run("haxe", ["tests/react-flight/build-ts.hxml"]);
run("haxe", ["tests/react-flight/build-classic.hxml"]);
const firstTree = digestTree(path.join(fixtureRoot, "out"));
run("haxe", ["tests/react-flight/build-ts.hxml"]);
run("haxe", ["tests/react-flight/build-classic.hxml"]);
deepStrictEqual(
  digestTree(path.join(fixtureRoot, "out")),
  firstTree,
  "React Flight output is byte-deterministic across equivalent rebuilds"
);

runGeneratedTypeScriptMatrix("tests/react-flight/tsconfig.json", {emit: false});
run("node", ["tests/react-flight/out/classic/index.js"]);

const typed = source("out/ts/src-gen/react_flight/Main.ts");
const classic = source("out/classic/react_flight/Main.js");
const typedCompatibility = source(
  "out/ts/src-gen/react_flight/CompatibilityAliases.ts"
);
for (const [profile, output] of [
  ["TypeScript", typed],
  ["classic", classic]
] as const) {
  ok(output.includes('Symbol.for("genes.fixture")'),
    `${profile} emits the canonical global symbol factory`);
  ok(output.includes("Symbol.keyFor("),
    `${profile} emits canonical global symbol-key lookup`);
  ok(output.includes("new Map()"),
    `${profile} preserves the native JavaScript Map identity`);
  ok(output.includes(".forEach("),
    `${profile} preserves the familiar native Map callback API`);
  ok(!output.includes("GlobalSymbolFactory")
      && !output.includes("FlightMap"),
    `${profile} introduces no React Flight wrapper runtime`);
}
ok(typedCompatibility.includes("formatDate(value: Date): string"),
  "semantic-only compatibility alias follows through to native Date");
ok(!typedCompatibility.includes("HostFlightDate")
    && !typed.includes("HostFlightDate"),
  "semantic-only compatibility alias creates no phantom emitted type");
for (const profile of ["ts/src-gen", "classic"]) {
  ok(existsSync(path.join(
    fixtureRoot,
    "out",
    profile,
    "react_flight",
    `Main.${profile === "classic" ? "js" : "ts"}.map`
  )), `${profile} emits a source map`);
}

expectFlightFailure(
  "NegativeRawPromise",
  "RawPromisePayload.resource",
  "ordinary Promise"
);
expectFlightFailure(
  "NegativeRawDate",
  "RawDatePayload.createdAt",
  "class instances"
);
expectFlightFailure(
  "NegativeRawMap",
  "RawMapPayload.entries",
  "class instances"
);
expectFlightFailure(
  "NegativeRawSet",
  "RawSetPayload.labels",
  "class instances"
);
expectFlightFailure(
  "NegativeRawArrayBuffer",
  "RawArrayBufferPayload.bytes",
  "class instances"
);
expectFlightFailure(
  "NegativeRawTypedArray",
  "RawTypedArrayPayload.bytes",
  "class instances"
);
expectFlightFailure(
  "NegativeNestedResource",
  "InvalidNestedResource.resource.resolved.callback",
  "ordinary functions"
);
expectFlightFailure(
  "NegativeHostCycle",
  "CyclicHostCapability.resource.again",
  "recursive or cyclic host capability graphs"
);
expectFlightFailure(
  "NegativeRawSymbol",
  "RawSymbolPayload.marker",
  "raw symbol"
);
expectFlightFailure(
  "NegativeFunction",
  "FunctionPayload.callback",
  "ordinary functions"
);
expectFlightFailure(
  "NegativeClass",
  "ClassPayload.record",
  "class instances"
);
expectFlightFailure(
  "NegativeDynamic",
  "DynamicPayload.value",
  "broad dynamic value"
);
expectFlightFailure(
  "NegativeUnknown",
  "UnknownPayload.value",
  "broad external-boundary values"
);
expectFlightFailure(
  "NegativeEnum",
  "EnumPayload.choice",
  "runtime Haxe enum instances"
);
expectFlightFailure(
  "NegativeRecursive",
  "RecursivePayload.child",
  "recursive or cyclic value graphs"
);
expectTypeFailure(
  "NegativeForgedGlobalSymbol",
  "NegativeForgedGlobalSymbol.hx",
  "js.lib.Symbol should be genes.react.flight.v19.FlightGlobalSymbol"
);

console.log("genes.react React 19 Flight value evidence passed");
