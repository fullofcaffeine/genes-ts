# ts2hx (experimental)

ts2hx is an **experimental inventory and migration-scaffolding tool** for
TypeScript/JavaScript → Haxe. It is not a lossless source-to-source compiler and
its output is not production-ready merely because the generated Haxe compiles.

- Plan: `docs/ts2hx/PLAN.md`
- Usage: `docs/ts2hx/USAGE.md`
- Future portability: `docs/ts2hx/PORTABILITY.md`
- Status: strict failure contract plus a bounded supported subset; not production-ready

## What is it for?

ts2hx is useful when you want **Haxe as a migration layer**:

- **TS/JS → Haxe-for-JS** (so you can incrementally refactor in Haxe)
- then optionally:
  - **Haxe → TypeScript** via genes-ts (to finish a “pure TS” port), or
  - **Haxe → other targets** later after the codebase is made more portable

Use it to inventory a migration, translate the subset it can prove, and identify
the remaining source with stable diagnostics. Do not use it as a general-purpose
“compile TS to every language” compiler.

## Translation modes

- `strict-js` (default) requires every input file and top-level statement to
  receive an explicit disposition. A construct the current emitter identifies
  as unsupported exits `1`, writes no partial output, and preserves the prior
  output tree.
- `assisted` emits reviewable partial scaffolding. Every omitted statement has a
  `TS2HX-*` marker and `ts2hx-manifest.json` records the loss. The command exits
  `3`, or `0` only when `--allow-loss` is explicit.

`strict-portable` is a future contract, not a current CLI mode. Current output
may depend on the Haxe JS target and genes runtime helpers.

Important: exit `0` currently means “no detected unsupported construct,” not
proven semantic equivalence. Some supported-looking lowerings still approximate
JavaScript behavior; the risk categories below and in `docs/ts2hx/USAGE.md`
remain subject to differential tests and the planned semantic IR.

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

For an intentionally partial scaffold:

```bash
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/unsupported-top-level/tsconfig.json \
  --out /tmp/ts2hx-assisted \
  --clean \
  --mode assisted
```

Exit codes are `0` for no detected translation loss, `1` for unsupported/lossy translation,
`2` for CLI/configuration/internal failure, and `3` for assisted output with
recorded losses. `--diagnostics-json <file>` writes the same deterministic
manifest even when strict mode refuses to touch the output directory.

Tests (snapshots, Haxe JS smoke, differential roundtrips, and strict failure/transaction checks):

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

Roundtrip harness (TS → Haxe → TS → JS differential smoke):

```bash
yarn --cwd tools/ts2hx test:roundtrip
```

What `test:roundtrip` does for selected supported modules:

1) builds and runs the original fixture via `tsc` + `node`,
2) emits Haxe via ts2hx,
3) compiles back to TypeScript via genes-ts (`-D genes.ts`),
4) enforces a typing guardrail (no `any`/`unknown` in the roundtripped user modules),
5) typechecks and runs the roundtripped output via `tsc` + `node`.

The five fixture `index.ts` files contain top-level `main()` calls that Haxe
cannot represent as module initialization today. They are deliberately emitted
in assisted mode, snapshotted with loss markers/manifests, and excluded from the
semantic claim; the harness invokes the translated Haxe `Main` directly. A
roundtrip pass therefore proves only the exercised, supported feature subset.

See `docs/ts2hx/USAGE.md` for more detailed workflows and how to apply this to a real codebase.
