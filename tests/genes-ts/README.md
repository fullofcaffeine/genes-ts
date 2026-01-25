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

`tests/genes-ts/snapshot/react/` keeps three variants side-by-side:

- `out/tsx` vs `intended/tsx` — idiomatic `.tsx` output
- `out/tsx-classic` vs `intended/tsx-classic` — TSX lowered to classic `React.createElement`
- `out/ts` vs `intended/ts` — low-level `.ts` output (no TSX)

## Full suite (runtime + TS typecheck)

`tests/genes-ts/full/` compiles the main `tests/` (classic Genes test corpus) through genes-ts and then:

- runs `tsc` (strict) over the generated TypeScript
- executes the compiled JS test runner with Node

This is intentionally larger/noisier than the snapshot cases and focuses on compatibility.

