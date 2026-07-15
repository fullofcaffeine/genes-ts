# ts2hx usage

ts2hx is an experimental, fail-closed TypeScript/JavaScript implementation-
source migration tool. It emits Haxe intended for the JavaScript target first.
It is not a lossless TypeScript-to-Haxe compiler, a `.d.ts` converter, or an
automatic route to every Haxe backend.

Choose the document that matches the question:

- [`WORKFLOWS.md`](WORKFLOWS.md): inventory, strict migration, assisted
  scaffolding, classic JS stabilization, and Haxe→TS roundtrips;
- [`LIMITATIONS.md`](LIMITATIONS.md): exact semantic matrix, unsupported
  constructs, TSX/async/module boundaries, and what each gate proves;
- [`PORTABILITY.md`](PORTABILITY.md): manual refactoring and evidence required
  before exploring another Haxe target;
- [`PLAN.md`](PLAN.md): architecture and longer-term direction.

## Build and inspect the CLI

From the repository root:

```bash
yarn --cwd tools/ts2hx build
node tools/ts2hx/dist/cli.js --help
node tools/ts2hx/dist/cli.js --version
```

The tool uses the repository's centralized TypeScript 6 API bridge. Generated
genes-ts output is tested separately on the supported TS5.5/TS6/TS7 lanes.

Current options:

```text
--project, -p         Path to tsconfig.json (default: ./tsconfig.json)
--list-files          Print configured root source files in deterministic order
--diagnostics         Print sorted TypeScript pre-emit diagnostics
--out, -o             Output directory for generated Haxe
--base-package        Generated Haxe package prefix (default: ts2hx)
--mode                strict-js (default) or assisted
--allow-loss          Map assisted exit 3 to 0; manifest stays assisted
--diagnostics-json    Write the complete deterministic manifest to another path
--clean               Transactionally replace, rather than overlay, the output
```

`--diagnostics` is an inspection aid. Run the original project's `tsc` gate
separately; printing a TypeScript diagnostic does not define ts2hx's
translation exit status.

## Inspect a project without emitting

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --list-files \
  --diagnostics
```

Only the printed root-file inventory receives translation dispositions. Make
the migration tsconfig explicit and include every implementation file intended
for conversion.

## Strict translation

`strict-js` is the default:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --out ./src-generated \
  --base-package migrated \
  --clean \
  --diagnostics-json ./artifacts/ts2hx-result.json
```

If any recognized file or construct cannot be preserved, strict mode exits `1`
and does not commit a partial tree. An existing output directory remains
unchanged. The external manifest still records deterministic diagnostics and
the complete semantic support catalog.

On success, `src-generated/ts2hx-manifest.json` is committed atomically beside
the Haxe files. Use `--clean` with a dedicated generated directory so files
removed from the source inventory cannot survive as stale output.

Try the smallest repository fixture:

```bash
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json \
  --out /tmp/ts2hx-out \
  --base-package ts2hx \
  --clean
```

## Assisted translation

Assisted mode produces reviewable inventory/scaffolding after a strict
rejection:

```bash
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/unsupported-top-level/tsconfig.json \
  --out /tmp/ts2hx-assisted \
  --base-package ts2hx \
  --clean \
  --mode assisted
```

It commits explicit `TS2HX-*` loss markers plus a manifest with status
`assisted`, then exits `3`. `--allow-loss` changes only that process status to
`0`; it does not improve the generated source or its semantic claim.

Never put assisted output on a production execution path merely because
automation accepted `--allow-loss`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Strict translation found no modeled loss, or assisted loss was explicitly allowed for inventory automation. Inspect manifest `status` to distinguish them. |
| `1` | Translation is unsupported/lossy under strict-js; no output tree was committed. |
| `2` | CLI, tsconfig, TypeScript project-load, filesystem, or internal tool failure. |
| `3` | Assisted output was committed with one or more recorded losses. |

## Translation manifest

Every successful or assisted tree contains a schema-v2
`ts2hx-manifest.json`. `--diagnostics-json <path>` writes the same complete
manifest for all translation results, including strict failures.

The stable top-level fields are:

- `schemaVersion`, `mode`, `status`, and `basePackage`;
- `plannedFiles`: deterministic output plan;
- `files`: one `emitted`, `declaration-only`, or `unsupported` disposition per
  configured source file;
- `diagnostics`: stable `TS2HX-*` ID, severity, source span, syntax kind,
  semantic category, support grade, output file, and remediation;
- `features`: the complete semantic support matrix with source occurrences for
  the current run.

`.d.ts` inputs are intentionally `declaration-only`. Use dts2hx or handwritten
externs to ingest npm declarations.

## Current fixture inventory

The snapshot runner currently owns these 20 projects:

| Area | Fixtures |
| --- | --- |
| Core declarations/runtime | `minimal-codegen`, `classes-enums`, `real-world-v1` |
| Expressions/control flow | `statement-coverage`, `expression-coverage`, `destructuring`, `params-defaults-rest`, `optional-chain-assignments`, `object-methods-spreads`, `async-await` |
| Types | `type-emission`, `type-literals` |
| Modules/exports | `export-forms`, `module-syntax`, `module-regexp`, `non-relative-imports` |
| JSX/React | `basic-tsx`, `react-types` |
| Migration roundtrip | `roundtrip-fixture`, `roundtrip-advanced` |

The current snapshot is 48 generated files. Most fixtures compile and execute
through standard Haxe JS. Explicit exceptions:

- `basic-tsx` and `react-types` compile but do not execute their raw marker
  calls under the standard Haxe generator; `react-types` additionally emits and
  strictly checks genes-ts TSX;
- `non-relative-imports` compile-smokes generated `@:jsRequire` externs but does
  not execute them inside the ESM tool package;
- `roundtrip-fixture`, `roundtrip-advanced`, `module-regexp`, `module-syntax`,
  and `type-literals` record one unsupported top-level `index.ts` entry call in
  assisted snapshots.

Additional evidence-only fixtures:

- `semantic-diff`: 13 supported semantic contracts executed as original TS,
  classic Genes JS, and genes-ts→JS;
- `semantic-unsupported`: 5 feature-specific strict failures with source
  provenance and unchanged prior output;
- `unsupported-top-level`: generic unknown-statement diagnostics, assisted loss
  markers, CLI exit codes, and transactional writes.

The executable source of truth is:

- `tools/ts2hx/src/test-snapshots.ts` for registered snapshot/smoke profiles;
- `tools/ts2hx/src/test-roundtrip.ts` for the three roundtrip fixtures;
- `tools/ts2hx/src/test-semantic-diff.ts` for semantic contracts;
- `tools/ts2hx/src/test-strict-diagnostics.ts` for failure behavior.

## Tests

Run the entire ts2hx suite:

```bash
yarn --cwd tools/ts2hx test
```

Focused gates:

```bash
yarn --cwd tools/ts2hx test:snapshots
yarn --cwd tools/ts2hx test:roundtrip
yarn --cwd tools/ts2hx test:semantic-diff
yarn --cwd tools/ts2hx test:strict-diagnostics
yarn --cwd tools/ts2hx test:docs
```

The roundtrip gate runs exactly:

- `roundtrip-fixture`;
- `roundtrip-advanced`;
- `module-regexp`.

Each compares an original TypeScript runtime marker with the generated
Haxe→genes-ts→TypeScript runtime and enforces no `any`/`unknown` in the selected
roundtripped user modules. The entry `index.ts` call remains an acknowledged
assisted loss; the harness invokes translated `Main` directly.

The semantic differential is the stronger behavior gate. It requires matching
event traces for explicit undefined, parameter defaults, uninitialized locals,
truthiness, strict equality, compound-assignment order, `for`/`continue`,
switch fallthrough/default placement, try/catch/finally, class and lexical
arrow `this`, async/await ordering, and ESM bindings. It also proves unary plus,
switch continue, outer completion through finally, dynamic prototype mutation,
and side-effect imports fail closed.

Update snapshots only after reviewing the semantic reason for every change:

```bash
UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test:snapshots
```

Compiler/tool changes must finish with the repository-wide gate:

```bash
yarn test:ci
```

## Applying ts2hx to a real codebase

Use [`WORKFLOWS.md`](WORKFLOWS.md) for copyable standalone, mixed-codebase,
assisted, differential, and portability workflows. The safe sequence is:

1. type-check the original TS project;
2. create and review a bounded translation tsconfig;
3. run strict-js with a manifest outside the generated directory;
4. inspect every file disposition and exercised semantic feature;
5. add an explicit Haxe bootstrap/adapters outside generated output;
6. compare original and translated runtime traces;
7. reduce each translator gap into a generic fixture;
8. rerun strict translation and the complete gates.

Read [`LIMITATIONS.md`](LIMITATIONS.md) before expanding the translated subset.
