import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  editPatternForWarmups,
  haxeTimingClockStatus,
  parseLinuxProcessCpuTicks,
  parseProcessCpuTime,
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
      id: "genes.plan.reachability.roots",
      path: "genes.plan.reachability/genes.plan.reachability.roots"
    },
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
    },
    {
      id: "genes.plan.reachability.declarationEdges",
      path: "genes.plan.reachability.expand/genes.plan.reachability.declarationEdges"
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
  ["src/genes/Generator.hx", [
    "genes.plan.reachability.roots",
    "genes.plan.reachability.expand"
  ]],
  ["src/genes/DependencyPlanBuilder.hx", [
    "genes.plan.reachability.runtimeEdges",
    "genes.plan.reachability.typeEdges",
    "genes.plan.reachability.declarationEdges"
  ]]
] as const) {
  const authoredSource = readFileSync(path.join(repoRoot, source), "utf8");
  for (const timerId of timerIds) {
    ok(authoredSource.includes(`timer('${timerId}')`),
      `${source} is missing the ${timerId} timer site`);
  }
}
const generatorSource = readFileSync(
  path.join(repoRoot, "src/genes/Generator.hx"),
  "utf8"
);
ok(
  generatorSource.indexOf("timer('genes.plan.reachability.roots')")
    < generatorSource.indexOf("final initialNames ="),
  "reachability roots timing must start before root evidence preparation"
);
function syntheticFineRow(
  id: string,
  path: string,
  reportedSeconds = 0.004
): HaxeTimingRow {
  return {
    name: id.split(".").at(-1) ?? id,
    id,
    path,
    depth: path.split("/").length - 1,
    reportedSeconds,
    percentOfTotal: 4,
    percentOfParent: 8,
    count: 3,
    info: "genes.plan.reachability"
  };
}
const syntheticFineRows = [
  syntheticFineRow(
    "genes.plan.reachability.roots",
    "genes.plan.reachability/genes.plan.reachability.roots"
  ),
  syntheticFineRow(
    "genes.plan.reachability.expand",
    "genes.plan.reachability/genes.plan.reachability.expand"
  ),
  syntheticFineRow(
    "genes.plan.reachability.runtimeEdges",
    "genes.plan.reachability.expand/genes.plan.reachability.runtimeEdges"
  ),
  syntheticFineRow(
    "genes.plan.reachability.typeEdges",
    "genes.plan.reachability.expand/genes.plan.reachability.typeEdges"
  ),
  syntheticFineRow(
    "genes.plan.reachability.declarationEdges",
    "genes.plan.reachability.expand/genes.plan.reachability.declarationEdges"
  )
];
assertOptionalReachabilityRows(syntheticFineRows, "positive hierarchy control");
const syntheticTypeRow = syntheticFineRows.find((row) =>
  row.id === "genes.plan.reachability.typeEdges"
);
ok(syntheticTypeRow !== undefined);
const intermittentStage = stageDistributions([
  { haxeTimes: [syntheticTypeRow] },
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
strictEqual(parseProcessCpuTime("00:01.25"), 1_250);
strictEqual(parseProcessCpuTime("1:02:03"), 3_723_000);
strictEqual(parseProcessCpuTime("2-01:02:03.5"), 176_523_500);
strictEqual(
  parseLinuxProcessCpuTicks(
    "123 (worker with ) name) S 1 2 3 4 5 6 7 8 9 10 35 12 0"
  ),
  47
);
const report = await runCompileStageReport({
  fixture: "control",
  samples: 1,
  warmups: 2,
  workspace: path.join(repoRoot, ".tmp/test-compile-stage-report")
});

strictEqual(report.schemaVersion, 3);
strictEqual(report.classification, "report-only");
strictEqual(
  report.environment.workingTreeDirty,
  report.environment.workingTreeStatus.length > 0
);
strictEqual(report.measurements.length, 2);
strictEqual(report.floorMeasurements.length, 4);
strictEqual(report.protocol.warmups, 2);
strictEqual(report.protocol.editPattern, "a-b-a-b");
strictEqual(report.protocol.measuredProfile, "genes-ts");
strictEqual(
  report.protocol.generationFloorSourceIsolation,
  "identical-independent-source-clones"
);
strictEqual(report.protocol.processMetrics.rssSamplingIntervalMs, 250);
strictEqual(report.protocol.processMetrics.publicationCpu, "probe-Sys.cpuTime");
if (process.platform === "linux") {
  strictEqual(
    report.protocol.processMetrics.generationCpu.source,
    "linux-proc-clock-ticks"
  );
  ok(
    (report.protocol.processMetrics.generationCpu.clockTicksPerSecond ?? 0) > 0
  );
} else if (process.platform === "darwin") {
  strictEqual(
    report.protocol.processMetrics.generationCpu.source,
    "fractional-ps"
  );
}
ok(report.protocol.commands.callbackNoopHaxe.some((argument) =>
  argument.includes("floor-fixtures/callback-noop/src")
));
ok(report.protocol.commands.structureScanHaxe.some((argument) =>
  argument.includes("floor-fixtures/structure-scan/src")
));
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
deepStrictEqual(
  report.floorMeasurements.map((measurement) => measurement.mode).sort(),
  ["callback-noop", "end-to-end", "publication-only", "structure-scan"]
);
for (const mode of [
  "callback-noop",
  "structure-scan",
  "end-to-end",
  "publication-only"
] as const) {
  strictEqual(report.aggregate.floorWall[mode].sampleCount, 1);
  strictEqual(report.aggregate.floorWall[mode].unit, "milliseconds");
  strictEqual(typeof report.protocol.floorModeDefinitions[mode], "string");
}
const callbackNoop = report.floorMeasurements.find((measurement) =>
  measurement.mode === "callback-noop"
);
const structureScan = report.floorMeasurements.find((measurement) =>
  measurement.mode === "structure-scan"
);
const endToEnd = report.floorMeasurements.find((measurement) =>
  measurement.mode === "end-to-end"
);
const publication = report.floorMeasurements.find((measurement) =>
  measurement.mode === "publication-only"
);
ok(callbackNoop?.counters !== null && callbackNoop?.counters !== undefined);
ok(structureScan?.counters !== null && structureScan?.counters !== undefined);
ok(endToEnd !== undefined && publication !== undefined);
if (process.platform === "linux" || process.platform === "darwin") {
  ok(callbackNoop.processCpuMs !== null);
  ok(structureScan.processCpuMs !== null);
  ok(endToEnd.processCpuMs !== null);
  ok(callbackNoop.maxSampledRssBytes !== null);
  ok(structureScan.maxSampledRssBytes !== null);
  ok(endToEnd.maxSampledRssBytes !== null);
  ok(publication.maxSampledRssBytes !== null);
}
strictEqual(callbackNoop.counters.scanPasses, 0);
strictEqual(callbackNoop.counters.expressionNodes, 0);
strictEqual(structureScan.counters.scanPasses, 1);
strictEqual(
  structureScan.counters.apiTypeEntries,
  callbackNoop.counters.apiTypeEntries
);
ok(structureScan.counters.expressionNodes > 0);
ok(structureScan.counters.typeNodes > 0);
strictEqual(callbackNoop.output.files, 0);
strictEqual(structureScan.output.files, 0);
strictEqual(endToEnd.output.sha256, publication.output.sha256);
ok(publication.processCpuMs !== null);
ok(publication.output.files > 0);
ok(publication.output.bytes > 0);
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
  if (entry.profile === "classic-js") {
    assertOptionalReachabilityRows(
      entry.timedHaxeTimes.filter((row) =>
        row.id.startsWith("genes.plan.reachability.")
      ),
      "classic declaration profile"
    );
  }
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
