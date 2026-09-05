# Performance practices reviewed from haxe.c

## Outcome

Genes can reuse several measurement practices from haxe.c without adopting its
C target architecture. Most useful compiler practices already exist in Genes.
The remaining evidence supports one new implementation task: partition the
required TypeScript acceptance run across isolated CI jobs.

This review makes no compiler or generated-output change. It does not claim a
new compiler speedup.

## Review boundary

The primary haxe.c review snapshot is commit
`4e33a9602a75c0937035f9459e8f570af8e48ab2` on branch
`codex/haxe-c-0h44`. Two independent commits provide additional evidence:

- `65c94719207c8c8b621bbd1cead6993f665d0efd` covers reuse of typed
  function-source plans.
- `719306114eb9513f5cbb9255a4ecf346c0cc7808` covers indexed garbage
  collector lookups and structural scaling limits.

The neighboring haxe.c worktree was dirty during this review. Its checked-out
`main` also preceded several reviewed commits. Therefore, this report cites
immutable commit objects and does not treat uncommitted files as evidence.

The review covered these committed owners:

- `docs/test-performance.md` explains test rings, sharding, receipts,
  benchmarks, and budget admission.
- `scripts/ci/run_toolchain_shard.py` owns exact shard membership, isolated
  execution, timing records, and local resume receipts.
- `scripts/ci/run_local_gate.py` owns reusable local evidence for a small set
  of expensive semantic tests.
- `examples/caxecraft/benchmark_renderer.py` owns a paired generated-Haxe and
  handwritten-C runtime comparison.
- `src/reflaxe/c/frontend/TypedFunctionSourceProvenance.hx` owns request-local
  source snapshots and source-plan reuse.
- `src/reflaxe/c/ir/HxcIRValidator.hx` owns one-pass validation of scoped
  string uses.
- `src/reflaxe/c/lowering/CBodyControlFlow.hx` owns bounded graph searches and
  reuse of exact request-local proofs.
- `runtime/hxrt/src/gc.c` and `runtime/hxrt/test/gc_scaling.c` own indexed
  runtime lookups and deterministic operation limits.

## Current Genes baseline

The reviewed Genes revision is
`703c6dde1b89ec33f0bbc2dd5f7c4133dcf564bd`. It contains the compiler-client
deadline fix from pull request 200.

`taskpolicy -b nice -n 10 yarn test:output-quality` passed on this revision.
The command produced these deterministic tree results:

| Output profile | Files | Tree hash prefix |
| --- | ---: | --- |
| TypeScript source | 57 | `689d13da7917` |
| Classic JavaScript and declarations | 120 | `b637963c4c78` |

The command reported first-build times of 58.16s and 51.82s. Its second builds
took 52.06s and 48.99s. Host load was about 18 on 12 logical CPUs, and several
unrelated Haxe compiles were active. These times are contention diagnostics,
not a speed baseline or regression limit.

The checked output budget remains the stable result. It fixes module, import,
and temporary counts. It also limits byte and token growth to a reviewed 5%
window. `tests/output-modes/output-quality.json` owns the exact values and
review reason.

Pull request 200 provides a current hosted CI baseline. GitHub Actions run
`33937589075` passed on exact head
`608409afedc4ede1ffc92871c27dc9688e69a330`. The required TypeScript job took
29m15s. Its acceptance artifact recorded 41 serial gates and 23m32s of gate
time.

| Slow acceptance gate | Time |
| --- | ---: |
| `genes-tsx` | 6m50s |
| `focused-module-functions` | 2m18s |
| `compiler-server` | 2m16s |
| `examples` | 1m44s |

These four gates used 13m08s, about 56% of the serial gate time. The artifact
also records each command, status, duration, cleanup result, and log path.

## Comparison

### Compiler latency

haxe.c adds phase timers only after a broad timer becomes ambiguous. It then
adds deterministic work counts beside wall time. Genes already uses this
practice in `benchmark:compile-stages`, request-local Genes timers, and focused
planner and emitter counters.

haxe.c also removes repeated typed-tree work before it adds persistent state.
Examples include one source hash per request and one function walk for many
values. Genes applied the same finite rule in its direct-binding, type-edge,
source-map, and JSON reachability changes.

Classification: **directly reusable and already adopted**. The deferred
`genes-f8vc.9.4` benchmark must identify any remaining callback, typed-scan, or
publication floor before another compiler optimization starts.

### Warm builds

haxe.c retains immutable, content-keyed plans across successful requests. It
does not retain Haxe compiler objects. Its changed-source inventory proves the
exact functions and generated files that changed before a cache is admitted.

Genes keeps request-local semantic state and proves cold and warm output
equality. It does not yet have evidence that a cross-request Genes plan cache
is the next dominant cost. The compiler-server benchmark also shows that Haxe
typing and Genes generation share one process boundary.

Classification: **adaptable, but not yet authorized**. Wait for
`genes-f8vc.9.4`. A cache needs exact identity, lifetime, invalidation,
failure rollback, and memory limits. No new cache task is justified now.

### Generated output

haxe.c records generated files, bytes, and independent output identities. It
uses exact structural limits when wall time is noisy. Genes already blocks
unexpected module, import, temporary, byte, and token growth in both output
profiles.

Classification: **directly reusable and already adopted**. Genes has a
stronger checked dual-profile budget than the reviewed haxe.c compiler-time
fixtures. No follow-up is necessary.

### Generated program work

haxe.c compares a changed runtime algorithm with its previous algorithm under
the same scene, compiler, native library, warmup, and sample count. A small
handwritten C program supplies an independent reference. The garbage collector
fixture also limits exact lookup and probe counts.

Genes emits JavaScript for many runtimes, so a C or collector benchmark does
not transfer directly. The method does transfer: use a representative
application, one independent reference, semantic parity, warmups, repeated
samples, and deterministic operation or allocation counts.

Classification: **target-specific implementation, adaptable method**. Add a
runtime benchmark only when a Genes change affects generated hot-path work.
The current research has no generic JavaScript runtime regression to measure.

### Memory and allocation

haxe.c records retained plan size, process memory, cache capacity, allocations,
and exact operation counts. It treats sampled resident memory as an observed
value, not an operating-system peak.

Genes `benchmark:compile-stages` already samples exact-process resident memory
and records typed-visit counts. Its output-quality gate counts generated
temporaries. The quiet-host benchmark still must determine whether memory or
publication work limits warm feedback.

Classification: **directly reusable and already adopted**. Do not add a memory
limit until repeated runs establish variance and a deliberately larger control
proves the threshold.

### Test and CI latency

haxe.c keeps one canonical serial test sequence. It assigns every command to
one isolated CI shard and validates the partition before execution. A small
aggregate job fails unless every shard succeeds. Independent jobs retain their
logs when another job fails.

Genes already has a canonical acceptance gate list, exact ownership checks,
per-gate timing, bounded cleanup, and separate output roots. However, the main
TypeScript acceptance job still executes all 41 gates serially. The current
artifact proves enough independent long work to justify a partition experiment.

Classification: **directly reusable with a Genes-specific implementation**.
Task `genes-gvwv.1` keeps the serial reference command while partitioning
hosted acceptance work. It must preserve every gate exactly once and keep one
stable required aggregate result.

### Local evidence receipts

haxe.c reuses only selected expensive local tests. Its key includes staged and
unstaged inputs, relevant untracked files, full classpath trees, commands,
locks, tools, environment, host, hook, and runner code. Timing benchmarks never
reuse receipts, and hosted CI always starts cold.

Genes has no equivalent local semantic-test receipt. The local output-quality
run took 5m37s on a saturated host, but this single loaded sample does not prove
the representative benefit. A safe receipt also needs a complete input model
for Haxe libraries, generated fixtures, Node tools, and environment values.

Classification: **adaptable, insufficient evidence**. Do not create an
implementation task from this spike. First collect repeated representative
local duplicate-run measurements and define the complete input identity.

## Candidate disposition

| Candidate | Classification | Disposition |
| --- | --- | --- |
| Nested phase timers and exact work counts | Directly reusable | Already present in Genes. |
| One-pass scans and request-local indexes | Directly reusable | Already used by merged compiler optimizations. |
| Cross-request immutable compiler plans | Adaptable | Wait for the remaining architecture-floor measurement. |
| Structural output budgets | Directly reusable | Already blocking in both Genes profiles. |
| Paired runtime benchmark with an independent reference | Adaptable method | Use only for a measured generated-runtime change. |
| Memory, allocation, and operation counters | Directly reusable | Existing harness owns current compiler evidence. |
| Exact CI partition with one aggregate result | Directly reusable | Create one implementation Bead. |
| Content-keyed local test receipts | Adaptable | Gather representative duplicate-run evidence first. |
| C runtime, Reflaxe IR, pass manager, and native object cache | Target-specific or rejected | Do not import these architectures into Genes. |

## Implementation boundary

The only new implementation task is `genes-gvwv.1`, which owns the acceptance
partition. Its positive contract is:

> The canonical Genes acceptance list authorizes each hosted gate to run in
> exactly one isolated shard, while one aggregate required check reports the
> complete result.

The task does not change compiler behavior, generated bytes, test assertions,
toolchain coverage, local serial reproduction, or security gates. It must use
the existing acceptance ownership list and per-gate evidence format.

## Revisit conditions

Revisit compiler-plan reuse after `genes-f8vc.9.4` identifies a dominant
request-local floor. Revisit local receipts after repeated representative runs
show expensive exact duplicates. Revisit runtime benchmarks when a compiler
change adds or removes generated hot-path work.
