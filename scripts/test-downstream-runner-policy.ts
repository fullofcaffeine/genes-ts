import assert from "node:assert/strict";
import { loadDownstreamContracts, type DownstreamCommand } from "./downstream-contracts.js";
import {
  assertDownstreamNodeVersion,
  classifyDownstreamCommand,
  summarizeDownstreamRun,
  typescriptDiagnosticHeadlines
} from "./downstream-runner-policy.js";

const contract = loadDownstreamContracts();
const openCode = contract.profiles.find((profile) => profile.id === "opencodehx");
assert.ok(openCode, "the pinned OpenCodeHX profile must exist");
const expectedCommand = openCode.commands.find((command) => command.id === "strict-typescript");
assert.ok(expectedCommand?.expectedFailure, "the known OpenCodeHX typecheck must be executable evidence");

const expectedOutput = `${expectedCommand.expectedFailure.diagnostics.join("\n")}\n`;
assert.deepEqual(typescriptDiagnosticHeadlines(`npm banner\n${expectedOutput}  Type detail\n`), [
  ...expectedCommand.expectedFailure.diagnostics
]);
assert.deepEqual(
  classifyDownstreamCommand(
    expectedCommand,
    expectedCommand.expectedFailure.exitCode,
    expectedOutput,
    true
  ),
  {
    status: "expected-failure",
    observation: expectedCommand.expectedFailure.observation
  }
);

const addedDiagnostic =
  "src-gen/Unexpected.ts(1,2): error TS2322: Type 'number' is not assignable to type 'string'.";
assert.equal(
  classifyDownstreamCommand(
    expectedCommand,
    expectedCommand.expectedFailure.exitCode,
    `${expectedOutput}${addedDiagnostic}\n`,
    true
  ).status,
  "failed",
  "an additional diagnostic must never hide behind the known failure"
);
assert.equal(
  classifyDownstreamCommand(
    expectedCommand,
    expectedCommand.expectedFailure.exitCode,
    expectedOutput.replace("(239,45)", "(240,45)"),
    true
  ).status,
  "failed",
  "changed diagnostics must remain unclassified"
);
assert.equal(
  classifyDownstreamCommand(expectedCommand, 1, expectedOutput, true).status,
  "failed",
  "the exact exit code is part of the evidence"
);
assert.equal(
  classifyDownstreamCommand(
    expectedCommand,
    expectedCommand.expectedFailure.exitCode,
    expectedOutput,
    false
  ).status,
  "failed",
  "truncated output cannot prove an exact match"
);
assert.equal(
  classifyDownstreamCommand(expectedCommand, 0, "", true).status,
  "unexpected-pass",
  "a fixed downstream must force removal of its stale baseline exception"
);

const ordinaryCommand: DownstreamCommand = {
  id: "ordinary",
  class: "runtime-smoke",
  executable: "node",
  args: ["fixture.js"]
};
assert.equal(classifyDownstreamCommand(ordinaryCommand, 0, "", true).status, "passed");
assert.equal(classifyDownstreamCommand(ordinaryCommand, 1, "", true).status, "failed");

assert.doesNotThrow(() => assertDownstreamNodeVersion("20", "20.19.3"));
assert.throws(
  () => assertDownstreamNodeVersion("20", "23.9.0"),
  /requires Node 20\.x.*using Node 23\.9\.0/s
);

assert.deepEqual(summarizeDownstreamRun(["passed"]), {
  failed: false,
  compilerObservation: "passed-curated-integration"
});
assert.deepEqual(summarizeDownstreamRun(["passed", "known-failure"]), {
  failed: false,
  compilerObservation: "passed-curated-integration-with-known-downstream-failure"
});
assert.deepEqual(summarizeDownstreamRun(["baseline-drift"]), {
  failed: true,
  compilerObservation: "downstream-baseline-drift"
});
assert.deepEqual(summarizeDownstreamRun(["baseline-drift", "failed"]), {
  failed: true,
  compilerObservation: "downstream-failure-unclassified"
});

console.log("downstream-runner-policy:ok (15 fail-closed contracts)");
