import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  acceptanceOwnedFocusedGates,
  assertFocusedGateOwnership
} from "./acceptance-gate-ownership.js";
import {
  AcceptanceProcessOwner,
  type AcceptanceGate
} from "./acceptance-process-owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const reportRoot = path.join(repoRoot, ".tmp/test-evidence/acceptance");
const defaultTimeoutMs = 40 * 60_000;

function timeoutFromEnvironment(): number {
  const raw = process.env.GENES_ACCEPTANCE_TIMEOUT_MS;
  if (raw === undefined) return defaultTimeoutMs;
  const parsed = Number(raw);
  assert(
    Number.isSafeInteger(parsed) && parsed > 0,
    "GENES_ACCEPTANCE_TIMEOUT_MS must be a positive integer"
  );
  return parsed;
}

const skipClassic = process.env.SKIP_CLASSIC === "1";
const skipTodoapp = process.env.SKIP_TODOAPP === "1";
const skipPlaywright = process.env.SKIP_PLAYWRIGHT === "1";
const skipTs2hx = process.env.SKIP_TS2HX === "1";
const skipCompilerServer = process.env.SKIP_COMPILER_SERVER === "1";

assertFocusedGateOwnership(repoRoot);
rmSync(reportRoot, { recursive: true, force: true });
const owner = new AcceptanceProcessOwner({
  cwd: repoRoot,
  reportRoot,
  timeoutMs: timeoutFromEnvironment(),
  env: process.env
});

async function run(
  id: string,
  command: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  const gate: AcceptanceGate = { id, command, args, env };
  await owner.run(gate);
}

await run("acceptance-process-owner", "node", [
  "scripts/dist/test-acceptance-process-owner.js"
]);

if (!skipClassic) {
  await run("classic-baseline", "npm", ["test"]);
  await run("classic-declarations", "node", ["scripts/dist/test-classic-dts.js"]);
}

await run("genes-ts", "node", ["scripts/dist/test-genes-ts.js"]);
await run("explicit-type-arguments", "node", [
  "scripts/dist/test-explicit-type-arguments.js"
]);
await run("genes-ts-minimal", "node", ["scripts/dist/test-genes-ts-minimal.js"]);
await run("genes-ts-full", "node", ["scripts/dist/test-genes-ts-full.js"]);
await run("dynamic-import-policy", "node", [
  "scripts/dist/test-dynamic-import-policy.js"
]);
if (!skipCompilerServer) {
  await run("compiler-server", "node", ["scripts/dist/test-compiler-server.js"]);
}
await run("genes-tsx", "node", ["scripts/dist/test-genes-tsx.js"]);
await run("package-shapes", "node", ["scripts/dist/test-package-shapes.js"]);
await run("binding-identity", "node", ["scripts/dist/probe-binding-identity.js"]);
await run("ts-narrowing", "node", ["scripts/dist/test-ts-narrowing.js"]);
await run("hxx-carrier-immutability", "node", [
  "scripts/dist/test-hxx-carrier-immutability.js"
]);
await run("hxx-event-variance", "node", [
  "scripts/dist/test-hxx-event-variance.js"
]);
await run("genes-ts-sourcemaps", "node", [
  "scripts/dist/test-genes-ts-sourcemaps.js"
]);
await run("genes-ts-snapshots", "node", [
  "scripts/dist/test-genes-ts-snapshots.js"
]);
await run("output-modes", "node", ["scripts/dist/test-output-modes.js"]);
await run("string-literals", "node", ["scripts/dist/test-string-literals.js"]);
await run("async-await-evidence", "node", [
  "scripts/dist/test-async-await-evidence.js"
]);
await run("output-quality", "node", ["scripts/dist/test-output-quality.js"]);
await run("output-transaction", "node", [
  "scripts/dist/test-output-transaction.js"
]);
await run("side-effect-import-evidence", "node", [
  "scripts/dist/test-side-effect-import-evidence.js"
]);
await run("module-directives", "node", ["scripts/dist/test-module-directives.js"]);
await run("internal-types", "node", ["scripts/dist/test-internal-types.js"]);
await run("type-roots", "node", ["scripts/dist/test-type-roots.js"]);
await run("finally-completion", "node", [
  "scripts/dist/test-finally-completion.js"
]);
await run("deep-nullish-alias", "node", [
  "scripts/dist/test-deep-nullish-alias.js"
]);
for (const gate of acceptanceOwnedFocusedGates) {
  const id = `focused-${gate.packageScript.slice("test:".length).replace(/[^a-z0-9]+/g, "-")}`;
  await run(id, "node", [gate.compiledScript]);
}

if (!skipTs2hx) {
  await run("ts2hx", "yarn", ["--cwd", "tools/ts2hx", "test"]);
}

if (!skipTodoapp) {
  await run("examples", "node", [
    "scripts/dist/test-examples.js",
    ...(skipPlaywright ? [] : ["--playwright"])
  ]);
} else {
  // The small example remains a cheap dual-output contract even when callers
  // intentionally skip the fullstack server/browser harness.
  await run("examples-without-todoapp", "node", [
    "scripts/dist/test-examples.js",
    "--skip-todoapp"
  ]);
}
