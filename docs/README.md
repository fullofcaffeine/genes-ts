# genes-ts documentation

This directory contains the long-form documentation for **genes-ts**.

Start here if you’re new to the project, or if you want to understand the full
feature surface beyond the quick examples in `readme.md`.

## Getting started

- `../readme.md` — quick start + feature overview
- [`../AGENTS.md`](../AGENTS.md) — agent/contributor first-ten-minutes guide,
  source-owner map, and safe repository workflow
- `WORKFLOWS.md` — choose Haxe → TS, Haxe → JS, TS → Haxe, or the roundtrip migration path
- `ARCHITECTURE.md` — compiler pipeline, ownership boundaries, fixtures, snapshots, and contributor map
- `OUTPUT_MODES.md` — TS output vs classic Genes JS output (and when to use each)
- `NULL_SAFETY.md` — Haxe package checking, TypeScript strict nulls, target
  representation, migration guidance, and the compiler's reviewed escape policy
- `OUTPUT_MODES.md#performance-oriented-es6-profile` — the explicit ES6 profile and planned comparison fixture
- `OUTPUT_MODES.md#reusable-library-profile` — opt-in matched runtime and declaration surfaces for packages
- `OUTPUT_MODES.md#typescript-aware-helpers-that-still-run-as-es6` — how TS-aware helper types erase to runnable ES6 without weakening TS output
- `MODULE_FUNCTIONS.md` — opt-in, analyzer-visible module functions that preserve the public Haxe static-method API
- `STDLIB_OVERRIDES.md` — narrowly reviewed JavaScript stdlib overlays,
  provenance guards, Reflaxe relationship, and the `haxe.io.Bytes` example
- `PACKAGING.md` — how to publish libraries/apps in both output modes
- `../examples/typescript-target/README.md` — minimal end-to-end Haxe → TS → JS example
- `../examples/todoapp/` — real fullstack example (React Router + Express)
- `TROUBLESHOOTING.md` — common failure modes + fixes

## Scoped source guides

These guides are instructions as well as navigation maps. Tools that support
scoped `AGENTS.md` files may load the closest applicable file; when uncertain,
agents and human contributors should read the scoped guide directly.

- [`../src/genes/AGENTS.md`](../src/genes/AGENTS.md) — compiler source owners,
  semantic boundaries, and how to prove a Haxe-to-TS/JS change
- [`../tooling/AGENTS.md`](../tooling/AGENTS.md) — optional Node host tooling,
  framework-neutral ownership boundaries, package navigation, and focused tests
- [`../tools/ts2hx/AGENTS.md`](../tools/ts2hx/AGENTS.md) — TypeScript compiler
  facts, Haxe emission, fixture routing, and fail-closed migration rules

## TypeScript target (genes-ts mode)

- `typescript-target/COMPILER_CONTRACT.md` — user-facing contract (output layout, module/import policy, defines)
- `typescript-target/TYPING_POLICY.md` — strict typing goals, nullability profiles, and escape-hatch rules
- `typescript-target/MINIMAL_RUNTIME.md` — what `-D genes.ts.minimal_runtime` changes/breaks
- `typescript-target/INTEROP.md` — bidirectional cookbook: Haxe consuming JS/TS and TS consuming generated Haxe
- `typescript-target/IMPORTS.md` — consuming existing JS/TS/TSX via `genes.ts.Imports`
- `typescript-target/REACT_HXX.md` — React/TSX authoring in Haxe (`genes.react.JSX`)
- `typescript-target/REACT_HOOKS.md` — framework-neutral semantic state,
  dependencies, optimistic state, component/Hook identity, and placement checks
- `typescript-target/REACT_FLIGHT_VALUES.md` — versioned native React Flight
  values, recursive macro validation, and the fail-closed host extension seam
- `typescript-target/ASYNC_AWAIT.md` — typed `@:async` + `await(...)`, native Genes output, and the exact anonymous/named stock-Haxe boundary
- `typescript-target/DEBUGGING.md` — source maps and debugging workflow

## Testing + CI

- `ARCHITECTURE.md#compiler-fixture-guide` — where each compiler/ts2hx test belongs
- `TESTING_STRATEGY.md` — the agentic change loop, compiler harnesses, evidence
  boundaries, todoapp E2E, and “one command” gates
- [`../tests/testing-strategy/agent-test-routing.json`](../tests/testing-strategy/agent-test-routing.json)
  — validated change-area routing to focused, acceptance, and full/release gates
- [`../tooling/README.md`](../tooling/README.md) — what the optional
  `@genes-ts/tooling` host library does, how its five primitives compose, and
  how to test or consume it before any public npm release
- [`../tooling/artifact-transactions/v1/README.md`](../tooling/artifact-transactions/v1/README.md) — framework-neutral durable generated-artifact protocol and shared conformance vectors
- `COMPATIBILITY_REPORT.md` — generated, deterministic evidence inventory with exact scope and counts
- `TOOLCHAINS.md` — centralized TypeScript, Haxe, and Node compatibility lanes
- `SECURITY.md` — local + CI secret scanning (gitleaks)
- `BRANCH_PROTECTION.md` — enforced GitHub ruleset, required checks, and recovery
- `RELEASING.md` — Conventional Commits, SemVer, exact-tested-commit
  publication, immutable GitHub Releases, and recovery

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
- `prompts/GPT_5_6_IMPORT_BINDING_IDENTITY_ARCHITECTURE.md` — focused evidence packet for separating ESM request, export binding, Haxe declaration, and emitted local-name identity

## Experimental

- `ts2hx/PLAN.md` — long-term strict-subset migration and assisted-scaffolding experiment
- `ts2hx/WORKFLOWS.md` — standalone, mixed-codebase, assisted, and semantic-differential migration loops
- `ts2hx/USAGE.md` — CLI, manifests, exit codes, current fixtures, and test commands
- `ts2hx/LIMITATIONS.md` — exact support/evidence boundary for semantics, TSX, async, types, and modules
- `ts2hx/PORTABILITY.md` — future non-JS portability grades and refactoring checklist
