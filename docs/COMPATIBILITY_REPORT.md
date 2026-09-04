# genes-ts Compatibility Evidence

This file is generated deterministically by `yarn report:compatibility --write`.

## Reading this report

genes-ts supports controlled Haxe-to-TypeScript and classic ESM JavaScript profiles. This evidence inventory maps bounded Genes product claims and one six-test official Haxe smoke subset to exact gates; it is not a blanket certification of arbitrary Haxe or npm programs and does not claim the complete applicable official Haxe suite.

This is an evidence contract, not a cached CI-success badge. `blocking` and `nonblocking-nightly` describe enforcement; current run results remain in CI. Compile, typing, semantic, snapshot, smoke, package, and downstream evidence are intentionally not merged into one score.

## Product-surface scorecards

Each row is an independent claim boundary. A green gate may cover several rows, but it advances only the surface whose behavior and oracle the change actually exercised. The example portfolio is an evidence asset, not another compiler product.

| Surface | Kind | Current bounded claim | Claim ceiling |
| --- | --- | --- | --- |
| Classic JavaScript generation and runtime | `product` | Ordinary Haxe programs in the reviewed corpus compile to split ESM JavaScript and preserve the exercised Haxe runtime behavior. | The checked compiler and example corpora; not arbitrary Haxe ecosystem compatibility. |
| Typed TypeScript generation and runtime | `product` | The reviewed Haxe corpus emits strict, executable TypeScript with the asserted public and runtime semantics. | The checked TypeScript 5/6/7 contracts and fixtures; not all possible Haxe or TypeScript programs. |
| Declarations and package contracts | `product` | Reviewed classic declarations and package-shaped imports retain precise, consumable public contracts. | The checked declaration consumers and package fixtures; runtime success alone cannot advance this claim. |
| React, HXX, JSX, and TSX compiler behavior | `product` | Reviewed HXX and React source shapes compile, type-check, map, and execute consistently across their declared source/createElement profiles. | Compiler-facing React/HXX behavior; it does not by itself prove a real browser application. |
| Browser and framework runtime behavior | `product` | The maintained Todo application runs its distinctive browser workflow in both generated profiles. | The maintained browser scenarios and pinned framework versions; compiler-only React fixtures cannot advance this claim. |
| Host tooling and publication helpers | `product` | The reviewed host lifecycle and publication primitives work through their protocol, runtime, clean-consumer, and transaction tests. | Framework-neutral primitives only; no framework-specific watcher or deployment policy is implied. |
| TypeScript-to-Haxe migration tooling | `product` | The documented ts2hx subset translates its checked fixtures transactionally and passes its semantic/runtime comparisons. | The proven migration subset only; it is not arbitrary TypeScript support and does not prove Haxe-to-Genes conformance. |
| Installation, release, adoption, and downstream contracts | `product` | The reviewed artifacts install cleanly, preserve their declared package shape, and are checked against pinned downstream contracts without laundering those results into compiler conformance. | Pinned package and downstream contracts; nonblocking downstream observations cannot promote a core compiler claim. |
| Maintained example portfolio | `evidence-portfolio` | Every immediate maintained example is classified and executes no more evidence than its declared tier and profile contract. | Examples are evidence assets, not a substitute for the product surface that owns the behavior. |

### Classic JavaScript generation and runtime

- Owner: Classic emitter and shared Haxe runtime owners
- Gates: `classic-core`, `css-module-companions`, `dual-output-semantics`, `test:writer-position`, `portable-haxe-smoke`, `acceptance`, `full-ci`
- Compatibility evidence: `compiler-output-inventory`, `runtime-semantic-differentials`, `official-haxe-dual-profile-smoke`
- Maintained examples: `todoapp`, `typescript-target`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: The complete applicable official Haxe inventory is registration evidence only; representative runtime expansion remains separate from the six-test smoke.

### Typed TypeScript generation and runtime

- Owner: TypeScript emitter and TypeScript semantic plans
- Gates: `typescript-full`, `css-module-companions`, `dual-output-semantics`, `test:writer-position`, `portable-haxe-smoke`, `source-maps`, `acceptance`, `full-ci`
- Compatibility evidence: `compiler-output-inventory`, `public-type-safety`, `runtime-semantic-differentials`, `official-haxe-dual-profile-smoke`
- Maintained examples: `todoapp`, `typescript-target`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: Generated-source readability still requires reviewed shape assertions in addition to strict type checking.

### Declarations and package contracts

- Owner: Declaration reachability, type emitters, and package/import plans
- Gates: `classic-declarations`, `css-module-companions`, `package-imports`, `binding-identity`, `acceptance`, `full-ci`
- Compatibility evidence: `public-type-safety`, `npm-package-shapes`
- Maintained examples: `todoapp`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: Third-party package contracts outside the curated fixtures remain independent evidence.

### React, HXX, JSX, and TSX compiler behavior

- Owner: HXX parser, JSX semantic plan, React helpers, and source emitters
- Gates: `hxx-tsx`, `hxx-carrier-immutability`, `hxx-event-variance`, `react-hooks`, `react-flight`, `source-maps`, `acceptance`, `full-ci`
- Compatibility evidence: `reviewed-generated-shape`, `runtime-semantic-differentials`
- Maintained examples: `todoapp`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: Framework-version and browser behavior require the separate browser/application scorecard.

### Browser and framework runtime behavior

- Owner: Maintained application QA and Playwright observers
- Gates: `examples-dual-profile-e2e`, `acceptance`, `full-ci`
- Compatibility evidence: `same-source-example-smoke`
- Maintained examples: `todoapp`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: A browser scenario protects only the user-visible workflow it actually executes.

### Host tooling and publication helpers

- Owner: The optional Node tooling package
- Gates: `host-tooling`, `css-module-companions`, `full-ci`
- Compatibility evidence: none; the focused gate is the current owner
- Maintained examples: none
- Last clean proof: The host-tooling gate owns live proof in required CI; no compatibility bucket or cached green result is asserted here.
- Residual risks: Framework integrations must provide their own real host/runtime evidence.

### TypeScript-to-Haxe migration tooling

- Owner: tools/ts2hx
- Gates: `ts2hx`, `acceptance`, `full-ci`
- Compatibility evidence: `runtime-semantic-differentials`, `reviewed-generated-shape`, `pinned-toolchain-lanes`
- Maintained examples: none
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: Unsupported TypeScript syntax and project configurations remain explicit migration boundaries.

### Installation, release, adoption, and downstream contracts

- Owner: Package, release, security, and curated downstream owners
- Gates: `release-contract`, `tooling-github-release-contract`, `package-imports`, `compatibility-inventory`, `full-ci`
- Compatibility evidence: `npm-package-shapes`, `curated-downstream-contracts`
- Maintained examples: none
- Last clean proof: Blocking package/release proof lives in required Actions. Curated downstream proof is nonblocking-nightly and exists only in its latest run artifact; this manifest does not cache a green result.
- Residual risks: Unpinned consumers and unsupported ecosystems remain outside the release claim.

### Maintained example portfolio

- Owner: examples/profiles.json and the example runner
- Gates: `examples-dual-profile-e2e`, `full-ci`
- Compatibility evidence: `same-source-example-smoke`
- Maintained examples: `todoapp`, `typescript-target`
- Last clean proof: The current required main/release gates; run results live in GitHub Actions rather than this deterministic manifest.
- Residual risks: A compile-only future example must not be advertised as runtime or migration proof.

## Coverage counts

| Evidence class | Metric | Exact count | Disposition |
| --- | --- | ---: | --- |
| Compile inventory | Classic Haxe test modules | 49 | `blocking` |
| Compile inventory | Generated TypeScript snapshot profiles | 8 | `blocking` |
| Compile inventory | Examples with TS and classic profiles | 2 | `blocking` |
| Strict public typing | Strict positive/negative consumer sources | 10 | `blocking` |
| Strict public typing | Explicitly owned exported-surface boundaries | 34 | `blocking` |
| Strict public typing | Reusable-library same-source Haxe modules | 4 | `blocking` |
| Semantic differential | Same-source Haxe modules | 18 | `blocking` |
| Semantic differential | TS/classic/declaration and JS oracle profiles | 5 | `blocking` |
| Semantic differential | Stable dual-output runtime trace events | 24 | `blocking` |
| Semantic differential | ts2hx supported and fail-closed semantic input modules | 55 | `blocking` |
| Snapshot stability | genes-ts snapshot profiles | 8 | `blocking` |
| Snapshot stability | ts2hx reviewed snapshot files | 50 | `blocking` |
| Runtime smoke and E2E | Same-source dual-profile examples | 2 | `blocking` |
| Runtime smoke and E2E | Todoapp browser journeys run in each profile | 4 | `blocking` |
| Compile inventory | Reviewed active official Haxe test registrations per profile | 1373 | `blocking` |
| Compile inventory | Independently generated registration profiles | 2 | `blocking` |
| Runtime smoke and E2E | Reviewed active official Haxe test identities | 6 | `blocking` |
| Runtime smoke and E2E | Independently executed Genes profiles | 2 | `blocking` |
| Runtime smoke and E2E | Hash-pinned local harness adaptation files | 4 | `blocking` |
| Toolchain compatibility | Pinned TypeScript lanes | 3 | `blocking` |
| Toolchain compatibility | Pinned Haxe lanes | 2 | `blocking` |
| Toolchain compatibility | Pinned Node lanes, runtime floors, and supported range | 5 | `blocking` |
| Package-shape interoperability | Local package-shape fixtures | 5 | `blocking` |
| Package-shape interoperability | dts2hx declaration entrypoints | 3 | `blocking` |
| Package-shape interoperability | dts2hx package roots | 2 | `blocking` |
| Downstream pressure tests | Pinned downstream repositories | 2 | `nonblocking-nightly` |
| Downstream pressure tests | Explicit unsupported/nonblocking full-app areas | 4 | `nonblocking-nightly` |
| Downstream pressure tests | Known pinned compiler/downstream observations | 0 | `nonblocking-nightly` |

## Toolchain contract

| Surface | Lane | Pin | Contract |
| --- | --- | --- | --- |
| Node | stable | 26.1.0+ (Node 26 lane) | blocking runtime lane |
| Node | current / next LTS | 26.1.0+ | blocking runtime lane |
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
- Does not prove: Compilation does not prove closed public types, runtime equivalence, arbitrary ecosystem compatibility, or an official upstream Haxe-suite result.
- Evidence:
  - [`test.hxml`](../test.hxml)
  - [`scripts/test-acceptance.ts`](../scripts/test-acceptance.ts)
  - [`scripts/test-examples.ts`](../scripts/test-examples.ts)
  - [`tests/genes-ts/snapshot`](../tests/genes-ts/snapshot)
  - [`examples/profiles.json`](../examples/profiles.json)
- Gates:
  - `yarn test`
  - `yarn test:acceptance`

### Pinned official Haxe 4.3.7 active registration inventory

- Disposition: `blocking`
- Scope: The exact upstream unit entry point is typed under each Genes JavaScript profile to record active conditional, standard-library specification, and issue-regression registrations.
- Proves: The pinned Haxe entry point registers the reviewed 1,373 test identities in each exact profile, and injected profile or cached-source drift stays red.
- Does not prove: Registration inventory does not compile these tests with Genes, target-check generated files, run the tests, or report runtime compatibility.
- Evidence:
  - [`tests/official-haxe-inventory/manifest.json`](../tests/official-haxe-inventory/manifest.json)
  - [`tests/official-haxe-inventory/inventories`](../tests/official-haxe-inventory/inventories)
  - [`scripts/test-official-haxe-inventory.ts`](../scripts/test-official-haxe-inventory.ts)
  - [`scripts/test-official-haxe-inventory-failures.ts`](../scripts/test-official-haxe-inventory-failures.ts)
- Gates:
  - `yarn test:official-haxe-inventory`
  - `yarn test:official-haxe-inventory:failures`

## Strict public typing

Positive consumers compile and selected invalid consumers are rejected without broad public any/unknown/index signatures.

### Closed exported surfaces and strict declaration consumers

- Disposition: `blocking`
- Scope: Generated TS exports, ordinary interfaces, explicit foreign boundaries, classic declarations, and strict external consumers.
- Proves: Every manifest-owned type module in the named generated profiles is either semantically audited or given an exact stale-detecting classification; strict consumers reject the named unsafe programs, and one opt-in library graph has matched retained TS/classic runtime and declaration surfaces.
- Does not prove: An exact runtime, fixture, or known-gap classification does not itself prove that foreign boundary sound; the audit also cannot infer soundness for untested raw metadata or every third-party declaration package.
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
- Scope: Haxe-to-TS/classic evaluation traces plus ts2hx strict-js control-flow, module-order, and typed package-binding contracts across original TypeScript, classic Genes, and genes-ts, with a separate standard-Haxe capability boundary.
- Proves: Named original-TypeScript, classic Genes, and genes-ts traces preserve the supported synchronous typed return/break/continue path through nested finalizers and the closed typed package boundary. Package evidence covers default, named, alias, static namespace, duplicate, primitive constant/function, Void, request order, once-only initialization, unused verbatim retention, and TS 5/6/7 generated output. Thirteen canonical ts2hx boundaries still fail closed, including broader package declarations, excluded async completion, standard-Haxe request rejection, and same-server isolation of the private Genes request capability.
- Does not prove: The synchronous contract does not cover excluded async/generator/constructor/anonymous/labeled/generic/weak-carrier/unsupported-loop forms. Package evidence does not cover mutable exports, overloads, object or union types, namespace identity/computed access, transform-synthesized binding uses, attributes, or arbitrary package export conditions. The standard-Haxe request rejection is a capability test rather than a fourth runtime-parity oracle; the curated traces are neither a language-wide proof nor a portability promise for other Haxe targets.
- Evidence:
  - [`tests/output-modes/profile-ownership.json`](../tests/output-modes/profile-ownership.json)
  - [`tests/output-modes/expected-trace.json`](../tests/output-modes/expected-trace.json)
  - [`tests/output-modes/src`](../tests/output-modes/src)
  - [`scripts/test-output-modes.ts`](../scripts/test-output-modes.ts)
  - [`tools/ts2hx/fixtures/semantic-diff`](../tools/ts2hx/fixtures/semantic-diff)
  - [`tools/ts2hx/fixtures/semantic-module-boundaries`](../tools/ts2hx/fixtures/semantic-module-boundaries)
  - [`tools/ts2hx/fixtures/semantic-unsupported`](../tools/ts2hx/fixtures/semantic-unsupported)
  - [`tools/ts2hx/src/semantic/package-extern-plan.ts`](../tools/ts2hx/src/semantic/package-extern-plan.ts)
  - [`tools/ts2hx/src/test-package-extern-facts.ts`](../tools/ts2hx/src/test-package-extern-facts.ts)
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
- Proves: Both outputs build and execute the same selected application workflows, including status filtering, validation, CRUD, navigation, and deep links.
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

### Pinned official Haxe 4.3.7 dual-profile smoke

- Disposition: `blocking`
- Scope: Six exact official Haxe tests from shared language, unitstd, and issue families compile through a packaged Genes artifact in classic and TypeScript profiles, pass each target checker, and execute 45 assertions per profile under Node.
- Proves: The published six-test official Haxe 4.3.7 smoke subset passes after target checking and runtime execution in each Genes profile, and the harness fails closed for generation, target, module-load, assertion, runtime, timeout, and missing-test failures.
- Does not prove: Six tests do not establish the complete active official tests/unit contract, capability coverage, Haxe preview compatibility, or any Genes-native declaration, HXX, package, source-map, transaction, or application claim outside the smoke.
- Evidence:
  - [`tests/portable-haxe-smoke/manifest.json`](../tests/portable-haxe-smoke/manifest.json)
  - [`scripts/test-portable-haxe-smoke.ts`](../scripts/test-portable-haxe-smoke.ts)
  - [`scripts/test-portable-haxe-smoke-failures.ts`](../scripts/test-portable-haxe-smoke-failures.ts)
- Gates:
  - `yarn test:smoke`

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
- Proves: The named package and import forms resolve, type-check, and execute through the tested profiles without weak generated extern types. The focused identity fixture also keeps same-named default, named, and namespace exports distinct across TS, classic JS, and both declaration surfaces. Package-backed native String/RegExp constructors retain value-derived public instance types, while missing contracts fail before publication. Its hxnodejs-style extern enum abstract, same-named module-field imports, and typed Node process/console globals preserve exact runtime values and source ownership under the stable gate. The same command is enrolled in the advisory Haxe preview lane and rejects raw __js__ leakage.
- Does not prove: Four synthetic packages do not cover every package.json condition, declaration merge, built-in native name, abstract shape, module-field shape, bundler, or host environment. The Haxe preview lane remains advisory rather than a supported release contract.
- Evidence:
  - [`scripts/test-package-shapes.ts`](../scripts/test-package-shapes.ts)
  - [`scripts/probe-binding-identity.ts`](../scripts/probe-binding-identity.ts)
  - [`scripts/dts2hx-bridge.ts`](../scripts/dts2hx-bridge.ts)
  - [`tests/genes-ts/package-shapes/packages`](../tests/genes-ts/package-shapes/packages)
  - [`tests/genes-ts/package-shapes/dts2hx/manifest.json`](../tests/genes-ts/package-shapes/dts2hx/manifest.json)
- Gates:
  - `yarn test:interop:module-shapes`
  - `yarn test:binding-identity`

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
