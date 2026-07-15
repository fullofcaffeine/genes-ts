# ts2hx usage (TS/JS → Haxe migration tool)

ts2hx is an **experimental inventory and migration-scaffolding tool** in this repo:

- Input: a TypeScript/JavaScript project (optionally TSX)
- Output: Haxe source intended to compile **on the JS target first**

It is designed to help with **migration**:

- **TS/JS → Haxe-for-JS** so you can refactor in Haxe, and then:
  - compile to **TypeScript** with genes-ts (`-D genes.ts`) to finish a “pure TS” port, or
  - move toward other Haxe targets later, after manual portability refactors.

It is not a lossless TypeScript-to-Haxe compiler. Current success is meaningful
only in strict mode; assisted output is explicitly incomplete and must be
reviewed. Portable non-JS Haxe is a later exploration, not a current guarantee.

## Build the tool

`tools/ts2hx` is a small TypeScript CLI package.

From the repo root:

```bash
yarn --cwd tools/ts2hx build
```

## Convert a project (emit Haxe)

Example using one of the built-in fixtures:

```bash
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json \
  --out /tmp/ts2hx-out \
  --clean
```

This writes `.hx` files that mirror the TS module graph under the selected base package (defaults to `ts2hx` in the fixtures).

## Strict and assisted contracts

`strict-js` is the default. If a source file or top-level statement is known not
to be preservable, ts2hx returns exit `1`, emits a source-positioned `TS2HX-*`
diagnostic, and leaves the existing output directory unchanged—even with
`--clean`.

This is an honest failure boundary, not yet a losslessness proof. Exit `0`
means the current emitter did not identify an unsupported construct; semantic
approximations still require the differential tests and future semantic IR
described below.

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.json \
  --out ./src-generated \
  --clean \
  --diagnostics-json ./ts2hx-result.json
```

`assisted` mode is for inventory and scaffolding. It writes explicit loss
markers and `ts2hx-manifest.json`, then exits `3` so automation cannot mistake a
partial scaffold for a lossless conversion:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.json \
  --out ./src-generated \
  --clean \
  --mode assisted
```

Use `--allow-loss` only for automation that intentionally inventories or stores
assisted output; it maps exit `3` to `0` without changing the manifest status.

Exit codes:

- `0`: no detected unsupported construct, or explicitly allowed assisted loss
- `1`: unsupported or semantically lossy input in strict mode
- `2`: CLI, project configuration, or internal tool failure
- `3`: assisted output was written with one or more recorded losses

## Standalone workflow (TS/JS → Haxe-for-JS)

Use this when you want to migrate a TS/JS codebase into Haxe, but you still intend to run on JS.

1) Run ts2hx to emit Haxe for your TS project
2) Compile the emitted Haxe to JS:
   - either with classic Genes (JS output), or
   - with genes-ts (TypeScript output + a `tsc` step)

The fastest path is usually: **ts2hx → Haxe → classic Genes JS output** while you stabilize semantics.

## Roundtrip workflow (TS → Haxe → TS → JS)

Use this when the end goal is a “pure TS” codebase, and you want a parity harness while you refactor:

1) Run ts2hx to emit Haxe from a TS project
2) Compile that Haxe back to TypeScript via genes-ts (`-D genes.ts`)
3) Typecheck and run the resulting TS via `tsc` + Node

This repo includes a roundtrip harness (`tools/ts2hx/src/test-roundtrip.ts`) that
automates this for selected fixtures. It is differential evidence for the
features exercised by those fixtures, not a whole-program parity certificate.
Their top-level `index.ts` entry calls are acknowledged assisted losses; the
harness invokes the translated Haxe `Main` directly.

## Non-relative imports (npm / node:* / react)

ts2hx supports non-relative imports by generating small **extern modules** under:

- `<basePackage>.extern.*`

This is enough to compile Haxe-for-JS with `@:jsRequire(...)`.

Important limitation:
- Haxe JS output for `@:jsRequire(...)` uses `require()`.
- The `tools/ts2hx` package is ESM (`type: "module"`).
- Therefore, fixtures that require non-relative imports are **compile-smoked** but not `node`-executed in snapshot tests.

Other important limitations are recorded in each run manifest. Known semantic
risk areas include omitted/default arguments versus explicit `null`, JavaScript
truthiness/coercion, uninitialized values, loop `continue` lowering, switch
fallthrough, `this`/prototype behavior, exception/finally ordering, module
merging, and async scheduling. Do not infer support from syntax-only output.

## Testing

Run all ts2hx tests:

```bash
yarn --cwd tools/ts2hx test
```

Update snapshots:

```bash
UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test:snapshots
```

Run the repo-wide CI-equivalent gate (includes ts2hx):

```bash
yarn test:ci
```
