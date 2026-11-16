import { strict as assert } from "node:assert";
import type { AcceptanceGate } from "./acceptance-process-owner.js";

export const acceptanceShardIds = [
  "compiler",
  "react",
  "output",
  "focused-examples"
] as const;

export type AcceptanceShardId = (typeof acceptanceShardIds)[number];

export interface AcceptanceSelection {
  readonly skipClassic: boolean;
  readonly skipTodoapp: boolean;
  readonly skipPlaywright: boolean;
  readonly skipTs2hx: boolean;
  readonly skipCompilerServer: boolean;
}

export type AcceptanceCondition =
  | "always"
  | "classic"
  | "compiler-server"
  | "ts2hx"
  | "todoapp"
  | "todoapp-fallback";

export interface AcceptanceGateDefinition {
  readonly id: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shard: AcceptanceShardId;
  readonly when: AcceptanceCondition;
  readonly addPlaywright?: boolean;
  readonly focusedPackageScript?: string;
  readonly requiresCompilerServer?: boolean;
}

const nodeGate = (
  id: string,
  compiledScript: string,
  shard: AcceptanceShardId,
  when: AcceptanceCondition = "always"
): AcceptanceGateDefinition => ({
  id,
  command: "node",
  args: [compiledScript],
  shard,
  when
});

const focusedGate = (
  packageScript: string,
  compiledScript: string,
  requiresCompilerServer = false
): AcceptanceGateDefinition => ({
  id: `focused-${packageScript.slice("test:".length).replace(/[^a-z0-9]+/g, "-")}`,
  command: "node",
  args: [compiledScript],
  shard: "focused-examples",
  when: requiresCompilerServer ? "compiler-server" : "always",
  focusedPackageScript: packageScript,
  ...(requiresCompilerServer ? { requiresCompilerServer: true } : {})
});

/**
 * Complete ordered acceptance authority.
 *
 * The shard boundaries are contiguous. Concatenating the selected gates from
 * each shard therefore reproduces the ordinary serial command exactly.
 */
export const acceptanceGateManifest: ReadonlyArray<AcceptanceGateDefinition> = [
  {
    id: "classic-baseline",
    command: "npm",
    args: ["test"],
    shard: "compiler",
    when: "classic"
  },
  nodeGate("classic-declarations", "scripts/dist/test-classic-dts.js", "compiler", "classic"),
  nodeGate("genes-ts", "scripts/dist/test-genes-ts.js", "compiler"),
  nodeGate("explicit-type-arguments", "scripts/dist/test-explicit-type-arguments.js", "compiler"),
  nodeGate("genes-ts-minimal", "scripts/dist/test-genes-ts-minimal.js", "compiler"),
  nodeGate("genes-ts-full", "scripts/dist/test-genes-ts-full.js", "compiler"),
  nodeGate("dynamic-import-policy", "scripts/dist/test-dynamic-import-policy.js", "compiler"),
  nodeGate("compiler-server", "scripts/dist/test-compiler-server.js", "compiler", "compiler-server"),
  nodeGate("genes-tsx", "scripts/dist/test-genes-tsx.js", "react"),
  nodeGate("package-shapes", "scripts/dist/test-package-shapes.js", "output"),
  nodeGate("binding-identity", "scripts/dist/probe-binding-identity.js", "output"),
  nodeGate("ts-narrowing", "scripts/dist/test-ts-narrowing.js", "output"),
  nodeGate("hxx-carrier-immutability", "scripts/dist/test-hxx-carrier-immutability.js", "output"),
  nodeGate("hxx-event-variance", "scripts/dist/test-hxx-event-variance.js", "output"),
  nodeGate("genes-ts-sourcemaps", "scripts/dist/test-genes-ts-sourcemaps.js", "output"),
  {
    id: "writer-position",
    command: "haxe",
    args: ["tests/writer-position/build.hxml"],
    shard: "output",
    when: "always"
  },
  nodeGate("genes-ts-snapshots", "scripts/dist/test-genes-ts-snapshots.js", "output"),
  nodeGate("output-modes", "scripts/dist/test-output-modes.js", "output"),
  nodeGate("string-literals", "scripts/dist/test-string-literals.js", "output"),
  nodeGate("async-await-evidence", "scripts/dist/test-async-await-evidence.js", "output"),
  nodeGate("output-quality", "scripts/dist/test-output-quality.js", "output"),
  nodeGate("output-transaction", "scripts/dist/test-output-transaction.js", "output"),
  nodeGate("side-effect-import-evidence", "scripts/dist/test-side-effect-import-evidence.js", "output"),
  nodeGate("module-directives", "scripts/dist/test-module-directives.js", "output"),
  nodeGate("internal-types", "scripts/dist/test-internal-types.js", "output"),
  nodeGate("type-roots", "scripts/dist/test-type-roots.js", "output"),
  nodeGate("finally-completion", "scripts/dist/test-finally-completion.js", "output"),
  nodeGate("deep-nullish-alias", "scripts/dist/test-deep-nullish-alias.js", "output"),
  focusedGate("test:lexical-binding-use-plan", "scripts/dist/test-lexical-binding-use-plan.js"),
  focusedGate("test:module-functions", "scripts/dist/test-module-functions.js"),
  focusedGate("test:array-index-strict", "scripts/dist/test-array-index-strict.js"),
  focusedGate("test:reflection-class-values", "scripts/dist/test-reflection-class-values.js"),
  focusedGate("test:abstract-implementation-properties", "scripts/dist/test-abstract-implementation-properties.js"),
  focusedGate("test:host-global-identity", "scripts/dist/test-host-global-identity.js"),
  focusedGate("test:host-callback-boundary", "scripts/dist/test-host-callback-boundary.js"),
  focusedGate("test:runtime-guarded-binding", "scripts/dist/test-runtime-guarded-binding.js"),
  focusedGate("test:higher-order-enum-constructors", "scripts/dist/test-higher-order-enum-constructors.js"),
  focusedGate("test:enum-payload-narrowing", "scripts/dist/test-enum-payload-narrowing.js"),
  focusedGate("test:byte-buffer-cache", "scripts/dist/test-byte-buffer-cache.js"),
  focusedGate("test:stdlib-overrides", "scripts/dist/test-stdlib-overrides.js"),
  focusedGate("test:nullable-temp-receivers", "scripts/dist/test-nullable-temp-receivers.js"),
  focusedGate("test:compile-stage-report", "scripts/dist/test-compile-stage-suite.js", true),
  {
    id: "ts2hx",
    command: "yarn",
    args: ["--cwd", "tools/ts2hx", "test"],
    shard: "focused-examples",
    when: "ts2hx"
  },
  {
    id: "examples",
    command: "node",
    args: ["scripts/dist/test-examples.js"],
    shard: "focused-examples",
    when: "todoapp",
    addPlaywright: true
  },
  {
    id: "examples-without-todoapp",
    command: "node",
    args: ["scripts/dist/test-examples.js", "--skip-todoapp"],
    shard: "focused-examples",
    when: "todoapp-fallback"
  }
];

function isSelected(definition: AcceptanceGateDefinition, selection: AcceptanceSelection): boolean {
  switch (definition.when) {
    case "always": return true;
    case "classic": return !selection.skipClassic;
    case "compiler-server": return !selection.skipCompilerServer;
    case "ts2hx": return !selection.skipTs2hx;
    case "todoapp": return !selection.skipTodoapp;
    case "todoapp-fallback": return selection.skipTodoapp;
  }
}

function executableGate(
  definition: AcceptanceGateDefinition,
  selection: AcceptanceSelection
): AcceptanceGate {
  return {
    id: definition.id,
    command: definition.command,
    args: [
      ...definition.args,
      ...(definition.addPlaywright && !selection.skipPlaywright ? ["--playwright"] : [])
    ]
  };
}

export function selectedAcceptanceGates(
  selection: AcceptanceSelection,
  shard?: AcceptanceShardId,
  manifest: ReadonlyArray<AcceptanceGateDefinition> = acceptanceGateManifest
): ReadonlyArray<AcceptanceGate> {
  return manifest
    .filter((definition) => isSelected(definition, selection) && (shard === undefined || definition.shard === shard))
    .map((definition) => executableGate(definition, selection));
}

export function assertAcceptancePartition(
  selection: AcceptanceSelection,
  manifest: ReadonlyArray<AcceptanceGateDefinition> = acceptanceGateManifest,
  shards: ReadonlyArray<AcceptanceShardId> = acceptanceShardIds
): void {
  const ids = manifest.map((definition) => definition.id);
  assert(new Set(ids).size === ids.length, "Acceptance manifest contains a duplicate gate ID");
  assert(new Set(shards).size === acceptanceShardIds.length,
    "Acceptance partition must name every shard exactly once");
  assert(shards.every((shard) => acceptanceShardIds.includes(shard)),
    "Acceptance partition contains an unknown shard");
  assert(manifest.every((definition) => shards.includes(definition.shard)),
    "Acceptance manifest contains an unowned shard");

  const serial = selectedAcceptanceGates(selection, undefined, manifest).map((gate) => gate.id);
  const partitioned = shards.flatMap((shard) =>
    selectedAcceptanceGates(selection, shard, manifest).map((gate) => gate.id));
  assert.deepEqual(partitioned, serial,
    "Acceptance shard concatenation changed the canonical serial sequence");
}

export function parseAcceptanceShard(value: string | undefined): AcceptanceShardId | undefined {
  if (value === undefined) return undefined;
  assert(acceptanceShardIds.includes(value as AcceptanceShardId),
    `Unknown acceptance shard: ${value}`);
  return value as AcceptanceShardId;
}
