# ts2hx migration workflows

ts2hx is an experimental, fail-closed migration tool for TypeScript or
JavaScript *implementation source*. It uses the TypeScript Program and
TypeChecker to generate Haxe intended for the JavaScript target first.

This guide covers the practical migration loops. Read
[`LIMITATIONS.md`](LIMITATIONS.md) before choosing a strict success criterion,
and use [`USAGE.md`](USAGE.md) for the complete CLI and fixture inventory.

All repository commands below run from the genes-ts root.

## Choose a workflow

| Goal | Mode and output | Recommended workflow |
| --- | --- | --- |
| Learn how much of a TS project is translatable | Inventory first; optionally `assisted` | [Inventory and scope a migration](#inventory-and-scope-a-migration) |
| Move a supported TS slice to Haxe but keep JavaScript as the runtime | `strict-js`, then classic Genes JS | [TS → Haxe → classic JS](#ts--haxe--classic-js) |
| Move selected modules to Haxe inside a TS-first repository | `strict-js`, then genes-ts TypeScript | [TS → Haxe → TypeScript](#ts--haxe--typescript) |
| Produce reviewable placeholders for unsupported source | `assisted` | [Assisted scaffolding](#assisted-scaffolding) |
| Prove a translator feature preserves behavior | Repository differential harness | [Build a semantic differential](#build-a-semantic-differential) |
| Eventually target something other than JavaScript | Refactor adapters after translation | [Portability work](#portability-work) |

If the input is an npm package's `.d.ts` rather than implementation source,
use the [dts2hx declaration bridge](../typescript-target/IMPORTS.md#generating-externs-from-npm-declarations-with-dts2hx).
ts2hx records `.d.ts` files as declaration-only and does not convert them into
extern APIs.

## Prepare the tool and the source project

Build the CLI through the repository's pinned TypeScript API bridge:

```bash
yarn --cwd tools/ts2hx build
node tools/ts2hx/dist/cli.js --version
```

Keep the input project type-correct under its own compiler before translation:

```bash
tsc -p ./tsconfig.json --noEmit
```

`--diagnostics` on ts2hx prints sorted TypeScript pre-emit diagnostics for
inspection, but it does not turn them into a separate translation failure
code. A clean TypeScript build remains the source-project gate.

Use a dedicated `tsconfig` for the migration slice. Every implementation file
that should receive a disposition must be part of that config's root-file
inventory. Confirm it before writing output:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --list-files \
  --diagnostics
```

The list is deterministic and path-relative. An imported implementation file
outside this inventory may exist in the TypeScript Program without becoming a
translation unit, so treat the printed list as a required review artifact.

## Inventory and scope a migration

Start with a small, dependency-light package or module group rather than an
entire application. A useful first slice has:

- an explicit typed API;
- pure/domain behavior separated from browser, Node, and npm adapters;
- an executable original-TypeScript test or stable event trace;
- no implicit top-level bootstrap side effects;
- a dedicated output directory that can be deleted and regenerated.

Run strict translation first:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --out ./src-generated \
  --base-package migrated \
  --clean \
  --diagnostics-json ./artifacts/ts2hx-strict.json
```

Possible outcomes:

- exit `0`: the complete root-file inventory was translated within the
  currently modeled strict-js subset;
- exit `1`: at least one file or construct was rejected, the prior output tree
  was preserved, and the external manifest contains source-positioned losses;
- exit `2`: configuration, CLI, or internal failure;
- exit `3`: assisted output was committed with recorded losses.

`--diagnostics-json` writes the complete schema-v2 translation manifest, not
only an array of errors. Put it outside the generated directory so a failed
strict transaction can still leave evidence without modifying that directory.

Review these fields before continuing:

```text
status             success | failed | assisted
mode               strict-js | assisted
files[]            emitted | declaration-only | unsupported
diagnostics[]      stable ID, source span, syntax kind, category, remediation
features[]         complete semantic catalog plus occurrences in this run
plannedFiles[]     deterministic output inventory
runtimeModules[]   staged runtime file identity, hash, owner, and destination
```

Exit `0` is a subset claim, not a replacement for runtime comparison. The
manifest tells you which semantic contracts occurred; it cannot prove syntax
that has no differential fixture yet.

## TS → Haxe → classic JS

This is the shortest stabilization loop when the translated project will still
run on JavaScript.

### 1. Translate in strict mode

Use the strict command from the inventory section and require exit `0`. Read
the generated `src-generated/ts2hx-manifest.json` into review or CI evidence.

### 2. Add an explicit Haxe composition root

TypeScript permits executable top-level statements. Haxe modules are not a
lossless home for arbitrary module initialization, so strict mode rejects
unmodeled calls. Supported bare package imports and manifest-owned relative
runtime files become compiler-owned ESM requests; other top-level startup must
move into an explicit exported function before translation or a reviewed Haxe
entry point after it:

```haxe
package app;

/** Owns startup that was previously an authored TypeScript entry module. */
function main():Void {
  migrated.Main.main();
}
```

Keep this bootstrap outside regenerated output.

### 3. Compile through classic Genes

```hxml
-lib genes-ts
-cp src-generated
-cp src-migration
--main app.Main
-js dist/index.js
-D js-es=6
```

```bash
haxe build.migrated.hxml
node --enable-source-maps dist/index.js
```

Async output uses `genes.js.Async`, non-relative packages may require generated
JS externs, and JSX markers require a genes-aware output profile. These are
JavaScript-target contracts, not portable-Haxe guarantees.

### 4. Compare behavior

Run the original TypeScript and translated runtime against the same inputs.
Prefer stable JSON events over human-formatted logs:

```text
original TS event trace == translated Haxe/JS event trace
```

Cover values and side-effect order, thrown errors, missing versus undefined
data, default parameters, control-flow completion, async ordering, and module
identity relevant to the slice. A successful Haxe build alone is insufficient.

## TS → Haxe → TypeScript

Use this path when a TS-first repository wants Haxe as an authoring or migration
layer while generated TypeScript remains an inspectable artifact.

### 1. Translate and review

Require a strict ts2hx translation and retain its manifest exactly as in the
classic workflow.

### 2. Emit TypeScript from the generated Haxe

```hxml
-lib genes-ts
-cp src-generated
-cp src-migration
--main app.Main
-js roundtrip-src/index.ts
-D genes.ts
```

```bash
haxe build.roundtrip.hxml
tsc -p tsconfig.roundtrip.json
node --enable-source-maps dist-roundtrip/index.js
```

An application can import the generated modules from authored TypeScript, but
Haxe DCE cannot see those external callers. Keep an explicit Haxe composition
root or use the genes-ts reusable-library profile for manually marked public
class surfaces. Do not retain every module globally merely to hide a missing
entry contract.

### 3. Use three-way evidence

For semantics touched by the translation, compare:

```text
original TypeScript
translated Haxe → classic Genes JavaScript
translated Haxe → genes-ts TypeScript → JavaScript
```

The repository's exact semantic suite demonstrates this shape:

```bash
yarn --cwd tools/ts2hx test:semantic-diff
```

The broader roundtrip smoke runs three selected fixtures through original TS
and generated TS:

```bash
yarn --cwd tools/ts2hx test:roundtrip
```

Those fixtures deliberately handle their unsupported authored `index.ts` calls
outside the translated module. That is recorded assisted loss, not hidden
support for arbitrary top-level execution.

## Assisted scaffolding

Use assisted mode to estimate work or preserve review context after strict mode
rejects a project:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --out ./src-generated-assisted \
  --base-package migrated \
  --clean \
  --mode assisted
```

The command normally exits `3`. Every unsupported file has a disposition, and
any partial Haxe file contains a nearby `TS2HX-*` loss marker. The committed
tree includes `ts2hx-manifest.json` with status `assisted`.

`--allow-loss` changes only the process exit to `0` for inventory automation:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.migration.json \
  --out ./src-generated-assisted \
  --clean \
  --mode assisted \
  --allow-loss
```

It does not change the manifest, fill placeholders, or make the result safe to
execute. Keep assisted output out of production build inputs until every loss
has been resolved and a later strict run succeeds.

## Build a semantic differential

When ts2hx rejects a construct that should become supported, reduce it to the
smallest generic TypeScript behavior before changing the emitter.

1. Add an original TypeScript fixture with a deterministic event trace.
2. Add the semantic feature or use an existing stable feature ID in
   `tools/ts2hx/src/semantic/ir.ts`.
3. Normalize evaluation/control-flow facts before printing Haxe.
4. Execute the original TS, classic Haxe/JS, and genes-ts/TS runtimes.
5. Add a companion rejection fixture for the nearest unsupported variant.
6. Assert the manifest occurrence, grade, diagnostic ID, and source span.
7. Run all ts2hx gates and then repository CI.

```bash
yarn --cwd tools/ts2hx test:snapshots
yarn --cwd tools/ts2hx test:roundtrip
yarn --cwd tools/ts2hx test:semantic-diff
yarn --cwd tools/ts2hx test:strict-diagnostics
yarn --cwd tools/ts2hx test:docs
yarn test:ci
```

Snapshot updates require inspection:

```bash
UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test:snapshots
```

Never update a snapshot to turn an unexplained semantic difference into the new
expected output.

## Portability work

Current strict mode is `strict-js`. It may intentionally emit `js.*` externs,
JavaScript truthiness/default helpers, Promise-based async lowering, ESM/npm
boundaries, and other J1 contracts.

After behavior is stable on JavaScript, isolate domain code from host adapters,
replace JavaScript absence/coercion assumptions with explicit domain states,
and add the destination Haxe target to the differential matrix. A future
`strict-portable` mode is a design direction, not a current CLI option.

Use the detailed [`PORTABILITY.md`](PORTABILITY.md) checklist before making any
cross-target claim.

## Recommended repository layout

```text
tsconfig.migration.json        # explicit TypeScript translation inventory
src-ts/                        # original or remaining authored TS
src-generated/                 # regenerated strict ts2hx Haxe output
src-migration/                 # reviewed Haxe bootstrap/adapters/repairs
artifacts/ts2hx-strict.json    # machine-readable strict result
roundtrip-src/                 # optional genes-ts output
dist/                          # executable build artifacts
tests/migration/               # original/translated differential traces
```

Do not hand-edit `src-generated`. Fix the original TS, improve a generic ts2hx
feature, or put intentional reviewed Haxe beside it. A clean regeneration must
be able to replace the generated tree transactionally.
