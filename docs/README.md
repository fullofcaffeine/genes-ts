# genes-ts documentation

This directory contains the long-form documentation for **genes-ts**.

Start here if you’re new to the project, or if you want to understand the full
feature surface beyond the quick examples in `readme.md`.

## Getting started

- `readme.md` — quick start + feature overview
- `docs/OUTPUT_MODES.md` — TS output vs classic Genes JS output (and when to use each)
- `examples/typescript-target/README.md` — minimal end-to-end Haxe → TS → JS example
- `examples/todoapp/` — real fullstack example (React Router + Express)

## TypeScript target (genes-ts mode)

- `docs/typescript-target/COMPILER_CONTRACT.md` — user-facing contract (output layout, module/import policy, defines)
- `docs/typescript-target/TYPING_POLICY.md` — strict typing goals, nullability profiles, and escape-hatch rules
- `docs/typescript-target/IMPORTS.md` — consuming existing JS/TS/TSX via `genes.ts.Imports`
- `docs/typescript-target/REACT_HXX.md` — React/TSX authoring in Haxe (`genes.react.JSX`)
- `docs/typescript-target/ASYNC_AWAIT.md` — `@:async` + `await(...)` macro (native `async`/`await` output)
- `docs/typescript-target/DEBUGGING.md` — source maps and debugging workflow

## Testing + CI

- `docs/TESTING_STRATEGY.md` — compiler harnesses, todoapp E2E, and “one command” gates
- `docs/SECURITY.md` — local + CI secret scanning (gitleaks)

## Experimental

- `docs/ts2hx/PLAN.md` — long-term TS/JS → Haxe transpiler experiment (post-1.0)

