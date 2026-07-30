# Module-function lowering fixture

This fixture proves the framework-neutral `@:genes.moduleFunction("name")`
compiler capability in classic JavaScript, TypeScript, and TSX output.

It covers both supported ownership shapes: class static methods retain their
existing `Owner.field` identity through a descriptor seed, while genuine Haxe
module-level functions emit and import as direct ESM functions without a
synthetic `_Fields_` class or registration machinery.

Dependency planning is tested at the same boundary. A direct function that
extracts an instance method still imports `genes.Register`, because the
generated body uses `Register.bind` to preserve the receiver. A mixed source
module containing one selected function and one ordinary value gives callers
two imports: the direct function binding and the compiler-synthetic owner that
still stores the ordinary value. These controls prevent direct lowering from
dropping runtime support that remains necessary elsewhere in the same typed
expression or module.

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

It also proves that `@:genes.moduleValue` fails explicitly with
`GENES-MODULE-VALUE-DEFERRED-001` in both output profiles. Direct values are a
different initialization problem: an ESM `const` initializer runs while the
module loads and can throw when it reaches a later uninitialized binding.
Keeping that negative case here prevents the bounded function feature from
silently growing into a call/effect analyzer.

Run the focused evidence with:

```sh
yarn test:module-functions
```

The repository's blocking `yarn test:ci` command runs this focused owner
directly. Keep that connection when reorganizing aggregate test scripts: the
general compiler suites do not independently reproduce every diagnostic,
descriptor, and source-map boundary checked here.

See [`docs/MODULE_FUNCTIONS.md`](../../docs/MODULE_FUNCTIONS.md) for the public
contract, positive and negative examples, and intentionally deferred shapes.
