# genes-ts documentation plan (genes-ts + ts2hx)

This is a **documentation PRD + roadmap** for:

- **genes-ts** (Haxe → TypeScript, plus classic Genes JS output mode)
- **ts2hx** (TypeScript/JavaScript → Haxe migration tool, experimental)

The goal is that a new engineer can pick a workflow quickly, get a “hello world”
running fast, and then progressively discover deeper topics (interop, TSX, async,
profiles, portability) without needing tribal knowledge.

This file is intentionally a plan (not the docs themselves). The actual work is
tracked in beads (`bd`) and the deliverables live in `docs/**`.

---

## Goals

### G1 — Clear onboarding paths (choose-your-own-adventure)

Users should be able to answer, quickly:

- “Should I use `-D genes.ts` (emit TS) or classic Genes JS output?”
- “When does ts2hx help me, and what does it *not* guarantee?”
- “How do I mix Haxe and TS/TSX safely in one repo?”

### G2 — End-to-end workflows (not just feature docs)

Document the common real workflows, including commands, folder layout, and
how pieces fit:

- Haxe → TS → JS (tsc/bundler)
- Haxe → JS (+ optional `.d.ts`) (no TS compiler)
- TS → Haxe (ts2hx) → JS (stabilize semantics quickly)
- TS → Haxe (ts2hx) → TS (genes-ts) to keep a mixed TS codebase while migrating

### G3 — “Portability story” (future-facing, with strong caveats)

Document the *conceptual* path:

- TS → Haxe (ts2hx) → refactor toward portable Haxe subset → compile to other targets

Including:

- what tends to be JS-specific and must be refactored
- what to do about platform APIs (Node/browser globals)
- how to structure “adapter layers” to make later retargeting feasible

This is **guidance**, not a promise of automatic TS→Python/C++/Elixir parity.

### G4 — Interop documentation is first-class

Both directions must be covered:

- Haxe importing TS/JS/TSX
- TS importing generated modules (and keeping types intact)

---

## Non-goals

- Claiming that ts2hx instantly produces “portable Haxe for any target”.
- Documenting every possible JS toolchain; we provide a few supported recipes and
  point to the todoapp example for a complete reference.
- Replacing the existing “contract” docs; we link to them and provide
  workflow-oriented entry points.

---

## Personas

1) **Haxe-first app developer**
   - Wants best DX and strongest typing.
   - Might choose classic Genes mode (fast) or genes-ts mode (TS output).

2) **TS-first team doing incremental migration**
   - Wants to keep most code in TS while moving some modules to Haxe.
   - Needs bidirectional interop and idiomatic TS output.

3) **TS project owner exploring a retarget**
   - Wants TS → Haxe as a bridge to non-JS targets later.
   - Needs clarity on required refactors and constraints.

4) **Compiler contributor**
   - Needs architecture overview and “how to add fixtures / snapshots / harnesses”.

---

## Proposed documentation set

### A) Top-level entry points

1) `docs/WORKFLOWS.md` (NEW)
   - Decision tree: output mode + migration mode selection
   - “Pick your path” sections with short command snippets
   - Cross-links into the deeper docs

2) `docs/FAQ.md` (NEW)
   - “Why Haxe vs TS for transpilers?”
   - “Why TS output still uses `-js` on the Haxe side?”
   - “Why do we commit generated outputs in examples/tests?”
   - “Where can `Dynamic`/`any` appear and why?”

3) `docs/ARCHITECTURE.md` (NEW)
   - Repo map: genes-ts compiler vs ts2hx tool vs todoapp harness
   - Where to add tests, where to add fixtures
   - Contracts and invariants (determinism, import specifiers, output dirs)

### B) genes-ts workflow guides (Haxe → TS / JS)

4) `docs/typescript-target/BUILD_TOOLING.md` (NEW)
   - `tsc` setup, `tsconfig` essentials, ESM notes
   - bundler expectations (Vite/webpack/esbuild) and import specifier policy

5) `docs/typescript-target/INTEROP.md` (NEW)
   - Haxe → TS output consumed by TS projects
   - TS/TSX consumed from Haxe (via `genes.ts.Imports`)
   - Recommended patterns for externs, module boundaries, and typed wrappers

### C) ts2hx workflow guides (TS/JS → Haxe)

6) `docs/ts2hx/WORKFLOWS.md` (NEW)
   - Standalone: TS → Haxe → classic Genes JS (fast stabilization)
   - Mixed codebase: TS → Haxe → TS (genes-ts) (incremental migration)
   - Roundtrip harness: TS → Haxe → TS → JS parity (how to run / extend)

7) `docs/ts2hx/LIMITATIONS.md` (NEW)
   - “JS-first” semantics and where escape hatches happen
   - TSX lowering strategy (current minimal behavior)
   - Async/await strategy and constraints
   - Known gaps: what to expect, how to contribute fixtures

8) `docs/ts2hx/PORTABILITY.md` (NEW, future-facing)
   - What “TS → other targets” really means in practice
   - How to structure adapter layers
   - Refactoring checklist to move from JS-centric to portable subset
   - How to evaluate feasibility per target (Python/C++/custom backends)

9) Update `docs/ts2hx/USAGE.md` (EXISTING)
   - Add “why/when” guidance (not just commands)
   - Keep it synced with current fixtures and supported subset

### D) Examples as documentation

10) Expand `examples/todoapp/README.md` (EXISTING)
   - Make it the canonical “full workflow” reference
   - Explicitly document generated dirs (`dist-ts`, `dist-js`, etc.) and why committed

11) Add a minimal “interop-only” example (OPTIONAL)
   - A tiny TS consumer importing generated Haxe modules
   - A tiny Haxe module importing TSX component(s)

---

## Acceptance criteria for the docs milestone

- A new engineer can follow `docs/WORKFLOWS.md` and:
  - run the todoapp
  - understand when to choose TS output vs JS output
  - understand what ts2hx is for and its current limitations
- All docs cross-link correctly from `docs/README.md`
- Commands in docs correspond to actual scripts in `package.json` / `tools/ts2hx/package.json`
- CI remains green (`yarn test:ci`)

---

## Beads tracking

Implementation tasks are tracked in beads under an epic (see `bd list`).

