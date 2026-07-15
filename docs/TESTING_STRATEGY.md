# Testing strategy (genes-ts)

genes-ts has two major things to keep reliable:
1) the **compiler** (classic Genes JS mode and `-D genes.ts` mode)
2) **every checked-in example in both output profiles**, including the
   fullstack todoapp as a realistic tooling/integration gate

This repo follows the **testing trophy**:
- **Lots of fast deterministic tests** (snapshots + typecheck)
- **Some runtime integration tests** (Node execution)
- **A small number of E2E tests** (Playwright) for the example app

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
```

The quality manifest measures the bounded dual corpus. It uses exact module,
temporary, and import baselines plus 5% byte/token ceilings; it is not a
whole-language performance benchmark.

The transaction harness deliberately fails after complete private staging
and again after a real filesystem rename. For both TS and classic JS with
declarations/maps, it requires the prior tree to remain byte-identical, then
proves a successful build removes only stale manifest-owned modules, preserves
a colocated user asset, and reproduces the same clean-tree hashes.

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

To mirror the CI split locally (classic tests + acceptance without rerunning classic):

```bash
npm run test:ci
```

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
