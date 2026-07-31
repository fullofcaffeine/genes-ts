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

The fixture also covers three cross-module facts that are easy to miss:

- a foreign direct function is locally aliased when its exported name matches
  an ordinary module-level field in the importing Haxe file;
- explicit matching `@:expose` metadata on a genuine module-level function
  re-exports that exact function from the compilation root; and
- when any reachable Haxe code activates `js.Lib.global`, an otherwise
  helper-free direct-function module retains `genes.Register` because its
  generated `$global` prelude reads `Register.$global`.

These checks use the generated TypeScript, TSX, and classic JavaScript shape
plus classic runtime identity. They prove that dependency names and public
exports are decided before printing rather than repaired by scanning generated
text.

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

The focused suite also builds `TopLevelExposed.hx` without a `--main` entry
point. That case protects library publishing: `@:expose("exposedTopLevel")`
must create the root `index` re-export even when no application entry point
would otherwise keep that root module alive. The harness executes the classic
root export and checks both classic and TypeScript declarations, so a fixture
`Main` cannot accidentally hide a missing library export.

That fixture deliberately gives the Haxe function a different authored name.
The generated implementation, owner declaration, and root declaration must all
agree on the validated `exposedTopLevel` binding; otherwise a package can ship
a root `.d.ts` re-export for a symbol its owner declaration never defined.

`ModuleInit.hx` covers a different hidden part of Haxe's typed module shape.
Haxe stores a module-level `__init__` body on the compiler-created owner rather
than among its visible fields. Genes may omit an all-direct owner only when
that hidden initializer is absent. The fixture checks its side effect in both
generated source profiles and at classic runtime.

`DependencyOrderConsumer.hx` makes import ordering observable. Its first call
argument reads an ordinary module value and its second calls a direct module
function; both dependency modules append to shared state during initialization.
The generated imports and runtime transcript must say `ordinary,direct`.
Planning all direct functions in an earlier pre-scan would incorrectly reverse
that order even though the Haxe expression evaluates the ordinary argument
first.

The repository's blocking `yarn test:ci` command runs this focused owner
directly. Keep that connection when reorganizing aggregate test scripts: the
general compiler suites do not independently reproduce every diagnostic,
descriptor, and source-map boundary checked here.

See [`docs/MODULE_FUNCTIONS.md`](../../docs/MODULE_FUNCTIONS.md) for the public
contract, positive and negative examples, and intentionally deferred shapes.
