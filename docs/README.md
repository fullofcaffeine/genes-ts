# genes-ts documentation

This directory contains the long-form documentation for **genes-ts**.

Start here if you’re new to the project, or if you want to understand the full
feature surface beyond the quick examples in `readme.md`.

## Getting started

- `../readme.md` — quick start + feature overview
- `WORKFLOWS.md` — choose Haxe → TS, Haxe → JS, TS → Haxe, or the roundtrip migration path
- `ARCHITECTURE.md` — compiler pipeline, ownership boundaries, fixtures, snapshots, and contributor map
- `OUTPUT_MODES.md` — TS output vs classic Genes JS output (and when to use each)
- `OUTPUT_MODES.md#performance-oriented-es6-profile` — the explicit ES6 profile and planned comparison fixture
- `OUTPUT_MODES.md#reusable-library-profile` — opt-in matched runtime and declaration surfaces for packages
- `OUTPUT_MODES.md#typescript-aware-helpers-that-still-run-as-es6` — how TS-aware helper types erase to runnable ES6 without weakening TS output
- `PACKAGING.md` — how to publish libraries/apps in both output modes
- `../examples/typescript-target/README.md` — minimal end-to-end Haxe → TS → JS example
- `../examples/todoapp/` — real fullstack example (React Router + Express)
- `TROUBLESHOOTING.md` — common failure modes + fixes

## TypeScript target (genes-ts mode)

- `typescript-target/COMPILER_CONTRACT.md` — user-facing contract (output layout, module/import policy, defines)
- `typescript-target/TYPING_POLICY.md` — strict typing goals, nullability profiles, and escape-hatch rules
- `typescript-target/MINIMAL_RUNTIME.md` — what `-D genes.ts.minimal_runtime` changes/breaks
- `typescript-target/INTEROP.md` — bidirectional cookbook: Haxe consuming JS/TS and TS consuming generated Haxe
- `typescript-target/IMPORTS.md` — consuming existing JS/TS/TSX via `genes.ts.Imports`
- `typescript-target/REACT_HXX.md` — React/TSX authoring in Haxe (`genes.react.JSX`)
- `typescript-target/ASYNC_AWAIT.md` — typed `@:async` + `await(...)`, native Genes output, and the exact anonymous/named stock-Haxe boundary
- `typescript-target/DEBUGGING.md` — source maps and debugging workflow

## Testing + CI

- `ARCHITECTURE.md#compiler-fixture-guide` — where each compiler/ts2hx test belongs
- `TESTING_STRATEGY.md` — compiler harnesses, todoapp E2E, and “one command” gates
- `COMPATIBILITY_REPORT.md` — generated, deterministic evidence inventory with exact scope and counts
- `TOOLCHAINS.md` — centralized TypeScript, Haxe, and Node compatibility lanes
- `SECURITY.md` — local + CI secret scanning (gitleaks)
- `BRANCH_PROTECTION.md` — recommended GitHub branch protection / required checks
- `RELEASING.md` — semver, changelog, GitHub Releases (semantic-release)

## Product / planning

- `PRD_TODOAPP_HARNESS.md` — historical todoapp integration-harness + ts2hx roundtrip PRD
- `PRIME_TIME_CRITERIA.md` — bounded-readiness criteria and evidence map (historical filename)
- `ARCHITECTURE_ROADMAP.md` — audit disposition, shared TS/JS architecture, and dependency-ordered roadmap
- `REFLAXE_ELIXIR_VENDOR_AUDIT.md` — three-way disposition of the useful, superseded, and downstream-only changes in Reflaxe.Elixir's vendored Genes copy
- `DOCS_PLAN.md` — docs PRD/roadmap (onboarding + workflows)
- `prompts/GPT_5_6_SIDE_EFFECT_IMPORT_ARCHITECTURE.md` — focused evidence packet for resolving ordered ESM side-effect imports before implementation
- `prompts/GPT_5_6_SIDE_EFFECT_IMPORT_ARCHITECTURE_RESPONSE.md` — reviewed semantic model, supported boundary, experiments, and incremental landing contract
- `prompts/GPT_5_6_BOUND_ONLY_ESM_IMPORT_ORDER_ARCHITECTURE.md` — focused follow-up for bound-import initialization order, unused-binding retention, and the standard-Haxe capability boundary
- `prompts/GPT_5_6_BOUND_ONLY_ESM_IMPORT_ORDER_ARCHITECTURE_RESPONSE.md` — reviewed split between binding translation and effective runtime requests, including TypeScript elision and the explicit Genes capability boundary
- `prompts/GPT_5_6_FINALLY_OUTER_COMPLETION_ARCHITECTURE.md` — focused evidence packet for return, break, and continue crossing callback-modeled `try/finally`
- `prompts/GPT_5_6_FINALLY_OUTER_COMPLETION_ARCHITECTURE_RESPONSE.md` — reviewed completion semantics, callback/target ownership model, first support boundary, and staged evidence contract

## Experimental

- `ts2hx/PLAN.md` — long-term strict-subset migration and assisted-scaffolding experiment
- `ts2hx/WORKFLOWS.md` — standalone, mixed-codebase, assisted, and semantic-differential migration loops
- `ts2hx/USAGE.md` — CLI, manifests, exit codes, current fixtures, and test commands
- `ts2hx/LIMITATIONS.md` — exact support/evidence boundary for semantics, TSX, async, types, and modules
- `ts2hx/PORTABILITY.md` — future non-JS portability grades and refactoring checklist
