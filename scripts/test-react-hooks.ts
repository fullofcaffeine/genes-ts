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
import {SourceMapConsumer, type RawSourceMap} from "source-map";
import {runGeneratedTypeScriptMatrix} from "./toolchains.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/react-hooks");

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

function sourceLine(value: string, needle: string): number {
  const offset = value.indexOf(needle);
  ok(offset !== -1, `source contains ${needle}`);
  return value.slice(0, offset).split("\n").length;
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

function assertMappedFunction(
  profile: "ts/src-gen" | "classic",
  modulePath: string,
  generatedNeedle: string,
  haxeNeedle: string
): void {
  const extension = profile === "classic" ? "js" : "ts";
  const generatedPath = path.join(
    fixtureRoot,
    "out",
    profile,
    `${modulePath}.${extension}`
  );
  const generated = readFileSync(generatedPath, "utf8");
  const haxePath = path.join(fixtureRoot, "src", `${modulePath}.hx`);
  const haxe = readFileSync(haxePath, "utf8");
  // source-map@0.6's constructor type is narrower than the v3 JSON object it
  // accepts at runtime. Keep the assertion at this one decoded file boundary.
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${generatedPath}.map`, "utf8")
  ) as RawSourceMap);
  const original = map.originalPositionFor(
    generatedPoint(generated, generatedNeedle)
  );
  ok(original.source?.endsWith(`src/${modulePath}.hx`),
    `${profile} ${generatedNeedle} maps to its Haxe module`);
  strictEqual(
    original.line,
    sourceLine(haxe, haxeNeedle),
    `${profile} ${generatedNeedle} maps to its Haxe declaration`
  );
}

function expectHaxeFailure(
  arguments_: ReadonlyArray<string>,
  diagnostic: string,
  sourceNeedle: string
): void {
  const result = spawnSync("haxe", [...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  strictEqual(result.status, 1, `${diagnostic} fixture must fail`);
  const output = `${result.stdout}${result.stderr}`;
  ok(output.includes(diagnostic), `fixture reports ${diagnostic}`);
  ok(output.includes(sourceNeedle), `fixture reports authored source`);
}

rmSync(path.join(fixtureRoot, "out"), {recursive: true, force: true});

run("haxe", ["tests/react-hooks/build-ts.hxml"]);
run("haxe", ["tests/react-hooks/build-tsx.hxml"]);
run("haxe", ["tests/react-hooks/build-classic.hxml"]);
run("haxe", ["tests/react-hooks/build-jsx.hxml"]);
const firstTree = digestTree(path.join(fixtureRoot, "out"));
run("haxe", ["tests/react-hooks/build-ts.hxml"]);
run("haxe", ["tests/react-hooks/build-tsx.hxml"]);
run("haxe", ["tests/react-hooks/build-classic.hxml"]);
run("haxe", ["tests/react-hooks/build-jsx.hxml"]);
deepStrictEqual(
  digestTree(path.join(fixtureRoot, "out")),
  firstTree,
  "React Hook output is byte-deterministic across clean-equivalent rebuilds"
);
runGeneratedTypeScriptMatrix("tests/react-hooks/tsconfig.json", {emit: false});
run(path.join(repositoryRoot, "node_modules/.bin/eslint"), [
  "--config",
  "tests/react-hooks/eslint.config.mjs",
  "tests/react-hooks/out/classic"
]);

const typed = source("out/ts/src-gen/react_hooks/Main.ts");
ok(typed.includes(
  'import {createContext, useState, useContext, useRef, useMemo, useCallback, useOptimistic, useEffect} from "react"'
),
  "TypeScript imports the canonical React Hook identities directly");
ok(typed.includes("function useCounter(initial: number): CounterView"),
  "custom Hook body is one analyzer-visible module function");
ok(typed.includes("function Counter(props: CounterProps): JSX.Element"),
  "component body is one analyzer-visible module function");
ok(typed.includes(
  "const state: UseStateResult<number> = useState<number>(initial)"
), "semantic state keeps its exact local value type on React's native tuple");
ok(typed.includes("return useState<string[]>([])"),
  "empty-array state retains its Haxe-selected element type");
ok(typed.includes("state[1](function (previous: number)"),
  "state update lowers directly to React's tuple dispatcher");
ok(typed.includes("const current: number = state[0]"),
  "computed state dependency receives one typed render-local snapshot");
ok(typed.includes("const currentLabel: string = label.toUpperCase()"),
  "effectful computed dependency is evaluated once before useMemo");
strictEqual(
  typed.match(/label\.toUpperCase\(\)/g)?.length,
  1,
  "computed dependency expression occurs exactly once"
);
ok(typed.includes(
  "}, [current, currentLabel, currentEnabled])"
), "memo callback and dependency array share the same snapshot identities");
ok(!typed.includes("new State") && !typed.includes("new Optimistic"),
  "semantic views allocate no wrapper objects");
ok(typed.includes(
  "declare static CounterLabel: import('react').Context<string>"
) && typed.includes(
  'Main_Fields_.CounterLabel = createContext("Counter")'
), "context creation retains its exact React value type");
ok(typed.includes(
  "const button = useRef<HTMLButtonElement | null>(null)"
),
  "nullable ref initialization retains its selected element type");
ok(typed.includes("return function ()"),
  "cleanup-returning effects preserve React's native cleanup callback");

const typeOnly = source(
  "out/ts/src-gen/react_hooks/TypeOnlyComponent.ts"
);
ok(typeOnly.startsWith('import type {JSX} from "react"'),
  "moved type-only component signature retains the JSX namespace import");
ok(typeOnly.includes(
  "function Identity(props: TypeOnlyComponentProps): JSX.Element"
), "component without HXX still keeps its exact source signature");
ok(typeOnly.includes(
  "function OptionalIdentity(props: TypeOnlyComponentProps): JSX.Element | null"
), "nullable component result keeps the exact render-nothing contract");

const gutenberg = source(
  "out/ts/src-gen/react_hooks/GutenbergBlock.ts"
);
ok(gutenberg.includes(
  "function BlockEdit(props: BlockEditProps): JSX.Element"
), "Gutenberg-shaped consumer uses the same analyzer-visible component contract");
ok(gutenberg.includes(
  "const selected: UseStateResult<boolean> = useState<boolean>(false)"
),
  "Gutenberg-shaped consumer keeps semantic state on the native Hook");

const stateInitialization = source(
  "out/ts/src-gen/react_hooks/StateInitialization.ts"
);
ok(stateInitialization.includes(
  'import type {Animal, Cat, Dog} from "./StateInitializationTypes.js"'
), "state witness types are allocated before TypeScript emission");
ok(stateInitialization.includes(
  "useState<Animal>(makeCat())"
), "eager state uses the exact wider local type");
ok(stateInitialization.includes(
  "useState<Animal>(function ()"
), "lazy state uses the same exact wider local type");
ok(stateInitialization.includes(
  "useState<Cat>(cat)"
), "an unannotated state remains narrow");
ok(stateInitialization.includes(
  "useState<Choice<number, string>>(Choice.Left<number, string>(1))"
), "generic enum state closes every parameter after local typing");
strictEqual(
  stateInitialization.match(/makeCat\(\)/g)?.length,
  2,
  "each eager and lazy initializer remains single-evaluation"
);

const stateInitializationTsx = source(
  "out/tsx/src-gen/react_hooks/StateInitialization.tsx"
);
for (const expected of [
  "useState<Animal>(makeCat())",
  "useState<Animal>(function ()",
  "useState<Cat>(cat)",
  "useState<Choice<number, string>>(Choice.Left<number, string>(1))"
]) {
  ok(stateInitializationTsx.includes(expected),
    `TSX state initialization retains ${expected}`);
}

const classic = source("out/classic/react_hooks/Main.js");
ok(classic.includes(
  'import {createContext, useState, useContext, useRef, useMemo, useCallback, useOptimistic, useEffect} from "react"'
), "classic output imports the same canonical React identities");
ok(classic.includes("function useCounter(initial)"),
  "classic output retains the analyzer-visible custom Hook");
ok(classic.includes("function Counter(props)"),
  "classic output retains the analyzer-visible component");
ok(classic.includes("const current = state[0]"),
  "classic output preserves the computed state snapshot");
ok(classic.includes("const currentLabel = label.toUpperCase()"),
  "classic output evaluates the computed dependency exactly once");
strictEqual(
  classic.match(/label\.toUpperCase\(\)/g)?.length,
  1,
  "classic computed dependency expression occurs exactly once"
);
ok(classic.includes(
  "}, [current, currentLabel, currentEnabled])"
), "classic callback and dependency array share snapshot identities");
ok(!/\b(?:Dynamic|untyped|any|unknown)\b/.test(typed),
  "typed implementation introduces no broad boundary type");

for (const profile of ["classic", "jsx"]) {
  const extension = profile === "classic" ? "js" : "jsx";
  const stateSource = source(
    `out/${profile}/react_hooks/StateInitialization.${extension}`
  );
  ok(stateSource.includes("useState(makeCat())")
    && stateSource.includes("useState(function ()")
    && stateSource.includes("useState(cat)")
    && stateSource.includes("useState(Choice.Left(1))"),
  `${profile} erases state type witnesses`);
  ok(!stateSource.includes("useState<"),
    `${profile} contains no TypeScript call syntax`);
  strictEqual(
    stateSource.match(/makeCat\(\)/g)?.length,
    2,
    `${profile} preserves single initializer evaluation`
  );
}

for (const profile of ["ts/src-gen", "classic"]) {
  const mainMap = path.join(fixtureRoot, "out", profile,
    "react_hooks/Main." + (profile === "classic" ? "js.map" : "ts.map"));
  ok(existsSync(mainMap), `${profile} emits a source map`);
}
for (const profile of ["ts/src-gen", "classic"] as const) {
  assertMappedFunction(
    profile,
    "react_hooks/Main",
    "function useCounter",
    "function useCounter"
  );
  assertMappedFunction(
    profile,
    "react_hooks/Main",
    "function Counter",
    "function Counter"
  );
  assertMappedFunction(
    profile,
    "react_hooks/Main",
    "function useComputedSummary",
    "function useComputedSummary"
  );
  assertMappedFunction(
    profile,
    "react_hooks/GutenbergBlock",
    "function BlockEdit",
    "function BlockEdit"
  );
  assertMappedFunction(
    profile,
    "react_hooks/TypeOnlyComponent",
    "function Identity",
    "function Identity"
  );
  assertMappedFunction(
    profile,
    "react_hooks/TypeOnlyComponent",
    "function OptionalIdentity",
    "function OptionalIdentity"
  );
}

expectHaxeFailure(
  ["tests/react-hooks/build-negative.hxml"],
  "GTS-REACT-STATE-001",
  "CallableState.hx"
);
expectHaxeFailure(
  ["tests/react-hooks/build-effect-negative.hxml"],
  "GTS-REACT-EFFECT-001",
  "EffectNegative.hx"
);
expectHaxeFailure(
  ["tests/react-hooks/build-placement-negative.hxml"],
  "GTS-REACT-HOOK-002",
  "HookPlacementNegative.hx"
);
for (const define of [
  undefined,
  "react_memo_snapshot_arity",
  "react_memo_snapshot_named",
  "react_memo_snapshot_rest",
  "react_memo_snapshot_type"
]) {
  expectHaxeFailure(
    [
      "tests/react-hooks/build-memo-snapshot-negative.hxml",
      ...(define === undefined ? [] : ["-D", define])
    ],
    "GTS-REACT-DEPS-002",
    "MemoSnapshotNegative.hx"
  );
}
for (const define of [
  "react_hook_loop",
  "react_hook_nested",
  "react_hook_protected",
  "react_hook_after_return"
]) {
  expectHaxeFailure(
    [
      "tests/react-hooks/build-placement-negative.hxml",
      "-D",
      define
    ],
    "GTS-REACT-HOOK-002",
    "HookPlacementNegative.hx"
  );
}
expectHaxeFailure(
  [
    "tests/react-hooks/build-placement-negative.hxml",
    "-D",
    "react_hook_outside"
  ],
  "GTS-REACT-HOOK-001",
  "HookPlacementNegative.hx"
);

for (const [define, diagnostic] of [
  ["react_component_second_argument", "GTS-REACT-COMPONENT-SIGNATURE-007"],
  ["react_component_wrong_return", "GTS-REACT-COMPONENT-SIGNATURE-008"],
  ["react_component_rest_argument", "GTS-REACT-COMPONENT-SIGNATURE-009"],
  ["react_component_value_field", "GTS-REACT-COMPONENT-SIGNATURE-010"],
  ["react_component_lowercase", "GTS-REACT-METADATA-005"],
  ["react_component_duplicate_module_marker", "GTS-REACT-ANALYZER-006"],
  ["react_component_overload", "GENES-MODULE-FUNCTION-OVERLOAD-009"]
] as const) {
  expectHaxeFailure(
    [
      "tests/react-hooks/build-component-signature-negative.hxml",
      "-D",
      define
    ],
    diagnostic,
    "ComponentSignatureNegative.hx"
  );
}

const lintControl = spawnSync(
  path.join(repositoryRoot, "node_modules/.bin/eslint"),
  [
    "--config",
    "tests/react-hooks/eslint.config.mjs",
    "tests/react-hooks/lint/invalid.js"
  ],
  {cwd: repositoryRoot, encoding: "utf8"}
);
strictEqual(lintControl.status, 1,
  "official React Hooks lint rejects the deliberate native control");
ok(`${lintControl.stdout}${lintControl.stderr}`.includes(
  "React Hook \"useState\" is called conditionally"
), "official React Hooks lint reports the conditional Hook");

console.log("genes.react Hook authoring evidence passed");
