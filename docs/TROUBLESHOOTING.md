# Troubleshooting (genes-ts)

This page covers the most common “first week” issues when using genes-ts.

## “It emitted `.ts`, but Node can’t run it”

genes-ts emits **TypeScript source** when `-D genes.ts` is enabled. You still need
to compile it with `tsc` (or a bundler) before running.

Recommended layout:
- `src-gen/**` — genes-ts output (TS source)
- `dist/**` — `tsc` output (JS runtime)

See `docs/typescript-target/COMPILER_CONTRACT.md`.

## “Cannot find module `./Foo.js`” (or runtime import errors)

By default, genes-ts emits explicit `.js` import specifiers in generated TS for
Node ESM compatibility.

Make sure your `tsconfig.json` uses NodeNext resolution, e.g.:
- `module: "NodeNext"`
- `moduleResolution: "NodeNext"`

If you are in a bundler-first project and want extensionless imports instead,
compile with:
- `-D genes.ts.no_extension`

See `docs/typescript-target/IMPORTS.md`.

## “My TS output has `T | null` everywhere” (nullability mismatch)

genes-ts supports two common profiles:

- **TS-strict (default)**: `strictNullChecks: true` → `Null<T>` becomes `T | null`
- **Haxe-null-tolerant**: `strictNullChecks: false`
  - recommended to pair with `-D genes.ts.no_null_union`

See `docs/typescript-target/TYPING_POLICY.md`.

## “`Type.resolveClass(...)` stopped working”

If you enabled:
- `-D genes.ts.minimal_runtime`

then genes-ts will not automatically register user-defined types into `$hxClasses`
and `$hxEnums`, which is what Haxe’s string-based reflection helpers depend on.

Fix:
- disable `genes.ts.minimal_runtime`, or
- avoid string-based reflection and use direct references.

See `docs/typescript-target/MINIMAL_RUNTIME.md`.

## “React output doesn’t typecheck / compiles with the wrong JSX runtime”

genes-ts can emit `.tsx` or low-level `.ts` React output depending on your output
file extension:
- `.tsx` output: `-js .../index.tsx`
- low-level `.ts` output (uses `React.createElement(...)`): `-js .../index.ts`

TypeScript config matters:
- default expectation is `jsx: "react-jsx"` (React 17+ automatic runtime)
- if you need classic runtime (`jsx: "react"`), compile with:
  - `-D genes.ts.jsx_classic`

See `docs/typescript-target/REACT_HXX.md`.

## “TypeScript says `@ts-expect-error` is unused in snapshots”

This usually means the generated TS became “too loose” (e.g. an `any` leaked) and
TypeScript no longer produces the expected error.

This is intentional: unused `@ts-expect-error` directives are a regression signal.

See `docs/typescript-target/REACT_HXX.md` (“Typechecking behavior”).

## “Haxe DCE removed something my TS code imports”

Haxe dead-code elimination does not “see” imports from TS-authored modules.

If a symbol is only referenced from TS, it may be removed from generated output.

Fix:
- reference it from Haxe once, or
- mark it `@:keep`.

The todoapp interop harness demonstrates the pattern.

See `docs/typescript-target/IMPORTS.md` (“TS importing Haxe-generated modules”).

## “Debugging shows generated TS, not my `.hx`”

At runtime you execute JS produced by `tsc`, so the debugger typically uses:
- JS → TS source maps (from `tsc`)

genes-ts also emits Haxe → TS maps when using `-debug`, but composing maps into
JS → Haxe is not guaranteed in v1.

See `docs/typescript-target/DEBUGGING.md`.
