# Agent guide: framework-neutral host tooling

This directory contains optional Node/TypeScript infrastructure for programs
that repeatedly run Genes. It is not part of Haxe typing or code generation,
and generated applications never import it.

Read [`README.md`](README.md) before changing an API. The README explains the
host workflow, package boundary, examples, and current distribution status.

## Navigate by responsibility

| Concern | Start here |
| --- | --- |
| Durable publication and recovery | `src/artifacts/`, `artifact-transactions/v1/` |
| HXML input discovery | `src/hxml/` |
| Reconciled native/polling watch | `src/watch/`, `watch-orchestration/v1/` |
| Serialized newest-state rebuilds | `src/loop/` |
| Owned Haxe `--wait` lifecycle | `src/haxe-server/`, `haxe-wait-server/v1/` |
| Public exports and package shape | `src/index.ts`, `package.json` |

The versioned JSON corpora are public conformance contracts for host adapters.
Do not change a protocol or vector merely to match one framework. Add a generic
case, update its schema and README, and prove the real runtime against it.

## Ownership boundary

Tooling may own deterministic mechanics: file inventory, event reconciliation,
one-at-a-time execution, exact process leases, durable journals, and structured
framework-neutral failure facts.

The caller must own framework commands, compiler discovery and arguments,
project policy, validation, diagnostics, generated-file authorization,
adoption, and “last good” behavior. Public names and types must not contain
Next.js, WordPress, Gutenberg, route, plugin, or another host-specific concept.

The package is independent from compiler semantic-release. Do not publish it,
change its public version, or dispatch a release workflow without explicit
authority. It is intentionally unpublished while no external host requires a
registry package. Exact Git consumers use `#COMMIT::path:tooling`; keep the
subpackage's `prepare` build self-contained and its build dependencies exact so
installation never depends on the repository root's `node_modules`. The
verified client is npm 11.18.0; npm 10.9.4 does not honor the selected
subdirectory during installation.

## Verification

Run the smallest relevant test while iterating, then the package boundary:

```bash
yarn --cwd tooling test
yarn test:tooling-package
```

Protocol changes also require their focused conformance vectors. Release or
package-policy changes require:

```bash
yarn test:tooling-release-workflow
yarn test:tooling-package
```

Finish changes that affect the wider repository with the full gate required by
the root [`AGENTS.md`](../AGENTS.md).
