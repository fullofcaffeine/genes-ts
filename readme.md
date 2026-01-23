# genes-ts

**genes-ts** is a **Haxe → TypeScript** compiler that runs on the Haxe **JS platform** and emits **split ESM TypeScript source** (`.ts` / `.tsx`).

This repo started as a fork of **Genes** (benmerckx/genes). It intentionally supports **two output modes** (selected by a define) so you can pick the best workflow per project.

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

Inline markup is opt-in (rewrite `@:markup "<...>"` → `JSX.jsx("<...>")`):
- `-D genes.react.inline_markup`
- `@:jsx_inline_markup` on the class (or `-D genes.react.inline_markup_all`)

Note: React TSX authoring is designed for `-D genes.ts` builds (TypeScript output). Classic Genes JS output does not currently lower JSX markers.

## Examples

- `examples/typescript-target/` — TS output contract + examples
- `examples/todoapp/` — fullstack todoapp (React Router + Express): `npm run build:example:todoapp`

## Defines (genes-ts)

- `-D genes.ts` — emit TypeScript instead of JS.
- `-D genes.ts.no_extension` — emit extensionless import specifiers (bundler-first). Default is explicit `.js` specifiers.
- `-D genes.ts.minimal_runtime` — opt into minimal runtime / no-reflection output.
- `-D genes.ts.jsx_classic` — when emitting `.tsx`, also emit `import * as React from "react"` so the output compiles under TypeScript `jsx: "react"` (classic runtime). Default expects `jsx: "react-jsx"`.

Classic Genes mode (JS output) also supports:
- `-D dts` — emit `.d.ts` alongside the generated `.js`.
- `-D genes.no_extension` — extensionless import specifiers for JS output.

## Development

- `npm test` (Genes baseline tests)
- `npm run test:genes-ts`
- `npm run test:genes-ts:minimal`
- `npm run test:genes-ts:full`
- `npm run test:genes-ts:tsx`
- `npm run test:genes-ts:snapshots` (or `UPDATE_SNAPSHOTS=1 npm run test:genes-ts:snapshots`)
- `npm run test:genes-ts:sourcemaps`
