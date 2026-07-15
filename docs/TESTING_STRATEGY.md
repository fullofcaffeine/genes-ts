# Testing strategy (genes-ts)

genes-ts has two major things to keep reliable:
1) the **compiler** (classic Genes JS mode and `-D genes.ts` mode)
2) the **fullstack todoapp example** (a realistic devx + tooling integration gate)

This repo follows the **testing trophy**:
- **Lots of fast deterministic tests** (snapshots + typecheck)
- **Some runtime integration tests** (Node execution)
- **A small number of E2E tests** (Playwright) for the example app

## Compiler

### 1) Classic Genes JS mode (baseline semantics)

Run:

```bash
npm test
```

This compiles `tests/*.hx` using classic Genes JS output and runs the suite under Node.

### 2) TypeScript output mode (`-D genes.ts`)

Run:

```bash
npm run test:genes-ts
npm run test:genes-ts:minimal
npm run test:genes-ts:full
npm run test:genes-ts:tsx
```

What these cover:
- **TS output snapshots**: lock down deterministic `.ts` output for key fixtures.
- **Strict TS typecheck**: `tsc -p ...` on generated TS/TSX.
- **Runtime smoke**: execute compiled JS under Node.

The authoritative same-source and output-quality layers are separately
available:

```bash
yarn test:dual-output    # semantic TS/classic/standard-Haxe/vanilla evidence
yarn test:output-quality # exact maps, clean hashes, and reviewed budgets
yarn test:interop:module-shapes # npm declaration/runtime import contracts
```

The quality manifest measures the bounded dual corpus. It uses exact module,
temporary, and import baselines plus 5% byte/token ceilings; it is not a
whole-language performance benchmark.

The package-shape gate currently covers a local CommonJS `export =`
constructor whose value/type namespaces differ. It compiles strict negative
consumers on TS 5/6/7 and runs the same Haxe source through TS and classic ESM;
future package forms should extend that generic fixture matrix.

## Todoapp example

### What we test

The todoapp is validated via:
- a **QA sentinel** (build + start server + API smoke + log capture + teardown)
- optional **Playwright E2E** (user journeys in a real browser)

Run:

```bash
npm run test:todoapp          # API smoke only
npm run test:todoapp:e2e      # API smoke + Playwright
```

### Playwright tests authored in Haxe

The Playwright specs live under:
- `examples/todoapp/e2e/src/` (Haxe)

They are compiled via genes-ts:
- Haxe → TS (`-D genes.ts`) into `examples/todoapp/e2e/src-gen/`
- TS → JS via `tsc` into `examples/todoapp/e2e/dist/`

The QA sentinel runs Playwright against `examples/todoapp/e2e/dist/*.spec.js`.

## One command

Run the full acceptance gate locally:

```bash
npm run test:acceptance
```

To mirror the CI split locally (classic tests + acceptance without rerunning classic):

```bash
npm run test:ci
```

Toolchain compatibility is split by responsibility:

```bash
yarn test:matrix:generated  # curated emitted TS/.d.ts on TS5, TS6, and TS7
yarn test:matrix:api        # semantic gates and ts2hx on the TS6 Program API
```

The full CI gate includes the API lane; aggregate generated-output runners own
the three-compiler matrix internally. See `TOOLCHAINS.md` for exact versions,
scope, and the non-blocking Haxe preview job.

## Security scanning

Secrets scanning is part of the standard gates:

```bash
yarn test:secrets
```

This is also executed as part of `yarn test:ci` and in GitHub Actions.

## ts2hx (experimental)

The repository also contains an experimental TS/JS → Haxe transpiler under `tools/ts2hx/`.

It is validated by:
- golden/snapshot tests for deterministic output
- a small JS smoke test by compiling the emitted Haxe with the Haxe JS target

Run:

```bash
yarn --cwd tools/ts2hx test
```

This is also executed as part of `npm run test:acceptance` unless `SKIP_TS2HX=1` is set.
