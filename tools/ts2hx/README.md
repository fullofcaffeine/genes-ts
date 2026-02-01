# ts2hx (experimental)

ts2hx is a **post-1.0 experiment**: a TS/JS → Haxe transpiler intended as a migration tool.

- Plan: `docs/ts2hx/PLAN.md`
- Usage: `docs/ts2hx/USAGE.md`
- Status: minimal working spike (fixtures + snapshots), not production-ready

## What is it for?

ts2hx is useful when you want **Haxe as a migration layer**:

- **TS/JS → Haxe-for-JS** (so you can incrementally refactor in Haxe)
- then optionally:
  - **Haxe → TypeScript** via genes-ts (to finish a “pure TS” port), or
  - **Haxe → other targets** later after the codebase is made more portable

Think of it as a *transpiler/migration tool*, not a general-purpose “compile TS to every language” compiler.

## How ts2hx fits with genes-ts

There are two common workflows:

1) **Standalone** (TS/JS → Haxe-for-JS):
   - run ts2hx to emit Haxe
   - compile the emitted Haxe to JS using classic Genes or genes-ts

2) **Roundtrip / parity harness** (TS → Haxe → TS → JS):
   - run ts2hx to emit Haxe
   - compile the emitted Haxe back to TypeScript via **genes-ts** (`-D genes.ts`)
   - typecheck and run via `tsc` + Node to validate migration parity

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
- `fixtures/type-literals/` (type aliases to object literals + optional fields + method signatures)
- `fixtures/non-relative-imports/` (non-relative imports like `react` / `node:*` via generated extern modules)
  - Note: this fixture is **compile-only**. Haxe JS output for `@:jsRequire` uses `require()` which is not runnable in ts2hx’s ESM package context.
- `fixtures/object-methods-spreads/` (object literal method syntax + spread properties)
- `fixtures/export-forms/` (local export lists + default export aliasing)
- `fixtures/statement-coverage/` (while/do-while/switch + break/continue + var-without-init)
- `fixtures/expression-coverage/` (unary ops, ternary, typeof, compound assignments, ++/--)
- `fixtures/type-emission/` (qualified names, unions, function types)

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

See `docs/ts2hx/USAGE.md` for more detailed workflows and how to apply this to a real codebase.
