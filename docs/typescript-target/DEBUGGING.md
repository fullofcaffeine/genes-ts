# Debugging genes-ts output

## What you can debug today (v1 scope)

genes-ts emits **TypeScript source** as its primary artifact. The recommended debugging flow today is:

1) Debug the **compiled JS**, but with **TS sources** via `tsc` source maps (JS → TS).
2) Optionally emit **Haxe → TS** source maps so you can correlate generated TS back to `.hx` during investigation.

Note: Automatic JS → TS → Haxe source-map *composition* is not guaranteed in v1 (tracked separately).

## Node debugging (TS sources)

1) Build the example:

```bash
npm run build:example:genes-ts
```

2) Run Node with source maps enabled:

```bash
node --enable-source-maps examples/typescript-target/dist/index.js
```

3) For an interactive debugger session:

```bash
node --inspect-brk --enable-source-maps examples/typescript-target/dist/index.js
```

This uses `tsc`’s `.js.map` files to let you step through the generated `.ts` in `examples/typescript-target/src-gen/`.

## Emitting Haxe → TS maps

genes-ts emits **Haxe → TS** maps when building with `-debug` (or `-D js_source_map`).

Example:

```hxml
-debug
-D genes.ts
-js src-gen/index.ts
```

This produces `src-gen/**/*.ts.map` files that map generated TS positions back to `.hx` positions.

## Current limitation: map composition

You will generally debug **TS**, not original **Haxe**, because the runtime executes JS compiled by `tsc`:
- `tsc` provides JS → TS maps.
- genes-ts provides Haxe → TS maps.

Some tooling can chain maps manually, but an official composition step (JS → Haxe) is tracked as a future milestone.

