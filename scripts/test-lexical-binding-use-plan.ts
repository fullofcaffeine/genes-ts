import {
  deepStrictEqual,
  match,
  ok,
  strictEqual
} from "node:assert";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compilerOutputSentinel,
  hashTree,
  leakedOutputStages
} from "./compiler-server-lifecycle.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = "tests/lexical-binding-use-plan";
const outputRoot = path.join(repoRoot, fixtureRoot, "out/gate");
const inventoryPrefix = "[GTS-LEXICAL-INVENTORY] lexicalbinding.";

type Profile = {
  readonly id: "classic" | "ts";
  readonly extension: "js" | "ts";
  readonly defines: ReadonlyArray<string>;
};

const profiles: ReadonlyArray<Profile> = [
  { id: "classic", extension: "js", defines: [] },
  { id: "ts", extension: "ts", defines: ["genes.ts"] }
];

function profileRoot(profile: Profile): string {
  return path.join(outputRoot, profile.id);
}

function outputFile(profile: Profile): string {
  return path.join(profileRoot(profile), `index.${profile.extension}`);
}

function buildArguments(
  profile: Profile,
  extraDefines: ReadonlyArray<string> = []
): string[] {
  return [
    "-lib", "genes-ts",
    "-cp", `${fixtureRoot}/src`,
    "--main", "lexicalbinding.Main",
    "--macro", "include('lexicalbinding.LazyOne')",
    "--macro", "include('lexicalbinding.LazyTwo')",
    "-js", path.relative(repoRoot, outputFile(profile)),
    ...profile.defines.concat(extraDefines)
      .flatMap((define) => ["-D", define]),
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full"
  ];
}

function compile(
  profile: Profile,
  extraDefines: ReadonlyArray<string> = []
): SpawnSyncReturns<string> {
  const result = spawnSync("haxe", buildArguments(profile, extraDefines), {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function successfulCompile(
  profile: Profile,
  extraDefines: ReadonlyArray<string> = []
): string {
  const result = compile(profile, extraDefines);
  const output = `${result.stdout}${result.stderr}`;
  strictEqual(
    result.status,
    0,
    `${profile.id} lexical binding-use build failed:\n${output}`
  );
  return output;
}

function inventory(output: string): string[] {
  return output.split(/\r?\n/)
    .filter((line) => line.startsWith(inventoryPrefix));
}

function requireInventoryLine(lines: ReadonlyArray<string>, suffix: string): void {
  ok(
    lines.includes(`${inventoryPrefix}${suffix}`),
    `Missing lexical inventory fact: ${suffix}\n${lines.join("\n")}`
  );
}

function counts(
  lines: ReadonlyArray<string>,
  module: "DeepFour" | "DeepEight"
): { expressions: number; scopes: number } {
  const prefix = `${inventoryPrefix}${module}:counts:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  ok(line !== undefined, `Missing ${module} structural counts`);
  const values = line.slice(prefix.length).split(":").map(Number);
  strictEqual(values.length, 5, `${module} count tuple has five values`);
  ok(values.every(Number.isFinite), `${module} counts are numeric`);
  return { expressions: values[0], scopes: values[1] };
}

function assertInventory(lines: ReadonlyArray<string>): void {
  for (const suffix of [
    "Main:classic:root:Boot:1",
    "Main:classic:root:Error:1",
    "Main:classic:root:setState:1",
    "Main:classic:root:setStateFunction:1",
    "Main:classic:root:setStateValue:1",
    "Main:classic:opaque:2:2-2",
    "Main:typescript:root:Boot:1",
    "Main:typescript:root:globalThis:1",
    "Main:typescript:root:setState:1",
    "Main:typescript:root:setStateFunction:1",
    "Main:typescript:root:setStateValue:1",
    "Main:typescript:opaque:2:2-2",
    "DynamicCases:classic:root:LazyOne:2",
    "DynamicCases:classic:root:LazyTwo:3",
    "DynamicCases:classic:root:setStateLazyOne:2",
    "DynamicCases:classic:root:setStateLazyTwo:3",
    "DynamicCases:classic:fixed:2:LazyOne",
    "DynamicCases:classic:fixed:2:setStateLazyOne",
    "DynamicCases:classic:fixed:3:LazyTwo",
    "DynamicCases:classic:fixed:3:setStateLazyTwo",
    "DynamicCases:typescript:root:LazyOne:2",
    "DynamicCases:typescript:root:LazyTwo:3",
    "DynamicCases:typescript:root:setStateLazyOne:2",
    "DynamicCases:typescript:root:setStateLazyTwo:3",
    "DynamicCases:typescript:fixed:2:LazyOne",
    "DynamicCases:typescript:fixed:2:setStateLazyOne",
    "DynamicCases:typescript:fixed:3:LazyTwo",
    "DynamicCases:typescript:fixed:3:setStateLazyTwo"
  ]) {
    requireInventoryLine(lines, suffix);
  }

  for (const profile of ["classic", "typescript"] as const) {
    for (const fact of [
      "query:clean:opaque:false",
      "query:clean:function-captures:1",
      "query:clean:conflict:queryRoot:false",
      "query:clean:conflict:missing:false",
      "query:dynamic:opaque:false",
      "query:dynamic:function-captures:2",
      "query:dynamic:conflict:LazyOne:true",
      "query:dynamic:conflict:LazyTwo:false",
      "query:host:opaque:false",
      "query:host:function-captures:1",
      "query:nested-dynamic:opaque:false",
      "query:nested-dynamic:function-captures:3",
      "query:nested-dynamic:conflict:InnerLazyOne:true",
      "query:nested-dynamic:conflict:OuterLazyOne:true",
      "query:nested-dynamic:conflict:SiblingLazyOne:false",
      "query:outer:opaque:true",
      "query:outer:function-captures:2",
      "query:outer:conflict:queryRoot:true",
      "query:outer:conflict:missing:false",
      "query:outer:function:capture:true",
      "query:outer:function:sibling:false",
      "query:outer:scope:capture:true",
      "query:outer:scope:sibling:false"
    ]) {
      requireInventoryLine(lines, `QueryCases:${profile}:${fact}`);
    }
  }
  for (const fact of [
    "classic:query:host:conflict:Error:true",
    "classic:query:host:conflict:globalThis:false",
    "typescript:query:host:conflict:Error:false",
    "typescript:query:host:conflict:globalThis:true"
  ]) {
    requireInventoryLine(lines, `QueryCases:${fact}`);
  }

  for (const suffix of [
    "StructuralClassCases:classic:root:RuntimeInterface:0",
    "StructuralClassCases:typescript:root:RuntimeInterface:0",
    "StructuralEnumCases:classic:root:Object:0",
    "StructuralEnumCases:classic:root:Register:0",
    "StructuralEnumCases:typescript:root:Object:0",
    "StructuralEnumCases:typescript:root:Register:0"
  ]) {
    requireInventoryLine(lines, suffix);
  }

  ok(
    !lines.some((line) => line.includes(":classic:root:globalThis:")),
    "Classic roots must not use TypeScript's globalThis spelling"
  );
  ok(
    !lines.some((line) => line.includes("Main:typescript:root:Error:")),
    "TypeScript host globals must not reserve the bare Error spelling"
  );
  ok(
    !lines.some((line) => line.includes(":root:TypeOnlyRoot:")),
    "Type-only declarations must not become runtime lexical roots"
  );
  ok(
    !lines.some((line) => line.includes("DynamicCases:")
      && line.includes(":opaque:")),
    "Compiler-owned dynamic-import setup must not make a lazy scope opaque"
  );

  const four = counts(lines, "DeepFour");
  const eight = counts(lines, "DeepEight");
  deepStrictEqual(four, { expressions: 29, scopes: 6 });
  deepStrictEqual(eight, { expressions: 49, scopes: 10 });
  ok(
    eight.expressions < four.expressions * 2,
    "Doubling closure depth must add less than double expression work"
  );
  ok(
    eight.scopes < four.scopes * 2,
    "Doubling closure depth must add less than double scope work"
  );
}

function assertGeneratedShape(): void {
  const tsMain = readFileSync(path.join(
    profileRoot(profiles[1]), "lexicalbinding/Main.ts"
  ), "utf8");
  const classicMain = readFileSync(path.join(
    profileRoot(profiles[0]), "lexicalbinding/Main.js"
  ), "utf8");
  const dynamicTs = readFileSync(path.join(
    profileRoot(profiles[1]), "lexicalbinding/DynamicCases.ts"
  ), "utf8");
  const queryTs = readFileSync(path.join(
    profileRoot(profiles[1]), "lexicalbinding/QueryCases.ts"
  ), "utf8");
  const queryClassic = readFileSync(path.join(
    profileRoot(profiles[0]), "lexicalbinding/QueryCases.js"
  ), "utf8");
  const structuralTs = readFileSync(path.join(
    profileRoot(profiles[1]), "lexicalbinding/StructuralClassCases.ts"
  ), "utf8");
  const structuralClassic = readFileSync(path.join(
    profileRoot(profiles[0]), "lexicalbinding/StructuralClassCases.js"
  ), "utf8");
  const enumTs = readFileSync(path.join(
    profileRoot(profiles[1]), "lexicalbinding/StructuralEnumCases.ts"
  ), "utf8");
  const enumClassic = readFileSync(path.join(
    profileRoot(profiles[0]), "lexicalbinding/StructuralEnumCases.js"
  ), "utf8");

  ok(tsMain.includes("const directType: any = setState.Factory"));
  ok(tsMain.includes("const hostType: any = globalThis.Error"));
  ok(tsMain.includes("Boot.__cast(value, setState.Factory)"));
  ok(tsMain.includes("new setState.Factory()"));
  ok(tsMain.includes("setStateFunction()") && tsMain.includes("setStateValue"));
  ok(tsMain.includes("typeOnly(value: TypeOnlyRoot.Value): TypeOnlyRoot.Value"));
  ok(classicMain.includes("const hostType = Error"));
  ok(!classicMain.includes("globalThis.Error"));
  ok(dynamicTs.includes(
    'var LazyOne = (module as typeof import("./LazyOne.js")).LazyOne'
  ));
  ok(dynamicTs.includes(
    'var setStateLazyOne = (module as typeof import("./LazyOne.js")).setStateLazyOne'
  ));
  ok(dynamicTs.includes(
    'var LazyTwo = (module as typeof import("./LazyTwo.js")).LazyTwo'
  ));
  ok(dynamicTs.includes(
    'var setStateLazyTwo = (module as typeof import("./LazyTwo.js")).setStateLazyTwo'
  ));
  ok(!dynamicTs.includes("DynamicBindingDeclarationMarker"));
  for (const generated of [queryTs, queryClassic]) {
    ok(!generated.includes("LexicalBindingQueryMarker"));
    ok(!generated.includes("genesLexicalBindingQuery"));
    ok(generated.includes("var OuterLazyOne ="));
    ok(generated.includes("var InnerLazyOne ="));
    ok(generated.includes("var SiblingLazyOne ="));
    ok(generated.includes(",InnerLazyOne);"));
    ok(!generated.includes(",OuterLazyOne);"));
  }
  for (const generated of [structuralTs, structuralClassic])
    ok(generated.includes("return [RuntimeInterface]"));
  for (const generated of [enumTs, enumClassic])
    ok(generated.includes("Object.assign("));
}

rmSync(outputRoot, { recursive: true, force: true });

const inventories = new Map<Profile["id"], string[]>();
for (const profile of profiles) {
  const baselineLog = successfulCompile(profile);
  strictEqual(
    inventory(baselineLog).length,
    0,
    `${profile.id} ordinary build unexpectedly requested inventory`
  );
  const baselineTree = hashTree(profileRoot(profile));

  const firstInventory = inventory(successfulCompile(profile,
    ["genes.lexical_binding_inventory"]));
  ok(firstInventory.length > 0, `${profile.id} inventory was empty`);
  deepStrictEqual(
    hashTree(profileRoot(profile)),
    baselineTree,
    `${profile.id} inventory changed generated output`
  );

  const secondInventory = inventory(successfulCompile(profile,
    ["genes.lexical_binding_inventory"]));
  deepStrictEqual(secondInventory, firstInventory,
    `${profile.id} inventory order changed between identical builds`);
  deepStrictEqual(
    hashTree(profileRoot(profile)),
    baselineTree,
    `${profile.id} repeated inventory changed generated output`
  );
  inventories.set(profile.id, firstInventory);
  strictEqual(
    existsSync(compilerOutputSentinel(outputFile(profile))),
    false,
    `${profile.id} left its private Haxe output sentinel`
  );
}

deepStrictEqual(
  inventories.get("ts"),
  inventories.get("classic"),
  "Both implementation profiles must consume one target-neutral inventory"
);
assertInventory(inventories.get("ts") ?? []);
assertGeneratedShape();

runGeneratedTypeScriptMatrix(
  "tests/lexical-binding-use-plan/tsconfig.json",
  { emit: false }
);

const tsProfile = profiles[1];
const lastGood = hashTree(profileRoot(tsProfile));
const failure = compile(tsProfile, [
  "genes.lexical_binding_inventory",
  "genes.lexical_binding_missing_probe"
]);
ok(failure.status !== null && failure.status !== 0,
  "The intentionally omitted runtime authority unexpectedly compiled");
const diagnostics = `${failure.stdout}${failure.stderr}`;
match(diagnostics, /GTS-LEXICAL-BINDING-PLAN-004/);
match(diagnostics, /Main\.hx:\d+: characters \d+-\d+/);
match(diagnostics, /accessor:direct:missingProbe\.Factory/);
deepStrictEqual(
  hashTree(profileRoot(tsProfile)),
  lastGood,
  "A missing runtime authority changed the last-known-good output tree"
);
strictEqual(
  existsSync(compilerOutputSentinel(outputFile(tsProfile))),
  false,
  "The failed build left its private Haxe output sentinel"
);

const moduleFailure = compile(tsProfile, [
  "genes.lexical_binding_inventory",
  "genes.lexical_binding_missing_module_probe"
]);
ok(moduleFailure.status !== null && moduleFailure.status !== 0,
  "The intentionally omitted module authority unexpectedly compiled");
const moduleDiagnostics = `${moduleFailure.stdout}${moduleFailure.stderr}`;
match(moduleDiagnostics, /GTS-LEXICAL-BINDING-PLAN-004/);
match(moduleDiagnostics, /module lexicalbinding\.StructuralClassCases emission/);
match(moduleDiagnostics,
  /accessor:declaration:class:lexicalbinding\.StructuralClassCases:RuntimeInterface/);
deepStrictEqual(
  hashTree(profileRoot(tsProfile)),
  lastGood,
  "A missing module authority changed the last-known-good output tree"
);
strictEqual(
  existsSync(compilerOutputSentinel(outputFile(tsProfile))),
  false,
  "The failed module build left its private Haxe output sentinel"
);
deepStrictEqual(
  leakedOutputStages(outputRoot),
  [],
  "The lexical binding-use gate left a private output stage"
);

process.stdout.write("lexical-binding-use-plan:ok\n");
