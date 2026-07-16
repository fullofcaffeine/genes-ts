# Opaque `try/finally` completion runner evidence

This fixture proves the small runtime rule needed before ts2hx can carry a
source `return`, `break`, or `continue` through its synthetic callbacks.

`genes.js.FinallyCompletion.run` treats `null` as normal callback completion
and every non-null value as an opaque typed completion. It never interprets
the private enum used by this fixture. The executable cases verify that:

- a normal finalizer preserves a protected result or the exact protected
  object, string, native `Error`, and Haxe exception value;
- a finalizer result or throw overrides the protected outcome;
- return payloads are evaluated before the finalizer and exactly once;
- normal-path and throw-path finalizers execute exactly once;
- `Void` and nullable return payloads need no weak type or fabricated value;
- representative break and continue target records retain their typed data.

`yarn test:finally-completion` compiles the same Haxe with full DCE through
request-free standard Haxe JavaScript, classic Genes, and genes-ts. Generated
TypeScript is checked by the repository's pinned TypeScript 5, 6, and 7 lanes,
an external consumer checks both the classic declaration and genes-ts helper
surface, and all three runtimes must print the same success transcript.

This is runtime infrastructure evidence only. It does not promote ts2hx outer
completion support: callback ownership, static dispatch, lowered `for`
increments, switches, catches, nesting, and source provenance remain separate
planner/emitter stages with their own differentials.
