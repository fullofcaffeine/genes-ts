# Testing strategy (genes-ts)

genes-ts has two major things to keep reliable:
1) the **compiler** (classic Genes JS mode and `-D genes.ts` mode)
2) **every checked-in example in both output profiles**, including the
   fullstack todoapp as a realistic tooling/integration gate

This repo follows the **testing trophy**:
- **Lots of fast deterministic tests** (snapshots + typecheck)
- **Some runtime integration tests** (Node execution)
- **A small number of E2E tests** (Playwright) for the example app

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
yarn test:dynamic-import-policy # cold/warm runtime-suffix equivalence
yarn test:compiler-server # whole-compiler cold/warm lifecycle equivalence
yarn test:compiler-server:rollback # raw/structured post-staging recovery
yarn benchmark:dependency-plan # report-only scaling experiment for large import graphs
```

Direct builds are the correctness baseline. They prove that a clean compiler
process can type, plan, emit, publish, type-check, and run the requested
profile. The compiler-server gate answers a different question: whether those
same results stay byte-for-byte and behaviorally identical when Haxe reuses one
process across requests. A green server run does not replace the ordinary
classic, TypeScript, declaration, source-map, or transaction owners, and users
do not need a server to use Genes correctly.

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

`examples/profiles.json` enumerates every immediate example directory and owns
its `ts-strict` and `classic-esm` commands. The aggregate runner rejects an
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
module-function and strict-array-index contracts. Module functions exercise a
single Haxe module's exported functions across TypeScript, TSX, classic
JavaScript, declarations, runtime registration, DCE, and source maps. Strict
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

Secrets scanning is part of the standard gates:

```bash
yarn test:secrets
```

This is also executed as part of `yarn test:ci` and in GitHub Actions.

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
