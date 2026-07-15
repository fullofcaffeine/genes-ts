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
assert.equal(openCode.baseline, "passing", "the repaired OpenCodeHX pin must have a passing baseline");
assert.deepEqual(openCode.knownObservations, [], "the repaired OpenCodeHX pin must have no accepted failure");
const openCodeTypecheck = openCode.commands.find((command) => command.id === "strict-typescript");
assert.ok(openCodeTypecheck, "the pinned OpenCodeHX strict typecheck must remain curated");
assert.equal(
  openCodeTypecheck.expectedFailure,
  undefined,
  "a repaired downstream must not retain a stale expected-failure allowance"
);
const openCodeClassic = openCode.commands.find(
  (command) => command.id === "classic-esm-application"
);
assert.ok(openCodeClassic, "the pinned OpenCodeHX classic application profile must remain curated");
assert.deepEqual(openCodeClassic.args, ["run", "test:classic-profile"]);
assert.equal(
  openCode.unsupported.some((entry) => entry.id === "opencode-classic-esm-application-profile"),
  false,
  "a passing classic application profile must not remain listed as unsupported"
);

// Keep exception-policy coverage independent of current downstream health. A
// real pinned exception must satisfy the manifest's ownership checks as well;
// this synthetic command isolates exact diagnostic classification behavior.
const expectedCommand = {
  id: "synthetic-known-type-error",
  class: "typecheck",
  executable: "tsc",
  args: ["-p", "tsconfig.json"],
  expectedFailure: {
    observation: "synthetic-downstream-type-model",
    exitCode: 2,
    matcher: "typescript-diagnostics",
    diagnostics: [
      "src-gen/Fixture.ts(7,11): error TS2322: Type 'string | null' is not assignable to type 'string'."
    ]
  }
} satisfies DownstreamCommand;

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
    expectedOutput.replace("(7,11)", "(8,11)"),
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

console.log("downstream-runner-policy:ok (21 fail-closed contracts)");
