# Exact enum-abstract projections

This repro protects closed Haxe string domains as they cross a generic host
boundary. The host returns a zero-runtime tuple view, while Haxe application
code exposes an exact enum-abstract value and replacement callback.

The TypeScript profile must emit the tuple and callbacks with the same literal
union, then use already-exact values directly. A redundant `as` expression is
not harmless output polish: it hides whether genes-ts actually retained the
source type at the expression boundary.

Two controls deliberately expose broad `string` in TypeScript: one parameter
and one generic host field. Those values still need a small assertion when
they enter the closed phase slot. They prevent the compiler from confusing a
narrow Haxe authoring type with the broader type it actually printed. The
existing basic snapshot's lowered array-loop control separately proves that a
genuinely widened mutable string keeps the same safeguard.

The classic profile runs the same Haxe source against a tiny global host and
proves that the metadata and TypeScript-only reasoning add no wrapper, helper,
or changed JavaScript behavior. The typed consumer runs on the repository's
TypeScript 5, 6, and 7 compatibility lanes.

Run the focused proof with:

```sh
node tests/genes-ts/repros/exact-enum-abstract-projections/check.mjs
```
