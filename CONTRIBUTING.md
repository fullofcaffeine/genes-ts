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

Start with [`AGENTS.md`](AGENTS.md) for the ten-minute repository orientation,
end-to-end compiler/ts2hx commands, and source-owner map. More specific
instructions apply under [`src/genes`](src/genes/AGENTS.md) and
[`tools/ts2hx`](tools/ts2hx/AGENTS.md).

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing compiler
semantics or ts2hx lowering. It maps the shared TS/classic pipeline to its source
owners and explains which snapshot, type-negative, runtime, package-shape,
dual-output, or semantic-differential harness must prove a change.

Snapshots are shape evidence, not semantic evidence. Add a behavior to the
smallest owning fixture, inspect the generated diff, and run its runtime or type
contract before the full CI gate.

## Setup

Prereqs:
- Node.js 26.1+
- Yarn (this repo pins Yarn via Corepack)
- Haxe via `lix` (auto-downloaded on `yarn install`)
- Go 1.26.5 for building the exact repository-owned Beads client
- haxe-formatter 1.18.0 for staged Haxe formatting

Install:

```bash
corepack enable
yarn install
yarn beads:install
yarn haxelib install formatter 1.18.0 --quiet
yarn hooks:install
```

`beads:install` builds a checksum-verified upstream commit into Git's common
directory. That location is shared by every linked worktree, just like the live
database. Use `yarn bd <command>` for issue work; an ambient `bd` may display a
newer release number while understanding an older database schema.

`hooks:install` composes the repository pre-commit checks with Beads instead of
replacing its generated section, and makes every managed Beads hook resolve the
same pinned client. Before each commit, complete staged `.hx` files are
formatted and re-staged, then the final staged snapshot is scanned for
credentials. A partially staged Haxe file is rejected so formatting cannot pull
unstaged edits into the commit. See
[`docs/SECURITY.md`](docs/SECURITY.md#pre-commit-boundary) for setup, failure
behavior and the required CI backstop. See
[`docs/BEADS_WORKTREES.md`](docs/BEADS_WORKTREES.md) for client identity,
incident recovery and database-upgrade policy.

## Quality gates (run locally)

Run the same suite as CI:

```bash
yarn test:ci
```

Useful subsets:

```bash
yarn test:precommit-hook
yarn test:beads-pin
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
