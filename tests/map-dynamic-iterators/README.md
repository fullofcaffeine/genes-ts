# Dynamic Map iterators

This focused fixture proves that Genes Map values retain `iterator()` and
`keyValueIterator()` when application code views them through `Dynamic`.

The same Haxe program creates String-, Int-, and object-keyed maps. It crosses
one explicit dynamic boundary for each map, immediately narrows the returned
iterators, and prints a manually reviewed key/value transcript. Classic Genes
JavaScript and generated TypeScript must produce the same transcript.

The generated-source checks also compile a typed-only control. Ordinary typed
`Map.keyValueIterator()` calls must keep Haxe's inline lowering, and classic
output must not retain a callable facade method unless the typed program uses
the `dynamic_read.keyValueIterator` feature.

Standard Haxe 4.3.7 JavaScript is not a runtime differential for this case. Its
StringMap also omits the method and crashes, although the pinned official Haxe
Map specification requires the dynamic call. The independent oracle here is
that reviewed specification plus the explicit insertion-order transcript.

Run:

```bash
yarn test:map-dynamic-iterators
```
