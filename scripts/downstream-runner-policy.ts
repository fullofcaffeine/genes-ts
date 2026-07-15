import type { DownstreamCommand } from "./downstream-contracts.js";

export type DownstreamCommandStatus =
  | "passed"
  | "failed"
  | "expected-failure"
  | "unexpected-pass";

export interface DownstreamCommandClassification {
  readonly status: DownstreamCommandStatus;
  readonly observation?: string;
}

export type DownstreamProfileStatus =
  | "passed"
  | "known-failure"
  | "failed"
  | "baseline-drift";

export interface DownstreamRunSummary {
  readonly failed: boolean;
  readonly compilerObservation:
    | "passed-curated-integration"
    | "passed-curated-integration-with-known-downstream-failure"
    | "downstream-baseline-drift"
    | "downstream-failure-unclassified";
}

/** Extracts the stable headline of every emitted TypeScript error. */
export function typescriptDiagnosticHeadlines(output: string): ReadonlyArray<string> {
  return output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^.+\(\d+,\d+\): error TS\d+: .+$/.test(line));
}

function arraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * Classifies one downstream command without weakening an unexpected failure.
 *
 * Why: pinned known failures are useful only when the runner can prove that the
 * observed defect is exactly the reviewed downstream defect. Substring matching
 * could accept a new diagnostic merely because the old one was also present.
 *
 * What: ordinary commands pass only at exit zero. An expected-failure command
 * instead requires its exact nonzero exit and ordered TypeScript diagnostic set.
 * A newly passing command is reported separately as baseline drift so the stale
 * exception is removed rather than silently retained.
 *
 * How: callers supply the complete captured stdout/stderr and whether capture
 * stayed within its safety bound. Truncation always fails closed because exact
 * diagnostic equality can no longer be established.
 */
export function classifyDownstreamCommand(
  command: DownstreamCommand,
  exitCode: number | null,
  output: string,
  captureComplete: boolean
): DownstreamCommandClassification {
  const expected = command.expectedFailure;
  if (!expected) return { status: exitCode === 0 ? "passed" : "failed" };
  if (exitCode === 0) {
    return { status: "unexpected-pass", observation: expected.observation };
  }
  if (
    captureComplete &&
    exitCode === expected.exitCode &&
    arraysEqual(typescriptDiagnosticHeadlines(output), expected.diagnostics)
  ) {
    return { status: "expected-failure", observation: expected.observation };
  }
  return { status: "failed", observation: expected.observation };
}

/**
 * Summarizes profile evidence without letting a softer state mask a hard one.
 *
 * Why: local runs may execute multiple profiles. If one stale known-failure
 * baseline drifts while another profile has a new failure, reporting only drift
 * would hide the unclassified regression in the top-level compiler observation.
 *
 * What/How: apply the explicit severity order `failed > baseline drift > matched
 * downstream failure > passed` and derive the process disposition from the same
 * decision, so JSON reporting and the exit code cannot disagree.
 */
export function summarizeDownstreamRun(
  statuses: ReadonlyArray<DownstreamProfileStatus>
): DownstreamRunSummary {
  if (statuses.includes("failed")) {
    return { failed: true, compilerObservation: "downstream-failure-unclassified" };
  }
  if (statuses.includes("baseline-drift")) {
    return { failed: true, compilerObservation: "downstream-baseline-drift" };
  }
  if (statuses.includes("known-failure")) {
    return {
      failed: false,
      compilerObservation: "passed-curated-integration-with-known-downstream-failure"
    };
  }
  return { failed: false, compilerObservation: "passed-curated-integration" };
}

/**
 * Enforces the centralized Node lane before a downstream checkout is touched.
 *
 * Native Node addons are ABI-specific. Running a Node-20 dependency tree under
 * an arbitrary host Node can therefore turn a healthy compiler smoke test into
 * a misleading `ERR_DLOPEN_FAILED`. The nightly workflow already installs the
 * stable lane from `config/toolchains.json`; local execution must do the same.
 */
export function assertDownstreamNodeVersion(expectedMajor: string, actualVersion: string): void {
  const actualMajor = actualVersion.split(".")[0];
  if (actualMajor !== expectedMajor) {
    throw new Error(
      `Downstream execution requires Node ${expectedMajor}.x from config/toolchains.json; ` +
        `the runner is using Node ${actualVersion}. Re-run the command with Node ${expectedMajor} ` +
        "before executing the pinned checkout."
    );
  }
}
