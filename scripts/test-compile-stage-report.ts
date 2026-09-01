import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  editPatternForWarmups,
  haxeTimingClockStatus,
  runCompileStageReport
} from "./compile-stage-report.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
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
  ok(measurement.haxeReportedSeconds > 0);
  ok(measurement.wallMsPerHaxeReportedSecond > 0);
  ok(measurement.output.files > 0);
  ok(measurement.output.bytes > 0);
}

process.stdout.write("compile-stage-report:ok\n");
