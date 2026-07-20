# Exact enum-abstract projections

This repro protects closed Haxe string domains as they cross a generic host
boundary. The host returns a zero-runtime tuple view, while Haxe application
code exposes an exact enum-abstract value and replacement callback.

The TypeScript profile must emit the tuple and callbacks with the same literal
union, then use already-exact values directly. A redundant `as` expression is
not harmless output polish: it hides whether genes-ts actually retained the
source type at the expression boundary. The existing basic snapshot's lowered
array-loop control separately proves that genuinely widened mutable strings
still receive the assertion needed to satisfy strict TypeScript.

The classic profile runs the same Haxe source against a tiny global host and
proves that the metadata and TypeScript-only reasoning add no wrapper, helper,
or changed JavaScript behavior.

Run the focused proof with:

```sh
node tests/genes-ts/repros/exact-enum-abstract-projections/check.mjs
```
