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
--base-package        Valid dot-separated Haxe package prefix (default: ts2hx)
--mode                strict-js (default) or assisted
--runtime-profile     genes-esm or standard-haxe-js (required with --out)
--allow-loss          Map assisted exit 3 to 0; manifest stays assisted
--diagnostics-json    Publish the complete manifest to a path outside --out
--runtime-modules     Hash-pinned staging manifest for relative runtime files
--clean               Replace a dedicated output tree instead of preserving unowned files
```

`--diagnostics` is an inspection aid. Emission requires a clean configured
TypeScript project because effective runtime requests are observed from the
compiler's final transform. A project error exits `2` before Haxe is planned;
keep the original project's own `tsc` gate as the authoritative source check.

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

## Runtime compiler profiles

Every `--out` command must state which Haxe compiler contract will consume the
generated tree:

- `--runtime-profile genes-esm` targets both maintained Genes output modes:
  classic Genes JavaScript and genes-ts TypeScript. Use it whenever configured
  TypeScript emit retains a runtime module request.
- `--runtime-profile standard-haxe-js` is the narrow request-free profile. If
  any original import remains a runtime request after TypeScript elision, ts2hx
  reports `TS2HX-MODULES-ESM-RUNTIME-TARGET-001` at the first request and
  preserves the previous tree. Assisted mode cannot weaken this boundary.

This profile is about module initialization capability, not rich TypeScript
types. A manifest with effective requests records
`genes.esm-runtime-requests`, and generated compiler-owned carriers add a
second Haxe macro guard if the tree is later compiled under the wrong profile.
The runtime-profile gate also reuses one Haxe compile server for a Genes build
followed by a `genes.disable` build, proving the private capability does not
leak between compilations.

## Strict translation

`strict-js` is the default:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --out ./src-generated \
  --base-package migrated \
  --runtime-profile genes-esm \
  --clean \
  --diagnostics-json ./artifacts/ts2hx-result.json
```

If any recognized file or construct cannot be preserved, strict mode exits `1`
and does not commit a partial tree. An existing output directory remains
unchanged. The external manifest still records deterministic diagnostics and
the complete semantic support catalog.

Source naming is checked before lowering. The base package and relative source
directories must be legal Haxe package segments, sources must remain under the
configured `rootDir`, and each source must own a unique Haxe module/output
identity. In particular, `foo-bar.ts` and `foo_bar.ts` cannot both become
`FooBar.hx`; both receive `TS2HX-SOURCE-NAMESPACE-COLLISION-001`. These failures
also remain errors in assisted mode because there is no honest one-file
scaffold for two modules. No prior output is changed.

On success, `src-generated/ts2hx-manifest.json` is committed atomically beside
the Haxe files. The default no-clean transaction reads the previous recognized
schema-v3 manifest and removes only its `plannedFiles` that are absent from the
new plan. Handwritten Haxe, assets, and every other unowned path are preserved.
If the prior manifest exists but is malformed or contains an unsafe ownership
path, publication fails before changing the old tree. Use `--clean` only when
the entire output directory is dedicated to ts2hx and should be replaced.

The optional `--diagnostics-json` path is a second publication of that same
manifest and must be outside `--out`; the generated tree already contains its
owned copy. ts2hx writes the external bytes to a sibling stage before changing
the generated tree, keeps the old tree as a backup until the external file is
installed, and restores prior output when staging or installation reports an
error. A strict translation failure still publishes its diagnostic manifest
without opening the Haxe-tree transaction.

Each final replacement uses a rename beside its own target. This gives a clear
process-failure guarantee: a reported staging or installation failure does not
leave newly generated Haxe behind. It is not a claim of crash-atomicity across
different filesystems; a process kill, power loss, or host crash between the
two final renames can expose only one of them. Keep the external artifact on
the same reliable build volume when crash recovery matters.

Try the smallest repository fixture:

```bash
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json \
  --out /tmp/ts2hx-out \
  --base-package ts2hx \
  --runtime-profile genes-esm \
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
  --runtime-profile standard-haxe-js \
  --clean \
  --mode assisted
```

It commits explicit `TS2HX-*` loss markers plus a manifest with status
`assisted`, then exits `3`. `--allow-loss` changes only that process status to
`0`; it does not improve the generated source or its semantic claim.

Never put assisted output on a production execution path merely because
automation accepted `--allow-loss`.

Some project-level boundaries cannot be scaffolded at all. Invalid or
colliding source namespaces and a runtime request sent to the request-free
standard-Haxe profile return status `failed` even when `--mode assisted` was
selected; `--allow-loss` does not turn those errors into output.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Strict translation found no modeled loss, or assisted loss was explicitly allowed for inventory automation. Inspect manifest `status` to distinguish them. |
| `1` | Translation is unsupported/lossy under strict-js; no output tree was committed. |
| `2` | CLI, tsconfig, TypeScript project-load, filesystem, or internal tool failure. |
| `3` | Assisted output was committed with one or more recorded losses. |

## Translation manifest

Every successful or assisted tree contains a schema-v3
`ts2hx-manifest.json`. `--diagnostics-json <path>` writes the same complete
manifest for all translation results, including strict failures. Its path must
be outside the generated tree, and success/assisted publication participates
in the output rollback window described above.

The stable top-level fields are:

- `schemaVersion`, `mode`, `status`, `basePackage`, and `targetProfile`;
- `compiler`: exact TypeScript bridge and executing engine versions plus a
  deterministic effective-options hash;
- `requiredCompilerCapabilities`: capabilities the selected Haxe compiler must
  provide, currently `genes.esm-runtime-requests` when runtime requests remain;
- `moduleRequests`: every original static import's runtime/type-only/elided
  disposition, original span, and any final request ordinal, module format, and
  emitted shape;
- `plannedFiles`: deterministic generated-file ownership used by the next
  no-clean transaction for selective stale cleanup;
- `files`: one `emitted`, `declaration-only`, or `unsupported` disposition per
  configured source file;
- `diagnostics`: stable `TS2HX-*` ID, severity, source span, syntax kind,
  semantic category, support grade, output file, and remediation;
- `runtimeModules`: build owner, source hash, original/emitted specifier, import
  attribute, and staged destination for every external relative runtime file;
- `features`: the complete semantic support matrix with source occurrences for
  the current run.

`.d.ts` inputs are intentionally `declaration-only`. Use dts2hx or handwritten
externs to ingest npm declarations.

## Current fixture inventory

The snapshot runner currently owns these 22 projects:

| Area | Fixtures |
| --- | --- |
| Core declarations/runtime | `minimal-codegen`, `classes-enums`, `real-world-v1` |
| Expressions/control flow | `statement-coverage`, `expression-coverage`, `destructuring`, `params-defaults-rest`, `optional-chain-assignments`, `object-methods-spreads`, `async-await`, `finally-completion-return`, `finally-completion-control` |
| Types | `type-emission`, `type-literals` |
| Modules/exports | `export-forms`, `module-syntax`, `module-regexp`, `non-relative-imports` |
| JSX/React | `basic-tsx`, `react-types` |
| Migration roundtrip | `roundtrip-fixture`, `roundtrip-advanced` |

The current snapshot is 50 generated files. Effective TypeScript emit assigns
11 fixtures to `genes-esm` and 11 request-free fixtures to
`standard-haxe-js`; 10 of the standard fixtures execute their smoke runtime.
Explicit exceptions:

- `basic-tsx` is assisted because classic JSX synthesizes a React namespace
  use after the source AST ts2hx lowers; it and request-free `react-types`
  compile but do not execute raw JSX marker calls. `react-types` additionally
  emits and strictly checks genes-ts TSX;
- `non-relative-imports` is strict and compile-smokes the reviewed strong
  `@:jsRequire` extern shape. The semantic differential owns the separate
  bound-package runtime claim;
- `roundtrip-fixture`, `roundtrip-advanced`, `module-regexp`, `module-syntax`,
  and `type-literals` record an unsupported top-level `index.ts` entry call in
  assisted snapshots; `module-syntax` additionally records runtime re-export
  losses.

Additional focused evidence fixtures:

- `package-extern-plan`: a declaration-only local package that proves the
  same strong-type plan consumed by translation. Primitive functions and
  immutable constants receive closed Haxe type plans; mutable,
  overloaded, generic, optional/rest/`this`, merged, class, literal, object,
  union, type-only, namespace-object, and implementation-source shapes receive
  deterministic rejection reasons;
- `semantic-diff`: all 18 supported semantic contracts execute as original TS,
  classic Genes JS, and genes-ts→JS. The completion trace covers supported
  synchronous return/break/continue through `finally`, nested target ownership,
  mixed local and propagated outcomes from one helper, every supported loop
  form, exact lowered-for increments, switch routing, catch control, finalizer precedence,
  nullable and `Void` carriers, and an ordinary class method. The same fixture
  also covers the reduced ordered `state`/`first`/`second` converted-module
  initialization proof, a standalone bound-only target that reads its imports
  in reverse order, and a local typed ESM package. The package path proves
  default, named, aliased, namespace, duplicate, primitive constant/function,
  `Void`, and unused-verbatim bindings; it initializes once, coalesces to one
  final import, and passes generated-output checks on TS 5/6/7. The fixture runs
  with `verbatimModuleSyntax` off and on, proving that TypeScript-elided imports
  create no carrier while an unused retained alias initializes in its effective
  request slot;
- `semantic-unsupported`: 12 strict failures with source provenance and
  unchanged prior output; together with the runtime-profile target rejection,
  the machine-owned matrix contains 13 feature-specific strict failures;
- `semantic-module-boundaries`: focused duplicate-ID coverage for bound and
  self cycles, aliased and namespace live bindings, all runtime re-export
  spellings, converted attributes, assisted loss records, and unchanged
  strict-mode output;
- `unsupported-top-level`: generic unknown-statement diagnostics, assisted loss
  markers, CLI exit codes, and transactional writes.

The executable source of truth is:

- `tools/ts2hx/src/test-snapshots.ts` for registered snapshot/smoke profiles;
- `tools/ts2hx/src/test-roundtrip.ts` for the three roundtrip fixtures;
- `tools/ts2hx/src/test-semantic-diff.ts` for semantic contracts;
- `tools/ts2hx/src/test-effective-module-requests.ts` for exact configured
  TypeScript request/elision evidence;
- `tools/ts2hx/src/test-package-extern-facts.ts` for checker alias/type facts
  and the closed package-extern semantic plan;
- `tools/ts2hx/src/test-source-namespace-plan.ts` for package/module/output
  identity, collisions, root containment, and strict/assisted rollback;
- `tools/ts2hx/src/test-output-ownership.ts` for no-clean selective stale
  removal, unowned-file preservation, malformed manifests, and determinism;
- `tools/ts2hx/src/test-runtime-profile.ts` for schema-v3 profile boundaries,
  transaction safety, and the Haxe macro guard;
- `tools/ts2hx/src/test-strict-diagnostics.ts` for failure behavior.

## Tests

Run the entire ts2hx suite:

```bash
yarn --cwd tools/ts2hx test
```

Focused gates:

```bash
yarn --cwd tools/ts2hx test:snapshots
yarn --cwd tools/ts2hx test:source-namespace-plan
yarn --cwd tools/ts2hx test:output-ownership
yarn --cwd tools/ts2hx test:esm-request-plan
yarn --cwd tools/ts2hx test:package-extern-facts
yarn --cwd tools/ts2hx test:runtime-profile
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
truthiness, strict equality, unary-plus numeric coercion, compound-assignment
order, `for`/`continue`, switch fallthrough/default placement,
unlabelled switch-to-loop `continue`, try/catch/finally, typed return/break/
continue through nested finalizers, class and lexical arrow `this`, async/await
ordering, ESM bindings, and effective ESM request order. It also proves labeled
switch continue, excluded async outer completion through finally, and dynamic
prototype mutation fail closed. Its module transcripts cover bare
packages, manifest-staged relatives, empty and inline-type clauses, immutable
named/default/namespace and combined converted bindings, TypeScript elision,
duplicates, and unused requests retained by verbatim emit. Original TypeScript,
classic Genes, and genes-ts agree under full DCE; standard Haxe is separately
required to reject the first effective request without modifying prior output.

## External relative runtime modules

Bare package specifiers are preserved as JavaScript-host J1 requests. A
relative file that is intentionally not translated requires
`--runtime-modules <manifest.json>`; ts2hx never guesses that a missing or
excluded source file should remain executable. The input manifest is schema v1:

```json
{
  "schemaVersion": 1,
  "modules": [{
    "importer": "Main.ts",
    "specifier": "./runtime/setup.mjs",
    "runtimeSpecifier": "./runtime/setup.mjs",
    "source": "runtime/setup.mjs",
    "stagedPath": "./runtime/setup.mjs",
    "owner": "app runtime-assets build",
    "sha256": "<64 lowercase hex characters>"
  }]
}
```

`importer` is relative to the migration tsconfig's `rootDir`; `source` is
relative to the manifest; and `stagedPath` is relative to the generated
importing Haxe module. The source bytes are hash-checked and copied inside the
same transaction as generated Haxe. The named `owner` must copy that staged
asset to the identical module-relative location in both final Genes output
trees. npm/package installation remains the host build's responsibility.

The current strict boundary supports bare packages, the closed typed
bound-package subset, manifest-owned external relative files, and acyclic
converted-relative modules. A supported package binding must resolve through a
declaration file to a primitive immutable constant or a single non-generic
function with required primitive parameters and a primitive/`void` result.
Default, named, alias, mixed, and statically-read namespace clauses share one
strong generated extern. Converted imports may use immutable named, default,
namespace, empty, and combined default clauses; their order follows the
requests retained by the configured TypeScript emit.
One non-empty literal `type` attribute is supported for external requests when
source and manifest agree. Converted requests use generated Haxe module
identities and compiler-internal DCE anchors rather than preserving original
`.js` paths. Converted cycles, mutable live bindings, broader package
declarations, namespace-object/computed uses, compiler-synthesized package
uses, configured non-ESM lowering, unresolved relatives, code outside the
configured conversion set, unmanifested runtime files, unsupported attributes,
and runtime re-exports receive stable source-positioned diagnostics.

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
