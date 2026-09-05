import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertFocusedGateOwnership
} from "./acceptance-gate-ownership.js";
import {
  assertAcceptancePartition,
  parseAcceptanceShard,
  selectedAcceptanceGates,
  type AcceptanceSelection
} from "./acceptance-gate-manifest.js";
import {
  AcceptanceInterruptedError,
  AcceptanceProcessOwner,
  maxNodeTimerDelayMs
} from "./acceptance-process-owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultTimeoutMs = 40 * 60_000;

function timeoutFromEnvironment(): number {
  const raw = process.env.GENES_ACCEPTANCE_TIMEOUT_MS;
  if (raw === undefined) return defaultTimeoutMs;
  const parsed = Number(raw);
  assert(
    Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maxNodeTimerDelayMs,
    `GENES_ACCEPTANCE_TIMEOUT_MS must be an integer from 1 to ${String(maxNodeTimerDelayMs)}`
  );
  return parsed;
}

const skipClassic = process.env.SKIP_CLASSIC === "1";
const skipTodoapp = process.env.SKIP_TODOAPP === "1";
const skipPlaywright = process.env.SKIP_PLAYWRIGHT === "1";
const skipTs2hx = process.env.SKIP_TS2HX === "1";
const skipCompilerServer = process.env.SKIP_COMPILER_SERVER === "1";
const shard = parseAcceptanceShard(process.argv[2]);
assert(process.argv.length <= 3, "Usage: test-acceptance [compiler|react|output|focused-examples]");
const selection: AcceptanceSelection = {
  skipClassic,
  skipTodoapp,
  skipPlaywright,
  skipTs2hx,
  skipCompilerServer
};
const reportRoot = shard === undefined
  ? path.join(repoRoot, ".tmp/test-evidence/acceptance")
  : path.join(repoRoot, ".tmp/test-evidence/acceptance-shards", shard);

assertFocusedGateOwnership(repoRoot);
assertAcceptancePartition(selection);
const owner = new AcceptanceProcessOwner({
  cwd: repoRoot,
  reportRoot,
  timeoutMs: timeoutFromEnvironment(),
  env: process.env
});

async function runAcceptance(): Promise<void> {
  for (const gate of selectedAcceptanceGates(selection, shard))
    await owner.run(gate);
}

try {
  await runAcceptance();
} catch (error) {
  if (error instanceof AcceptanceInterruptedError) {
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
