# ts2hx Haxe bootstrap canary

This fixture answers one long-term architecture question: can strongly typed
Haxe use TypeScript's real `Program`, `TypeChecker`, AST, and diagnostics without
requiring the Genes generator to build stage 0?

Run it with:

```bash
yarn test:ts2hx-bootstrap
```

The runner compares a direct TypeScript implementation with the same Haxe
source compiled through:

1. standard Haxe JavaScript with `-D genes.disable`;
2. classic Genes ESM JavaScript; and
3. genes-ts, checked by TypeScript 5, 6, and 7 before execution.

All four paths must report the same checker type, valid-file diagnostic count,
invalid-file diagnostic code, and exact source positions. Two clean builds must
also own byte-identical output trees. Timings and byte counts are printed as
report-only evidence; they are not performance budgets.

The generated-TypeScript config uses `types: []` to keep unrelated workspace
ambient packages out of this isolated fixture. It deliberately does not use
`skipLibCheck`, so TypeScript 5, 6, and 7 still check the imported compiler API
declarations and all generated support declarations.

The curated extern deliberately uses no `Dynamic`, `untyped`, casts, or raw
syntax. It demonstrates a feasible interop seam, not a translated ts2hx. The
production translator remains TypeScript-owned, including its semantic planner,
emitter, CLI, source maps, manifests, and transactional output guarantees. See
[`docs/ts2hx/HAXE_BOOTSTRAP_FEASIBILITY.md`](../../docs/ts2hx/HAXE_BOOTSTRAP_FEASIBILITY.md)
for the decision and the conditions on any future experiment.
