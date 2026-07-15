# genes-ts bounded-readiness criteria

This file keeps its historical name so existing links remain stable. It now
defines the evidence required before genes-ts can make a broad "prime-time"
claim. The current truthful position is **production-capable for controlled,
tested profiles**, not universal readiness.

The original `genes-705` backlog established a substantial compiler and
harness. Passing that backlog did not prove every exported type, npm package
shape, or same-source TS/JS behavior. The architecture and evidence roadmap is
tracked by epic `genes-09r` and documented in `ARCHITECTURE_ROADMAP.md`.

## Readiness dimensions

### R1 — Closed, precise public TypeScript surfaces

- Ordinary Haxe interfaces expose their complete public contract and reject
  unknown members.
- Exported types do not acquire inferred or imported `any`/unjustified
  `unknown` through compiler fallbacks.
- Null, undefined, optional, and absent values remain distinct where their
  Haxe/JavaScript contracts differ.

Closed-interface emission and its negative consumer have landed. A
TypeScript-Compiler-API exported-surface audit and broader negative matrix are
still tracked by `genes-09r.1`; the reusable public-surface model is
`genes-09r.10`, and shared nullish modeling is `genes-09r.2`.

### R2 — Runtime correctness in both output modes

- The classic Genes ESM suite remains blocking.
- TS output type-checks and executes representative Node/browser workloads.
- One authoritative source corpus emits TS, classic JS, and classic
  declarations, then compares stable semantic traces rather than source-byte
  identity.

The existing mode-specific suites are substantial. The authoritative paired
corpus is still open as `genes-cn4`, so broad dual-output equivalence remains
experimental.

### R3 — Honest declaration and ecosystem interop

- Classic `.d.ts` is compiled by a strict external consumer with
  `skipLibCheck: false`.
- ESM, CommonJS `export =`, type/value namespace, secondary extern types,
  subpaths, and conditional exports have focused package-shape fixtures.
- dts2hx ingestion and genes-ts emission share fixture contracts rather than
  hidden implementation coupling.

Precise classic `Null<T>` and the strict declaration consumer have landed.
CommonJS `export =` remains `genes-6za`; the cross-tool bridge is
`genes-09r.8`.

### R4 — Deterministic, diagnosable output

- Repeated clean builds have identical normalized tree hashes.
- Representative generated tokens and runtime stack frames map to exact Haxe
  source positions.
- Bytes, tokens, temporary declarations, module counts, and imports have
  reviewed budgets.
- Unsupported target capabilities fail with stable source-positioned
  diagnostics rather than being silently ignored.

Snapshot stability exists today. Exact source-map, determinism, and budget
gates are tracked by `genes-09r.6`.

### R5 — Explicit profiles and supported toolchains

- `ts-strict`, `classic-esm`, and `classic-dts` consume shared semantic facts
  while retaining target-specific syntax policy.
- Generated output is tested on declared TypeScript compatibility lanes;
  compiler-API tools are tested separately from `tsc` output compatibility.
- Stable Haxe is blocking and Haxe preview is a separately labeled signal.

The centralized toolchain matrix is tracked by `genes-09r.4`. Until it lands,
the versions pinned by the repository tests are the supported evidence, not an
open-ended compatibility promise.

### R6 — Migration tools fail closed

- ts2hx strict mode never silently omits a root file or unsupported top-level
  statement.
- Assisted output records every known loss and cannot be mistaken for strict
  success.
- Semantic support is demonstrated by original-TS versus translated-Haxe
  differential fixtures, not by compilation alone.

Structured diagnostics, transactional output, strict/assisted dispositions,
and exit codes have landed. The minimal semantic IR and wider differential
support matrix remain `genes-09r.7`.

## Evidence map

| Evidence | Current gate | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Classic JS assertions | `yarn test` | Exercised classic runtime semantics | Declaration precision or complete dual-output parity |
| TS aggregate fixtures | `yarn test:genes-ts` and profile runners | Generated syntax/imports plus exercised runtime behavior | All public surfaces are precise merely because `tsc` passes |
| Closed-interface negative consumer | `yarn test:genes-ts:full` | Unknown ordinary interface members are rejected | All inferred/imported exported types avoid unsafe fallbacks |
| Strict classic declaration consumer | `yarn test:classic:dts` | Exercised `.d.ts` nullability and closed interfaces under strict flags | Every declaration in arbitrary programs is sound |
| Lexical typing policy | Included by TS runners | Selected literal unsafe forms are absent outside its exclusions | Inferred/imported `any`, broad structural holes, or semantic nullish mismatches |
| Snapshots | `yarn test:genes-ts:snapshots` | Expected deterministic shape for current cases | Runtime or type soundness by itself |
| Todoapp acceptance | `yarn test:acceptance` | A real Node/browser integration profile | General compiler completeness |
| Full repository gate | `yarn test:ci` | All current blocking layers agree at the pinned revisions | Future toolchains, arbitrary npm packages, or unsupported syntax |

## Current disposition

- **Controlled downstream use:** go with pinned revisions and the relevant
  strict/runtime/declaration gates.
- **Broad public prime-time or universal type-safety claim:** not yet.
- **Classic runtime:** first-class and the more mature runtime surface.
- **Classic declarations:** bounded and improving, assessed separately from JS
  runtime readiness.
- **Same-source dual output:** supported for selected tested subsets; general
  parity remains experimental.
- **ts2hx:** useful as strict subset migration and assisted scaffolding, not a
  lossless TypeScript-to-Haxe compiler.

Every newly discovered downstream defect should first become a minimized,
generic compiler fixture. PiMonoHX and OpenCodeHX are pressure-test harnesses,
not sources of product-specific compiler branches.
