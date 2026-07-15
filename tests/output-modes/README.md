# Authoritative dual-output corpus

This fixture is the bounded semantic contract for compiling one Haxe source
tree through both first-class Genes output modes.

## Why this exists

Mode-specific suites can both be green while the same program behaves
differently between generated TypeScript and classic ESM JavaScript. Source
snapshots alone are also insufficient: harmless formatting changes can produce
large diffs, while an incorrect expected snapshot can still be deterministic.

`yarn test:dual-output` therefore compares stable runtime observations first,
then runs bounded shape and output-quality evidence: DCE, import kind,
declaration reachability, exact representative mappings, clean-build hashes,
and reviewed budgets.

## Profiles and oracles

| Profile | Build product | Gate |
| --- | --- | --- |
| `ts-strict` | Split TypeScript, then NodeNext JavaScript/declarations | Strict `tsc` plus runtime trace |
| `classic-esm` | Split modern ESM JavaScript | Runtime trace |
| `classic-dts` | Declarations emitted beside classic JS | Strict external consumer with negative cases |
| Standard Haxe JS | Single CommonJS oracle with Genes disabled | Primary runtime trace oracle |
| Vanilla Genes | Split ESM from pinned `../genes-vanilla` | Secondary core oracle when the sibling checkout exists; otherwise the checked-in pinned baseline is validated |

All current profiles, commands, artifacts, snapshot owners, and capability
exclusions are machine-readable in `profile-ownership.json`. Exact mapping and
budget inputs live in `output-quality.json`; run that layer alone with
`yarn test:output-quality`.

## Covered semantic seams

The identical `dual.Main` source covers:

- classes, interfaces, applied generics, enums, and reflection;
- null, real JavaScript `undefined`, optional records, and immediate narrowing
  of `genes.ts.Unknown`;
- maps, iterators, exceptions, expression-valued switch, and receiver/index/RHS
  evaluation order;
- a real `node:path` ESM value import and a type-only local dependency;
- embedded Haxe resources, strict resource/Bytes runtime support typing, DCE,
  source-map linkage, and a retained no-temp/stack-probe entry point.

The live vanilla comparison intentionally runs only the target-neutral core:
vanilla predates `genes.ts` helper abstractions. Its pinned baseline records
accepted registry and map-helper divergences; byte identity is never an oracle.

## Deliberate exclusions and supplementary owners

- JSX is intentionally exercised by the smaller identical-source React fixture
  at `tests/genes-ts/snapshot/react/src/DualJsxMain.hx`. Its TSX/classic runtime
  differential, negative TS consumers, and fail-closed capability diagnostic
  run under `yarn test:genes-ts:tsx`; they do not require the standard-Haxe or
  vanilla oracles used by this target-neutral core.
- Output quality is deliberately bounded to this corpus. Six representative
  TS/classic tokens map to exact Haxe lines and columns. A real classic Node
  stack maps directly to Haxe; the TypeScript runtime stack maps to generated
  TS and the separate Genes map is then followed to the same Haxe token. This
  proves both links, not automatic JS → TS → Haxe map composition.
- Two clean TS/classic compiler trees must have identical normalized hashes.
  Normalization changes only line endings, JSON key order, path separators,
  and machine-owned repo/Haxe/haxelib roots inside map `sources`; code tokens,
  relative artifact paths, mapping strings, and source order remain hashed.
- `output-quality.json` records exact module baselines, 5% byte/token ceilings,
  source-map-classified temporary counts, import counts, and zero-temp files.
  Module/temp/import growth requires a new review ID and rationale.
- The two clean Haxe compile durations are printed as report-only evidence.
  They have no threshold until repeated CI data establishes a noise envelope.
- CommonJS `export =` constructor identity is owned by the separate blocking
  `yarn test:interop:module-shapes` gate. Conditional exports beyond that local
  root entry and package subpaths remain in the broader interop roadmap; this
  corpus exercises an ESM host import.

These exclusions prevent one passing fixture from being presented as universal
compiler equivalence.
