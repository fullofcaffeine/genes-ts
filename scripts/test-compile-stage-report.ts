import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  editPatternForWarmups,
  haxeTimingClockStatus,
  runCompileStageReport,
  stageDistributions
} from "./compile-stage-report.js";
import type { HaxeTimingRow } from "./haxe-times.js";

function assertOptionalReachabilityRows(
  rows: ReadonlyArray<HaxeTimingRow>,
  measurementKind: string
): void {
  for (const expected of [
    {
      id: "genes.plan.reachability.expand",
      path: "genes.plan.reachability/genes.plan.reachability.expand"
    },
    {
      id: "genes.plan.reachability.runtimeEdges",
      path: "genes.plan.reachability.expand/genes.plan.reachability.runtimeEdges"
    },
    {
      id: "genes.plan.reachability.typeEdges",
      path: "genes.plan.reachability.expand/genes.plan.reachability.typeEdges"
    }
  ]) {
    const row = rows.find((candidate) => candidate.id === expected.id);
    if (row === undefined) continue;
    ok(row.count > 0, `${measurementKind} ${expected.id} has no calls`);
    ok(row.path.includes(expected.path),
      `${measurementKind} ${expected.id} has an unexpected path ${row.path}`);
  }
}

// Haxe legitimately omits every fine row when each aggregate rounds to zero.
assertOptionalReachabilityRows([], "zero-rounded reachability control");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
for (const [source, timerIds] of [
  ["src/genes/Generator.hx", ["genes.plan.reachability.expand"]],
  ["src/genes/DependencyPlanBuilder.hx", [
    "genes.plan.reachability.runtimeEdges",
    "genes.plan.reachability.typeEdges"
  ]]
] as const) {
  const authoredSource = readFileSync(path.join(repoRoot, source), "utf8");
  for (const timerId of timerIds) {
    ok(authoredSource.includes(`timer('${timerId}')`),
      `${source} is missing the ${timerId} timer site`);
  }
}
const syntheticFineRow: HaxeTimingRow = {
  name: "typeEdges",
  id: "genes.plan.reachability.typeEdges",
  path: "genes.plan.reachability.expand/genes.plan.reachability.typeEdges",
  depth: 2,
  reportedSeconds: 0.004,
  percentOfTotal: 4,
  percentOfParent: 8,
  count: 3,
  info: "genes.plan.reachability"
};
assertOptionalReachabilityRows([syntheticFineRow], "positive hierarchy control");
const intermittentStage = stageDistributions([
  { haxeTimes: [syntheticFineRow] },
  { haxeTimes: [] }
]);
strictEqual(intermittentStage.length, 1);
deepStrictEqual(intermittentStage[0]?.distribution.samples, [0.004, 0]);
strictEqual(intermittentStage[0]?.distribution.sampleCount, 2);
strictEqual(intermittentStage[0]?.distribution.median, 0);
strictEqual(
  haxeTimingClockStatus("darwin", "4.3.7"),
  "known-unscaled-macos-monotonic-clock"
);
strictEqual(haxeTimingClockStatus("linux", "4.3.7"), "unverified");
strictEqual(haxeTimingClockStatus("darwin", "4.3.8"), "unverified");
strictEqual(editPatternForWarmups(1), "b-a-b-a");
strictEqual(editPatternForWarmups(2), "a-b-a-b");
const report = await runCompileStageReport({
  fixture: "control",
  samples: 1,
  warmups: 2,
  workspace: path.join(repoRoot, ".tmp/test-compile-stage-report")
});

strictEqual(report.schemaVersion, 2);
strictEqual(report.classification, "report-only");
strictEqual(
  report.environment.workingTreeDirty,
  report.environment.workingTreeStatus.length > 0
);
strictEqual(report.measurements.length, 2);
strictEqual(report.protocol.warmups, 2);
strictEqual(report.protocol.editPattern, "a-b-a-b");
strictEqual(report.protocol.measuredProfile, "genes-ts");
strictEqual(report.measurements[0]?.edit, "a");
strictEqual(report.measurements[1]?.edit, "a");
strictEqual(report.aggregate.coldWall.sampleCount, 1);
strictEqual(report.aggregate.warmEditWall.sampleCount, 1);
strictEqual(report.aggregate.coldHaxeReported.sampleCount, 1);
strictEqual(report.aggregate.warmEditHaxeReported.sampleCount, 1);
strictEqual(report.aggregate.typescript.sampleCount, 1);
strictEqual(report.aggregate.coldWall.unit, "milliseconds");
strictEqual(report.aggregate.warmEditWall.unit, "milliseconds");
strictEqual(report.aggregate.coldHaxeReported.unit, "haxe-reported-seconds");
strictEqual(report.aggregate.warmEditHaxeReported.unit, "haxe-reported-seconds");
strictEqual(report.aggregate.typescript.unit, "milliseconds");
strictEqual(report.protocol.haxeTiming.source, "--times");
strictEqual(report.protocol.haxeTiming.reportedUnit, "seconds");
strictEqual(report.protocol.haxeTiming.absoluteTimingAuthority,
  "process-wall-clock");
strictEqual(report.protocol.haxeTiming.safeInterpretation,
  "within-run-shares-and-same-toolchain-relative-comparisons");
strictEqual(
  report.protocol.haxeTiming.clockStatus,
  process.platform === "darwin"
    ? "known-unscaled-macos-monotonic-clock"
    : "unverified"
);
deepStrictEqual(
  report.outputNeutrality.map((entry) => entry.profile).sort(),
  ["classic-js", "genes-ts"]
);
for (const entry of report.outputNeutrality) {
  strictEqual(entry.fixture, "control");
  strictEqual(entry.timed.sha256, entry.untimed.sha256);
  strictEqual(entry.timed.bytes, entry.untimed.bytes);
}
for (const measurement of report.measurements) {
  ok(measurement.haxeTimes.some((row) => row.id === "total"));
  ok(measurement.haxeTimes.some((row) => row.id.startsWith("genes.")));
  const classRows = measurement.haxeTimes.filter((row) =>
    row.id.startsWith("genes.emit.ts.class.")
  );
  for (const id of [
    "genes.emit.ts.class.methods",
    "genes.emit.ts.class.methodBody"
  ]) {
    ok(classRows.some((row) => row.id === id),
      `${measurement.kind} timing rows are missing ${id}`);
  }
  ok(classRows.every((row) => row.count > 0));
  ok(classRows.some((row) =>
    row.id === "genes.emit.ts.class.methodBody"
    && row.path.includes(
      "emitClass/genes.emit.ts.class.methods/genes.emit.ts.class.methodBody"
    )
  ));
  const signatureRow = classRows.find((row) =>
    row.id === "genes.emit.ts.class.methodSignature"
  );
  if (signatureRow !== undefined) {
    ok(signatureRow.path.includes(
      "emitClass/genes.emit.ts.class.methods/genes.emit.ts.class.methodSignature"
    ));
  }
  const reachabilityRows = measurement.haxeTimes.filter((row) =>
    row.id.startsWith("genes.plan.reachability.")
  );
  ok(measurement.haxeTimes.some((row) =>
    row.id === "genes.plan.reachability"
  ), `${measurement.kind} timing rows are missing reachability`);
  assertOptionalReachabilityRows(reachabilityRows, measurement.kind);
  ok(measurement.haxeReportedSeconds > 0);
  ok(measurement.wallMsPerHaxeReportedSecond > 0);
  ok(measurement.output.files > 0);
  ok(measurement.output.bytes > 0);
}

process.stdout.write("compile-stage-report:ok\n");
