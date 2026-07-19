# Explicit generic-call arguments

This fixture proves a framework-neutral TypeScript interop boundary where Haxe
and TypeScript would otherwise infer the same generic extern call differently.

`@:ts.explicitTypeArguments` is intentionally opt-in. The positive program
shows a nullable value and an exact no-argument `undefined` result; a neighboring
ordinary extern call proves TypeScript inference remains the default. The
negative programs pin malformed arguments, non-extern use, and non-generic use
to one source-positioned diagnostic family.

Both genes-ts and classic Genes compile the same Haxe program. Only TypeScript
source contains the explicit `<...>` syntax; classic JavaScript retains the
ordinary calls and runtime evaluation order.

