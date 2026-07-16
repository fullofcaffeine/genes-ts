# Haxe-authored ts2hx feasibility decision

Status: feasible as a long-term incremental experiment; a production rewrite is
not justified. The TypeScript implementation remains authoritative.

This decision answers a narrow question: could ts2hx eventually be written in
typed Haxe, both to consolidate the toolchain and to exercise Genes on a real
compiler application? It does not authorize a port and does not claim that the
current translator has been reproduced in Haxe.

## What the experiment proved

The repository-owned canary in `tests/ts2hx-bootstrap` uses a curated Haxe
extern to call the real TypeScript 6.0.3 compiler API. The same Haxe source:

- creates a `Program` and obtains its `TypeChecker`;
- walks the real AST without `Dynamic`, `untyped`, casts, or raw syntax;
- asks the checker for the annotated `number` type;
- retains the declaration's exact line and column;
- observes zero diagnostics for the valid file; and
- observes diagnostic 2322 at the exact line and column of the invalid file.

The runner compares those facts with a direct TypeScript implementation. They
match under standard Haxe JavaScript, classic Genes, and genes-ts. Generated
genes-ts output passes strict TypeScript 5.5, 6, and 7 checks and contains no
`any` or broad `unknown` in the canary's modules.

Two clean builds must produce identical complete output trees. On the
2026-07-16 evidence run, their implementation-source sizes were 9,186 bytes for
standard Haxe, 16,494 bytes for classic Genes, and 24,124 bytes for genes-ts.
These numbers describe this tiny fixture; they are not product budgets.

Runtime and build timings are report-only because process startup, filesystem
cache, and machine load materially changed repeated samples. Typical warm Haxe
compiles for this fixture were roughly 0.5–0.7 seconds, and warm three-lane
TypeScript checks were roughly 1–2 seconds with full library checking. Most
runtime samples were about 0.5–0.7 seconds, with a recorded 2.2-second outlier.
That is enough to show no
obvious order-of-magnitude penalty in the reduced seam, but not enough to
predict full-translator performance.

Run the evidence with:

```bash
yarn test:ts2hx-bootstrap
```

## Independent stage-0 path

The bootstrap path does not need the Genes generator:

```text
typed Haxe source
  -> pinned standard Haxe 4.3.7 JavaScript backend
  -> CommonJS stage-0 executable
  -> real pinned TypeScript Program API
```

The standard build uses `-D genes.disable`; it consumes only ordinary Haxe and
the small reusable `genes.ts.Undefinable<T>` boundary. Classic Genes and
genes-ts compile the same source as additional stress/equivalence oracles, not
as prerequisites for building stage 0. This avoids turning today's downstream
CI feedback loop into a compiler build cycle.

If a future experiment publishes a stage-0 artifact, its Haxe version,
TypeScript API engine, source revision, and SHA-256 must be pinned. A clean
source rebuild must reproduce it before the artifact is trusted.

## Interop model

The successful boundary uses four general mechanisms:

1. `@:jsRequire("typescript")` retains the real host module instead of copying
   parser or checker behavior.
2. Small Haxe abstracts keep numeric TypeScript enums distinct.
3. `@:ts.type("import('typescript').…")` restores canonical ecosystem types in
   genes-ts while standard/classic JavaScript keep the same runtime values.
4. `genes.ts.Undefinable<T>` and a read-only array abstract model host absence
   and readonly collections without weak Haxe types.

These annotations are appropriate here because TypeScript's compiler API is the
canonical external boundary. They should live in a curated compiler-API extern
module, not be repeated throughout a translated implementation.

## Why a rewrite is premature

At this baseline, production ts2hx contains 10 non-test TypeScript files and
7,964 lines. Those files contain 797 `ts.*` references spanning 174 distinct
TypeScript namespace members. The largest implementation files are the
5,460-line Haxe emitter and the 1,322-line semantic planner. A tiny successful
extern does not establish that this entire surface can be moved economically.

Automatic declaration conversion is not currently a sound shortcut. The
pinned `typescript` dependency is a Yarn alias, which dts2hx cannot resolve
without a temporary package-name shim. With that shim, dts2hx 0.34.0:

- reported 34 unhandled-symbol errors while returning exit status 0;
- generated 1,241 Haxe files and 30,281 lines; and
- emitted 1,658 `Dynamic` occurrences.

That output violates this repository's type-safety boundary and is much broader
than ts2hx actually needs. A future experiment should curate only the members
used by one migration seam and add them when executable evidence requires them.

## Comparison with the current translator

| Contract | TypeScript implementation | Haxe canary |
| --- | --- | --- |
| Authoritative parser/checker | Direct TypeScript `Program` and `TypeChecker` | Same host objects through typed externs |
| Diagnostic code and provenance | Full project diagnostics | One exact semantic diagnostic proved |
| Translation coverage | Current strict/assisted ts2hx subset | No translation implemented |
| Transactional output | Planned files, atomic commit, stale ownership, rollback tests | Not implemented or claimed |
| Determinism | Full snapshots/manifests and same-process tests | Exact two-build canary tree only |
| Runtime semantics | 18 supported contracts across three runtimes | One compiler-API fact transcript |
| Compiler API surface | 174 observed members in production source | Small curated Program/checker/node subset |
| Performance evidence | Full existing CI workloads | Report-only micro-canary measurements |

The transaction row is a hard stop, not paperwork. A future Haxe experiment
must design immutable planned files, validation-before-publication, rollback,
stale-file ownership, and deterministic diagnostics before it can replace even
one production emitter seam.

## Recommendation

Keep ts2hx in TypeScript. Retain the Haxe canary as a general Genes interop and
self-hosting pressure test.

If this direction is revisited, the next bounded experiment should mirror only
`tools/ts2hx/src/project.ts`: load a tsconfig, create the Program, and emit a
read-only JSON inventory of root files and diagnostics. It must run beside the
TypeScript implementation and compare facts; it must not become a production
subprocess or switch any translator consumer. Continue only if that experiment
reduces or preserves total complexity.

Do not begin the emitter, semantic planner, CLI, or transaction port until all
of these are true:

- the curated extern surface remains strong and versioned;
- stage-0 rebuilds are reproducible on the pinned Haxe/Node lanes;
- diagnostics and source positions match on a representative invalid corpus;
- a Haxe-owned transaction plan matches the current rollback guarantees;
- full semantic, snapshot, deterministic-tree, and performance comparisons are
  green; and
- each migrated seam has an immediate rollback point.

This leaves the long-term possibility open for the right reason: the core
interop is genuinely possible. It rejects a rewrite now for the equally
important reason that most of the translator's contracts remain unproved in
Haxe.
