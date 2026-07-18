# Dependency-plan scaling benchmark

## What this checks

Before Genes writes an `import` statement, it builds a dependency plan. That
plan remembers which modules are needed while the program runs, which imports
exist only for TypeScript type checking, and the order in which runtime modules
must be initialized.

Some of the planner's current searches walk an existing list from the start.
That code is simple and preserves order, but many repeated searches could make
a generated module with hundreds of imports slower than expected. This
benchmark measures that risk before we consider a more complicated lookup
table.

Run it with:

```bash
yarn benchmark:dependency-plan
```

The benchmark generates three temporary Haxe modules with 128, 256, and 512
dependency edges. Half are runtime imports and half are imports used only by
TypeScript types. For each size it:

1. performs one unmeasured build to warm filesystem caches;
2. measures five complete genes-ts builds and reports the median time;
3. confirms that every requested import reached the generated output; and
4. hashes the complete output tree after every build to prove that repeated
   measurements did not change the result.

Temporary source and output files are removed after a successful report. The
hash compares repeated builds in the same run; it is not a cross-machine
golden value because the compiler ownership manifest includes the configured
output location.

## How to read the result

The reported time covers the complete Haxe and Genes build: parsing, typing,
dependency planning, and writing output. It deliberately does not pretend to
measure one private function in isolation. A large increase would justify a
smaller instrumented experiment before optimization. A roughly proportional
increase is evidence that the current implementation is not yet a practical
bottleneck.

The command is report-only because timing differs across computers and active
workloads. The report names the Node, Haxe, operating-system, and processor
architecture used for that run. It has no release threshold, and its numbers
should not be copied into CI as a performance budget without measurements from
stable CI hardware.

See also:

- `src/genes/DependencyPlan.hx`, which owns the ordered dependency projection;
- `docs/ARCHITECTURE.md`, which explains why dependency order is a semantic
  compiler fact rather than printer formatting; and
- `scripts/test-output-quality.ts`, which owns deterministic output and the
  repository's existing report-only whole-build timings.
