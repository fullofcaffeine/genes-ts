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

- `src/reflaxe/c/CPhaseTiming.hx` and
  `examples/caxecraft/profile_compiler.py` own compiler phase measurements and
  repeatable cold and unchanged warm profiles.
- `examples/caxecraft/profile_incremental_edit.py` owns the real source edit
  and compares rebuilt functions, modules, sidecars, and generated files.
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
- `src/reflaxe/c/lowering/CBodyFunctionReplayCache.hx` and
  `src/reflaxe/c/lowering/CBodyControlFlowPlanCache.hx` own the distinct
  cross-request function and control-flow plan caches.
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

The separate `benchmark:dependency-plan` owner tested one suspected planner
cost in July 2026. On its pinned Node 20.19.3, Haxe 4.3.7, macOS/arm64 run, 4x
the mixed runtime/type-only edges took 1.42x the whole-build median. That result
is historical: the reviewed compiler requires Node 26 and includes 21 later
`DependencyPlanBuilder.hx` changes, including a type-edge scan rewrite.

The benchmark was repeated on this report's compiler with Node 26.1.0 and Haxe
4.3.7. Every size again retained one stable output hash and the expected
runtime/type-only split.

| Dependency edges | Five whole-build samples | Median |
| ---: | --- | ---: |
| 128 | 29.76s, 31.15s, 30.48s, 30.37s, 22.80s | 30.37s |
| 256 | 38.94s, 42.34s, 37.98s, 38.96s, 42.46s | 38.96s |
| 512 | 105.40s, 138.42s, 153.32s, 161.02s, 165.89s | 153.32s |

Four times as many edges produced a 5.05x median increase. The run used the
required background priority on a contended host, and the largest samples
drifted upward by 60.49s. The result therefore proves a current whole-build
scaling warning, not that dependency planning caused it. Task `genes-gvwv.2`
must interleave sizes on a quiet host and add owner-specific timing or work
counts before any planner optimization is authorized.

Classification of the dependency-plan comparison: **directly reusable
measurement with a current unresolved warning**. Re-measure and attribute; do
not reject or implement planner work from this ordered, contended run.

### Warm builds

haxe.c retains immutable, content-keyed plans across successful requests. It
does not retain Haxe compiler objects. Its changed-source inventory proves the
exact functions and generated files that changed before a cache is admitted.

Genes keeps request-local semantic state and proves cold and warm output
equality. It does not yet have evidence that a cross-request Genes plan cache
is the next dominant cost. The compiler-server benchmark also shows that Haxe
typing and Genes generation share one process boundary.

The host lifecycle evidence in `tooling/development-session/v1/README.md` and
`yarn test:host-tooling` proves a different layer: the exact declared HXML,
library, and extra-input closure, one owned Haxe server, serialized rebuilds,
accepted input revision and output-manifest identities, and failure-atomic
publication. Macro-owned external inputs must be declared in `extraInputs`;
the host cannot invalidate an external read it was not told about. This is
strong reuse and invalidation evidence inside that declared boundary, but it
does not skip an unchanged Genes semantic plan and it has no latency budget.
It therefore does not authorize a compiler cache or a separate host
optimization from this spike.

Classification of the host-lifecycle comparison: **directly reusable and
already adopted lifecycle method; insufficient latency evidence for new
work**.

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

Genes `benchmark:compile-stages` samples exact-process resident memory and
records typed-visit counts. This covers retained-process observation and
structural work, but its 250ms sampling can miss short-lived allocations.
Genes does not count compiler allocations or generated-program allocations.
The output-quality gate's generated temporary declarations are an output-shape
measure, not allocation evidence. The quiet-host benchmark still must
determine whether retained memory or publication work limits warm feedback.

Classification: **partially adopted; allocation counting remains unmeasured**.
Do not add a memory or allocation limit until repeated runs establish variance,
a deliberately larger control proves the threshold, and the measurement can
observe the claimed compiler or generated-program allocation surface.

### Test and CI latency

haxe.c keeps one canonical serial test sequence. It assigns every command to
one isolated CI shard and validates the partition before execution. A small
aggregate job fails unless every shard succeeds. Independent jobs retain their
logs when another job fails.

Genes has one canonical serial acceptance runner, per-gate timing, bounded
cleanup, and separate output roots. It does not yet have a complete declarative
gate manifest: `acceptanceOwnedFocusedGates` describes only the focused subset,
while direct and conditional calls in `scripts/test-acceptance.ts` own the rest.
The main TypeScript acceptance job executes all 41 gates serially. The current
artifact proves enough independent long work to justify first modeling the
complete conditional sequence and then running a partition experiment.

Classification: **directly reusable with a Genes-specific implementation**.
Task `genes-gvwv.1` keeps the serial reference command while partitioning
hosted acceptance work. It must first create and validate the complete gate
manifest, preserve every selected gate exactly once for each supported option
set, and keep one stable required aggregate result.

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
| Current dependency-plan scaling warning | Adaptable | Re-measure with interleaved controls and attribute the cost in `genes-gvwv.2`. |
| Cross-request immutable compiler plans | Adaptable | Wait for the remaining architecture-floor measurement. |
| Structural output budgets | Directly reusable | Already blocking in both Genes profiles. |
| Paired runtime benchmark with an independent reference | Adaptable method | Use only for a measured generated-runtime change. |
| Resident-memory sampling and typed-operation counters | Directly reusable | Partly present in the compile-stage harness; retain its stated sampling limit. |
| Compiler and generated-program allocation counters | Adaptable | Not measured in Genes; add only for a demonstrated allocation problem with a stable observer. |
| Exact CI partition with one aggregate result | Directly reusable | Create one implementation Bead. |
| Content-keyed local test receipts | Adaptable | Gather representative duplicate-run evidence first. |
| C runtime and garbage collector | Target-specific | Genes targets JavaScript; reuse benchmark method, not C runtime ownership. |
| Reflaxe C intermediate representation | Rejected | Genes reads Haxe's typed tree directly; a C-oriented intermediate form would add unrelated semantics and passes. |
| haxe.c pass manager | Rejected | Genes has no measured need for a general pass scheduler; use the smallest owning plan or emitter instead. |
| Native object-file cache | Target-specific | Genes publishes source trees, not native object files; its object identity and linker invalidation rules do not transfer. |

## Implementation boundary

The only new implementation task is `genes-gvwv.1`, which owns the acceptance
partition. The current planner result also creates measurement task
`genes-gvwv.2`; it does not authorize production code. The implementation
task's positive contract is:

> The canonical Genes acceptance list authorizes each hosted gate to run in
> exactly one isolated shard, while one aggregate required check reports the
> complete result.

The task does not change compiler behavior, generated bytes, test assertions,
toolchain coverage, local serial reproduction, or security gates. It must use
the existing per-gate evidence format. Its first prerequisite is a complete
declarative manifest for all direct, focused, and conditional gates currently
owned by `scripts/test-acceptance.ts`; the focused ownership array alone is not
the partition authority.

## Revisit conditions

Revisit compiler-plan reuse after `genes-f8vc.9.4` identifies a dominant
request-local floor. Revisit local receipts after repeated representative runs
show expensive exact duplicates. Revisit runtime benchmarks when a compiler
change adds or removes generated hot-path work. Revisit dependency-plan code
only after `genes-gvwv.2` separates graph-size cost from host drift and
attributes the measured work to an owner.
