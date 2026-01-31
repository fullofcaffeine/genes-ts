# genes-ts — compiler contract (Haxe 4.3.7)

This document locks the **user-facing contract** for **genes-ts**, a Haxe→TypeScript compiler built on the Genes-style JS platform pipeline.

This document specifically describes the **TypeScript source output mode** (enabled with `-D genes.ts`). The same library also supports **classic Genes JS output** when `-D genes.ts` is not set (see `readme.md`).

## Goals

- Emit **idiomatic TypeScript** (both code style and project/module structure).
- Be **semantically faithful** to Haxe→JS on Haxe 4.3.7.
- Type-check under a **strict-by-default** TS configuration, while providing pragmatic escape hatches.
- Support two runtime profiles:
  - **Default:** Haxe runtime compatibility (reflection-friendly).
  - **Opt-in:** minimal runtime / “TS-first” mode (less Haxe runtime surface).
- Provide optional authoring sugar for modern JS/TS patterns (e.g. `@:async` + `await(...)`).

## Non-goals (for 1.0)

- Haxe 5 `--custom-target`. Haxe 4.3.7 first.
- Guaranteed Haxe→TS→JS sourcemap composition. (We will ship Haxe→TS maps early; composition is a later milestone.)

## How users invoke the compiler (Haxe 4.3.7)

This target runs under the Haxe **JS platform** and is enabled via a define.

Note: the haxelib name is **genes-ts** (used via `-lib genes-ts`), but the Haxe package namespace remains `genes.*`.

Minimal invocation:

```hxml
-lib genes-ts
-cp src
--main my.app.Main

# IMPORTANT: still uses -js because we compile on the JS platform.
# The output filename defines the output directory and the “main module” name.
-js src-gen/index.ts

# Enable TS emission
-D genes.ts
```

To emit TSX (so JSX markers print real TSX markup), use a `.tsx` output:

```hxml
-js src-gen/index.tsx
-D genes.ts
```

## Output layout

- Output directory is derived from the `-js <path>` argument.
  - Example: `-js src-gen/index.ts` causes files to be written under `src-gen/`.
- Output is **file-per-module** (like Genes today), using ESM.
- Entry module is the basename of the `-js` output file (e.g. `index`).

## Recommended directory conventions (TS output)

genes-ts only cares about the `-js <path>` you pass it, but we recommend a consistent
directory layout to avoid confusion when mixing TS compilation, bundling, and runtime artifacts:

- **`src-gen/`** (recommended default)
  - “Generated source” output from genes-ts (`.ts` / `.tsx`).
  - Consider this an intermediate source tree that is meant to be typechecked/bundled by TS tooling.
  - Typically gitignored.
- **`dist/`**
  - “Built artifacts” produced by TypeScript (and optionally bundlers): `.js`, `.d.ts`, `.map`, assets, etc.
  - Typically gitignored (unless you publish built artifacts).
- **`dist-ts/`** (optional, best used for examples / porting / audit trails)
  - A *checked-in* copy of the generated TS output (usually `dist-ts/src-gen/**`).
  - This is helpful when you want the repo to contain a stable, browsable “what genes-ts emits” tree
    (e.g. to demonstrate the app structure, or to make later TS-only porting easier).
  - This is **not** a good default output directory for day-to-day builds because “dist” implies runtime artifacts.

Example patterns:

1) Normal build (recommended):

```hxml
-js src-gen/index.tsx   # genes-ts output
```

Then TS/bundler produces:
- `dist/**` (runtime)

2) “Canonical generated TS tree” (opt-in):

```hxml
-js dist-ts/src-gen/index.tsx
```

Then TS/bundler still produces:
- `dist/**` (runtime)

## Packaging strategy (do both)

We support two consumption modes:

1) **TS source output (primary artifact)**
   - The compiler emits TS to `src-gen/` (or equivalent).
   - This is the readable “source of truth” for diffs, debugging, and review.

2) **Compiled npm distribution (recommended for publishing)**
   - A standard build step compiles `src-gen/` into `dist/`:
     - `dist/**/*.js` for runtime
     - `dist/**/*.d.ts` for types
     - optional `dist/**/*.map`

Recommended TypeScript build settings for packaging:
- `declaration: true`
- `outDir: dist`
- `rootDir: src-gen`

## Module resolution + import specifier policy (do both)

### Default: explicit `.js` import specifiers (recommended)

Generated TS imports will use `.js` specifiers, e.g.:

```ts
import { Foo } from "./foo/Foo.js";
```

This is intended to work well with:
- `moduleResolution: "NodeNext"`
- ESM runtime in Node after compilation (Node requires extensions)

### Opt-in: extensionless imports (bundler-first)

Users can opt into extensionless imports, e.g.:

```ts
import { Foo } from "./foo/Foo";
```

This is intended for bundler workflows and TS `moduleResolution: "Bundler"`.

## TS strictness

- **Default:** `strict: true`
- Still configurable by the consuming project or by future compiler “profiles”.

## `Dynamic` mapping

- **Default:** `Dynamic -> any` (pragmatic, closest to Haxe intent, avoids huge friction).
- **Opt-in:** `Dynamic -> unknown` (forces narrowing/casts):
  - `-D genes.ts.dynamic_unknown`

## Enum abstracts

When the valid values are known, `enum abstract` types are emitted as **TS
literal unions** to avoid “stringly” APIs.

Example:
- `js.html.RequestCache` → `"default" | "no-store" | ..."`

## Runtime profiles

### Default profile: Haxe runtime compatibility

Goal: preserve compatibility with Haxe JS runtime expectations and reflection-ish APIs.

Examples of things this mode may emit:
- class/enum registries (e.g. `$hxClasses`, `$hxEnums`)
- `__name__` and other identity helpers
- Genes `Register` helper usage where required for semantics (cycles, binds, etc.)

### Opt-in profile: minimal runtime / no reflection

Goal: allow users who don’t need portability/reflection to get output closer to “handwritten TS”.

In this mode we will *avoid* (where practical):
- global registries / reflection helpers
- extra identity fields that only exist for Haxe reflection

Current behavior (implemented):
- The compiler does **not** populate `$hxClasses` / `$hxEnums` registries.
  - This means `Type.resolveClass("...")` / `Type.resolveEnum("...")` return `null`.
  - Other Haxe runtime metadata is still emitted for now to preserve core stdlib behavior.

Tradeoff: some Haxe reflection APIs may not work or may become partial.

## Defines

Enable the target:
- `-D genes.ts` — emit TypeScript instead of JS

Import mode:
- `-D genes.ts.no_extension` — emit extensionless import specifiers (bundler-first). Default is `.js` specifiers.
- `-D genes.ts.no_null_union` — erase `Null<T>` unions (recommended with `strictNullChecks: false`).

Type strictness knobs:
- `-D genes.ts.dynamic_unknown` — map `Dynamic` to `unknown` instead of `any`.

Runtime profile:
- `-D genes.ts.minimal_runtime` — opt into minimal runtime / no-reflection output.
  - See `docs/typescript-target/MINIMAL_RUNTIME.md` for the current contract.

JSX/TSX:
- `-D genes.ts.jsx_classic` — when emitting `.tsx`, also emit `import * as React from "react"` so the output compiles under TypeScript `jsx: "react"` (classic runtime). Default expects `jsx: "react-jsx"`.

Async/await sugar:
- `@:async` + `await(...)` are available via `genes.js.Async` (see `ASYNC_AWAIT.md`).

## Metadata

TS-specific overrides:
- `@:ts.type("...")` — override a type in emitted TS types (fields/typedefs/type params/etc.).
- `@:ts.returnType("...")` — override a function return type in emitted TS.

Compatibility aliases (optional):
- `@:genes.type` and `@:genes.returnType` are supported as aliases for the TS metadata above.

## Recommended `tsconfig` baselines

See the example configs in `examples/typescript-target/`.
