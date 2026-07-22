# Analyzer-visible module functions

`@:genes.moduleFunction("name")` is an opt-in compiler capability for a narrow
case: a supported public static Haxe method must remain callable as
`Owner.field(...)`, but an external source analyzer needs the implementation
body to be a genuine module-scope function.

This is an output-shape capability, not a React or framework feature. A linter,
optimizer, instrumentation tool, code indexer, or host convention can attach
meaning to an ordinary named function without requiring Genes to understand
that convention.

## Why it exists

Genes ordinarily emits a static Haxe method as an ES class method:

```haxe
class CounterHooks {
	public static function useCounter(initial:Int):Counter {
		return useState(initial);
	}
}
```

```ts
export class CounterHooks {
  static useCounter(initial: number): Counter {
    return useState(initial);
  }
}
```

That preserves Haxe's class shape, but a source analyzer may classify the body
only from its JavaScript/TypeScript syntax. For example, a rule that permits a
special call only inside module functions cannot inspect the same body as a
valid function when it appears inside a class.

Adding a delegating wrapper does not solve that problem: the analyzer sees an
empty wrapper while the real body remains in the class, and runtime calls gain
another function identity and stack frame.

## Authoring contract

Give one retained public static normal method an exact module binding:

```haxe
class CounterHooks {
	/**
	 * `@:genes.moduleFunction` moves this body to the unexported module function
	 * `useCounter`. `CounterHooks.call` is then assigned that exact function
	 * value; no delegating wrapper is generated.
	 */
	@:genes.moduleFunction("useCounter")
	public static function call(initial:Int):Counter {
		return useState(initial);
	}
}
```

Genes TypeScript output has this structural shape:

```ts
function useCounter(initial: number): Counter {
  return useState(initial);
}

export class CounterHooks {
  static call(initial: number): Counter;

  static call(): never {
    throw this;
  }
}

CounterHooks.call = useCounter;
Register.setHxClass("CounterHooks", CounterHooks);
```

The first class method declaration is a TypeScript overload signature. The
zero-argument implementation is a **descriptor seed**: it creates the same
writable, non-enumerable, configurable class-method property in the same
own-key position as ordinary Genes output. Genes immediately replaces only its
value before registration, static initialization, or the Haxe class initializer
can observe it. The seed does not delegate, and the selected Haxe body appears
only in `useCounter`.

Classic JavaScript uses the same runtime technique without TypeScript's overload
signature:

```js
function useCounter(initial) {
  return useState(initial)
}

export const CounterHooks = class CounterHooks {
  static call() {
    throw this
  }
}

CounterHooks.call = useCounter
Register.hxClasses()["CounterHooks"] = CounterHooks
```

The module function is deliberately private to the generated ESM module.
TypeScript and JavaScript consumers continue to use the existing exported class
field, so the metadata does not broaden the package API or declaration files.

## What remains equivalent

For admitted methods, Genes preserves:

- ordinary calls, return values, thrown values, default/rest evaluation, and
  `async` behavior;
- `Owner.field` extraction and later reassignment;
- recursion through the mutable `Owner.field` property;
- exact identity between the final class property and the module function;
- the class property's writable, non-enumerable, configurable descriptor and
  original own-key position;
- class registration, static initialization, class initialization, DCE,
  dependency planning, declarations, and source provenance;
- the same Haxe method API for other Haxe modules.

The selected function is not exported and metadata is not a DCE root. If Haxe
removes the field, Genes emits no function and reserves no requested name.

## Intentional function-object differences

Opting in changes intrinsic properties that no ordinary module function can
share with an ES class method:

- a synchronous module function is constructable and owns `prototype`;
- `Function.name` is the requested module binding, which may differ from the
  Haxe field or emitted `@:native` property;
- `Function.prototype.toString()` shows module-function syntax.

If code depends on class-method nonconstructability, the original function
name, or exact `toString()` text, do not apply this metadata. A delegating
wrapper could hide those differences only by violating the analyzer-visible
body and exact-identity requirements.

## Supported v1 shape

The first release accepts:

- a concrete, non-extern, non-interface `KNormal` class without class type
  parameters;
- one retained public static `MethNormal` method with a typed function body;
- method-local type parameters and constraints;
- ordinary, optional/default, and rest arguments;
- synchronous or `@:jsAsync` methods;
- simple ASCII `@:native` class-property spellings;
- private static helper calls and Haxe local statics, which Haxe 4.3.7 has
  already lowered to ordinary owner-field access before Genes plans output;
- recursion that remains a typed `Owner.field(...)` access.

The compiler fails closed for instance, inline, dynamic, abstract, bodyless,
extern, interface, abstract-implementation, module-field, overloaded, or
generic-owner shapes. It also rejects opaque `js.Syntax`/legacy `__js__` bodies:
raw target text could conceal `this`, `super`, or `new.target`, so the compiler
cannot prove that changing lexical location is safe. The only admitted
`js.Syntax` calls are an exact, arity-checked set of compiler-library
identity/undefined templates (`undefined`, `{0}`, `{0} ?? null`, and
`({0}) === undefined`) plus `construct` with a resolved Haxe type expression.
The latter is required by Haxe's typed JavaScript `Array.map` implementation,
which allocates its result as `js.Syntax.construct(Array, length)`. Constructor
arguments remain part of the ordinary typed traversal, while string-named
constructors remain opaque. The focused runtime suite covers both boundaries.
Similar-looking or newly introduced raw templates still fail closed until they
receive an explicit generalized proof.

## Exact names and collisions

The metadata argument must be one nonempty direct string literal using:

```text
[A-Za-z_$][A-Za-z0-9_$]*
```

Reserved ES-module bindings such as `class`, `await`, `arguments`, and `eval`
are rejected. Genes never sanitizes or suffixes the requested name: analyzer
conventions may depend on that exact spelling.

Collision validation runs after import aliases and local-name plans are known.
It checks module types and fields, imports in both projections, module-scope
locals and compiler temporaries, JSON support aliases, private lowered helpers,
other selected functions, and compiler-owned bindings. A collision reports the
requested name, owner field, and prior binding kind at the metadata source
position. It does not silently rename an unrelated import.

For example, this fails before publishing output:

```haxe
class Catalog {}

class Hooks {
	@:genes.moduleFunction("Catalog")
	public static function load():Int {
		return 1;
	}
}
```

The diagnostic begins with:

```text
GENES-MODULE-FUNCTION-COLLISION-005
```

The output transaction preserves the last known-good implementation,
declarations, maps, support modules, and manifest on every validation failure.

## Verification

Run the focused contract with:

```sh
yarn test:module-functions
```

The harness compiles deterministic TypeScript, TSX, and classic JavaScript,
checks both typed source profiles with the pinned TS 5/6/7 lanes, runs classic
ESM behavior, inspects exact identity, descriptors, own-key order, registration,
initialization, inheritance, and cyclic-module behavior, verifies DCE,
declarations and source maps, and exercises exact diagnostics plus transactional
rollback across the supported profiles.

The complete compiler gate remains:

```sh
yarn test:ci
```
