# genes-ts documentation

This directory contains the long-form documentation for **genes-ts**.

Start here if you’re new to the project, or if you want to understand the full
feature surface beyond the quick examples in `readme.md`.

## Getting started

- `../readme.md` — quick start + feature overview
- `OUTPUT_MODES.md` — TS output vs classic Genes JS output (and when to use each)
- `PACKAGING.md` — how to publish libraries/apps in both output modes
- `../examples/typescript-target/README.md` — minimal end-to-end Haxe → TS → JS example
- `../examples/todoapp/` — real fullstack example (React Router + Express)

## TypeScript target (genes-ts mode)

- `typescript-target/COMPILER_CONTRACT.md` — user-facing contract (output layout, module/import policy, defines)
- `typescript-target/TYPING_POLICY.md` — strict typing goals, nullability profiles, and escape-hatch rules
- `typescript-target/IMPORTS.md` — consuming existing JS/TS/TSX via `genes.ts.Imports`
- `typescript-target/REACT_HXX.md` — React/TSX authoring in Haxe (`genes.react.JSX`)
- `typescript-target/ASYNC_AWAIT.md` — `@:async` + `await(...)` macro (native `async`/`await` output)
- `typescript-target/DEBUGGING.md` — source maps and debugging workflow

## Testing + CI

- `TESTING_STRATEGY.md` — compiler harnesses, todoapp E2E, and “one command” gates
- `SECURITY.md` — local + CI secret scanning (gitleaks)
- `BRANCH_PROTECTION.md` — recommended GitHub branch protection / required checks
- `RELEASING.md` — semver, changelog, GitHub Releases (semantic-release)

## Product / planning

- `PRD_TODOAPP_HARNESS.md` — todoapp as prime-time harness + ts2hx roundtrip fixture
- `PRIME_TIME_CRITERIA.md` — definition of “prime time” + where it’s tested

## Experimental

- `ts2hx/PLAN.md` — long-term TS/JS → Haxe transpiler experiment (post-1.0)
