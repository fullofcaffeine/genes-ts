import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCompileStageReport } from "./compile-stage-report.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const report = await runCompileStageReport({
  fixture: "control",
  samples: 1,
  warmups: 2,
  workspace: path.join(repoRoot, ".tmp/test-compile-stage-report")
});

strictEqual(report.schemaVersion, 1);
strictEqual(report.classification, "report-only");
strictEqual(
  report.environment.workingTreeDirty,
  report.environment.workingTreeStatus.length > 0
);
strictEqual(report.measurements.length, 2);
strictEqual(report.protocol.warmups, 2);
strictEqual(report.measurements[0]?.edit, "a");
strictEqual(report.measurements[1]?.edit, "a");
strictEqual(report.aggregate.coldWall.sampleCount, 1);
strictEqual(report.aggregate.warmEditWall.sampleCount, 1);
strictEqual(report.aggregate.coldHaxeTimed.sampleCount, 1);
strictEqual(report.aggregate.warmEditHaxeTimed.sampleCount, 1);
strictEqual(report.aggregate.typescript.sampleCount, 1);
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
  ok(measurement.haxeTimedMs > 0);
  ok(measurement.wallToHaxeTimedRatio > 0);
  ok(measurement.output.files > 0);
  ok(measurement.output.bytes > 0);
}

process.stdout.write("compile-stage-report:ok\n");
