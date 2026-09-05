import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  distribution,
  parseOptions,
  plannerPercentOfTotal,
  plannerReportedSeconds,
  requireCleanStatus,
  scheduleForRound,
  sourceFor,
  validateOutputPath,
  validateWorkspacePath,
  type BenchmarkSample
} from "./benchmark-dependency-plan.js";

throws(
  () => parseOptions(["--sensitivity-multiplier", "1"]),
  /sensitivity multiplier must be greater than 1/
);
throws(
  () => validateWorkspacePath(process.cwd()),
  /must not equal or contain/
);
throws(
  () => parseOptions(["--workspace", "."]),
  /must not equal or contain/
);
const liveTreeParent = path.join(tmpdir(), "genes-dependency-plan-live-parent");
throws(
  () => validateWorkspacePath(liveTreeParent, path.join(liveTreeParent, "project", "repo")),
  /must not equal or contain/
);
throws(
  () => validateWorkspacePath(tmpdir()),
  /must be a child/
);
throws(
  () => validateWorkspacePath(homedir()),
  /must not equal or contain/
);
strictEqual(
  validateWorkspacePath(path.join(tmpdir(), "genes-dependency-plan-test")),
  path.resolve(tmpdir(), "genes-dependency-plan-test")
);
const symlinkSandbox = mkdtempSync(path.join(tmpdir(), "genes-dependency-plan-link-test-"));
try {
  const link = path.join(symlinkSandbox, "checkout");
  symlinkSync(process.cwd(), link, "dir");
  throws(
    () => validateWorkspacePath(path.join(link, "benchmark")),
    /must be a child/
  );
} finally {
  rmSync(symlinkSandbox, { recursive: true, force: true });
}
const disposableWorkspace = path.join(tmpdir(), "genes-dependency-plan-test");
throws(
  () => validateOutputPath(path.join(disposableWorkspace, "report.json"), disposableWorkspace),
  /must not be inside/
);
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
