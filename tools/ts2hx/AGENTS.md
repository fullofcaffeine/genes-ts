# ts2hx contributor guide

This file applies to `tools/ts2hx/**`. Read the repository
[`AGENTS.md`](../../AGENTS.md) first for workflow, issue tracking, documentation,
typing, and landing requirements.

## What ts2hx is

ts2hx is an experimental migration tool for TypeScript or JavaScript
**implementation source**:

```text
configured TypeScript Program and TypeChecker
  -> explicit compiler and semantic facts
  -> supported/lossy/unsupported dispositions
  -> deterministic Haxe source plan
  -> transactional Haxe tree plus ts2hx-manifest.json
```

It is not a general TypeScript-to-Haxe compiler, a `.d.ts` ingestion tool, or a
promise that successful generated Haxe is portable to every Haxe target.
Strict mode succeeds only for the feature subset recorded in the manifest.
Assisted mode is reviewable scaffolding with explicit loss, not executable
parity.

ts2hx depends on Genes for some JavaScript runtime profiles and differential
tests. The compiler under `src/genes` must never depend on ts2hx.

Start with:

- [`README.md`](README.md) for the local overview and commands;
- [`../../docs/ts2hx/USAGE.md`](../../docs/ts2hx/USAGE.md) for CLI, manifests,
  exit codes, and fixture inventory;
- [`../../docs/ts2hx/WORKFLOWS.md`](../../docs/ts2hx/WORKFLOWS.md) for
  inventory, strict, assisted, roundtrip, and CI workflows;
- [`../../docs/ts2hx/LIMITATIONS.md`](../../docs/ts2hx/LIMITATIONS.md) for the
  exact support boundary;
- [`../../docs/ARCHITECTURE.md#contributing-a-ts2hx-fixture`](../../docs/ARCHITECTURE.md#contributing-a-ts2hx-fixture)
  before extending translation behavior.

## Navigate the implementation

| Concern | Start here |
| --- | --- |
| CLI options, exit status, orchestration | `src/cli.ts` |
| TypeScript project loading and root inventory | `src/project.ts`, `src/typescript-api.ts` |
| Typed facts extracted from the TypeScript compiler | `src/semantic/compiler-facts.ts` |
| Effective runtime/type-only/elided module requests | `src/semantic/effective-module-requests.ts` |
| Closed semantic support model and diagnostics | `src/semantic/ir.ts` |
| Package extern admission | `src/semantic/package-extern-plan.ts` |
| Haxe source generation | `src/haxe/emit.ts` |
| Haxe namespace/file ownership | `src/haxe/source-namespace-plan.ts` |
| External relative runtime files | `src/haxe/runtime-modules.ts` |
| Transaction and stale-output evidence | `src/test-output-ownership.ts` and the publication helpers reached from `src/cli.ts` |

Search by stable `TS2HX-*` diagnostic or semantic feature ID before searching
by emitted text. A syntax kind alone is rarely enough: translation decisions
may also depend on the TypeChecker's symbol, type, resolved signature, final
emit behavior, or effective runtime module request.

## Build and inspect

```bash
yarn --cwd tools/ts2hx build
node tools/ts2hx/dist/cli.js --help

node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json \
  --out /tmp/ts2hx-out \
  --runtime-profile genes-esm \
  --clean
```

Inspect both generated `.hx` files and `ts2hx-manifest.json`. A snapshot proves
deterministic output shape; it does not prove runtime equivalence.

## Extend the supported subset

1. Add the smallest TypeScript fixture that distinguishes the intended
   semantics from a plausible but wrong translation.
2. Capture authoritative TypeScript compiler facts before printing.
3. Give every encountered construct an explicit supported, lossy, or
   unsupported disposition with source provenance.
4. Keep strict failure transactional: no partial new Haxe tree may replace the
   prior good output.
5. Add the fixture to the evidence owner that matches the claim:
   - `test:snapshots` for deterministic shape;
   - `test:strict-diagnostics` for fail-closed source diagnostics;
   - `test:roundtrip` for selected TS -> Haxe -> TS execution;
   - `test:semantic-diff` for original TS/classic Genes/genes-ts transcript
     equivalence;
   - `test:runtime-profile` for Genes versus request-free standard Haxe;
   - `test:output-ownership` for transactions and stale cleanup.
6. Update the semantic catalog, manifest documentation, usage/limitations
   guides, and local Why/What/How comments together.

Run the complete tool gate before landing:

```bash
yarn --cwd tools/ts2hx test
```

Do not silently repair unsupported syntax with `any`, `Dynamic`, raw target
code, omitted statements, guessed import behavior, or generated placeholders.
If the TypeScript compiler cannot provide enough evidence for an exact
translation, strict mode must fail at the original source span; assisted mode
may scaffold only when the manifest records the loss explicitly.
