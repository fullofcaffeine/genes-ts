# Explicit generic-call arguments

This fixture proves a framework-neutral TypeScript interop boundary where Haxe
and TypeScript would otherwise infer the same generic call differently.

`@:ts.explicitTypeArguments` is intentionally opt-in. The positive program
shows a nullable value and an exact no-argument `undefined` result; a neighboring
ordinary extern call proves TypeScript inference remains the default.

Haxe erases some source types before generic call emission. The positive enum
abstract therefore uses `genes.ts.TypeArguments.call(genericCall, witness)`. The
witness is checked at compile time and never evaluated; it preserves the closed
`"pending" | "ready"` argument on the original direct call. TypeScript then
infers the local from that call, avoiding a redundant `Cell<string>` annotation
that would discard the preserved contract. This lower-level helper is intended
for typed library macros and reduced interop seams, not ordinary generic calls.
The fixture also reassigns a wider mutable local. That local retains its Haxe
annotation so TypeScript does not freeze the initializer's narrower type and
reject a later assignment that Haxe already accepted.
One test-only library macro duplicates the same call template and proves that
equivalent witnesses remain valid at a shared generated source span. A second
macro uses different witnesses at that same span. Both compile correctly
because the exact typed occurrences—not their copied positions—own the facts.
The compiler never lets source-map provenance or emission order decide which
type wins.

A second library macro returns a fluent expression whose inner `makeCell` call
uses the witness and whose outer `seal()` call is ordinary. Haxe assigns both
typed callees the macro invocation's source span, then can relocate the inner
call to the macro definition. A source-span registry cannot distinguish those
values and an ordinary static registry disappears when a compilation server
reuses the typed tree in another macro context. `TypeArguments.call` therefore
adds a typed compiler-internal identity carrier around the reviewed occurrence.
Its inert typed-null facts preserve the witness without evaluating the authored
expression, and the resolved extern declaration must still match. Both emitters
remove the carrier and facts, so only `makeCell` receives
`<"pending" | "ready">`, while `seal()` remains non-generic. An unused reviewed
call proves that erasure does not remove runtime evaluation.
The positive fixture also nests an ordinary call to the same extern field
inside a reviewed call. The occurrence-local witness is consumed exactly once,
so the outer call receives the saved witness while the nested call receives
only the type argument that Haxe derived for that nested expression itself.
This mechanism applies to any fluent interop API; it does not recognize package
or framework names.

The positive program covers both package externs and an ordinary emitted Haxe
generic function. The negative programs pin malformed declaration annotations,
non-generic declarations, unmarked or aliased call-site targets, wrong witness
arity, unresolved witnesses, and non-call input to one source-positioned
diagnostic family.

Both genes-ts and classic Genes compile the same Haxe program. Only TypeScript
source contains the explicit `<...>` syntax; classic JavaScript retains the
ordinary calls and runtime evaluation order. No `TypeArguments` value or helper
exists at runtime.
