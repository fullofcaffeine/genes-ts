# genes-ts bounded-readiness criteria

This file keeps its historical name so existing links remain stable. It now
defines the evidence required before genes-ts can make a broad "prime-time"
claim. The current truthful position is **production-capable for controlled,
tested profiles**, not universal readiness.

The original `genes-705` backlog established a substantial compiler and
harness. Passing that backlog did not prove every exported type, npm package
shape, or same-source TS/JS behavior. The architecture and evidence roadmap is
tracked by epic `genes-09r` and documented in `ARCHITECTURE_ROADMAP.md`. The
generated `COMPATIBILITY_REPORT.md` is the exact, deterministic inventory of
the evidence currently owned by this repository; it is not a cached CI badge.

## Readiness dimensions

### R1 — Closed, precise public TypeScript surfaces

- Ordinary Haxe interfaces expose their complete public contract and reject
  unknown members.
- Exported types do not acquire inferred or imported `any`/unjustified
  `unknown` through compiler fallbacks.
- Null, undefined, optional, and absent values remain distinct where their
  Haxe/JavaScript contracts differ.

Closed-interface emission, the TypeScript-Compiler-API exported-surface audit,
the reusable `PublicSurface` model, and shared `NullishContract` planning have
landed. Exact optional-property consumers and paired runtime traces distinguish
null, undefined, omission, ordinary optional values, optional parameters, map
absence, and iterator completion. The negative matrix remains deliberately
fixture-scoped. The explicit runtime/type/declaration `DependencyPlan` has also
landed: it retains compiler-owned refs and source provenance, and no longer
discovers reachability by printing types into a sink.

### R2 — Runtime correctness in both output modes

- The classic Genes ESM suite remains blocking.
- TS output type-checks and executes representative Node/browser workloads.
- One authoritative source corpus emits TS, classic JS, and classic
  declarations, then compares stable semantic traces rather than source-byte
  identity.

The authoritative `yarn test:dual-output` corpus now runs identical Haxe source
through TS, classic JS/declarations, and standard Haxe JS, with a pinned/live
vanilla-compatible core. It covers stable semantic traces, strict declaration
consumption, DCE/type-only shape, ESM imports, resources, reflection, and
source-map linkage. This is bounded evidence, not broad language equivalence;
JSX now has a separate identical-source TSX/classic runtime differential and
fail-closed capability policy. The same dual-output command now adds exact
representative source-map, clean-build determinism, and reviewed output-budget
evidence; those measurements remain corpus-scoped.

### R3 — Honest declaration and ecosystem interop

- Classic `.d.ts` is compiled by a strict external consumer with
  `skipLibCheck: false`.
- ESM, CommonJS `export =`, type/value namespace, secondary extern types,
  subpaths, and conditional exports have focused package-shape fixtures.
- dts2hx ingestion and genes-ts emission share fixture contracts rather than
  hidden implementation coupling.

Precise classic `Null<T>` and the strict declaration consumer have landed.
Declaration-only type aliases are retained without producing classic JS files.
The reusable-library overlay now retains explicitly marked public class graphs
before DCE and requires matched declarations in classic mode; its inactive
marker separately proves ordinary application output remains compact.
The CommonJS `export =` constructor/value split now has a blocking
`@:ts.instanceType` fixture across TS 5/6/7 and both Genes runtime profiles.
Haxe 4.3.7's historical `PositionError` and `FetchObserver` WebIDL names now
come from one shared TS/classic support contract with a generic strict-consumer
regression. The dts2hx bridge now adds deterministic generated externs for an
ESM root, typed subpath, conditional exports, and class-shaped CommonJS
`export =`, with explicit tool/input/output hashes and known-loss metadata.
This remains a curated local package matrix, not a blanket guarantee for every
npm declaration pattern.

### R4 — Deterministic, diagnosable output

- Repeated clean builds have identical normalized tree hashes.
- Representative generated tokens and runtime stack frames map to exact Haxe
  source positions.
- Bytes, tokens, temporary declarations, module counts, and imports have
  reviewed budgets.
- Unsupported target capabilities fail with stable source-positioned
  diagnostics rather than being silently ignored.

`genes-09r.6` has landed. `yarn test:output-quality` hashes two fresh TS/classic
compiler trees after documented machine-path normalization, checks exact token
positions and executable stack-map stages, and enforces checked-in
module/byte/token/temp/import budgets. Byte/token growth has a 5% window;
module/temp/import growth requires a reviewed manifest baseline. Automatic
JS → TS → Haxe map composition is still not claimed.

### R5 — Explicit profiles and supported toolchains

- `ts-strict`, `classic-esm`, and `classic-dts` consume shared semantic facts
  while retaining target-specific syntax policy.
- Generated output is tested on declared TypeScript compatibility lanes;
  compiler-API tools are tested separately from `tsc` output compatibility.
- Stable Haxe is blocking and Haxe preview is a separately labeled signal.

The centralized matrix has landed in `genes-09r.4`. TS5.5 is the generated-code
floor, TS6 is both an output lane and the Program/TypeChecker bridge, and TS7 is
an output-only lane. Haxe 4.3.7 remains blocking; Haxe 5 preview is explicitly
non-blocking. `docs/TOOLCHAINS.md` defines the bounded ownership of each lane;
none of them implies compatibility beyond the projects assigned to it.

### R6 — Migration tools fail closed

- ts2hx strict mode never silently omits a root file or unsupported top-level
  statement.
- Assisted output records every known loss and cannot be mistaken for strict
  success.
- Semantic support is demonstrated by original-TS versus translated-Haxe
  differential fixtures, not by compilation alone.

Structured diagnostics, transactional output, strict/assisted dispositions,
exit codes, the minimal semantic IR, and the supported/fail-closed differential
matrix have landed in `genes-09r.7`. This proves only the declared semantic
contracts; it does not make ts2hx a lossless general TypeScript translator.

## Evidence map

| Evidence | Current gate | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Classic JS assertions | `yarn test` | Exercised classic runtime semantics | Declaration precision or complete dual-output parity |
| TS aggregate fixtures | `yarn test:genes-ts` and profile runners | Generated syntax/imports plus exercised runtime behavior | All public surfaces are precise merely because `tsc` passes |
| Closed-interface negative consumer | `yarn test:genes-ts:full` | Unknown ordinary interface members are rejected | All inferred/imported exported types avoid unsafe fallbacks |
| Strict classic declaration consumer | `yarn test:classic:dts` | Exercised `.d.ts` nullability and closed interfaces under strict flags | Every declaration in arbitrary programs is sound |
| Reusable-library surface | `yarn test:library-profile` | One explicitly marked API has matched runnable TS/classic implementations and strict declarations while default DCE omits it | Every unmarked class, arbitrary metadata boundary, or package publication layout |
| Exact nullish matrix | `yarn test:genes-ts:full`, `yarn test:classic:dts`, and `yarn test` | Shared null/undefined/omission contracts agree across TS declarations and both runtime modes | Every host API has already been classified |
| Same-source differential corpus | `yarn test:dual-output` | The checked source has identical TS/classic/standard-Haxe behavior, strict classic declarations, bounded output shape, exact representative mapping/budget evidence, and pinned vanilla core evidence | Universal parity, JSX, every npm package shape, or automatic multi-stage map composition |
| Output quality | `yarn test:output-quality` | Two clean bounded compiler trees are normalized-deterministic; selected TS/classic tokens and stack stages resolve exactly; checked module/temp/import and 5% size/token ceilings hold | Every generated token, performance, or automatic JS → Haxe map composition |
| Output transaction | `yarn test:output-transaction` | TS and classic implementations, declarations, support files, maps, and ownership manifests roll back after pre-publication and real rename failures; successful rebuilds remove stale owned files and preserve unrelated assets | Simultaneous unrelated writers targeting the same final path or cross-process read isolation between individual renames |
| Generated toolchain matrix | `yarn test:matrix:generated` | Full, React, dual-output, and classic-declaration projects remain accepted by TS5/TS6/TS7 | Every arbitrary generated project or future TypeScript release |
| Compiler-API bridge | `yarn test:matrix:api` | Semantic gates and ts2hx build and execute against the TS6 Program API | A TypeScript 7 Program API, which does not exist in this toolchain contract |
| Lexical typing policy | Included by TS runners | Selected literal unsafe forms are absent outside its exclusions | Inferred/imported `any`, broad structural holes, or semantic nullish mismatches |
| Snapshots | `yarn test:genes-ts:snapshots` | Expected deterministic shape for current cases | Runtime or type soundness by itself |
| Todoapp acceptance | `yarn test:acceptance` | A real Node/browser integration profile | General compiler completeness |
| Complete example matrix | `yarn test:examples` | Every checked-in example has TS/classic ownership; the minimal runtime transcript and fullstack API behavior match, with optional identical browser journeys | Arbitrary applications or universal same-source parity |
| Generated compatibility evidence | `yarn test:compatibility-report` | Exact fixture counts, pins, scopes, and non-claims remain synchronized across eight separate evidence classes | Current CI success or a single aggregate readiness score |
| Pinned downstream pressure tests | Nightly `yarn test:downstream:curated --execute` | Exact PiMonoHX/OpenCodeHX revisions run on the stable Node lane; reviewed downstream failures require exact diagnostic evidence while later independent stages continue | Full application parity, automatic compiler ownership, or a blocking core result |
| Full repository gate | `yarn test:ci` | All current blocking layers agree at the pinned revisions | Future toolchains, arbitrary npm packages, or unsupported syntax |

## Current disposition

- **Controlled downstream use:** go with pinned revisions and the relevant
  strict/runtime/declaration gates.
- **Broad public prime-time or universal type-safety claim:** not yet.
- **Classic runtime:** first-class and the more mature runtime surface.
- **Classic declarations:** bounded and improving, assessed separately from JS
  runtime readiness.
- **Same-source dual output:** bounded-ready for the authoritative corpus;
  general parity remains experimental.
- **ts2hx:** useful as strict subset migration and assisted scaffolding, not a
  lossless TypeScript-to-Haxe compiler.

Every newly discovered downstream defect should first become a minimized,
generic compiler fixture. PiMonoHX and OpenCodeHX are pressure-test harnesses,
not sources of product-specific compiler branches.
