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

Update snapshots:

```bash
UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test
```
