# Dependency-plan scaling benchmark

## What this checks

Before Genes writes an `import` statement, it builds a dependency plan. The
plan keeps runtime imports, TypeScript-only imports, and runtime initialization
order separate.

Run the report-only experiment on a quiet host with the pinned toolchains:

```bash
yarn benchmark:dependency-plan \
  --out /tmp/genes-dependency-plan.json
```

The default protocol runs five rounds. Each round brackets a seeded shuffle of
the 128-, 256-, and 512-edge cases with the same 256-edge control:

```text
256 control -> seeded 128/256/512 order -> 256 control
```

This arrangement makes run-order drift visible. It does not assume that the
largest graph always runs last. Every fixture gets one unmeasured warmup, and
all Haxe children run serially.

## Owner attribution

Every measured build enables Haxe `--times` and the private
`genes.compile_stage_profile` define. The JSON report keeps process wall time,
host load, output hashes, and the existing Genes timer rows for inventory,
reachability roots and expansion, runtime and type-edge collection,
validation, emission, and publication. Process wall time is the absolute
latency authority. Haxe timer values rank owners only within the same host and
toolchain run.

The benchmark also pairs an ordinary 128-edge source with a source-only
sensitivity control. The control keeps the same 64 runtime and 64 type-only
imports but repeats every typed dependency reference eight times by default.
The owner observer must report more combined runtime/type-edge work for that
control. This proves that the selected planner rows respond to planner input;
it does not claim that repeated references are a production workload.

The focused `yarn test:compile-stage-report` gate checks the seeded schedule,
fixed anchors, source shape, stable import count, and timer aggregation without
running the long benchmark.

## Report contents

The JSON records:

- the exact Git commit and working-tree state;
- Node and Haxe versions, operating system, CPU count, process priority, and
  load averages;
- the seed, full command, case order, and every individual sample;
- exact runtime/type-only import counts and stable output-tree hashes;
- wall-time and planner-owner distributions for each case; and
- the measured sensitivity ratio.

The first isolated five-round baseline and every sample are recorded in
[`HOSTED_BASELINE_081CEEA3.md`](HOSTED_BASELINE_081CEEA3.md).

Temporary generated sources and output are removed after a successful run.
The workspace is fixed at `.tmp/dependency-plan-benchmark`; the CLI cannot
redirect recursive cleanup to another directory. Use `--keep-workspace` only
for diagnosis. Keep `--out` outside the repository when the report contains
machine-local paths.

## How to read the result

The wall-clock ratio says whether larger import graphs still make complete
builds grow sharply. The bracketing controls show how much of that ratio could
come from host drift. The planner rows then show whether dependency planning
is a material share of the increase or whether parsing, typing, dead-code
elimination, another Genes scan, emission, or publication owns it.

Do not optimize the planner from wall time alone. A production optimization is
justified only when the interleaved samples are stable, the fixed controls are
credible, and owner timing attributes a material cost to planning. Any such
change belongs in a separate Bead and must preserve first-occurrence import
order and both output profiles.

The command has no CI timing threshold. One workstation run must not become a
blocking budget. See `docs/TESTING_STRATEGY.md` for the evidence needed before
a statistical threshold can block a release.
