import {deepStrictEqual, ok, strictEqual} from "node:assert";
import {execFileSync} from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SourceMapConsumer, type RawSourceMap} from "source-map";
import {
  runGeneratedTypeScriptMatrix,
  runTypeScript
} from "./toolchains.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/hxx-direct-import-source");
const outputRoot = path.join(fixtureRoot, "out");

type Transcript = {
  readonly direct: string;
  readonly named: string;
  readonly dotted: string;
  readonly object: string;
  readonly dottedReads: readonly string[];
  readonly objectReads: readonly string[];
};

function run(command: string, arguments_: readonly string[]): void {
  execFileSync(command, [...arguments_], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
}

function text(relativePath: string): string {
  return readFileSync(path.join(fixtureRoot, relativePath), "utf8");
}

function copyComponents(profile: "ts" | "tsx" | "js" | "jsx"): void {
  const extension = profile === "ts" || profile === "tsx" ? ".tsx" : ".js";
  const destination = path.join(outputRoot, profile, "components");
  mkdirSync(destination, {recursive: true});
  for (const name of ["Child", "Parent", "Dotted", "Object"]) {
    cpSync(
      path.join(fixtureRoot, "components", `${name}${extension}`),
      path.join(destination, `${name}${extension}`)
    );
  }
}

function generatedPoint(value: string, needle: string): {
  readonly line: number;
  readonly column: number;
} {
  const offset = value.indexOf(needle);
  ok(offset !== -1, `generated source contains ${needle}`);
  const before = value.slice(0, offset);
  const lines = before.split("\n");
  return {line: lines.length, column: lines.at(-1)?.length ?? 0};
}

function sourceLine(value: string, needle: string): number {
  const offset = value.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return value.slice(0, offset).split("\n").length;
}

function assertSourceMap(profile: "tsx" | "jsx"): void {
  const generatedPath = path.join(outputRoot, profile, `Main.${profile}`);
  const generated = readFileSync(generatedPath, "utf8");
  const authored = text("src/Main.hx");
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap);
  for (const [generatedNeedle, authoredNeedle, label] of [
    ["<Child />", "<DirectComponents.Child />", "default"],
    ["<NamedChild />", "<NamedComponents.NamedChild />", "named"]
  ] as const) {
    const original = map.originalPositionFor(
      generatedPoint(generated, generatedNeedle)
    );
    ok(original.source?.endsWith("src/Main.hx"),
      `${profile} ${label} child maps to the authored Haxe module`);
    strictEqual(
      original.line,
      sourceLine(authored, authoredNeedle),
      `${profile} ${label} child maps to the authored child expression`
    );
  }
}

function execute(modulePath: string): Transcript {
  return JSON.parse(execFileSync(process.execPath, [modulePath], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim()) as Transcript;
}

rmSync(outputRoot, {recursive: true, force: true});
for (const profile of ["tsx", "ts", "jsx", "js"] as const) {
  run(path.join(repositoryRoot, "node_modules/.bin/haxe"), [
    `tests/hxx-direct-import-source/build.${profile}.hxml`
  ]);
  copyComponents(profile);
}

const tsx = text("out/tsx/Main.tsx");
const jsx = text("out/jsx/Main.jsx");
const typedCalls = text("out/ts/Main.ts");
const classicCalls = text("out/js/Main.js");

for (const [profile, source] of [["tsx", tsx], ["jsx", jsx]] as const) {
  ok(source.includes("return <Parent><Child /></Parent>"),
    `${profile} nests direct default-imported component children`);
  ok(source.includes("return <NamedParent><NamedChild /></NamedParent>"),
    `${profile} nests direct named-imported component children`);
  ok(!/const \w+(?:\: JSX\.Element)? = <Child \/>/.test(source),
    `${profile} removes the default-import child temporary`);
  ok(!/const \w+(?:\: JSX\.Element)? = <NamedChild \/>/.test(source),
    `${profile} removes the named-import child temporary`);
  ok(/const tmp(?:\: JSX\.Element)? = <Components\.Child \/>/.test(source),
    `${profile} preserves the dotted getter-capable child read`);
  ok(source.includes("return <Components.Parent>{tmp}</Components.Parent>"),
    `${profile} preserves dotted component evaluation order`);
  ok(/const tmp(?:\: JSX\.Element)? = <ObjectComponents\.Child \/>/.test(source),
    `${profile} preserves the object-backed child read`);
  ok(source.includes("return <ObjectComponents.Parent>{tmp}</ObjectComponents.Parent>"),
    `${profile} preserves object-backed component evaluation order`);
}
ok(typedCalls.includes("const tmp: JSX.Element = React__genes_jsx.createElement(Child"),
  "typed createElement output retains its existing explicit child schedule");
ok(typedCalls.includes("const tmp: JSX.Element = React__genes_jsx.createElement(NamedChild"),
  "typed createElement output retains named-import child scheduling");
ok(classicCalls.includes("const tmp = React__genes_jsx.createElement(Child"),
  "classic createElement output retains its existing explicit child schedule");
ok(classicCalls.includes("const tmp = React__genes_jsx.createElement(NamedChild"),
  "classic createElement output retains named-import child scheduling");

assertSourceMap("tsx");
assertSourceMap("jsx");
runGeneratedTypeScriptMatrix("tests/hxx-direct-import-source/tsconfig.tsx.json");
runGeneratedTypeScriptMatrix("tests/hxx-direct-import-source/tsconfig.ts.json");

runTypeScript("apiBridge", [
  "-p",
  "tests/hxx-direct-import-source/tsconfig.jsx.json"
]);

const expected: Transcript = {
  direct: "<section><span>child</span></section>",
  named: "<nav><i>named</i></nav>",
  dotted: "<article><em>dotted</em></article>",
  object: "<aside><b>object</b></aside>",
  dottedReads: ["dotted-child-read", "dotted-parent-read"],
  objectReads: ["object-child-read", "object-parent-read"]
};
deepStrictEqual(execute(path.join(outputRoot, "tsx-dist/index.js")), expected,
  "strict TSX runtime preserves markup and observable field-read order");
deepStrictEqual(execute(path.join(outputRoot, "ts-dist/index.js")), expected,
  "typed createElement runtime matches strict TSX");
deepStrictEqual(execute(path.join(outputRoot, "jsx-dist/index.js")), expected,
  "source JSX runtime matches strict TSX");
deepStrictEqual(execute(path.join(outputRoot, "js/index.js")), expected,
  "classic createElement runtime matches strict TSX");

console.log("Direct-import source JSX checks passed.");
