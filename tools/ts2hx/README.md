# ts2hx (experimental)

ts2hx is a **post-1.0 experiment**: a TS/JS → Haxe transpiler intended as a migration tool.

- Plan: `docs/ts2hx/PLAN.md`
- Status: minimal working spike (fixtures + snapshots), not production-ready

Run:

```bash
node node_modules/typescript/bin/tsc -p tools/ts2hx/tsconfig.json
node tools/ts2hx/dist/cli.js --help
```

Quick try (emit Haxe):

```bash
node tools/ts2hx/dist/cli.js --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json --out /tmp/ts2hx-out --clean
```

Tests (snapshots + Haxe JS smoke):

```bash
yarn --cwd tools/ts2hx test
```

Current fixtures:
- `fixtures/roundtrip-fixture/` (baseline parity)
- `fixtures/roundtrip-advanced/` (more “real-world TS” surface: object literals, arrow fns, optional chaining, string-literal unions)
- `fixtures/module-syntax/` (default exports, namespace imports, and re-exports)
- `fixtures/type-literals/` (type aliases to object literals + optional fields)

Update snapshots:

```bash
UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test:snapshots
```

Roundtrip harness (TS → Haxe → TS → JS parity):

```bash
yarn --cwd tools/ts2hx test:roundtrip
```

What `test:roundtrip` does for `fixtures/roundtrip-fixture`:

1) builds and runs the original fixture via `tsc` + `node`,
2) emits Haxe via ts2hx,
3) compiles back to TypeScript via genes-ts (`-D genes.ts`),
4) enforces a typing guardrail (no `any`/`unknown` in the roundtripped user modules),
5) typechecks and runs the roundtripped output via `tsc` + `node`.
