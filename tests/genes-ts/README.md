# genes-ts test harness

This directory contains **compiler blackbox tests** for the **genes-ts** TypeScript output mode.

## Snapshot tests (golden output)

Most output stability tests live under `tests/genes-ts/snapshot/` and follow an **intended vs out** layout:

- `tests/genes-ts/snapshot/<case>/src/` — Haxe input sources (the “program under test”)
- `tests/genes-ts/snapshot/<case>/intended/` — committed “golden” TypeScript output
- `tests/genes-ts/snapshot/<case>/out/` — generated output from the last test run (gitignored)

Update snapshots:

```bash
UPDATE_SNAPSHOTS=1 yarn test:genes-ts:snapshots
```

### React variants

`tests/genes-ts/snapshot/react/` keeps four TypeScript variants side-by-side:

- `out/tsx` vs `intended/tsx` — idiomatic `.tsx` output
- `out/tsx-jsx-source` vs `intended/tsx-jsx-source` — TSX with an explicit imported JSX type namespace
- `out/tsx-classic` vs `intended/tsx-classic` — TSX source compiled with TypeScript's classic React JSX runtime
- `out/ts` vs `intended/ts` — low-level `.ts` output (no TSX)

The same directory also owns `DualJsxMain.hx`, which is compiled from one Haxe
source to TSX and classic Genes ESM. The React gate compares rendered runtime
transcripts and verifies that disabling a required JSX runtime fails before
emitting files.

### todoapp output

The `examples/todoapp` example checks in its own intended generated output next to the example:

- `examples/todoapp/web/dist-ts/src-gen`
- `examples/todoapp/server/dist-ts/src-gen`

The build (`yarn build:example:todoapp`) regenerates `examples/todoapp/{web,server}/src-gen` and compares it against the committed `dist-ts/src-gen`.

## Full suite (runtime + TS typecheck)

`tests/genes-ts/full/` compiles the main `tests/` (classic Genes test corpus) through genes-ts and then:

- runs `tsc` (strict) over the generated TypeScript
- executes the compiled JS test runner with Node

This is intentionally larger/noisier than the snapshot cases and focuses on compatibility.

## Package-shape interop

`tests/genes-ts/package-shapes/` owns small, local npm packages whose declaration
and runtime module shapes must agree. The current blocking fixture models a
CommonJS `export =` constructor represented as a `const` plus merged namespace.
It proves `@:ts.instanceType` field and return surfaces under strict NodeNext on
TS 5/6/7, negative consumer typing, and identical TS/classic runtime behavior.

Run it directly with:

```bash
yarn test:interop:module-shapes
```

Keep these fixtures package-generic. Downstream package failures should be
reduced to the relevant ESM/CommonJS/type-value/subpath construct here rather
than introducing product or dependency names into the compiler.
