# Explicit generic-call arguments

This fixture proves a framework-neutral TypeScript interop boundary where Haxe
and TypeScript would otherwise infer the same generic extern call differently.

`@:ts.explicitTypeArguments` is intentionally opt-in. The positive program
shows a nullable value and an exact no-argument `undefined` result; a neighboring
ordinary extern call proves TypeScript inference remains the default.

Haxe erases some source types before generic call emission. The positive enum
abstract therefore uses `genes.ts.TypeArguments.call(externCall, witness)`. The
witness is checked at compile time and never evaluated; it preserves the closed
`"pending" | "ready"` argument on the original direct call. TypeScript then
infers the local from that call, avoiding a redundant `Cell<string>` annotation
that would discard the preserved contract. This lower-level helper is intended
for typed library macros and reduced interop seams, not ordinary generic calls.
The fixture also reassigns a wider mutable local. That local retains its Haxe
annotation so TypeScript does not freeze the initializer's narrower type and
reject a later assignment that Haxe already accepted.
One test-only library macro duplicates the same call template and proves that
equivalent witnesses remain valid at a shared generated source span. A negative
macro uses conflicting witnesses at one span and must fail deterministically;
the compiler never lets emission order decide which type wins.

The negative programs pin malformed declaration annotations, non-extern and
non-generic declarations, unmarked or aliased call-site targets, wrong witness
arity, unresolved witnesses, and non-call input to one source-positioned
diagnostic family.

Both genes-ts and classic Genes compile the same Haxe program. Only TypeScript
source contains the explicit `<...>` syntax; classic JavaScript retains the
ordinary calls and runtime evaluation order. No `TypeArguments` value or helper
exists at runtime.
