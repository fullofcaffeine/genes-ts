import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  plannerPercentOfTotal,
  plannerReportedSeconds,
  scheduleForRound,
  sourceFor,
  type BenchmarkSample
} from "./benchmark-dependency-plan.js";

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
