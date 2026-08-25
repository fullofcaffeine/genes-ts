# Lexical binding-use plan

This fixture proves the target-neutral authority used before Genes allocates a
compiler-created lexical name. It inventories exact imported/direct roots,
profile-specific host globals, checked casts, direct module bindings, nested
dynamic-import callback locals, lexical scope depth, and authored raw-syntax
barriers. A negative lane removes one constructor registration and requires the
emitter assertion to fail before replacing a sentinel output file.

The inventory define is test-only. Ordinary compiler builds do not request the
plan until a real synthetic-name consumer needs it.

Run the focused gate with:

```bash
yarn test:lexical-binding-use-plan
```

The gate builds TypeScript and classic JavaScript from the same Haxe source.
It compares clean and inventory builds byte for byte. It also checks the
generated files and runs all supported TypeScript compiler lanes.

The four-level fixture contains 29 expressions and 6 scopes. The eight-level
fixture contains 49 expressions and 10 scopes. These fixed counts prove one
bounded module walk. They do not provide a wall-clock performance threshold.
