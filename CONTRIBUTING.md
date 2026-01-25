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
