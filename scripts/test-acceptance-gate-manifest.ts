import { strict as assert } from "node:assert";
import {
  acceptanceGateManifest,
  acceptanceShardIds,
  assertAcceptancePartition,
  parseAcceptanceShard,
  selectedAcceptanceGates,
  type AcceptanceSelection
} from "./acceptance-gate-manifest.js";
import type { AcceptanceGate } from "./acceptance-process-owner.js";

const nodeGate = (id: string, script: string, ...args: string[]): AcceptanceGate => ({
  id,
  command: "node",
  args: [script, ...args]
});

/** Independent transcription of the serial sequence before it became data. */
function expectedLegacySequence(selection: AcceptanceSelection): ReadonlyArray<AcceptanceGate> {
  return [
    ...(selection.skipClassic ? [] : [
      { id: "classic-baseline", command: "npm", args: ["test"] },
      nodeGate("classic-declarations", "scripts/dist/test-classic-dts.js")
    ]),
    nodeGate("genes-ts", "scripts/dist/test-genes-ts.js"),
    nodeGate("explicit-type-arguments", "scripts/dist/test-explicit-type-arguments.js"),
    nodeGate("genes-ts-minimal", "scripts/dist/test-genes-ts-minimal.js"),
    nodeGate("genes-ts-full", "scripts/dist/test-genes-ts-full.js"),
    nodeGate("dynamic-import-policy", "scripts/dist/test-dynamic-import-policy.js"),
    ...(selection.skipCompilerServer ? [] : [
      nodeGate("compiler-server", "scripts/dist/test-compiler-server.js")
    ]),
    nodeGate("genes-tsx", "scripts/dist/test-genes-tsx.js"),
    nodeGate("package-shapes", "scripts/dist/test-package-shapes.js"),
    nodeGate("binding-identity", "scripts/dist/probe-binding-identity.js"),
    nodeGate("ts-narrowing", "scripts/dist/test-ts-narrowing.js"),
    nodeGate("hxx-carrier-immutability", "scripts/dist/test-hxx-carrier-immutability.js"),
    nodeGate("hxx-event-variance", "scripts/dist/test-hxx-event-variance.js"),
    nodeGate("genes-ts-sourcemaps", "scripts/dist/test-genes-ts-sourcemaps.js"),
    { id: "writer-position", command: "haxe", args: ["tests/writer-position/build.hxml"] },
    nodeGate("genes-ts-snapshots", "scripts/dist/test-genes-ts-snapshots.js"),
    nodeGate("output-modes", "scripts/dist/test-output-modes.js"),
    nodeGate("string-literals", "scripts/dist/test-string-literals.js"),
    nodeGate("async-await-evidence", "scripts/dist/test-async-await-evidence.js"),
    nodeGate("output-quality", "scripts/dist/test-output-quality.js"),
    nodeGate("output-transaction", "scripts/dist/test-output-transaction.js"),
    nodeGate("side-effect-import-evidence", "scripts/dist/test-side-effect-import-evidence.js"),
    nodeGate("module-directives", "scripts/dist/test-module-directives.js"),
    nodeGate("internal-types", "scripts/dist/test-internal-types.js"),
    nodeGate("type-roots", "scripts/dist/test-type-roots.js"),
    nodeGate("finally-completion", "scripts/dist/test-finally-completion.js"),
    nodeGate("deep-nullish-alias", "scripts/dist/test-deep-nullish-alias.js"),
    nodeGate("focused-lexical-binding-use-plan", "scripts/dist/test-lexical-binding-use-plan.js"),
    nodeGate("focused-module-functions", "scripts/dist/test-module-functions.js"),
    nodeGate("focused-array-index-strict", "scripts/dist/test-array-index-strict.js"),
    nodeGate("focused-reflection-class-values", "scripts/dist/test-reflection-class-values.js"),
    nodeGate("focused-abstract-implementation-properties", "scripts/dist/test-abstract-implementation-properties.js"),
    nodeGate("focused-host-global-identity", "scripts/dist/test-host-global-identity.js"),
    nodeGate("focused-host-callback-boundary", "scripts/dist/test-host-callback-boundary.js"),
    nodeGate("focused-runtime-guarded-binding", "scripts/dist/test-runtime-guarded-binding.js"),
    nodeGate("focused-higher-order-enum-constructors", "scripts/dist/test-higher-order-enum-constructors.js"),
    nodeGate("focused-enum-payload-narrowing", "scripts/dist/test-enum-payload-narrowing.js"),
    nodeGate("focused-byte-buffer-cache", "scripts/dist/test-byte-buffer-cache.js"),
    nodeGate("focused-stdlib-overrides", "scripts/dist/test-stdlib-overrides.js"),
    nodeGate("focused-nullable-temp-receivers", "scripts/dist/test-nullable-temp-receivers.js"),
    ...(selection.skipCompilerServer ? [] : [
      nodeGate("focused-compile-stage-report", "scripts/dist/test-compile-stage-suite.js")
    ]),
    ...(selection.skipTs2hx ? [] : [{
      id: "ts2hx",
      command: "yarn",
      args: ["--cwd", "tools/ts2hx", "test"]
    }]),
    ...(selection.skipTodoapp ? [
      nodeGate("examples-without-todoapp", "scripts/dist/test-examples.js", "--skip-todoapp")
    ] : [
      nodeGate("examples", "scripts/dist/test-examples.js",
        ...(selection.skipPlaywright ? [] : ["--playwright"]))
    ])
  ];
}

for (let mask = 0; mask < 32; mask += 1) {
  const selection: AcceptanceSelection = {
    skipClassic: (mask & 1) !== 0,
    skipTodoapp: (mask & 2) !== 0,
    skipPlaywright: (mask & 4) !== 0,
    skipTs2hx: (mask & 8) !== 0,
    skipCompilerServer: (mask & 16) !== 0
  };
  assert.deepEqual(selectedAcceptanceGates(selection), expectedLegacySequence(selection));
  assertAcceptancePartition(selection);
}

const allEnabled: AcceptanceSelection = {
  skipClassic: false,
  skipTodoapp: false,
  skipPlaywright: false,
  skipTs2hx: false,
  skipCompilerServer: false
};
assert.throws(
  () => assertAcceptancePartition(allEnabled, [...acceptanceGateManifest, acceptanceGateManifest[0]!]),
  /duplicate gate ID/
);
assert.throws(
  () => assertAcceptancePartition(allEnabled, acceptanceGateManifest, acceptanceShardIds.slice(0, -1)),
  /every shard exactly once/
);
assert.throws(
  () => assertAcceptancePartition(allEnabled, acceptanceGateManifest, [
    acceptanceShardIds[1],
    acceptanceShardIds[0],
    ...acceptanceShardIds.slice(2)
  ]),
  /changed the canonical serial sequence/
);
assert.throws(() => parseAcceptanceShard("unknown"), /Unknown acceptance shard/);

console.log("acceptance-gate-manifest:ok (all 32 option sets; partition controls red)");
