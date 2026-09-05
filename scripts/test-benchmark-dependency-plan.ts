import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  distribution,
  materializeSourceSnapshot,
  parseOptions,
  plannerPercentOfTotal,
  plannerReportedSeconds,
  requireCleanStatus,
  scheduleForRound,
  sourceFor,
  validateOutputPath,
  type BenchmarkSample
} from "./benchmark-dependency-plan.js";

throws(
  () => parseOptions(["--sensitivity-multiplier", "1"]),
  /sensitivity multiplier must be greater than 1/
);
throws(
  () => parseOptions(["--workspace", "."]),
  /Unknown argument/
);
const disposableWorkspace = path.join(process.cwd(), ".tmp/dependency-plan-benchmark");
throws(
  () => validateOutputPath(path.join(disposableWorkspace, "report.json")),
  /must not overlap/
);
throws(
  () => validateOutputPath(path.dirname(disposableWorkspace)),
  /must not overlap/
);
const symlinkTarget = path.join(disposableWorkspace, "report.json");
const symlinkPath = path.join(process.cwd(), ".tmp/dependency-plan-report-link.json");
rmSync(disposableWorkspace, { recursive: true, force: true });
rmSync(symlinkPath, { force: true });
try {
  mkdirSync(disposableWorkspace, { recursive: true });
  writeFileSync(symlinkTarget, "test-only\n");
  symlinkSync(symlinkTarget, symlinkPath);
  throws(() => validateOutputPath(symlinkPath), /must not overlap/);
} finally {
  rmSync(symlinkPath, { force: true });
  rmSync(disposableWorkspace, { recursive: true, force: true });
}
const sourceSnapshot = path.join(process.cwd(), ".tmp/dependency-plan-source-snapshot-test");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
rmSync(sourceSnapshot, { recursive: true, force: true });
try {
  materializeSourceSnapshot(commit, sourceSnapshot);
  strictEqual(
    readFileSync(path.join(sourceSnapshot, "haxelib.json"), "utf8"),
    execFileSync("git", ["show", `${commit}:haxelib.json`], { encoding: "utf8" })
  );
  strictEqual(
    readFileSync(path.join(sourceSnapshot, "src/genes/Generator.hx"), "utf8"),
    execFileSync("git", ["show", `${commit}:src/genes/Generator.hx`], { encoding: "utf8" })
  );
} finally {
  rmSync(sourceSnapshot, { recursive: true, force: true });
}
strictEqual(distribution([1, 100]).median, 50.5);
requireCleanStatus([]);
throws(() => requireCleanStatus([" M src/genes/Generator.hx"]), /requires a clean working tree/);

const first = scheduleForRound(1, 20260905);
const repeated = scheduleForRound(1, 20260905);
deepStrictEqual(first, repeated, "the recorded seed must reproduce one round");
strictEqual(first[0]?.kind, "anchor-before");
strictEqual(first.at(-1)?.kind, "anchor-after");
strictEqual(first[0]?.edges, 256);
strictEqual(first.at(-1)?.edges, 256);
deepStrictEqual(
  first.filter((entry) => entry.kind === "scale")
    .map((entry) => entry.edges).sort((left, right) => left - right),
  [128, 256, 512]
);
ok(
  JSON.stringify(scheduleForRound(1, 20260905))
    !== JSON.stringify(scheduleForRound(2, 20260905)),
  "successive rounds must not preserve one ordered-size sequence"
);

const ordinary = sourceFor(128, 1);
const inflated = sourceFor(128, 8);
strictEqual((ordinary.match(/@:jsRequire/g) ?? []).length, 128);
strictEqual((inflated.match(/@:jsRequire/g) ?? []).length, 128,
  "the sensitivity control must preserve the import graph size");
strictEqual((ordinary.match(/total \+= RuntimeEdge/g) ?? []).length, 64);
strictEqual((inflated.match(/total \+= RuntimeEdge/g) ?? []).length, 512);
strictEqual((ordinary.match(/public static function keepType/g) ?? []).length, 64);
strictEqual((inflated.match(/public static function keepType/g) ?? []).length, 512);

const synthetic = {
  timings: [
    {
      id: "genes.plan.reachability.runtimeEdges",
      path: "genes.plan.reachability.expand/genes.plan.reachability.runtimeEdges",
      reportedSeconds: 0.25,
      percentOfTotal: 5,
      percentOfParent: 20,
      count: 1
    },
    {
      id: "genes.plan.reachability.typeEdges",
      path: "genes.plan.reachability.expand/genes.plan.reachability.typeEdges",
      reportedSeconds: 0.75,
      percentOfTotal: 15,
      percentOfParent: 60,
      count: 1
    },
    {
      id: "genes.emit.implementation",
      path: "generate/genes.emit.implementation",
      reportedSeconds: 2,
      percentOfTotal: 40,
      percentOfParent: 50,
      count: 1
    }
  ]
} satisfies Pick<BenchmarkSample, "timings">;
strictEqual(plannerReportedSeconds(synthetic), 1);
strictEqual(plannerPercentOfTotal(synthetic), 20);

process.stdout.write("dependency-plan benchmark controls passed\n");
