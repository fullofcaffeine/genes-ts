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
| Admitted-generation session contract | `src/session/`, `development-session/v1/` |
| Public exports and package shape | `src/index.ts`, `package.json` |

The versioned JSON corpora are public conformance contracts for host adapters.
Do not change a protocol or vector merely to match one framework. Add a generic
case, update its schema and README, and prove the real runtime against it.

For a first tooling change, follow this order:

1. Name the owning layer in plain language: compiler, reusable tooling, host
   validator, framework adapter, or top-level application command.
2. Read that layer's public types and versioned conformance README before code.
3. Add or update a stable vector when observable lifecycle behavior changes.
4. Keep human prose as a presentation of structured facts; never make tests or
   agents parse it as the source of truth.
5. Run the focused route printed by `yarn test:focus -- <changed-path>`, then
   the package and repository gates required below.

Documentation is part of the contract. Define unfamiliar terms, state what is
already implemented, state what is deliberately deferred, and give the reader
a shortest safe path through the files. Examples must distinguish public API
from future or illustrative pseudocode.

## Ownership boundary

Tooling may own deterministic mechanics: file inventory, event reconciliation,
one-at-a-time execution, exact process leases, private candidates, host
admission handoff, last-good publication, read/publication coordination,
durable journals, and structured framework-neutral failure facts.

The caller must own framework commands, compiler discovery and arguments,
project policy, the validation decision, diagnostics, framework reload/restart
behavior, and top-level signals. Public names and types must not contain
Next.js, WordPress, Gutenberg, route, plugin, or another host-specific concept.
Automation-facing contracts use versioned JSON facts, stable identifiers, and
real completion barriers; agents must not need to scrape terminal prose or
depend on timing-only sleeps.

For `DevelopmentSession`, keep three authorities explicit:

- the immutable effective invocation (including entry/nested HXML policy)
  owns what Haxe may execute;
- the private candidate plus host admission owns what is eligible to publish;
- the output-scoped journal, accepted marker, and compiler manifest own what
  may replace the public tree or be recovered after a crash.

Do not turn a failed reconciliation into “no changes,” adopt an unowned live
file because a candidate wants its path, or keep publication authority only
under a caller-selected private state directory. Lifecycle observers may call
`close()` synchronously; install cancellation/ownership state before emitting
events and recheck it after every observer or awaited host boundary.

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
