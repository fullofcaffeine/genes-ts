# Authoritative dual-output corpus

This fixture is the bounded semantic contract for compiling one Haxe source
tree through both first-class Genes output modes.

## Why this exists

Mode-specific suites can both be green while the same program behaves
differently between generated TypeScript and classic ESM JavaScript. Source
snapshots alone are also insufficient: harmless formatting changes can produce
large diffs, while an incorrect expected snapshot can still be deterministic.

`yarn test:dual-output` therefore compares stable runtime observations first
and uses generated shape only for bounded invariants such as DCE, import kind,
declaration reachability, and source-map presence.

## Profiles and oracles

| Profile | Build product | Gate |
| --- | --- | --- |
| `ts-strict` | Split TypeScript, then NodeNext JavaScript/declarations | Strict `tsc` plus runtime trace |
| `classic-esm` | Split modern ESM JavaScript | Runtime trace |
| `classic-dts` | Declarations emitted beside classic JS | Strict external consumer with negative cases |
| Standard Haxe JS | Single CommonJS oracle with Genes disabled | Primary runtime trace oracle |
| Vanilla Genes | Split ESM from pinned `../genes-vanilla` | Secondary core oracle when the sibling checkout exists; otherwise the checked-in pinned baseline is validated |

All current profiles, commands, artifacts, snapshot owners, and capability
exclusions are machine-readable in `profile-ownership.json`.

## Covered semantic seams

The identical `dual.Main` source covers:

- classes, interfaces, applied generics, enums, and reflection;
- null, real JavaScript `undefined`, optional records, and immediate narrowing
  of `genes.ts.Unknown`;
- maps, iterators, exceptions, expression-valued switch, and receiver/index/RHS
  evaluation order;
- a real `node:path` ESM value import and a type-only local dependency;
- embedded Haxe resources, strict resource/Bytes runtime support typing, DCE,
  and source-map shape.

The live vanilla comparison intentionally runs only the target-neutral core:
vanilla predates `genes.ts` helper abstractions. Its pinned baseline records
accepted registry and map-helper divergences; byte identity is never an oracle.

## Deliberate exclusions and supplementary owners

- JSX is intentionally exercised by the smaller identical-source React fixture
  at `tests/genes-ts/snapshot/react/src/DualJsxMain.hx`. Its TSX/classic runtime
  differential, negative TS consumers, and fail-closed capability diagnostic
  run under `yarn test:genes-ts:tsx`; they do not require the standard-Haxe or
  vanilla oracles used by this target-neutral core.
- Exact token mappings, mapped thrown stacks, deterministic tree hashes, and
  output budgets are owned by `genes-09r.6`. This fixture checks source-map
  linkage and source membership only.
- CommonJS `export =`, conditional exports, and package subpaths remain in the
  package-shape interop roadmap; the corpus exercises an ESM host import.

These exclusions prevent one passing fixture from being presented as universal
compiler equivalence.
