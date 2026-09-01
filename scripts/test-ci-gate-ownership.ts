import { strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  acceptanceOwnedFocusedGates,
  assertFocusedGateOwnership,
  shouldRunAcceptanceFocusedGate
} from "./acceptance-gate-ownership.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Provides a fast proof that normal PR and release workflows share one owner
 * for the audited focused compiler gates.
 *
 * This checks composition only; each focused suite and the aggregate
 * acceptance command remain responsible for proving compiler behavior.
 */
assertFocusedGateOwnership(repoRoot);
const compileStageGate = acceptanceOwnedFocusedGates.find(
  (gate) => gate.packageScript === "test:compile-stage-report"
);
strictEqual(compileStageGate !== undefined, true);
if (compileStageGate !== undefined) {
  strictEqual(shouldRunAcceptanceFocusedGate(compileStageGate, false), true);
  strictEqual(shouldRunAcceptanceFocusedGate(compileStageGate, true), false);
}
console.log(
  `ci-gate-ownership:ok (${acceptanceOwnedFocusedGates.map((gate) => gate.packageScript).join(", ")})`
);
