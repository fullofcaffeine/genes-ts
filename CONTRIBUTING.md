# Contributing to genes-ts

Thanks for helping improve **genes-ts**.

## Repo principles

- Keep **both output modes** green:
  - TypeScript output (`-D genes.ts`)
  - Classic Genes JS output (default)
- Prefer **typed boundaries**:
  - Avoid `untyped` / `Dynamic` in framework + test code.
  - Avoid emitting `any` / `unknown` in generated user TypeScript.
- Document vital/complex code with **hxdoc** (Why / What / How).

## Architecture and fixture ownership

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing compiler
semantics or ts2hx lowering. It maps the shared TS/classic pipeline to its source
owners and explains which snapshot, type-negative, runtime, package-shape,
dual-output, or semantic-differential harness must prove a change.

Snapshots are shape evidence, not semantic evidence. Add a behavior to the
smallest owning fixture, inspect the generated diff, and run its runtime or type
contract before the full CI gate.

## Setup

Prereqs:
- Node.js 20+
- Yarn (this repo pins Yarn via Corepack)
- Haxe via `lix` (auto-downloaded on `yarn install`)

Install:

```bash
corepack enable
yarn install
```

## Quality gates (run locally)

Run the same suite as CI:

```bash
yarn test:ci
```

Useful subsets:

```bash
yarn test:secrets
yarn test:vulns
yarn test:genes-ts
yarn test:acceptance
```

## Pull requests

- Keep changes focused and well-tested.
- Update docs when behavior/flags/output changes.
- If you add a workaround/exception (e.g. `.osv-scanner.toml`), justify it and time-bound it.

## GitHub Actions note

GitHub may still show a workflow named `.github/workflows/main.yml`. This is a **legacy** CI workflow that existed earlier in the repo history; GitHub keeps it listed because old runs still exist. The active workflows are the ones currently present in `.github/workflows/`.
