# genes-ts Compatibility Evidence

This file is generated deterministically by `yarn report:compatibility --write`.

## Reading this report

genes-ts supports controlled Haxe-to-TypeScript and classic ESM JavaScript profiles. This evidence inventory maps bounded claims to exact gates; it is not a blanket certification of arbitrary Haxe or npm programs.

This is an evidence contract, not a cached CI-success badge. `blocking` and `nonblocking-nightly` describe enforcement; current run results remain in CI. Compile, typing, semantic, snapshot, smoke, package, and downstream evidence are intentionally not merged into one score.

## Coverage counts

| Evidence class | Metric | Exact count | Disposition |
| --- | --- | ---: | --- |
| Compile inventory | Classic Haxe test modules | 46 | `blocking` |
| Compile inventory | Generated TypeScript snapshot profiles | 7 | `blocking` |
| Compile inventory | Examples with TS and classic profiles | 2 | `blocking` |
| Strict public typing | Strict positive/negative consumer sources | 7 | `blocking` |
| Strict public typing | Explicitly owned exported-surface boundaries | 6 | `blocking` |
| Strict public typing | Reusable-library same-source Haxe modules | 4 | `blocking` |
| Semantic differential | Same-source Haxe modules | 12 | `blocking` |
| Semantic differential | TS/classic/declaration and JS oracle profiles | 5 | `blocking` |
| Semantic differential | Stable dual-output runtime trace events | 19 | `blocking` |
| Semantic differential | ts2hx supported and fail-closed semantic input modules | 53 | `blocking` |
| Snapshot stability | genes-ts snapshot profiles | 7 | `blocking` |
| Snapshot stability | ts2hx reviewed snapshot files | 48 | `blocking` |
| Runtime smoke and E2E | Same-source dual-profile examples | 2 | `blocking` |
| Runtime smoke and E2E | Todoapp browser journeys run in each profile | 3 | `blocking` |
| Toolchain compatibility | Pinned TypeScript lanes | 3 | `blocking` |
| Toolchain compatibility | Pinned Haxe lanes | 2 | `blocking` |
| Toolchain compatibility | Pinned Node lanes | 2 | `blocking` |
| Package-shape interoperability | Local package-shape fixtures | 3 | `blocking` |
| Package-shape interoperability | dts2hx declaration entrypoints | 3 | `blocking` |
| Package-shape interoperability | dts2hx package roots | 2 | `blocking` |
| Downstream pressure tests | Pinned downstream repositories | 2 | `nonblocking-nightly` |
| Downstream pressure tests | Explicit unsupported/nonblocking full-app areas | 4 | `nonblocking-nightly` |
| Downstream pressure tests | Known pinned compiler/downstream observations | 0 | `nonblocking-nightly` |

## Toolchain contract

| Surface | Lane | Pin | Contract |
| --- | --- | --- | --- |
| Node | stable | 20 | blocking runtime lane |
| Node | next LTS | 22 | blocking runtime lane |
| Haxe | stable | 4.3.7 | blocking compiler lane |
| Haxe | preview | 5.0.0-preview.1 | nonblocking early warning |
| TypeScript | legacyFloor | 5.5.4 | generated-output |
| TypeScript | apiBridge | 6.0.2 | program-api-and-generated-output |
| TypeScript | current | 7.0.2 | generated-output-only |
| dts2hx | declaration ingestion | 0.34.0 / TS 5.9.3 / [ccc944540e04](https://github.com/haxiomic/dts2hx/commit/ccc944540e04ed1e41383533a3b7b9ac6ee80208) | declaration-ingestion |

## Compile inventory

Sources and declared profiles compile under their owned gates; compilation alone is not semantic or public-type proof.

### Classic JavaScript and TypeScript output inventory

- Disposition: `blocking`
- Scope: Classic Genes runtime tests, generated TypeScript snapshot profiles, and every checked-in example in both first-class output profiles.
- Proves: The enumerated compiler fixtures and examples compile under their owned TS/classic profiles.
- Does not prove: Compilation does not prove closed public types, runtime equivalence, or arbitrary ecosystem compatibility.
- Evidence:
  - [`test.hxml`](../test.hxml)
  - [`scripts/test-acceptance.ts`](../scripts/test-acceptance.ts)
  - [`scripts/test-examples.ts`](../scripts/test-examples.ts)
  - [`tests/genes-ts/snapshot`](../tests/genes-ts/snapshot)
  - [`examples/profiles.json`](../examples/profiles.json)
- Gates:
  - `yarn test`
  - `yarn test:acceptance`

## Strict public typing

Positive consumers compile and selected invalid consumers are rejected without broad public any/unknown/index signatures.

### Closed exported surfaces and strict declaration consumers

- Disposition: `blocking`
- Scope: Generated TS exports, ordinary interfaces, explicit foreign boundaries, classic declarations, and strict external consumers.
- Proves: Selected exported APIs are semantically audited, strict consumers reject the named unsafe programs, and one opt-in library graph has matched retained TS/classic runtime and declaration surfaces.
- Does not prove: The audit cannot infer soundness for untested raw metadata or every third-party declaration package.
- Evidence:
  - [`scripts/exported-surface-policy.ts`](../scripts/exported-surface-policy.ts)
  - [`scripts/test-exported-surface-policy.ts`](../scripts/test-exported-surface-policy.ts)
  - [`scripts/test-classic-dts.ts`](../scripts/test-classic-dts.ts)
  - [`scripts/test-library-profile.ts`](../scripts/test-library-profile.ts)
  - [`tests/typing-policy/exported-surface-boundaries.json`](../tests/typing-policy/exported-surface-boundaries.json)
  - [`tests/typing-policy/semantic`](../tests/typing-policy/semantic)
  - [`tests/classic-dts/consumer.ts`](../tests/classic-dts/consumer.ts)
  - [`tests/output-modes/consumer.ts`](../tests/output-modes/consumer.ts)
  - [`tests/library-profile/consumer.ts`](../tests/library-profile/consumer.ts)
  - [`tests/library-profile/src`](../tests/library-profile/src)
- Gates:
  - `yarn test:types:exports`
  - `yarn test:classic:dts`
  - `yarn test:dual-output`
  - `yarn test:library-profile`

## Semantic differential

Named runtime traces agree across the explicitly listed oracles; the result applies only to those contracts.

### Same-source compiler and ts2hx semantic differentials

- Disposition: `blocking`
- Scope: Haxe-to-TS/classic evaluation traces plus ts2hx strict-js contracts across original TypeScript, classic Genes, and genes-ts, with a separate standard-Haxe capability boundary.
- Proves: Named original-TypeScript, classic Genes, and genes-ts traces preserve the exercised runtime behavior; thirteen canonical ts2hx boundaries fail closed, including standard-Haxe rejection and same-server isolation of the private Genes request capability.
- Does not prove: The standard-Haxe rejection is a capability test, not a fourth runtime-parity oracle; the curated traces are neither a language-wide proof nor a portability promise for other Haxe targets.
- Evidence:
  - [`tests/output-modes/profile-ownership.json`](../tests/output-modes/profile-ownership.json)
  - [`tests/output-modes/expected-trace.json`](../tests/output-modes/expected-trace.json)
  - [`tests/output-modes/src`](../tests/output-modes/src)
  - [`scripts/test-output-modes.ts`](../scripts/test-output-modes.ts)
  - [`tools/ts2hx/fixtures/semantic-diff`](../tools/ts2hx/fixtures/semantic-diff)
  - [`tools/ts2hx/fixtures/semantic-module-boundaries`](../tools/ts2hx/fixtures/semantic-module-boundaries)
  - [`tools/ts2hx/fixtures/semantic-unsupported`](../tools/ts2hx/fixtures/semantic-unsupported)
  - [`tools/ts2hx/src/test-semantic-diff.ts`](../tools/ts2hx/src/test-semantic-diff.ts)
  - [`tools/ts2hx/src/test-runtime-profile.ts`](../tools/ts2hx/src/test-runtime-profile.ts)
- Gates:
  - `yarn test:dual-output`
  - `yarn --cwd tools/ts2hx test:semantic-diff`
  - `yarn --cwd tools/ts2hx test:runtime-profile`

## Snapshot stability

Generated source shape is deterministic relative to reviewed snapshots; snapshots do not establish semantics by themselves.

### Reviewed genes-ts and ts2hx snapshots

- Disposition: `blocking`
- Scope: Generated TypeScript/TSX and supported ts2hx Haxe source shapes.
- Proves: The exact generated forms remain stable unless reviewers intentionally update their baselines.
- Does not prove: A stable snapshot can preserve a bug; semantic and typing gates remain authoritative.
- Evidence:
  - [`scripts/test-genes-ts-snapshots.ts`](../scripts/test-genes-ts-snapshots.ts)
  - [`tests/genes-ts/snapshot`](../tests/genes-ts/snapshot)
  - [`tools/ts2hx/src/test-snapshots.ts`](../tools/ts2hx/src/test-snapshots.ts)
  - [`tools/ts2hx/tests_snapshots`](../tools/ts2hx/tests_snapshots)
- Gates:
  - `yarn test:genes-ts:snapshots`
  - `yarn --cwd tools/ts2hx test:snapshots`

## Runtime smoke and E2E

Named application journeys execute in selected profiles; smoke success is not general semantic parity.

### Same-source examples and todoapp browser E2E

- Disposition: `blocking`
- Scope: The minimal example and fullstack todoapp compile from one Haxe source tree through TS and classic ESM profiles.
- Proves: Both outputs build and execute the same selected application workflows, including validation, CRUD, navigation, and deep links.
- Does not prove: Two green examples do not imply whole-ecosystem or framework-independent parity.
- Evidence:
  - [`examples/profiles.json`](../examples/profiles.json)
  - [`examples/typescript-target/src`](../examples/typescript-target/src)
  - [`examples/todoapp/src`](../examples/todoapp/src)
  - [`examples/todoapp/e2e/src/todo/e2e/Main.hx`](../examples/todoapp/e2e/src/todo/e2e/Main.hx)
  - [`scripts/test-examples.ts`](../scripts/test-examples.ts)
  - [`scripts/qa-todoapp.ts`](../scripts/qa-todoapp.ts)
- Gates:
  - `yarn test:examples --playwright`

## Toolchain compatibility

Generated output and programmatic compiler APIs are checked on separately owned, pinned lanes.

### Pinned generated-output and compiler-API lanes

- Disposition: `blocking`
- Scope: Stable/current Node, stable/preview Haxe, TS5/TS6/TS7 generated output, the TS6 program API, and dts2hx's TS5.9 converter API.
- Proves: Generated code and API consumers are checked against their explicitly different compatibility contracts, and ts2hx request evidence records the exact pinned TypeScript engine and configured transform behavior.
- Does not prove: The Haxe preview lane is nonblocking, and TS7 generated-output success does not imply a TS7 programmatic API.
- Evidence:
  - [`config/toolchains.json`](../config/toolchains.json)
  - [`scripts/toolchains.ts`](../scripts/toolchains.ts)
  - [`scripts/test-typescript-api-lane.ts`](../scripts/test-typescript-api-lane.ts)
  - [`tools/ts2hx/src/semantic/effective-module-requests.ts`](../tools/ts2hx/src/semantic/effective-module-requests.ts)
  - [`tools/ts2hx/src/semantic/compiler-facts.ts`](../tools/ts2hx/src/semantic/compiler-facts.ts)
  - [`tools/ts2hx/src/test-effective-module-requests.ts`](../tools/ts2hx/src/test-effective-module-requests.ts)
  - [`docs/TOOLCHAINS.md`](../docs/TOOLCHAINS.md)
  - [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Gates:
  - `yarn test:versions`
  - `yarn test:matrix:generated`
  - `yarn test:matrix:api`
  - `yarn --cwd tools/ts2hx test:esm-request-plan`

## Package-shape interoperability

Named ESM, subpath, conditional-export, CommonJS, and declaration-ingestion fixtures work under their tested resolution modes.

### ESM/CommonJS/subpath/declaration-ingestion package shapes

- Disposition: `blocking`
- Scope: Manual externs and deterministic dts2hx-generated externs consumed through TS and classic Genes profiles.
- Proves: The named package and import forms resolve, type-check, and execute through the tested profiles without weak generated extern types.
- Does not prove: Three synthetic packages do not cover every package.json condition, declaration merge, bundler, or host environment.
- Evidence:
  - [`scripts/test-package-shapes.ts`](../scripts/test-package-shapes.ts)
  - [`scripts/dts2hx-bridge.ts`](../scripts/dts2hx-bridge.ts)
  - [`tests/genes-ts/package-shapes/packages`](../tests/genes-ts/package-shapes/packages)
  - [`tests/genes-ts/package-shapes/dts2hx/manifest.json`](../tests/genes-ts/package-shapes/dts2hx/manifest.json)
- Gates:
  - `yarn test:interop:module-shapes`

## Downstream pressure tests

Pinned WIP consumers provide nonblocking integration evidence; failures are not compiler defects until reduced to a generic compiler fixture.

### Pinned PiMonoHX and OpenCodeHX pressure tests

- Disposition: `nonblocking-nightly`
- Scope: Pinned, network-isolated build/typecheck/local-smoke subsets from two WIP application ports.
- Proves: Exact downstream revisions run under the centralized stable Node lane; reviewed downstream-owned failures require exact command, exit-code, and TypeScript diagnostic evidence while independent later stages continue.
- Does not prove: A matched downstream-owned exception is not a compiler correctness proof; every unmatched failure remains unclassified until minimized, and a downstream pass is smoke evidence rather than semantic parity.
- Evidence:
  - [`tests/compatibility/downstream-contracts.json`](../tests/compatibility/downstream-contracts.json)
  - [`scripts/downstream-contracts.ts`](../scripts/downstream-contracts.ts)
  - [`scripts/downstream-runner-policy.ts`](../scripts/downstream-runner-policy.ts)
  - [`scripts/test-downstream-runner-policy.ts`](../scripts/test-downstream-runner-policy.ts)
  - [`scripts/test-downstream-contracts.ts`](../scripts/test-downstream-contracts.ts)
  - [`.github/workflows/downstream.yml`](../.github/workflows/downstream.yml)
- Gates:
  - `yarn test:downstream:contracts`
  - `yarn test:downstream:curated --execute`

## Pinned downstream revisions

These jobs are deliberately nonblocking and require the centralized stable Node lane before touching a checkout. Their JSON result artifacts keep the compiler candidate observation, downstream command statuses, and unsupported areas separate. A reviewed downstream-owned failure is recognized only by an exact pinned command, exit code, and complete TypeScript diagnostic set; every mismatch fails closed.

| Profile | Revision | Curated commands | Pinned baseline | Disposition |
| --- | --- | ---: | --- | --- |
| PiMonoHX curated compiler contract | [`c8025aa12a6a`](https://github.com/fullofcaffeine/pimono-hx/commit/c8025aa12a6a9a3901aadb63c097a5df66e03d33) | 8 | `passing` | `nonblocking-nightly` |
| OpenCodeHX curated compiler contract | [`26c09de81241`](https://github.com/fullofcaffeine/opencodehx/commit/26c09de81241efb0b7a36ed4e2dcc15def4e4445) | 8 | `passing` | `nonblocking-nightly` |

## Known pinned-contract observations

None.


## Explicit downstream exclusions

### PiMonoHX curated compiler contract

- `pimono-full-upstream-parity` — **not-claimed**: The port remains WIP and does not claim complete upstream Pi behavior.
- `pimono-live-provider-network` — **excluded-from-curated**: Live providers, OAuth, credentials, and external network effects are outside the no-network compiler contract.

### OpenCodeHX curated compiler contract

- `opencode-full-upstream-parity` — **not-claimed**: The port remains WIP and does not claim complete upstream OpenCode behavior.
- `opencode-live-package-network` — **excluded-from-curated**: Live package-manager and external provider effects are outside the no-network compiler contract.

## Promotion boundary

A passing downstream smoke or matched downstream-owned exception cannot promote a compiler claim. An unmatched downstream failure cannot block core work as a compiler defect until the underlying Haxe/JS/TS construct is minimized into this repository and assigned to the appropriate blocking evidence class.
