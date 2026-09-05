import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acceptanceShardIds,
  selectedAcceptanceGates,
  type AcceptanceSelection,
  type AcceptanceShardId
} from "./acceptance-gate-manifest.js";
import type { AcceptanceGate } from "./acceptance-process-owner.js";

const stableCiSelection: AcceptanceSelection = {
  skipClassic: true,
  skipTodoapp: false,
  skipPlaywright: false,
  skipTs2hx: true,
  skipCompilerServer: false
};

interface AggregateInput {
  readonly artifactsRoot: string;
  readonly preflightResult: string;
  readonly shardsResult: string;
}

interface AggregateSummary {
  readonly schemaVersion: 1;
  readonly contract: "genes-acceptance-shard-aggregate";
  readonly shards: ReadonlyArray<{
    readonly id: AcceptanceShardId;
    readonly gateCount: number;
    readonly durationMs: number;
  }>;
  readonly totalGates: number;
  readonly totalGateDurationMs: number;
}

interface ShardObservation {
  readonly summary: AggregateSummary["shards"][number];
  readonly gates: ReadonlyArray<AcceptanceGate>;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  assert(typeof value === "string", `${label} must be a string`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be a number`);
  return value;
}

function stringArray(value: unknown, label: string): ReadonlyArray<string> {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string"),
    `${label} must be a string array`);
  return value;
}

function readShardState(
  artifactsRoot: string,
  shard: AcceptanceShardId
): { readonly gates: ReadonlyArray<AcceptanceGate>; readonly durationMs: number } {
  const artifact = `genes-acceptance-shard-${shard}`;
  const statePath = path.join(artifactsRoot, artifact, "state.json");
  const state = objectValue(JSON.parse(readFileSync(statePath, "utf8")) as unknown,
    `${shard} state`);
  assert.equal(state.schemaVersion, 2, `${shard} state schema changed`);
  assert.equal(state.contract, "genes-acceptance-process-owner",
    `${shard} state contract changed`);
  assert.equal(state.activeGate, null, `${shard} retained an active gate`);
  assert(Array.isArray(state.gates), `${shard} gates must be an array`);

  let durationMs = 0;
  const gates = state.gates.map((rawGate, index): AcceptanceGate => {
    const gate = objectValue(rawGate, `${shard} gate ${index}`);
    assert.equal(gate.status, "passed", `${shard} gate did not pass`);
    assert.equal(gate.phase, "terminal", `${shard} gate is not terminal`);
    assert.equal(gate.exitCode, 0, `${shard} gate exit changed`);
    const cleanup = objectValue(gate.cleanup, `${shard} gate cleanup`);
    assert.equal(cleanup.succeeded, true, `${shard} gate cleanup did not succeed`);
    const publication = objectValue(gate.publication, `${shard} gate publication`);
    assert.equal(publication.log, "published", `${shard} gate log was not published`);
    assert.equal(publication.state, "published", `${shard} gate state was not published`);
    const command = stringArray(gate.command, `${shard} gate command`);
    assert(command.length > 0, `${shard} gate command is empty`);
    durationMs += numberValue(gate.durationMs, `${shard} gate duration`);
    return {
      id: stringValue(gate.id, `${shard} gate id`),
      command: command[0]!,
      args: command.slice(1)
    };
  });
  return { gates, durationMs };
}

export function validateAcceptanceShardAggregate(input: AggregateInput): AggregateSummary {
  assert.equal(input.preflightResult, "success", "genes-ts preflight did not pass");
  assert.equal(input.shardsResult, "success", "acceptance shard matrix did not pass");

  const expectedArtifacts = acceptanceShardIds.map((shard) =>
    `genes-acceptance-shard-${shard}`);
  assert.deepEqual(readdirSync(input.artifactsRoot).sort(), [...expectedArtifacts].sort(),
    "Acceptance artifacts are missing, duplicated, or unknown");

  const observations: ReadonlyArray<ShardObservation> = acceptanceShardIds.map((shard) => {
    const observed = readShardState(input.artifactsRoot, shard);
    const expected = selectedAcceptanceGates(stableCiSelection, shard);
    assert.deepEqual(observed.gates, expected, `${shard} artifact changed its owned gates`);
    return {
      summary: {
        id: shard,
        gateCount: observed.gates.length,
        durationMs: observed.durationMs
      },
      gates: observed.gates
    };
  });
  const observedSequence = observations.flatMap((observation) =>
    observation.gates.map((gate) => gate.id));
  const expectedSequence = selectedAcceptanceGates(stableCiSelection).map((gate) => gate.id);
  assert.deepEqual(observedSequence, expectedSequence,
    "Acceptance artifacts changed the canonical serial sequence");

  const shards = observations.map((observation) => observation.summary);

  return {
    schemaVersion: 1,
    contract: "genes-acceptance-shard-aggregate",
    shards,
    totalGates: shards.reduce((total, shard) => total + shard.gateCount, 0),
    totalGateDurationMs: shards.reduce((total, shard) => total + shard.durationMs, 0)
  };
}

function terminalGate(gate: AcceptanceGate, durationMs: number): Record<string, unknown> {
  return {
    id: gate.id,
    command: [gate.command, ...gate.args],
    phase: "terminal",
    status: "passed",
    exitCode: 0,
    durationMs,
    cleanup: { succeeded: true },
    publication: { log: "published", state: "published" }
  };
}

function writeSyntheticArtifacts(
  mutate?: (shard: AcceptanceShardId, gates: Array<Record<string, unknown>>) => void
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "genes-acceptance-aggregate-"));
  for (const shard of acceptanceShardIds) {
    const artifactRoot = path.join(root, `genes-acceptance-shard-${shard}`);
    mkdirSync(artifactRoot, { recursive: true });
    const gates = selectedAcceptanceGates(stableCiSelection, shard)
      .map((gate, index) => terminalGate(gate, index + 1));
    mutate?.(shard, gates);
    writeFileSync(path.join(artifactRoot, "state.json"), JSON.stringify({
      schemaVersion: 2,
      contract: "genes-acceptance-process-owner",
      activeGate: null,
      gates
    }));
  }
  return root;
}

function runSyntheticControls(): void {
  const roots: string[] = [];
  const input = (root: string, preflightResult = "success", shardsResult = "success"): AggregateInput => ({
    artifactsRoot: root,
    preflightResult,
    shardsResult
  });
  try {
    const valid = writeSyntheticArtifacts();
    roots.push(valid);
    assert.equal(validateAcceptanceShardAggregate(input(valid)).totalGates, 41);

    const missing = writeSyntheticArtifacts();
    roots.push(missing);
    rmSync(path.join(missing, "genes-acceptance-shard-react"), { recursive: true });
    assert.throws(() => validateAcceptanceShardAggregate(input(missing)), /missing/);

    const unknown = writeSyntheticArtifacts();
    roots.push(unknown);
    mkdirSync(path.join(unknown, "genes-acceptance-shard-unknown"));
    assert.throws(() => validateAcceptanceShardAggregate(input(unknown)), /unknown/);

    const duplicate = writeSyntheticArtifacts((shard, gates) => {
      if (shard === "compiler") gates.push({ ...gates[0] });
    });
    roots.push(duplicate);
    assert.throws(() => validateAcceptanceShardAggregate(input(duplicate)), /owned gates/);

    const reordered = writeSyntheticArtifacts((shard, gates) => {
      if (shard === "output") gates.reverse();
    });
    roots.push(reordered);
    assert.throws(() => validateAcceptanceShardAggregate(input(reordered)), /owned gates/);

    const failed = writeSyntheticArtifacts((shard, gates) => {
      if (shard === "react") gates[0]!.status = "failed";
    });
    roots.push(failed);
    assert.throws(() => validateAcceptanceShardAggregate(input(failed)), /did not pass/);
    assert.throws(() => validateAcceptanceShardAggregate(input(valid, "failure")), /preflight/);
    assert.throws(() => validateAcceptanceShardAggregate(input(valid, "success", "cancelled")), /matrix/);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
  console.log("acceptance-shard-aggregate:ok (missing/unknown/duplicate/reordered/failed/cancelled controls red)");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const artifactsRoot = argument("--artifacts");
if (artifactsRoot === undefined) {
  runSyntheticControls();
} else {
  const preflightResult = argument("--preflight-result");
  const shardsResult = argument("--shards-result");
  const output = argument("--out");
  assert(preflightResult !== undefined && shardsResult !== undefined && output !== undefined,
    "Aggregate validation requires --preflight-result, --shards-result, and --out");
  const summary = validateAcceptanceShardAggregate({
    artifactsRoot,
    preflightResult,
    shardsResult
  });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`acceptance-shard-aggregate:ok (${summary.totalGates} gates; ${summary.totalGateDurationMs}ms)`);
}
