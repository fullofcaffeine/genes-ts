# genes-ts

**genes-ts** is a **Haxe → TypeScript** compiler that runs on the Haxe **JS platform** and emits **split ESM TypeScript source** (`.ts` / `.tsx`).

This repo started as a fork of **Genes** (benmerckx/genes). It still supports Genes’ JS output mode, but the v1 focus is the **TypeScript source target** enabled via `-D genes.ts`.

Requires **Haxe 4.3.7+**.

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

See `docs/typescript-target/COMPILER_CONTRACT.md` and `examples/typescript-target/`.

## React TSX authoring (optional)

genes-ts includes a compile-time JSX-ish macro that lowers to React nodes:

```haxe
import genes.react.JSX.*;

return jsx('<div className={"x"}>{title}</div>');
```

Inline markup is opt-in (rewrite `@:markup "<...>"` → `JSX.jsx("<...>")`):
- `-D genes.react.inline_markup`
- `@:jsx_inline_markup` on the class (or `-D genes.react.inline_markup_all`)

## Defines (genes-ts)

- `-D genes.ts` — emit TypeScript instead of JS.
- `-D genes.ts.no_extension` — emit extensionless import specifiers (bundler-first). Default is explicit `.js` specifiers.
- `-D genes.ts.minimal_runtime` — opt into minimal runtime / no-reflection output.
- `-D genes.ts.jsx_classic` — when emitting `.tsx`, also emit `import * as React from "react"` so the output compiles under TypeScript `jsx: "react"` (classic runtime). Default expects `jsx: "react-jsx"`.

## Development

- `npm test` (Genes baseline tests)
- `npm run test:genes-ts`
- `npm run test:genes-ts:minimal`
- `npm run test:genes-ts:full`
- `npm run test:genes-ts:tsx`
- `npm run test:genes-ts:snapshots` (or `UPDATE_SNAPSHOTS=1 npm run test:genes-ts:snapshots`)
- `npm run test:genes-ts:sourcemaps`
