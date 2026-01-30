# PRD: Todoapp as Prime-Time Harness (genes-ts) + ts2hx Roundtrip Fixture

Date: 2026-01-30  
Owner: genes-ts

## Summary

Make `examples/todoapp/` the primary “real world” harness that proves genes-ts is production-ready by exercising:

1) **Haxe → TypeScript** compilation (TS + TSX), strict typechecking, and runtime correctness.  
2) **Interop in both directions**:
   - Haxe importing **existing TS/TSX/JSX** modules (via externs and `genes.ts.Imports`).
   - “Pure TS” importing **Haxe-generated** modules (compiled output as a consumable package boundary).
3) Optional **profiles**:
   - default runtime (reflection-friendly)
   - `-D genes.ts.minimal_runtime` (“TS-first / no reflection”)
4) A **state-of-the-art test harness**:
   - output snapshots (intended vs out)
   - strict `tsc --noEmit`
   - runtime smoke tests (Node/server)
   - Playwright E2E for the web app

In parallel, make `tools/ts2hx/` prove feasibility via one **roundtrip fixture**:

> Pure TS → Haxe (ts2hx) → TS (genes-ts) → JS (tsc/bundler)  
…with tests that validate behavior is preserved.

This PRD is intentionally implementation-agnostic but includes concrete acceptance criteria and a milestone breakdown suitable for beads tasks.

---

## Goals (what success looks like)

### G1 — “Prime time” evidence via one flagship app

`examples/todoapp/` becomes the canonical demonstration that genes-ts:

- emits **idiomatic typed TS/TSX** (not “JS in .ts files”)
- works with **React Router** + real data flows
- supports **interop** with the TS ecosystem in practical ways
- remains stable/deterministic (snapshot harness + CI)

### G2 — Compiler regression prevention

The todoapp harness should catch regressions in:

- module splitting / import ordering / cycles
- runtime init semantics (constructors, `Register.inherits`, etc.)
- TS typing regressions (unexpected `any`/`unknown` leaks)
- React TSX emission modes (`.tsx` and `.ts`+`createElement`)
- Node ESM import specifier policy (`.js` specifiers vs extensionless)

### G3 — ts2hx roundtrip feasibility

One medium-complexity TS fixture is roundtripped through ts2hx + genes-ts and:

- keeps the same test outputs (behavior)
- remains strongly typed after roundtrip (best-effort)
- stays fast enough for CI

---

## Non-goals (explicitly out of scope)

- “Support all Haxe JS projects” purely via todoapp; it’s a flagship harness, not a full ecosystem matrix.
- Perfect JS → TS → Haxe source-map composition (nice-to-have; tracked separately).
- TS → portable Haxe for non-JS targets automatically (ts2hx is a migration tool; portability comes later via refactors).
- Any Elixir/phoenix porting work (future milestone; not part of this PRD).

---

## Users / Personas

1) **Haxe-first app dev**
   - wants to ship a real React + Node app using Haxe, without giving up TS ecosystem access.

2) **TS-first migration dev**
   - wants to use Haxe as an intermediate “better language” layer and eventually migrate to pure TS.

3) **Compiler maintainer**
   - needs deterministic, high-signal tests that fail with actionable diffs.

---

## Constraints / Principles

- CI must remain “local == CI” (single-command gates).
- Keep **classic Genes** output green as a baseline (separate concern from todoapp correctness).
- Avoid `untyped`/`Dynamic` escape hatches in harness/framework code unless extremely justified.
- Where “dynamic typing” is unavoidable, keep it behind a narrow runtime boundary and document why.

---

## Functional requirements — Todoapp (examples/todoapp)

### R1 — App completeness: fullstack + shared domain

The todoapp should remain a realistic fullstack app:

- Web: React + React Router
- Server: Node (Express is fine) providing a JSON API
- Shared: domain models and validation shared across web/server

### R2 — Two React output styles must be exercised

The harness must test both modes:

1) **TSX output** (`.tsx`) — idiomatic TSX markup
2) **Low-level output** (`.ts`) — lowered `React.createElement(...)`

Recommended approach:
- Keep the app’s canonical build as TSX output.
- Add a second build variant/fixture that uses low-level `.ts` output and is typechecked (and preferably smoke-tested).

### R3 — Interop: Haxe imports TS/TSX

Demonstrate consuming TS ecosystem code from Haxe:

- Use `genes.ts.Imports` for imports that work in both output modes.
- Include at least one TS/TSX module that:
  - exports a default component
  - exports a named helper function
  - exports a generic utility type/value

Concrete examples that are “high signal”:
- a TSX `Button.tsx` component (props + event handler typing)
- a TS file providing runtime validation (e.g. schema parser) that is called from Haxe

### R4 — Interop: TS imports Haxe-generated modules

Demonstrate importing generated Haxe modules into a TS-only module:

- Add a TS-only file that imports from `src-gen/...` and uses exported Haxe code in a typed way.
- Ensure it runs as part of the web bundle or server runtime.

This proves the “eventual migration to TS” story: TS can keep consuming the compiled Haxe output without special glue.

### R5 — “Haxe portability vs TS-first” knobs

The app should show both styles:

- Haxe-portable style (std types, stdlib usage, reflection-friendly runtime)
- TS-first style (externs, direct use of React/DOM/Node APIs, minimal reflection dependence)

### R6 — Compiler edge-case coverage (through app features)

Expand the app to exercise compiler semantics that commonly break:

- Enums in JSON (encode/decode with tagged unions)
- Optional args / default values
- `Null<T>` behavior under strict TS
- Generics-heavy helpers (e.g. Result/Either)
- Exception paths (server errors, validation errors)
- Async/await (`@:async` + `await(...)`)
- Module cycles (deliberately create a small cycle in shared code that still works)
- DCE expectations (ensure unused modules are not emitted; keep a “dead module” fixture)

---

## Test requirements — Todoapp harness

### T1 — Deterministic output snapshots (already in place, must be extended)

- Continue using `dist-ts/src-gen` as canonical output.
- Add additional “variants” snapshots if we introduce:
  - low-level `.ts` React output mode
  - minimal runtime profile
  - extensionless import specifier profile

### T2 — Strict TS typecheck

- `tsc --noEmit` must run for both web and server outputs.
- Keep TS configs strict and avoid `skipLibCheck` unless justified.

### T3 — Runtime smoke tests

- Server starts and serves at least one request (API smoke).
- Web bundle can be built deterministically (esbuild is fine).

### T4 — Playwright E2E (already in place, should be expanded)

E2E tests should validate:

- routing (React Router) navigation and deep links
- create/update/complete flows
- error states (API error, validation error)
- concurrency/latency resilience (avoid flakes)

### T5 — “Interop tests” are explicit

Add explicit tests that prove:

- Haxe can call into a TS module and the types line up
- TS can import from generated Haxe output and typecheck + run

---

## Functional requirements — ts2hx roundtrip fixture

### X1 — One medium-complexity pure TS project fixture

Add one fixture under `tools/ts2hx/fixtures/` that includes:

- multiple modules
- classes + interfaces
- discriminated unions
- generics
- async/await
- (optional) light TSX if we want to stretch, but not required for the first roundtrip

### X2 — Roundtrip pipeline

CI should run a single command that performs:

1) build + typecheck original TS fixture
2) ts2hx emit Haxe
3) genes-ts compile Haxe back to TS
4) typecheck the roundtripped TS under strict settings
5) run the same test suite against the roundtripped output and compare results

### X3 — Quality bar

“Almost 1:1” means:

- behavior/test outputs match
- type quality is close (no pervasive `any`; allow isolated fallbacks with explanation)
- module boundaries remain understandable (stable file layout)

---

## Milestones (suggested for beads)

### M0 — Definition

- Define “prime time” criteria specific to genes-ts (typing, determinism, DX).
- Decide the exact list of compiler features the todoapp must exercise.

### M1 — Todoapp interop expansion

- Add TS/TSX modules consumed from Haxe (Imports + TSX component).
- Add TS-only module that imports from Haxe-generated output.
- Add explicit tests proving both directions.

### M2 — Multi-profile builds

- Add a low-level React output variant (`.ts`+`createElement`) and keep it typechecked.
- Add a minimal runtime variant if compatible (or a dedicated fixture if not).

### M3 — Harden tests and docs

- Expand Playwright suite, reduce flake risk.
- Update docs to reflect workflows (especially “TS imports Haxe output”).

### M4 — ts2hx roundtrip fixture

- Add medium TS fixture.
- Implement roundtrip harness + snapshots.
- Keep CI time reasonable.

---

## Open questions (need decisions)

1) Do we want the todoapp to include any SSR (ReactDOMServer) for coverage, or keep it client-only?
2) Should the “TS imports Haxe output” demo be in the web bundle, the server, or both?
3) For low-level React output mode: do we keep a second build target in todoapp, or a separate `examples/todoapp-lowlevel/`?
4) For ts2hx roundtrip: should we target Node-only first (no DOM), to keep variables minimal?

