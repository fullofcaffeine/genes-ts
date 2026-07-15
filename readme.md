# genes-ts

**genes-ts** is a general-purpose **Haxe → TypeScript / JavaScript** compiler
that runs on the Haxe **JS platform**. It emits either split ESM TypeScript
source (`.ts` / `.tsx`) or classic Genes ESM JavaScript from the same library.

This repo started as a fork of **Genes** (benmerckx/genes). It intentionally supports **two output modes** (selected by a define) so you can pick the best workflow per project.

The blocking toolchain currently pins **Haxe 4.3.7**. Newer Haxe compatibility
is established by explicit matrix lanes rather than assumed from the version
number; that matrix is tracked by `genes-09r.4`.

The compiler is production-capable for controlled, tested project profiles.
Its classic JavaScript runtime path is the more mature surface; TypeScript
implementation output, classic declarations, npm package shapes, and
same-source dual-output behavior have explicit compatibility gates and a
remaining roadmap. See `docs/ARCHITECTURE_ROADMAP.md` for the precise readiness
boundary and planned shared architecture.

## Documentation

- `docs/README.md` — documentation index (start here)
- `docs/typescript-target/COMPILER_CONTRACT.md` — TS target contract
- `docs/typescript-target/TYPING_POLICY.md` — TS typing rules + profiles
- `docs/TROUBLESHOOTING.md` — common failure modes + fixes
- `docs/OUTPUT_MODES.md` — TS output vs classic Genes JS output
- `docs/ARCHITECTURE_ROADMAP.md` — readiness boundary and shared TS/JS architecture roadmap
- `docs/ts2hx/USAGE.md` — ts2hx workflows (TS/JS → Haxe) + roundtrip harness
- `CONTRIBUTING.md` — contribution guidelines

## Feature highlights

- **Two output modes** in one library:
  - Haxe → **TypeScript source** (`-D genes.ts`)
  - Haxe → **ESM JavaScript + optional `.d.ts`** (classic Genes mode)
- **Strict TS builds** for the supported fixtures, with closed generated interfaces and negative consumer checks
- **Target-polymorphic helper types** such as `genes.ts.Undefinable<T>` and `genes.ts.Unknown`: rich TypeScript in TS mode and paired runtime behavior in classic JS for the exercised helpers
- **React authoring** from Haxe:
  - TSX output (`.tsx`) or low-level `React.createElement(...)` output (`.ts`)
  - inline markup (`return <div>...</div>;`), default-on in TypeScript mode
- **JS/TS interop helpers** via `genes.ts.Imports` (consume existing TS/TSX easily)
- **Async/await sugar** (`@:async` + `await(...)`) emitting native `async`/`await`
- **Layered harness**: snapshots, strict `tsc`, negative type consumers, runtime smoke, classic JS assertions, and todoapp E2E (Playwright)
- **ts2hx experiment**: fail-closed TS/JS → Haxe subset migration plus explicitly lossy assisted scaffolding
- **Secret scanning** in CI + local (`gitleaks`)
- **Dependency vulnerability scanning** in CI + local (`osv-scanner`)

## Install

With lix:

```bash
lix +lib genes-ts
```

## Basic usage (Haxe → TS)

```hxml
-lib genes-ts
-cp src
--main my.app.Main

# Still uses -js because we compile on the JS platform.
-js src-gen/index.ts

# Enable TS emission
-D genes.ts
```

Then compile TypeScript to JS (Node ESM example):

```bash
tsc -p tsconfig.json
node --enable-source-maps dist/index.js
```

See:
- `docs/typescript-target/COMPILER_CONTRACT.md`
- `examples/typescript-target/`

## Output modes

### 1) TypeScript source output (genes-ts mode)

Enable with `-D genes.ts`.

- Output: `src-gen/**/*.ts` (or `.tsx` if your `-js` output ends with `.tsx`)
- Requires a TS build step (`tsc` / bundler) to produce runnable JS
- Best for:
  - migrating a Haxe codebase to “pure TS”
  - deep TS ecosystem interop (React, modern ESM tooling, etc.)
  - reviewing/debugging generated output as readable TS

### 2) Classic Genes JS output (ESM + optional `.d.ts`)

Default when `-D genes.ts` is **not** set.

```hxml
-lib genes-ts
-cp src
--main my.app.Main

-js dist/index.js
-D dts
```

- Output: `dist/**/*.js` (plus `dist/**/*.d.ts` when `-D dts` is set)
- No TS compiler required (useful when TS compilation is a net negative)
- Best for:
  - Haxe-first projects that want modern split ESM output
  - keeping the runtime pipeline small and fast

Classic `.d.ts` generation now preserves `Null<T>` precisely and has a strict
external-consumer gate. Treat declarations as a bounded, improving surface
until the semantic exported-type audit in `genes-09r.1` covers inferred and
imported unsafety as well as literal `any` tokens.

## Target-polymorphic helpers

Some JavaScript and TypeScript APIs distinguish shapes that plain Haxe does not model directly. For example, TypeScript often uses `T | undefined`, while Haxe normally reaches for `Null<T>`.

The recommended authoring style for JS/TS ecosystem projects is **TS-minded Haxe**: write clear Haxe first, but model real TypeScript/JavaScript boundary contracts precisely when they matter. Use Haxe typedefs, enums, abstracts, externs, and small `genes.ts` helpers instead of broad `Dynamic` or raw emitted TypeScript strings.

Examples of these helpers:

- `genes.ts.Undefinable<T>` for APIs where absence is JavaScript `undefined`, not `null`.
- `genes.ts.Unknown` for untrusted runtime values that should be decoded or narrowed before application code uses them.
- `genes.ts.UnknownNarrow`, `UnknownRecord`, and `UnknownArray` for guarded reads from untrusted JavaScript values.
- `genes.ts.Imports` for typed imports from existing JS/TS/TSX modules without hand-writing fragile import strings at every call site.

They are useful when the JavaScript/TypeScript ecosystem has a real contract that Haxe does not express directly. The helper gives that contract a Haxe name, keeps the unsafety or TS-specific syntax in one maintained place, and lets the compiler choose the right output for each target.

genes-ts handles this with small Haxe helper abstractions instead of asking you to write raw TypeScript strings everywhere.

`Undefinable<T>` means “a `T`, or JavaScript `undefined`.” It exists because many JS/TS APIs use `undefined` to mean “not provided,” while Haxe `Null<T>` naturally maps to `null`. Keeping that distinction matters for strict TypeScript APIs, optional object fields, DOM/Node/npm externs, and config/env maps where `null` and `undefined` are different contracts.

```haxe
import genes.ts.Undefinable;

typedef ProcessEnv = haxe.DynamicAccess<Undefinable<String>>;

final missing = Undefinable.absent();
```

In TypeScript output, `Undefinable<String>` can print as `string | undefined`. In classic Genes JS output, the type annotation disappears but `Undefinable.absent()` still emits the runtime JavaScript value `undefined`.

`Unknown` means “this value crossed a runtime boundary and has not been
validated yet.” It intentionally does not let application code use the value
directly. Use `UnknownNarrow` for the first guarded step, then copy validated
data into normal Haxe records, arrays, maps, enums, or abstracts:

```haxe
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;

function decodeName(raw:Unknown):Null<String> {
  final record = UnknownNarrow.record(raw);
  if (record == null)
    return null;

  return UnknownNarrow.string(record.get("name"));
}
```

In TypeScript output, `UnknownRecord` is a read-only
`Readonly<Record<string, unknown>>` view and `UnknownArray` is a
`readonly unknown[]` view. In classic Genes JS output, those type annotations
erase while the same runtime checks (`typeof`, `Array.isArray`,
`Object.keys`, and own-property reads) remain executable ES6. This is useful
for `JSON.parse`, `fetch().json()`, plugin payloads, host callbacks, caught JS
values, and other places where the runtime value is real but not yet trusted.

This is useful because one Haxe source is designed to target both workflows:

- **TypeScript mode** keeps a precise, idiomatic TS surface for the exercised contracts.
- **Classic JS mode** erases TS-only annotations while preserving the paired helpers' tested ES6 runtime behavior.

That means you can write Haxe with TypeScript in mind, compile to rich
TypeScript for review and ecosystem interop, or compile to plain ES6 when
performance, build simplicity, or runtime constraints make that preferable.
The authoritative `yarn test:dual-output` corpus now proves the checked runtime,
declaration, resource, DCE, import, reflection, and source-map-shape contracts
across TS, classic, standard Haxe JS, and a vanilla-compatible core. General
equivalence—especially JSX and constructs outside that corpus—remains
experimental.

ES6 support is not a lowest-common-denominator mode. TypeScript output should stay precise and readable; portability is implemented through maintainable compiler architecture and target-specific emitters.

## React TSX authoring

genes-ts includes a compile-time JSX-ish macro that lowers to React nodes:

```haxe
import genes.react.JSX.*;

return jsx('<div className={"x"}>{title}</div>');
```

TSX vs low-level mode:
- Emit `.tsx` (idiomatic TSX): set your `-js` output to `.../index.tsx`
- Emit `.ts` (low-level): set your `-js` output to `.../index.ts`

Inline markup rewriting is default-on in `-D genes.ts` builds. Disable it for a
build with `-D genes.react.no_inline_markup`, or for one class with
`@:jsx_no_inline_markup`. Outside TypeScript mode, `@:jsx_inline_markup`,
`-D genes.react.inline_markup`, and `-D genes.react.inline_markup_all` are
explicit opt-ins to the parser rewrite only.

React JSX lowering is currently a TypeScript-output capability. Classic Genes
JS output does not lower the resulting JSX markers, so JSX-bearing source is
not yet part of the honest same-source dual-output subset. `genes-09r.5` tracks
a target-neutral JSX intent and explicit classic capability policy.

See `docs/typescript-target/REACT_HXX.md`.

## Async/await sugar (optional)

genes-ts includes an `@:async` + `await(...)` macro that emits native `async`/`await`:

```haxe
import genes.js.Async.await;
import js.lib.Promise;

@:async
function plusOne(x: Int): Promise<Int> {
  final v = await(Promise.resolve(x));
  return v + 1;
}
```

See `docs/typescript-target/ASYNC_AWAIT.md`.

## Importing existing JS/TS/TSX

Use `genes.ts.Imports` for ergonomic imports whose supported forms have paired
TS/classic lowering:

```haxe
import genes.ts.Imports;

final Path = Imports.namespaceImport("node:path");
final Button = Imports.defaultImport("./components/Button.js");
```

See `docs/typescript-target/IMPORTS.md`.

## Typing + strictness

- Typing goals and escape-hatch rules: `docs/typescript-target/TYPING_POLICY.md`
- Nullability profiles:
  - Default: `strictNullChecks: true` (recommended for TS migration)
  - Optional: `strictNullChecks: false` + `-D genes.ts.no_null_union`
- Runtime profile:
  - Default: reflection-friendly
  - Opt-in: `-D genes.ts.minimal_runtime` (reduces reflection surface)

## Debugging + source maps

See `docs/typescript-target/DEBUGGING.md`.

## Examples

- `examples/typescript-target/` — TS output contract + examples
- `examples/todoapp/` — fullstack todoapp (React Router + Express): `npm run example:todoapp`

## ts2hx (TS/JS → Haxe, experimental)

ts2hx is an experimental TS/JS → Haxe subset translator and migration
scaffolder. Strict mode fails closed for constructs the translator knows it
cannot preserve; assisted mode records explicit losses. Exit success is not a
blanket semantic-equivalence certificate.

Workflows:
- **Standalone**: supported TS/JS subset → Haxe-for-JS → JS (classic Genes) or TS (genes-ts)
- **Roundtrip**: selected TS → Haxe → TS (genes-ts) → JS (tsc) differential harness

Docs:
- `docs/ts2hx/USAGE.md`

Tests:

```bash
yarn --cwd tools/ts2hx test
```

## Security (secret scanning)

This repo includes a local + CI secret scan using **gitleaks** (pinned).

```bash
yarn test:secrets
```

See `docs/SECURITY.md`.

## Defines (genes-ts)

- `-D genes.ts` — emit TypeScript instead of JS.
- `-D genes.ts.no_extension` — emit extensionless import specifiers (bundler-first). Default is explicit `.js` specifiers.
- `-D genes.ts.no_null_union` — erase `Null<T>` → `T | null` unions in TS output (recommended when compiling with `strictNullChecks: false`).
- `-D genes.ts.dynamic_unknown` — map `Dynamic` to `unknown` instead of `any` (opt-in stricter interop).
- `-D genes.ts.minimal_runtime` — opt into minimal runtime / no-reflection output.
- `-D genes.ts.jsx_classic` — when emitting `.tsx`, also emit `import * as React from "react"` so the output compiles under TypeScript `jsx: "react"` (classic runtime). Default expects `jsx: "react-jsx"`.

React/markup:
- `-D genes.react.no_inline_markup` — disable the default inline-markup rewrite.
- `@:jsx_no_inline_markup` — disable inline markup for one class.
- `-D genes.react.inline_markup` / `@:jsx_inline_markup` — opt in outside `-D genes.ts`.
- `-D genes.react.inline_markup_all` — force-enable inline markup globally.

Classic Genes mode (JS output) also supports:
- `-D dts` — emit `.d.ts` alongside the generated `.js`.
- `-D genes.no_extension` — extensionless import specifiers for JS output.

## Development

- `npm test` (Genes baseline tests)
- `npm run test:acceptance` (compiler + todoapp acceptance gate)
- `npm run test:ci` (CI-equivalent local run; includes secret scan)
- `npm run test:genes-ts`
- `npm run test:genes-ts:minimal`
- `npm run test:genes-ts:full`
- `npm run test:genes-ts:tsx`
- `npm run test:genes-ts:snapshots` (or `UPDATE_SNAPSHOTS=1 npm run test:genes-ts:snapshots`)
- `npm run test:genes-ts:sourcemaps`
- `npm run test:todoapp` (todoapp API smoke)
- `npm run test:todoapp:e2e` (todoapp API + Playwright E2E; Playwright specs are authored in Haxe)

Snapshot fixtures live under `tests/genes-ts/snapshot/` (each case has `src/`, `intended/`, and `out/`).

## Generated output directories (recommended)

genes-ts writes output wherever you point `-js <path>`. Recommended conventions:

- `src-gen/` — generated TypeScript source (`.ts` / `.tsx`) from genes-ts (usually gitignored).
- `dist/` — compiled/bundled runtime artifacts (JS + `.d.ts` + assets).
- `dist-ts/` — optional *checked-in* copy of the generated TS source (best for examples/audits, not daily builds).

## Publishing

Build the haxelib package zip:

```bash
yarn submit:zip
```

Submit to haxelib (interactive):

```bash
yarn submit
```
