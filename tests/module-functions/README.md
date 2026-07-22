# Module-function lowering fixture

This fixture proves the framework-neutral `@:genes.moduleFunction("name")`
compiler capability in classic JavaScript, TypeScript, and TSX output.

The metadata moves one supported public static Haxe method body to an
unexported, genuine ES-module function. Genes leaves a compiler-owned method
descriptor in the original class slot and immediately replaces only its value.
That gives external analyzers the ordinary function syntax they need without a
wrapper call, while `Owner.field` remains the same callable value with the
existing non-enumerable class property and key position.

This is an explicit compatibility tradeoff. A module function is constructable,
owns a `prototype`, reports the requested function name, and has different
`Function.prototype.toString()` text than a class method. The fixture treats
those intrinsic differences as part of the opt-in contract. It verifies calls,
extraction, reassignment-aware recursion, descriptor/order, static and class
initialization, registration, cycles, strict TypeScript/TSX, classic
declarations, DCE/import neutrality, source maps, deterministic output, exact
collision diagnostics, and transaction rollback instead.

Run the focused evidence with:

```sh
yarn test:module-functions
```

See [`docs/MODULE_FUNCTIONS.md`](../../docs/MODULE_FUNCTIONS.md) for the public
contract, positive and negative examples, and intentionally deferred shapes.
