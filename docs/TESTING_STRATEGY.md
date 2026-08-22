# Testing strategy (genes-ts)

genes-ts has several independently claim-bearing product surfaces. Keep their
evidence separate:

1. classic JavaScript generation and runtime;
2. typed TypeScript generation and runtime;
3. declarations and package contracts;
4. React/HXX compiler behavior;
5. browser and framework runtime behavior;
6. host tooling;
7. ts2hx migration behavior; and
8. installation, release, adoption, and pinned downstream contracts.

Maintained examples form a ninth scorecard, but it is an **evidence portfolio**,
not another product. A green Todo application cannot prove every compiler rule,
and a green compiler fixture cannot prove the browser workflow.

The canonical scorecards live in
[`tests/testing-strategy/agent-test-routing.json`](../tests/testing-strategy/agent-test-routing.json)
and are rendered into
[`COMPATIBILITY_REPORT.md`](COMPATIBILITY_REPORT.md#product-surface-scorecards).
Each card names its bounded claim, gates, evidence buckets, examples, ceiling,
and residual risks. One surface's green result must never advance another
surface's claim.

This repo follows the **testing trophy**:
- **Lots of fast deterministic tests** (snapshots + typecheck)
- **Some runtime integration tests** (Node execution)
- **A small number of E2E tests** (Playwright) for the example app

## Behavior-first evidence

Before automating a meaningful behavior change broadly, record one concrete
scenario: its input/preconditions, compilation or user action, observable
result, important error case, owning product surface, and protected claim. A
Bead acceptance section, fixture table, or Given/When/Then paragraph is enough;
Genes does not require Gherkin.

Use the lowest faithful observer and preserve a reviewable red-to-green trail:

1. Run the smallest owner against the old or tempting-wrong behavior. Record
   the exact command and concise expected failure in the Bead or PR. A separate
   red commit is optional.
2. State the oracle independently of the implementation: Haxe/JS/TS semantics,
   a manually reviewed minimal expectation, a pinned differential, an invariant,
   or a real consumer. Do not generate expected output with the code under test.
3. Make the focused owner green, then run the next broader contract.
4. For a new capability, prove one **tracer bullet** first: authored source
   through Genes, target check/build, the relevant package/framework boundary,
   and a real runtime or system observer. Expand permutations only afterward.
5. When a browser or high-level test discovers a compiler defect, keep the
   representative real-boundary proof and add a small deterministic compiler
   regression. This “double lock” preserves both diagnosis and user value.

Snapshots are reviewed oracles only when their provenance and semantic change
are explained. Refreshing generated files without that review is not evidence.
Mocks may support a focused owner, but they cannot replace a package, browser,
filesystem, compiler-server, or runtime boundary that the claim explicitly
names.

### Closed CSS Module tracer

`yarn test:css-module-companions` is the first tracer bullet for exact CSS
Module types. It intentionally crosses several existing product surfaces
without letting one substitute for another:

- a hand-reviewed JSON file owns the five expected class keys;
- pinned `postcss-modules` independently reports its runtime exports;
- host tooling validates that manifest, checks source hashes, and generates the
  closed Haxe companion twice to prove deterministic bytes;
- Haxe accepts valid fields and rejects missing, untyped, wrong-owner,
  wrong-request, and nonliteral cases at authored source positions;
- tooling rejects a hashed non-CSS entry, a generated module that differs from
  the Haxe owner, a companion that reuses the authored owner module, a
  declaration path that differs from the emitted import, and cross-platform
  drive-path syntax before returning generated files;
- strict TypeScript first rejects the usual broad CSS wildcard declaration,
  then accepts the generated exact per-file declaration; its negative consumer
  separately proves there is no arbitrary-key escape;
- the classic and TypeScript profiles each emit one default CSS import;
- classic JavaScript also emits a `.d.ts` contract that preserves the closed
  CSS Module return type for TypeScript callers; and
- pinned esbuild loads and executes both outputs through a controlled real
  loader, then checks the reviewed keys and string values.

The same gate now adds a separate warm-development owner. Through one real
owned Haxe server it accepts an initial CSS Module, adds a class and uses it,
rejects removal of a still-used class, rejects invalid CSS, repairs the files,
rejects deletion, and accepts restoration. Every successful warm tree must
match a new isolated cold build, including declarations and source maps. Every
failure must leave the earlier companion, processor manifest, loader receipt,
declaration, maps, and target output byte-for-byte unchanged.

The warm test also runs strict TypeScript and a real controlled loader against
each candidate before publication. A hand-written expected key list, the Haxe
type checker, raw whole-tree hashes, and the real loader are independent
answers; the session is not allowed to approve itself. Focused session tests
separately reject reserved private paths, collisions with compiler output, and
collisions between prepared files and validator evidence.

The test processor and bundler live in a private, exact-lockfile fixture. They
are witnesses, not dependencies of the Genes compiler or
`@genes-ts/tooling`. This gate proves the framework-neutral one-shot and safe
warm-publication contracts. It still does not advance a Next.js or browser
claim; those need a real Next build and browser owner in NextJsHx. See
[Closed CSS Module types](CSS_MODULES.md) for the user-facing flow and limits.

Compiler representation, runtime/ABI, package publication, security,
migration, and public-claim changes require a review pass distinct from the
implementation. Challenge test sensitivity, oracle independence, negative
cases, mocked boundaries, selector omissions, scorecard laundering, and
over-broad prose; record each finding and disposition in the PR.

## Agent and contributor guide contract

The root and scoped `AGENTS.md` files are executable navigation contracts, not
standalone copies of the manuals. They identify the current compiler profiles,
source owners, user workflows, and focused test commands, then link to the
authoritative long-form guides.

Run:

```bash
yarn test:agent-guides
```

The gate verifies that local links and heading anchors resolve, the compiler
and ts2hx owner maps name their required entrypoints, and the selected critical
onboarding commands still have package-script owners. It intentionally does
not discover every shell command, score prose, or check external websites;
review remains responsible for clear explanations, command examples, and
truthful support boundaries.

## The agentic change loop

A compiler change can fail in several different places. Haxe may reject the
source, Genes may emit the wrong module, TypeScript may reject the generated
types, or the generated program may load successfully but behave incorrectly.
Running one giant suite after every edit is slow and often hides the first
useful failure. Running only a snapshot is fast but can miss runtime and public
type failures.

The practical loop is:

```text
changed compiler contract
  -> smallest matching owner
  -> inspect the artifact that carries the claim
  -> both-profile smoke or another independent owner
  -> existing full gate before merge
```

Use these commands:

| Command | What it does now | What it does not yet do |
| --- | --- | --- |
| `yarn test:focus -- <gate-id-or-path>` | Runs one smallest matching focused owner and writes its selection and log under `.tmp/test-evidence/test-plan/`. An exact gate ID is the most predictable form. | It is not a merge gate and deliberately omits unrelated matrices. |
| `yarn test:smoke` | Packages the current Genes checkout, compiles the same six official Haxe tests through classic JS and TypeScript, target-checks both, executes both, then proves eleven failure classes stay red. | It is not the complete official Haxe suite or broad Genes acceptance. |
| `yarn test:official-haxe-representative` | Runs five official methods in separate classic and TypeScript cells. Each cell must match its reviewed pass or owned known-problem outcome. | It is not a quick edit loop, the complete suite, or a compatibility percentage. |
| `yarn test:ci:explain` | Reports selected and omitted gates, matching rules, unknown or ambiguous paths, estimated known duration, and remote jobs without running them. | The selected plan is observation-only. |
| `yarn test:pr` | Reproduces the plan locally. During observation it still executes `test:ci` whenever the full backstop is selected. | It does not replace the hosted required gate. |
| `yarn test:full` | Runs the current complete local `test:ci` contract. | A local run does not prove hosted settings or release publication. |

The machine-readable plan is
[`tests/testing-strategy/agent-test-routing.json`](../tests/testing-strategy/agent-test-routing.json).
It records stable gate IDs, semantic owners, profiles, evidence kinds, feedback
rings, timeouts, cache policy, artifacts, and reverse-dependency rules. Run:

```bash
yarn test:agent-test-routing
```

The validator fails when IDs collide, commands or owner roots disappear,
official smoke hashes drift, a gate becomes unreachable, an impact rule names
an unknown gate or product surface, a surface lacks selected evidence, or
required CI no longer runs the plan and smoke. The selector
also has executable examples for compiler, TypeScript, React/HXX, harness,
package/release, ts2hx, ordinary documentation, unknown, and ambiguous changes.

Selection reports deliberately distinguish **affected surfaces** from
**covered surfaces**. “Affected” comes only from the changed path's explicit
impact rule or direct test owner. “Covered” lists everything the selected gates
happen to exercise. Selecting broad `full-ci` can cover the browser scorecard
without claiming a compiler-core edit changed browser behavior. Unknown paths
mark every surface affected because the repository cannot narrow them safely.
When a broad rule overlaps a more-specific compiler subtree, the broad rule may
still select conservative backstops while excluding its affected-surface claim;
the focused TypeScript/declaration or React/HXX rule then owns that attribution.
Declaration-only emitters therefore affect the declaration/package card without
advancing the TypeScript runtime card. The shared `src/genes/es/**` emitter is
not classic-only: TypeScript and classic declaration emitters subclass it, and
both implementation profiles use its JSX expression support. Its focused rule
therefore affects classic, TypeScript, declarations, and the React/HXX compiler
card.
The dependency lockfile is deliberately different: it can change every product
surface, so it marks all product scorecards affected even though the example
portfolio remains an evidence inventory rather than another product.

Maintained examples follow their executable claim ceiling rather than one broad
`examples/**` product rule. Every example change affects the example portfolio;
the Todoapp additionally affects the five surfaces proved by its dual-profile,
declaration, HXX, and Playwright observers, while the smaller
`typescript-target` showcase affects only classic and TypeScript runtime. A
future compile-only snippet may list no product claims. Similarly, a checked
React compiler fixture can affect HXX and generated TypeScript evidence while
the selected Playwright gate remains covered backstop evidence, not proof that
browser behavior itself changed.
The manifest validator ties each claim-bearing example route back to that
example's declared owner and requires the route's affected products to match
the example claims exactly, so adding or reclassifying an example fails closed
until its change routing is equally precise.

Direct test ownership answers which command should run; it does not answer
which product implementation changed. Owner-only fixture paths therefore add
their gate and appear under covered surfaces, but only an explicit impact rule
may add an affected surface. This prevents a broad source-map test from making
an unrelated fixture look like a React/HXX product change. Test-policy sources
such as the compatibility-report generator have their own all-scorecard rule,
because changing how evidence is summarized can alter every published claim.

Unknown means no rule or declared owner recognizes a changed path. Ambiguous
means more than one executable impact rule or declared gate owner claims it.
Both cases select the full backstop rather than guessing. For example,
`src/genes/react/JSX.hx`
belongs to the compiler core and React/HXX rules, so its explanation names both
and includes `full-ci`.

### Observation period

Affected-test selection is not yet allowed to remove any existing required
coverage. Every non-documentation pull request still runs:

- plan/provenance validation;
- the official Haxe both-profile smoke;
- all eleven failure-propagation checks, including source-cache drift and a
  silently omitted assertion count; and
- the existing required `genes-ts` full job.

The selector must complete at least 30 representative pull-request/main runs
over at least 14 days before promotion is considered. A failure on the complete
main/nightly suite that the selector should have chosen is a selector miss. It
updates the ownership rule and resets the confidence window for that area.
The daily scheduled workflow and every main push keep the complete current
primary suite as the audit backstop. Release publication still depends on the
clean, complete claim-bearing jobs.

There is no conditionally skipped selected-job graph yet, so a separate
selection aggregator would add ceremony without protecting anything. Add that
aggregator when selection becomes authoritative; it must then prove every
selected job actually ran and passed.

### Test-tool preparation

Standalone `yarn test:*` commands remain safe from a fresh checkout. Their
shared `yarn build:scripts` step now hashes every test-runner TypeScript source
and the configuration inputs that affect compilation. It reuses `scripts/dist`
only when all expected files and their aggregate hash match that exact input
identity. A changed source, changed configuration, missing output, corrupt
output, or absent cache causes a clean rebuild.

### Development-session tooling

The admitted-generation runtime is tested at four distinct boundaries so one
green mock does not stand in for filesystem, process, or protocol behavior:

```bash
yarn --cwd tooling test
yarn test:tooling-package
```

- `session-vector-test` validates the released JSON schemas and all exact
  protocol payload examples.
- `session-runtime-vector-test` drives all 12 released scenarios through the
  real state machine with controlled compiler, watcher, validator, and fault
  boundaries. It checks event/state runs, revisions, generations, first
  admission, failure phases, publication attempts, and read-barrier behavior.
- `session-test` uses the real recoverable artifact publisher to prove
  last-good output, rollback, exact stale deletion, unowned-file preservation,
  burst supersession, HXML registration-gap closure, compiler-identity
  rotation, read/publication exclusion, and single-writer ownership. Its
  adversarial closure cases also cover mutable invocation inputs, nested HXML
  lifecycle/output flags, unowned path collisions, exact marker/manifest
  drift, reconciliation failure at both publication claims, startup/close
  races, private-path sanitization, and process-exit recovery through a
  different private state directory. It also proves unresolved libraries fail
  before compilation, resolved library HXML receives the same option policy,
  portable output aliases share one lock/control/digest identity, alias
  input/state overlap is rejected, and an alias restart resolves the original
  journal. It also starts from real entry-scoped output, recovers the older
  journal, blocks an older live writer, and proves that the upgrade keeps the
  accepted output while establishing the new root marker. The test stops after
  journal preparation and file moves within each receipt, migration-fence,
  owner, and root-marker step. Every restart must remove those journals without
  rebuilding or changing the accepted output. It also rejects a marker that
  does not match the live Genes manifest, corrupt receipts, corrupt fences, and
  conflicting old entry markers. One cross-process fixture compiles and runs
  the exact released v1 implementation at commit
  `33ecc1b4476b7090c56cae82775b8ec8d533b898`. The current implementation then
  recovers that state, blocks a same-entry downgrade, and accepts later v2
  generations. Direct-path checks reject symbolic links as case-alias evidence.
  Entry ordering, symlinked parent directories, stable-control/state
  separation, and repeated private-path sanitization are focused regressions.
  A two-library case keeps both external class paths and proof files in the
  watch set. An external source edit rebuilds with a private logical event path.
  A proof-file edit also changes the warm compiler identity. Undeclared and
  linked external paths fail before the compiler runs.
  The same test checks declared compiler-data limits, exact bytes and digests,
  access without filesystem paths, linked files, missing or extra files, and
  expired reads. A crash test covers a stopped compiler-data update. Recovery
  rolls back and rebuilds instead of validating without the private bytes.
- `session-integration-test` uses the selected Haxe 4.3.7 compiler for both
  TypeScript and classic JavaScript output. A real module-level Haxe macro
  writes declared JSON during typing. The host validates and publishes those
  bytes with each generated tree. Warm edits reuse one owned Haxe server in
  each profile. The authored program uses two distinct libraries outside the
  project folder, and an edit to one library triggers a real warm rebuild.
  Direct Haxe cases also reject a missing session declaration,
  an unknown ID, a duplicate write, and an oversized value at the macro call.
  The test still proves the private output override, the compiler's v2
  ownership manifest, source-map path safety, and HXML policy before public
  mutation.

The focused HXML inventory test checks every Haxe 4.3.7 option that receives
special early handling. Its inline `--option=value` form must fail before a
library resolver or Haxe can run, while ordinary inline one-value options still
pass the same safety checks. Focused tests also cover a missing class-path
directory that is created after inventory, plus an ordinary inline value ending
in `.hxml`. The standalone inventory must reject that value because its output
is passed directly to Haxe. The session vector and real development-session
test prove the private bridge keeps the value as data, removes its helper before
validation, and never publishes it. The real Haxe fixture reads the define
during typing, so a missing or rewritten value cannot pass merely because the
application never used it. The focused inventory test also rejects a line break
introduced through a separate option value and an already-present broken
symbolic link. The watcher test creates a symbolic link after a missing nested
class path was registered and proves the next scan stops before following it,
whether the link's target exists or is itself still missing.

The package gate then installs the deterministic tarball into a clean Node
project, type-checks the public factory/types, and imports both the root and
`./session` runtime exports. Framework/browser acceptance remains downstream:
NextJsHx proves a non-Vite host, while GameCarry is the first maintained Vite,
strict-TypeScript, React, and agent-facing reference integration.

`yarn test:test-tool-preparation` proves the cold, warm, changed-input,
corrupt-output, and missing-output paths. Initial local samples were 2.31
seconds for a rebuild and 0.20 seconds for a verified hit. Those are samples,
not blocking performance thresholds.

### Stop and escalate

Stop the loop and diagnose before running more aggregates when:

- the focused command fails or hangs;
- the generated artifact changes for a reason the fixture does not explain;
- classic and TypeScript disagree about shared Haxe behavior;
- a snapshot passes but runtime, declaration, or source-map evidence is still
  required;
- a selected test is skipped, disappears, or executes no assertion;
- a failure changes the last-good public evidence tree or leaves staging
  debris; or
- a downstream problem has not yet been reduced to a generic Genes fixture.

Escalate when a change crosses owners. A TypeScript cast can also add a
type-only import; moving an HXX child can change evaluation order and source
maps; changing persistent macro state requires cold/warm compiler-server
evidence. Record observed facts, inferences, and remaining experiments in the
pull request.

## Portable Haxe compatibility versus Genes product evidence

These are independent evidence axes:

1. **Portable Haxe compatibility** asks whether exact official Haxe source
   compiles through a packaged Genes build, passes the target checker, and
   executes successfully.
2. **Genes product evidence** asks whether declarations, imports, source maps,
   output transactions, HXX/React behavior, compiler-server reuse, package
   shape, and maintained applications satisfy their own contracts.

A green todoapp does not establish the upstream Haxe language corpus. A green
numeric-literal test does not prove declarations, package imports, HXX, or
rollback. Reports and claims therefore keep the two Genes profiles and these
two evidence axes separate.

### Current official-suite smoke

`yarn test:smoke` currently proves a deliberately bounded result:

> Each Genes profile passes the published six-test official Haxe 4.3.7 smoke
> subset after target checking and Node execution. This is not the complete
> applicable official `tests/unit` contract.

The pinned inputs are:

- Haxe revision `e0b355c6be312c1b17382603f018cf52522ec651`;
- utest revision `a94f8812e8786f2b5fec52ce9f26927591d26327`;
- three `TestNumericSeparator` methods;
- the generated `IntIterator.unit.hx` specification; and
- issue regressions `Issue10018` and `Issue10032`.

The runner downloads or archives those revisions into an ignored cache,
verifies every selected source hash and license record, packages the current
Genes checkout as a Haxelib artifact, and runs the same active identities in
both profiles:

```text
classic:    Haxe -> packaged Genes -> ESM JavaScript -> node --check -> Node
typescript: Haxe -> packaged Genes -> TypeScript 5.5.4 strict -> JavaScript -> Node
```

Both profiles currently execute 45 assertions. The machine report includes
every test ID, per-test assertion/failure count, source identity, exact runtime
toolchain, stage duration, command, log, and generated tree:

```text
.tmp/test-evidence/portable-haxe-smoke/report.json
```

The selected official tests use utest assertions, but the full historical
utest reporting/browser runner is not itself part of this strict-TypeScript
smoke. Genes therefore uses a small typed harness adaptation that calls the
exact selected methods and preserves their assertion predicates. Both the
upstream utest inputs and every local adapter file have reviewed SHA-256 values
in
[`tests/portable-haxe-smoke/manifest.json`](../tests/portable-haxe-smoke/manifest.json).
Changing either side fails closed until the adaptation is reviewed again.

The failure harness injects generation, JavaScript syntax, strict TypeScript,
module-load, assertion, runtime-exception, timeout, and missing-active-test
failures. Every case must exit nonzero, keep a diagnostic tree, and leave the
last successful public evidence tree byte-identical.

### Current representative official-suite lane

`yarn test:official-haxe-representative` adds five methods from the reviewed
inventory. Each method runs in a separate compilation for each profile.

The manifest requires an exact result for each method and profile. A passing
result has a reviewed assertion count. A known problem has a phase, diagnostic
text, and Bead owner. A changed result fails until a reviewer updates the
manifest. Each selected identity and source must also occur in both reviewed
registration files.

The daily schedule and every release-eligible push to `main` run this command.
The quick pull-request scope continues to use `yarn test:smoke`, and manual
dispatches do not create representative release evidence.

The machine report keeps all outcomes separate. In hosted runs it also records
the scheduled or release scope, exact commit, run identity, reviewed
exclusions, and exact artifact name. Compiler publication depends on that
same-run job. CI uploads the complete tree as
`official-haxe-<scope>-<40-character-sha>`.

The report does not combine the profiles or calculate a compatibility
percentage. See
[`tests/official-haxe-representative/README.md`](../tests/official-haxe-representative/README.md)
for the current methods and outcomes.

### Complete active registration inventory

`yarn test:official-haxe-inventory` records the complete active registration
set before Genes compilation or runtime execution. It reads the typed upstream
`unit.TestMain` program after conditional compilation and macro expansion.

Each profile registers 1,373 test methods:

- 250 main unit methods.
- 67 generated standard-library specification methods.
- 1,056 issue-regression methods.

The command generates classic and TypeScript inventories independently. Their
identities must match the reviewed files and each other.

Each ignored source cache records a SHA-256 hash of its complete extracted
tree. Every cache hit recalculates that hash before Haxe reads the source.

The manifest also records inactive upstream source and later runtime
requirements. These requirements include resources, filesystem access,
loopback sockets, and the official HTTP echo server.

See
[`tests/official-haxe-inventory/README.md`](../tests/official-haxe-inventory/README.md)
for the exact pins, extraction rule, capability policy, and update command.
This inventory does not claim that Genes compiles or runs all 1,373 methods.

### Remaining official-Haxe work

Runtime capability shards, workflow enrollment for the representative lane,
the Haxe preview source manifest, and the full release-package suite remain
tracked work. Do not turn these results into a compatibility percentage or say
Genes “passes the Haxe suite.”

## Measured starting point

The machine-readable baseline is
[`tests/testing-strategy/ci-baseline.json`](../tests/testing-strategy/ci-baseline.json).
It records ten successful main-branch workflow runs and one local full-gate
sample from before this change.

| Observed item | Initial result | Interpretation |
| --- | ---: | --- |
| Primary `genes-ts` remote job | p50 1,726 s; p95 1,803 s | This was the required critical path and included a 1,409-second acceptance stage in the reference run. |
| Duplicate next-LTS acceptance smoke | p50 1,196 s; p95 1,241 s | A supported compatibility lane; its cost is visible but is not demoted in this increment. |
| Haxe preview advisory | p50 752 s; p95 765 s | Preview remains advisory and collects the complete configured evidence. |
| Classic stable Ubuntu | p50 42 s; p95 50 s | A useful early runtime signal. |
| Local `yarn test:ci` | 1,230.36 s (one sample) | Initial sample only, not a percentile. |
| New both-profile official smoke | 5.49 s intermediate local sample | Generation, strict target checking, and runtime all occur inside the measured report. |
| New local `yarn test:smoke` aggregate | 31.45 s intermediate nine-sentinel sample | This predates the tenth missing-assertion sentinel and is retained only as rollout history, not exact-head timing. |
| Post-change local `yarn test:ci` | 1,238.10 s intermediate sample | This review-round run predates later reviewer corrections. Its 7.74-second / 0.63% difference remains descriptive, not exact-head or percentile evidence. |

**Observed:** the existing full gate passed before graph changes, the smoke
passes both profiles with identical active results, and verified test-tool
reuse avoids recompiling unchanged runners. An intermediate full-gate sample
passed all prior owners plus the then-current plan and smoke checks without a
material single-run slowdown. Exact-head readiness comes from the hosted PR
gate; this table does not relabel that evolving result as a stable percentile.

**Inferred:** placing the smoke before the long primary job should provide a
faster actionable compiler/runtime failure. Hosted queue/setup time and actual
failure latency are not yet measured, so this is not reported as an achieved
remote SLO.

**Assumed for rollout:** 30 representative runs or 14 days is enough initial
variety to assess the selector. This governance threshold can be tightened
after real misses and change distributions are known.

**Unknown/untested:** time to first actionable failure from red runs, new
remote p50/p95, unique-failure yield, final CI-minute change, and whether
selected PR execution can safely replace any existing required work.

The new preflight job adds setup rather than pretending it is free. Its value
is earlier, clearer failure and auditable source provenance. Refactoring the
long primary job or reusing immutable generated artifacts across jobs requires
post-merge timing evidence and remains separate work.

## Compiler

### 1) Classic Genes JS mode (baseline semantics)

Run:

```bash
npm test
```

This compiles `tests/*.hx` using classic Genes JS output and runs the suite under Node.

### 2) TypeScript output mode (`-D genes.ts`)

Run:

```bash
npm run test:genes-ts
npm run test:genes-ts:minimal
npm run test:genes-ts:full
npm run test:genes-ts:tsx
```

What these cover:
- **TS output snapshots**: lock down deterministic `.ts` output for key fixtures.
- **Strict TS typecheck**: `tsc -p ...` on generated TS/TSX.
- **Runtime smoke**: execute compiled JS under Node.

The authoritative same-source and output-quality layers are separately
available:

```bash
yarn test:dual-output    # semantic TS/classic/standard-Haxe/vanilla evidence
yarn test:output-quality # exact maps, clean hashes, and reviewed budgets
yarn test:output-transaction # failure atomicity and stale-file ownership
yarn test:interop:module-shapes # npm declaration/runtime import contracts
yarn test:library-profile # default DCE vs matched TS/classic library surfaces
yarn test:react-hooks # semantic React state/deps, placement, analyzers, maps
yarn test:react-flight # React 19 value algebra, host extensions, native identities
yarn test:dynamic-import-policy # cold/warm runtime-suffix equivalence
yarn test:compiler-server # whole-compiler cold/warm lifecycle equivalence
yarn test:compiler-server:rollback # raw/structured post-staging recovery
yarn test:null-safety # compiler scope, macro order, escape inventory, stable compile
yarn benchmark:dependency-plan # report-only scaling experiment for large import graphs
```

Direct builds are the correctness baseline. They prove that a clean compiler
process can type, plan, emit, publish, type-check, and run the requested
profile. The compiler-server gate answers a different question: whether those
same results stay byte-for-byte and behaviorally identical when Haxe reuses one
process across requests. A green server run does not replace the ordinary
classic, TypeScript, declaration, source-map, or transaction owners, and users
do not need a server to use Genes correctly.

`yarn test:null-safety` owns the compiler implementation's Haxe source-checking
policy. It verifies that recursive Loose checking targets only `genes.*`, is
installed before `Generator.use()` can load those types, and that every
`@:nullSafety(Off)` is a statement-local entry in the reviewed machine-readable
inventory. It also performs the stable Haxe compile. It does not prove emitted
TypeScript nullability or JavaScript missing-value behavior; those remain owned
by the strict TypeScript, dual-output, runtime, and nullish fixtures described
in [`NULL_SAFETY.md`](NULL_SAFETY.md). The command runs in the required
`genes-ts (TS output + todoapp E2E)` PR job as well as `test:ci`, so an ordinary
compiler change cannot merge with a broadened or unreviewed escape.

When changing compiler lifecycle state, run the smallest semantic owner first,
then the server owner. For example, a dynamic-import change starts with
`yarn test:dynamic-import-policy`; a pre-DCE signature change starts with its
type/declaration fixture. Finish with:

```bash
yarn test:compiler-server
yarn test:ci
```

The server command selects the real configured Haxe executable, starts exactly
one child on a reserved loopback port, and never attaches to an existing
process. Readiness is a real compilation with a 10-second startup deadline,
not a successful TCP connection. Stable clients have a 60-second timeout;
preview clients have 120 seconds. On every success, failure, timeout, or
interrupt, cleanup sends `SIGTERM`, escalates to `SIGKILL` after two seconds,
awaits the exact child, and verifies that its PID is gone. Logs are retained
for a bounded failure report.

Stable Haxe 4.3.7 is the blocking warm-build contract. Haxe
`5.0.0-preview.1` runs the same command in the advisory CI job: it currently
accepts the native server protocol but exposes a cold/warm post-DCE monomorph
difference in `genes/Register.ts`. That result remains visible and is not
allowlisted, but it does not weaken the stable release gate. The latest-Node
smoke sets `SKIP_COMPILER_SERVER=1` because that lane owns Node compatibility;
the main stable acceptance job owns compiler-server correctness.

`yarn test:compiler-server:rollback` focuses on one failure boundary within
that lifecycle. It first publishes a known-good TS or classic
JavaScript-plus-declarations tree, then throws after every generated file has
been written into the private stage. One case uses the ordinary structured
compiler diagnostic; the other throws a plain Haxe string. Both the isolated
compiler and the warm server must report the original message, leave the
public tree and ownership manifest byte-identical, remove the private stage and
Haxe sentinel, and compile successfully afterward.

Stable Haxe additionally requires the recovered warm tree to equal the cold
tree. Preview compares each recovered process with its own prior tree because
the complete server owner already exposes a separate cold/warm
`genes/Register.ts` typed-AST variance. The focused comparison does not
allowlist or normalize those files: `yarn test:compiler-server` continues to
report the independent preview difference.

The quality manifest measures the bounded dual corpus. It uses exact module,
temporary, and import baselines plus 5% byte/token ceilings; it is not a
whole-language performance benchmark.

`benchmark:dependency-plan` answers a narrower performance question: how a
single generated module's build time changes as its import graph grows from
128 to 512 edges. It reports complete warm genes-ts build times and verifies
identical output hashes, but it sets no CI timing budget. See
`tests/dependency-plan-benchmark/README.md` for the fixture shape and guidance
on interpreting the numbers without mistaking a whole-build result for a
microbenchmark of one planner function.

### Performance evidence and CI budgets

Every compiler pull request must consider three independent costs:

1. how much work Genes and Haxe perform while compiling;
2. how much code Genes emits; and
3. how much work the emitted program performs while running.

The relevant evidence depends on what changed. A dependency-planner edit should
run `yarn benchmark:dependency-plan`; an emitter or lowering change should
inspect the TypeScript and classic output and run `yarn test:output-quality`;
a runtime-helper or hot generated-expression change needs a focused runtime
benchmark or an exact operation/allocation count. Documentation-only work can
be performance-neutral, but its PR should say why so reviewers know the
question was considered.

Genes already has a blocking structural performance budget. During
`yarn test:acceptance`, `test:output-quality` checks a deterministic dual-output
corpus. Module counts are exact, byte and token counts have at most a reviewed
5% ceiling above their baseline, and import or lowering-temporary counts cannot
grow without an explicit new baseline and rationale. These metrics are stable
enough for CI because identical source and toolchains should produce identical
structure; the gate is not a statistical wall-clock benchmark.

Wall-clock time, memory, and end-to-end edit latency need a different
threshold. A blocking timing budget must first have:

- a representative workload and a same-run control or baseline;
- pinned toolchains and a named CI environment;
- documented warmup and repeated sampling;
- enough recorded runs to characterize normal variance; and
- a reviewed relative regression limit that fails a deliberately slower
  implementation without failing ordinary runner noise.

Until those facts exist, keep timing report-only and create an owning Bead for
collecting them. Report-only means the command helps diagnose a possible
regression; it does not prevent one from merging. Once the evidence is stable,
put the threshold and its rationale in a reviewed configuration file, run it
in the normal acceptance path, and require an explicit review when changing
the baseline. Never turn one workstation measurement into an absolute CI
timeout.

Performance improvements remain subject to all semantic gates. A faster build
or smaller file does not justify changed evaluation order, weaker types,
missing source mappings, nondeterministic output, stale compiler-server state,
or a regression in the other output profile.

The transaction harness deliberately fails after complete private staging
and again after a real filesystem rename. For both TS and classic JS with
declarations/maps, it requires the prior tree to remain byte-identical, then
proves a successful build removes only stale manifest-owned modules, preserves
a colocated user asset, and reproduces the same clean-tree hashes. It also
builds punctuation-colliding filenames and `.ts`/`.js` entrypoints into shared
directories. Each must receive a distinct v2 manifest containing its exact
owner, a mismatched owner record must fail before publication, and an ambiguous
v1 manifest must remain untouched.

The dual/output-quality pair also owns the pre-emission lowering-plan contract:
`TempPlan` supplies iterator and expression-result bindings to both printers,
and `NamePlan` supplies deterministic local names by `TVar.id`. Runtime traces
cover receiver/index/RHS order, clean-tree hashes cover naming determinism, the
no-temp entry point rejects needless declarations, and the main genes-ts suite
keeps inline-expanded collision and record/TSX readability cases focused.

The package-shape gate covers a precise manual CommonJS `export =`
const-plus-namespace constructor and a dts2hx-generated bridge for ESM,
subpaths, conditional `import`/`require` exports, and a class-shaped CommonJS
`export =`. It resolves declarations through TS6 and dts2hx's pinned TS5.9 API,
compares two clean generated extern trees to a checked-in manifest, rejects
weak generated types, compiles strict negative consumers on TS 5/6/7, and runs
the same Haxe source through TS and classic ESM.

The reusable-library gate starts from an API that no Haxe expression calls.
Default classic output must omit it. `-D genes.library` must instead retain the
marked facade, signature-only classes, and required abstract runtime helpers in
both classic JS/`.d.ts` and TypeScript implementation output. Strict consumers
reject private or nonexistent members, both runtimes execute, and classic mode
without `-D dts` must fail before publishing output.

The dynamic-import policy gate owns one real Haxe compiler server rather than
attaching to an ambient process. It builds `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`,
and extensionless profiles cold and in a repeated warm sequence. Every warm
tree must hash exactly like its isolated cold build; ordinary `.ts`/`.tsx`
surfaces must pass TS 5/6/7, the classic `.mjs` request must execute, and the
exact `import()` token must map to the authored Haxe macro call. The
extensionless TS profile proves request spelling and cold/warm equality only,
because its application or bundler owns module resolution. The harness uses
`finally` to terminate its child after normal success or a handled failure and
rejects leaked transaction stages, output sentinels, or compiler-only carrier
names. Injected failure, signal/interruption cleanup, and unrelated-process
controls belong to the separate whole-compiler server-lifecycle gate rather
than this suffix-policy fixture.

The whole-compiler lifecycle gate is:

```bash
yarn test:compiler-server
```

It owns exactly one Haxe server child and never discovers or attaches to an
ambient process. A real bounded compilation establishes readiness; every later
client has a timeout and retained logs. Shutdown sends `SIGTERM`, escalates to
`SIGKILL` after a bounded grace period, awaits the exact child, and checks that
its PID is dead. Separate probes cover interruption cleanup and prove an
unrelated local listener is neither contacted nor terminated.

Each semantic request is also built in a fresh process. The gate compares
sorted relative paths and raw-byte SHA-256 hashes for the entire warm and cold
trees, then independently checks runtime transcripts, TS 5/6/7 consumers,
classic declarations, source-map tokens, diagnostics, ownership manifests,
private transaction stages, and output sentinels. Its sequence includes TS,
classic MJS, TSX, changed output roots, edit/delete/restore, module directives,
module functions, library/DCE surfaces, a `TypeArguments.call` witness rebuilt
as String → Int → String at one exact source position, import forms and attributes,
post-staging failure/recovery, an active-to-disabled capability transition, and
two projects with identical Haxe module names but different typed contracts.
Every request also installs the framework-neutral React diagnostics and
analyzer-function passes, so their compilation-local callback guards are
exercised across the same cold/warm sequence even when a scenario does not
declare a React component.

Haxe 4.3.7 chooses native compiler-server caches from a compilation signature
whose important inputs include the target and defines, not the classpath name.
The two-project probe therefore supplies one private, behavior-neutral define
per project. This prevents Haxe itself from returning the wrong project's
typed module before Genes runs, while all `@:persistent` Genes macro state
still shares the same owned server process. Do not remove that define or
replace the cold/warm check with text-only snapshots.

Stable Haxe 4.3.7 is blocking in the main acceptance job. Haxe preview runs the
same owner in the advisory preview job; an unsupported native protocol or
preview-only failure is reported explicitly and does not redefine the stable
release contract. The secondary Node-version smoke skips this expensive owner
with `SKIP_COMPILER_SERVER=1`; that lane checks Node compatibility, while the
stable job owns compiler-server correctness.

At the current checkpoint, `5.0.0-preview.1` accepts the native protocol but
does not pass byte equivalence: its warm `genes/Register.ts` adds an
`unsafeCast<{}>` around `cls.prototype` that its cold build does not emit.
Record-mode compiler dumps localize the change to DCE resolving
`js.lib.Object.defineProperty`'s generic monomorph differently in cold and warm
trees; the earlier casting-stage trees agree. This remains visible in the
advisory job for typed-state characterization. Stable assertions are not
relaxed and no preview-specific output allowlist is used. The owner-by-owner
checkpoint table is in
[`tests/compiler-server/README.md`](../tests/compiler-server/README.md#macro-state-checkpoint).

### Compatibility evidence and downstream pressure tests

`yarn test:compatibility-report` checks the generated
`COMPATIBILITY_REPORT.md`/`.json` pair against repository-owned evidence. The
report deliberately keeps compile inventory, strict typing, semantic
differentials, snapshots, smoke/E2E, toolchains, package shapes, and downstream
pressure tests in separate buckets. Exact counts are recomputed from tracked
fixtures and validated manifests; intentional coverage changes must update the
evidence manifest and regenerate the report.

PiMonoHX and OpenCodeHX are pinned, nonblocking nightly pressure tests. Their
curated commands run only after dependency bootstrap and inside an OS network
namespace with external networking disabled. Result artifacts keep compiler
observations, downstream command results, known owners, and unsupported areas
separate. Both current pinned profiles have passing baselines; exception-policy
coverage uses a synthetic diagnostic fixture so a repaired downstream never
needs to retain a stale allowance. Execution requires the stable Node major
from `config/toolchains.json` before even the downstream clean step, preventing
native-addon ABI drift from looking like a compiler or application failure. A
reviewed downstream-owned known failure is accepted only when its pinned
command, exit code, and complete
ordered TypeScript diagnostic headline set match exactly; the runner then
continues later independent policy/unit/smoke stages. A missing, changed, or
additional diagnostic remains unclassified. A downstream failure becomes a
blocking compiler defect only after a generic reduced fixture lands here.
The OpenCodeHX contract exercises both its primary strict TypeScript build and
its same-source classic ESM application/declaration/runtime profile; this is
downstream pressure evidence, not a claim of complete OpenCode parity.

```bash
yarn report:compatibility --write # intentionally regenerate evidence docs
yarn test:compatibility-report    # check report + pinned contracts
yarn test:downstream:contracts    # validate pins/commands without execution
yarn test:downstream:curated --execute --id pimono-hx # stable Node lane; isolated CI
yarn test:downstream:curated --execute --id opencodehx # includes strict TS and classic ESM
yarn test:downstream:curated --execute --allow-host-network --id pimono-hx # explicit local network-policy override
```

## Example matrix and todoapp

### What we test

`examples/profiles.json` enumerates every immediate example directory, assigns
an owner and tier, names the exact product surfaces and distinctive claims it
supports, states a claim ceiling, and owns its `ts-strict` and `classic-esm`
commands. The current tiers are:

- **flagship application** — a maintained vertical application with real
  runtime/system observers (`todoapp`);
- **capability showcase** — a smaller executable onboarding path
  (`typescript-target`); and
- **compile-only snippet** — allowed for future narrow syntax demonstrations,
  but never runtime, migration, package, or browser proof.

The Todoapp-specific living coverage map is
[`examples/todoapp/feature-coverage.json`](../examples/todoapp/feature-coverage.json).
It inventories stable feature contracts across the TSX, low-level TypeScript,
minimal TypeScript, classic JavaScript, classic declaration, Node, browser, and
focused-fixture columns. It is a disposition map rather than another runner:
`covered`, `partial`, `gap`, and `not-applicable` say exactly how far that
observer can advance the claim, while evidence-owner records point back to the
existing executable commands and files.

`yarn test:agent-test-routing` validates the map and runs deliberate red
controls for deleted, missing, and duplicate stable IDs; dead command and file
owners; and invalid application dispositions. A disposition explains who owns
the part that Todoapp does not currently prove:

- `planned` names an open or in-progress Bead for useful application work that
  still needs to land;
- `focused-only` names the exact focused fixture that deliberately owns the
  remaining edge cases after Todoapp has exercised a representative case; and
- `not-applicable` says the Todoapp is the wrong observer for the contract,
  names its focused owner, and carries no application-profile evidence.

Every disposition includes a plain-language reason and the event that would
justify revisiting it. Rows that are complete for every applicable observer do
not need one. The required feature-ID inventory lives in the validator rather
than in the manifest it checks, so deleting a row cannot also delete the test's
expectation. Every row retains a focused owner because a flagship application
is broad integration evidence, not the lowest faithful observer for compiler
edge cases, diagnostics, source maps, transactions, or lifecycle failures.

Do not add a `Map`, dynamic import, module directive, deliberate name
collision, reflection call, or another construct merely to turn a coverage
cell green. Add application evidence when a real Todo workflow needs that
behavior. Otherwise keep the smaller focused fixture as the authoritative
test. `not-applicable` is scoped only to this application observer; it never
means that Genes does not support the feature.

The manifest validator ties claims to observers rather than tier labels alone.
Classic and TypeScript runtime claims require their matching runtime commands;
browser and React/HXX example claims require Playwright in both profiles; and
the declaration/package claim is limited to the both-profile flagship path.
Host tooling, ts2hx, and distribution claims have their own independent owners
and cannot be borrowed from an example. A compile-only snippet therefore lists
no product-surface claim at all, while remaining classified in the example
portfolio.

The aggregate runner rejects an
unowned directory, validates every structured command before execution, and
invokes each profile directly without a shell. Identical build commands are
deduplicated, but every declared runtime contract still executes. The runner
uses the minimal example as an exact runtime differential and validates the
todoapp with:

- isolated TS and classic web/server builds from the same Haxe source;
- strict TS implementation and classic declaration consumers on TS 5/6/7;
- a QA sentinel (server + API smoke + log capture + teardown) per profile;
- optional identical Playwright journeys per profile.

Run:

```bash
npm run test:examples         # all examples, both profiles, runtime/API smoke
npm run test:examples -- --playwright # add browser parity for both profiles
npm run test:todoapp          # API smoke only
npm run test:todoapp:e2e      # API smoke + Playwright
```

The legacy todoapp commands default to `ts-strict`; use
`node scripts/dist/qa-todoapp.js --profile classic` for a focused classic run.
The aggregate example command is the authoritative dual-profile owner.

### Playwright tests authored in Haxe

The Playwright specs live under:
- `examples/todoapp/e2e/src/` (Haxe)

They are compiled via genes-ts:
- Haxe → TS (`-D genes.ts`) into `examples/todoapp/e2e/src-gen/`
- TS → JS via `tsc` into `examples/todoapp/e2e/dist/`

The QA sentinel runs Playwright against `examples/todoapp/e2e/dist/*.spec.js`.

## One command

Run the full acceptance gate locally:

```bash
npm run test:acceptance
```

`test:acceptance` is the normal stable pull-request owner for the focused
direct-module-binding and strict-array-index contracts. The direct-binding
fixture exercises functions and closed values across TypeScript, TSX, classic
JavaScript, declarations, runtime imports, DCE, source maps, and failed-output
rollback. Strict
array indexing proves that generated TypeScript remains valid with
`noUncheckedIndexedAccess` while preserving the classic and standard Haxe
runtime result.

Those two tests used to run only as separate steps inside `test:ci`. GitHub's
normal stable compiler job calls `test:acceptance` directly, so that arrangement
could discover a regression during release validation rather than on the pull
request that introduced it. Acceptance now runs each focused owner once. A
structural assertion invoked by `scripts/test-acceptance.ts` rejects a duplicate
direct invocation from `test:ci` or either GitHub workflow, while the standalone
`yarn test:module-functions` and `yarn test:array-index-strict` commands remain
available for fast local iteration.

Run the composition check alone with:

```bash
yarn test:ci-gate-ownership
```

To mirror the CI split locally (classic tests + acceptance without rerunning classic):

```bash
npm run test:ci
```

`test:ci` delegates these two focused contracts to its acceptance phase, so the
release workflow also runs each one exactly once rather than repeating them
before the aggregate gate.

Toolchain compatibility is split by responsibility:

```bash
yarn test:matrix:generated  # curated emitted TS/.d.ts on TS5, TS6, and TS7
yarn test:matrix:api        # semantic gates and ts2hx on the TS6 Program API
```

The full CI gate includes the API lane; aggregate generated-output runners own
the three-compiler matrix internally. It also checks that the deterministic
compatibility report and downstream contracts are current. See
`TOOLCHAINS.md` for exact versions, scope, and the non-blocking Haxe preview
job.

## Security scanning

The repository owns three different security checks:

```bash
yarn test:codeql-workflow
yarn test:precommit-hook
yarn test:secrets
yarn test:vulns
```

`test:precommit-hook` creates a disposable primary checkout and linked worktree,
installs the real Beads/Genes hook composition, and proves that staged
credentials are rejected before commit creation. It also proves that complete
staged Haxe files are formatted and re-staged, while partially staged Haxe
files fail without changing either version. CI runs this focused contract in
both supported Beads lanes.

`test:secrets` scans the repository and committed history for credentials,
while `test:vulns` checks every lockfile installed by required tests, including
the focused CSS Modules processor/loader fixture. Both execute locally and as
separate GitHub jobs. The pre-commit scan reduces the chance of publishing a
secret-bearing branch; the required full-history scan remains the hosted
backstop when a local hook is absent or explicitly bypassed.

CodeQL is different: GitHub's hosted `Analyze (JavaScript)` job builds the
database, analyzes the JavaScript/TypeScript surface, and publishes its result.
It lives in the main CI workflow so the final release job can name it in
`needs`; a same-named check in a separate workflow could finish after
publication. The local `test:codeql-workflow` command checks that dependency
and the policy around the hosted scan. It requires the Node 24-based CodeQL v4
and checkout v7 action majors, the ordinary `pull_request` event rather than
the privileged `pull_request_target` event, the stable required-check name,
and the reviewed least-privilege job permissions:

```text
actions: read
contents: read
security-events: write
```

The CodeQL job intentionally does not run the compiler test matrix or install
the repository's configured Node release. CodeQL's embedded Node 24 runtime is
the implementation runtime of the GitHub actions themselves; it is independent
from the Node 22.22.0 and Node 24 application lanes in
`config/toolchains.json`. The local structural gate runs in `test:ci`, but a
green hosted CodeQL check is still required before merging a workflow change.

See also GitHub's
[CodeQL v4 migration notice](https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/)
and the [branch-protection check list](BRANCH_PROTECTION.md).

## Main protection contract

GitHub's active **Main branch quality gate** ruleset requires the stable
compiler, security, and CodeQL checks before a pull request can update `main`.
Run the repository-side structural proof with:

```bash
yarn test:main-protection-policy
```

This test deliberately checks both workflow triggers and exact job names.
Required checks must be created for every pull request, including a
roadmap-only `.beads/issues.jsonl` update; a workflow skipped by a path filter
would leave that pull request waiting forever. The test also protects the
non-blocking Haxe preview and macOS policies.

Repository settings cannot be proved from a checkout. Use the API commands in
[Main branch protection](BRANCH_PROTECTION.md#verify-the-live-rule) to confirm
the active ruleset, required GitHub Actions contexts, strict up-to-date policy,
and empty bypass list.

## Release workflow supply-chain contract

Compiler publication is the final job in the same `main` CI run that tested
the source. It tags that exact commit and injects the derived SemVer only into
temporary Haxelib package staging; it never pushes a generated release commit
through protected `main`. The focused non-publishing proof is:

```bash
yarn test:release
```

The three checks have separate jobs:

- `test:release-workflow` runs the installed Conventional Commit analyzer and
  release-notes generator, verifies the same-run dependency/permission model,
  exact plugin set, pinned compatibility versions, and development sentinels;
- `test:release-artifact` builds the tracked package twice, compares exact
  bytes, verifies inventory/version/tag/source metadata, and rejects tampering;
- `test:release-recovery` proves deterministic note regeneration, clean-tree
  enforcement, missing-only draft planning, byte/note mismatch rejection,
  immutable snapshot checks, and the repository-host control policy. The test
  does not call GitHub's mutating Release API; the final same-run job owns that
  integration and verifies its authoritative hosted result.

The required hosted `genes-ts` job runs all three checks. The release job then
depends on both that job and same-run CodeQL, so neither untested release code
nor an unfinished security scan can publish the current SHA.

Repository administrators additionally run:

```bash
node scripts/release/verify-host-controls.cjs fullofcaffeine/genes-ts
```

That read-only check requires immutable GitHub Releases plus an active `v*` tag
ruleset that prevents deletion and non-fast-forward updates. A local unit
fixture proves the interpretation; only the live API query proves the current
repository setting. The query needs repository `Administration: read`, which
GitHub's workflow `GITHUB_TOKEN` cannot request. CI intentionally uses only
`contents: write` and independently requires the final hosted Release to report
`immutable: true`; storing an administrator token in Actions is not part of the
release contract.

The compiler release job and the independent `@genes-ts/tooling` release
workflow can create publicly visible files, so their executable action
identities are stricter than ordinary CI: every release-job `uses:` reference
is a reviewed full commit SHA with a same-line release-version comment. The
GitHub-only archive workflow does not require a second-person approval. The
manual start is the release action, so the workflow does not ask for a typed
approval sentence. A first attempt requires an exact version and current
`main` commit. An exact tag at current `main` also remains a first attempt. A
retry can use the same commit after `main` moves only when the protected tag
locks that source and a draft or public GitHub Release exists for the tag. A
tag alone does not prove an interrupted release. The workflow records this
choice before it runs repository code. It keeps the package source at the
requested commit, but it runs the publisher from the reviewed workflow commit.
Before starting the workflow, the operator also runs the read-only host check
in [`RELEASING.md`](RELEASING.md). The separate npm workflow keeps its
existing protected-environment rules.

Run the GitHub archive check with:

```bash
yarn test:tooling-github-release
```

This check proves that a first attempt accepts only an exact `main` commit. A
retry can use an existing protected tag only when it points to the same
reviewed commit and has an existing draft or public Release. It also proves
that recovery runs the reviewed publisher without changing the package source.
The check also proves deterministic
package bytes, exact release files, safe retries, and a second hosted-byte check
immediately before publication. A lost publish response cannot hide a complete
immutable release. The final hosted check also repeats for a short bounded
period while GitHub updates its public state. This check does not publish a
release.

Run the separate npm workflow and live-settings proof with:

```bash
yarn test:tooling-release-workflow
```

The npm tooling test rejects mutable action tags, exercises fail-closed
environment-policy mutations, verifies the compiler ignores tooling-scoped
Conventional Commits, and reads the public live
`tooling-npm-production` environment. It does not dispatch a workflow, request
an npm identity, or publish bytes. A network/API failure is a test failure
because a cached settings snapshot cannot prove the current approval boundary.
See [Releasing genes-ts and `@genes-ts/tooling`](RELEASING.md) for the action
rotation and reviewer-change procedures.

## ts2hx (experimental)

The repository also contains an experimental TS/JS → Haxe transpiler under `tools/ts2hx/`.

It is validated by:
- golden/snapshot tests for deterministic output
- a small JS smoke test by compiling the emitted Haxe with the Haxe JS target

Run:

```bash
yarn --cwd tools/ts2hx test
```

This is also executed as part of `npm run test:acceptance` unless
`SKIP_TS2HX=1` is set. The aggregate `yarn test:ci` uses that flag for its
acceptance phase and immediately runs the dedicated `test:ts2hx` command, so
the full suite has one clearly attributed ts2hx owner instead of executing it
twice. Standalone acceptance remains complete by default.
