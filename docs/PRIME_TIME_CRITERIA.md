# genes-ts “prime time” criteria (and where we test it)

This document defines what we mean by **“prime time”** for genes-ts and maps each
criterion to concrete tests/harnesses in this repo.

This is the “definition of done” for the `genes-705` epic and complements
`docs/PRD_TODOAPP_HARNESS.md`.

---

## Criteria

### C1 — Idiomatic, strongly-typed TS/TSX output

genes-ts emits TypeScript that:

- is **idiomatic** (module structure, naming, TSX output where appropriate)
- is **strongly typed** and does not degrade into “JS in `.ts` files”
- avoids `any`/`unknown` in user code as a rule (runtime boundary only)
- keeps strict nullability semantics coherent under `tsc --strict`

### C2 — Deterministic, diff-friendly output

Given the same inputs, genes-ts output should be stable across runs:

- stable file layout
- stable import ordering/specifiers
- stable formatting where it affects diffs

### C3 — Runtime correctness (Node + browser)

Generated output must:

- typecheck under `tsc --noEmit` (and compile when needed)
- run correctly in Node (server)
- run correctly in the browser (web bundle)

### C4 — Practical TS ecosystem interop (both directions)

genes-ts must support:

- **Haxe importing TS/TSX** (typed, ergonomic)
- **TS importing generated Haxe modules** (typed, ergonomic)

This is core to the “Haxe now → TS later” migration story.

### C5 — Profiles / knobs (portable vs TS-first)

genes-ts must keep multiple modes well-defined and tested:

- TS output vs classic Genes JS output (baseline stays green)
- reflection-friendly runtime vs `-D genes.ts.minimal_runtime`
- TSX vs low-level React output mode
- import specifier policy (`.js` vs extensionless), where relevant

---

## Coverage map (tests/harnesses)

| Criterion | Where it’s exercised | Gate / command |
| --- | --- | --- |
| C1 (typed TS) | compiler snapshot fixtures + todoapp strict typecheck | `yarn test:genes-ts:snapshots`, `yarn build:example:todoapp` |
| C1 (no unsafe types) | typing policy scan over todoapp-generated modules | `yarn build:example:todoapp` (runs `typing-policy` check) |
| C2 (determinism) | intended-vs-generated diffs (`dist-ts/src-gen` vs `src-gen`) | `yarn test:acceptance` / `yarn build:example:todoapp` |
| C3 (Node runtime) | todoapp server smoke + Playwright runs against it | `yarn test:acceptance` |
| C3 (browser runtime) | todoapp web bundle + Playwright UI flows | `yarn test:acceptance` |
| C4 (interop both ways) | todoapp interop fixtures (see PRD milestones) | `genes-705.2` / `genes-705.10` |
| C5 (profiles) | dedicated genes-ts test runners + todoapp variants | `yarn test:genes-ts:minimal`, `yarn test:genes-ts:tsx`, `genes-705.9` |
| baseline | classic Genes JS output | `yarn test` |

Notes:

- “One command” CI gate: `yarn test:ci` (local == CI).
- Todoapp’s snapshot contract is documented in `examples/todoapp/README.md`.

---

## Current gaps (tracked work)

- Todoapp interop fixtures (Haxe↔TS): `genes-705.2`
- Todoapp variants (low-level React, minimal_runtime): `genes-705.9`
- E2E expansion for routing/errors/interop paths: `genes-705.10`
