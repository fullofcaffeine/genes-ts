# genes-ts

**genes-ts** is a **Haxe → TypeScript** compiler that runs on the Haxe **JS platform** and emits **split ESM TypeScript source** (`.ts` / `.tsx`).

This repo started as a fork of **Genes** (benmerckx/genes). It intentionally supports **two output modes** (selected by a define) so you can pick the best workflow per project.

Requires **Haxe 4.3.7+**.

## Documentation

- `docs/README.md` — documentation index (start here)
- `docs/typescript-target/COMPILER_CONTRACT.md` — TS target contract
- `docs/typescript-target/TYPING_POLICY.md` — TS typing rules + profiles
- `docs/OUTPUT_MODES.md` — TS output vs classic Genes JS output

## Feature highlights

- **Two output modes** in one library:
  - Haxe → **TypeScript source** (`-D genes.ts`)
  - Haxe → **ESM JavaScript + optional `.d.ts`** (classic Genes mode)
- **Strict-by-default** TS output (typed, idiomatic, ESM)
- **React authoring** from Haxe:
  - TSX output (`.tsx`) or low-level `React.createElement(...)` output (`.ts`)
  - optional inline markup (`return <div>...</div>;`)
- **JS/TS interop helpers** via `genes.ts.Imports` (consume existing TS/TSX easily)
- **Async/await sugar** (`@:async` + `await(...)`) emitting native `async`/`await`
- **SOTA harness**: snapshots + `tsc` typecheck + runtime smoke + full todoapp E2E (Playwright)
- **Secret scanning** in CI + local (`gitleaks`)

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
  - keeping the pipeline small/fast while still emitting strong `.d.ts`

## React TSX authoring (optional)

genes-ts includes a compile-time JSX-ish macro that lowers to React nodes:

```haxe
import genes.react.JSX.*;

return jsx('<div className={"x"}>{title}</div>');
```

TSX vs low-level mode:
- Emit `.tsx` (idiomatic TSX): set your `-js` output to `.../index.tsx`
- Emit `.ts` (low-level): set your `-js` output to `.../index.ts`

Inline markup is opt-in (rewrite `@:markup "<...>"` → `JSX.jsx("<...>")`):
- `-D genes.react.inline_markup`
- `@:jsx_inline_markup` on the class (or `-D genes.react.inline_markup_all`)

Note: React TSX authoring is designed for `-D genes.ts` builds (TypeScript output). Classic Genes JS output does not currently lower JSX markers.

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

Use `genes.ts.Imports` for ergonomic imports that work in both output modes:

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
- `examples/todoapp/` — fullstack todoapp (React Router + Express): `npm run build:example:todoapp`

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
- `-D genes.react.inline_markup` — enable inline markup rewrite (scoped; requires `@:jsx_inline_markup` on classes).
- `-D genes.react.inline_markup_all` — enable inline markup rewrite globally.

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

## Publishing

Build the haxelib package zip:

```bash
yarn submit:zip
```

Submit to haxelib (interactive):

```bash
yarn submit
```
