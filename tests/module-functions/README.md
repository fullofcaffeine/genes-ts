# Direct module-binding fixture

This fixture proves the framework-neutral `@:genes.moduleFunction("name")`
and `@:genes.moduleValue("name")` compiler capabilities in classic JavaScript,
TypeScript, and TSX output.

It covers both supported ownership shapes: class static methods retain their
existing `Owner.field` identity through a descriptor seed, while genuine Haxe
module-level functions emit and import as direct ESM functions without a
synthetic `_Fields_` class or registration machinery.

Selected immutable module-level values emit as direct typed ESM `const`
bindings. The fixture pairs a value with a selected function on one synthetic
owner, imports same-named values from two source modules through collision-safe
aliases, verifies exact declaration and source-map output, and proves that the
metadata itself does not create a DCE root. It also covers owner-only exports,
same-module local shadowing (including source names that match generated
suffixes), collision-safe foreign imports around local direct exports,
expression-owned and TypeScript-only Register helpers, and the typed native
`findIndex` helper. Mutable, class-owned, mixed-owner, cyclic, direct and
immediately-invoked forward-reading, malformed, and renamed shapes fail before
transactional publication.

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

The repository's blocking `yarn test:ci` command runs this focused owner
directly. Keep that connection when reorganizing aggregate test scripts: the
general compiler suites do not independently reproduce every diagnostic,
descriptor, and source-map boundary checked here.

See [`docs/MODULE_FUNCTIONS.md`](../../docs/MODULE_FUNCTIONS.md) and
[`docs/MODULE_VALUES.md`](../../docs/MODULE_VALUES.md) for the public
contracts, exact Haxe/TypeScript/JavaScript examples, negative controls, and
intentionally deferred shapes.
