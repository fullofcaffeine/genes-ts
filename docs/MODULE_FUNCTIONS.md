# Analyzer-visible module functions

`@:genes.moduleFunction("name")` is an opt-in compiler capability for a narrow
case: a supported public static Haxe method must remain callable as
`Owner.field(...)`, but an external source analyzer or native consumer needs
the implementation body to be a genuine module-scope function.

This is an output-shape capability, not a React or framework feature. A linter,
optimizer, instrumentation tool, code indexer, or host convention can attach
meaning to an ordinary named function without requiring Genes to understand
that convention.

For immutable Haxe module-level data that must become a direct ESM `const`, see
[`MODULE_VALUES.md`](MODULE_VALUES.md). Functions and values share the same
collision-safe module binding namespace and synthetic-owner omission rules.

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

## Publishing the genuine function

Add `@:expose` with the same exact name when native ESM consumers need the
module function itself:

```haxe
class Values {
	@:expose("identity")
	@:genes.moduleFunction("identity")
	public static function identity<T>(value:T):T {
		return value;
	}
}
```

Genes emits one function value, exports it from its owner module, and
re-exports it from the compilation root:

```ts
export function identity<T>(value: T): T {
  return value;
}

export class Values {
  static identity<T>(value: T): T;
  static identity(): never {
    throw this;
  }
}

Values.identity = identity;
```

```ts
// compilation root
export {identity} from "./Values.js";
```

`Values.identity`, the owner-module binding, and the root binding are the exact
same function object. TypeScript output carries the direct generic signature.
Classic JavaScript emits `export declare const identity: typeof
Values.identity`, so its `.d.ts` derives the same closed generic contract
without duplicating it.

`@:expose` is also a generation root once Haxe has typed the source module. A
library function does not need an unrelated Haxe runtime call merely to keep
its owner file in the generated package: Genes retains the owner module and
the compilation-root re-export in both output profiles. Library builds still
have to load the package in the normal Haxe way, for example:

```hxml
--macro include("my.library")
```

That command makes Haxe discover the source modules. `@:expose` then tells
Genes which selected function is part of the native ESM API.

The two metadata names must match. This v1 constraint keeps the local binding,
public name, stack name, analyzer identity, and declaration surface aligned.
`@:expose` with no argument uses the Haxe field name. A class-member
`@:expose` without `@:genes.moduleFunction` retains its existing Genes/Haxe
behavior; it does not synthesize a wrapper or make an ES class property into a
top-level ESM binding. Haxe module-field exports retain their existing
behavior.

This is intentionally framework-neutral. Genes owns genuine module functions,
stable ESM bindings, root re-exports, declarations, source maps, DCE, and
runtime identity. A host framework remains responsible for any convention
module, directive, public path, or server/client policy it builds on top.

## Genuine Haxe module-level functions

When the Haxe declaration is already a module-level function, Genes does not
manufacture a class compatibility surface:

The annotation is still explicit in this release because Haxe presents a
file-level function to custom JavaScript generators as a static field on a
compiler-generated module-fields class. Replacing that established backing
owner with a direct ESM function changes observable details such as
`Function.name`, `prototype`, constructability, `toString()` text, reflection,
and initialization. `@:genes.moduleFunction("name")` records that the author
accepts this representation change and supplies the exact ESM binding name.
Class-owned static methods will continue to require that opt-in. A separate
compatibility migration may make proven-safe genuine file-level functions
direct by default; see the project roadmap rather than assuming this metadata
will always be necessary.

```haxe
package values;

@:genes.moduleFunction("identity")
function identity<T>(value:T):T {
  return value;
}
```

TypeScript output:

```ts
export function identity<T>(value: T): T {
  return value;
}
```

Classic JavaScript output:

```js
export function identity(value) {
  return value;
}
```

Another Haxe module imports and calls the same source function normally:

```haxe
import values.Identity.identity;

final result = identity("typed");
```

Genes projects that call as a direct named ESM import. If the source module
contains only selected module functions, its compiler-synthetic `_Fields_`
class, descriptor seeds, assignments, and registration import are omitted.
This is the preferred shape for APIs that are conceptually JavaScript or
TypeScript modules rather than runtime classes.

Omitting registration does not remove runtime helpers used by the function
body. For example, a typed method closure still emits `Register.bind`, so Genes
retains the Register import for that expression while continuing to omit the
synthetic owner. Dependency planning treats helper reachability and class
registration as separate facts.

That rule also covers helpers introduced only by a selected output language.
For example, Haxe accepts a relational comparison on `Null<Int>` with
JavaScript coercion semantics, while strict TypeScript needs Genes'
`Register.unsafeCast<number>` identity assertion around the nullable operand.
The TypeScript profile plans that runtime dependency before emission; classic
JavaScript keeps the direct operator and does not import an unused helper.
The same separation covers an assignment whose field has an authored
`@:ts.type`/`@:genes.type` projection and a generic enum constructor receiving
literal `null`: TypeScript needs an identity assertion to preserve the target
field contract or prevent overly narrow generic inference, while classic
JavaScript still emits the original assignment or call.

Haxe may also make a runtime helper necessary at module scope rather than in a
field body. When any retained code activates `js.Lib.global`, both
implementation profiles emit a `$global = Register.$global` prologue in every
runtime module. Dependency planning reads that compiler feature directly, so a
direct-only module still imports `Register` even when none of its own typed
expressions mentions `$global`.

The compiler-created owner is omitted only when it truly has no work left.
Haxe stores a module-level `__init__()` body separately from the visible field
list. If that initializer exists, Genes keeps the owner and emits its side
effects after installing the direct functions. Native consumers still receive
the direct ESM binding; only the otherwise invisible initialization carrier
remains.

The binding is public from its own generated module, not implicitly
re-exported from the compilation-root barrel. Separate Haxe source modules may
therefore export the same conventional name (for example `render`) without a
false global collision; callers receive the ordinary collision-safe ESM import
alias.

### Async module functions

Genes' typed async authoring composes with the same direct module shape:

```haxe
import genes.js.Async.await;
import js.lib.Promise;

@:async
@:genes.moduleFunction("loadCount")
function loadCount(value:Int):Promise<Int> {
	final resolved = await(Promise.resolve(value));
	return resolved + 1;
}
```

TypeScript output remains one ordinary typed native function:

```ts
export async function loadCount(
  value: number
): globalThis.Promise<number> {
  const resolved: number = await globalThis.Promise.resolve(value);
  return resolved + 1;
}
```

Classic output keeps the same runtime semantics without TypeScript types:

```js
export async function loadCount(value) {
  const resolved = await Promise.resolve(value)
  return resolved + 1
}
```

`@:async` and `await(...)` are Genes language/tooling features, not a scheduler
or Promise replacement. The async transform records the typed `:jsAsync`
function fact; module-function validation then admits only its exact
`await {0}` target template and still recursively checks the operand. The same
template in a non-async method, any other raw target template, or an awaited
operand containing a class-lexical escape still fails before publication.

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

A private selected function is not exported and its module-function metadata is
not a DCE root. `@:expose` is an explicit public root. Without it, if Haxe
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

The supported shape accepts:

- either a concrete, non-extern, non-interface `KNormal` class without class
  type parameters or Haxe's synthetic owner for genuine module-level fields;
- one retained public static `MethNormal` method with a typed function body;
- method-local type parameters and constraints;
- ordinary, optional/default, and rest arguments;
- synchronous, `@:jsAsync`, or Genes-authored `@:async` methods;
- simple ASCII `@:native` class-property spellings;
- private static helper calls and Haxe local statics, which Haxe 4.3.7 has
  already lowered to ordinary owner-field access before Genes plans output;
- recursion that remains a typed `Owner.field(...)` access.

The compiler fails closed for instance, inline, dynamic, abstract, bodyless,
extern, interface, abstract-implementation, overloaded, or generic-owner
shapes. It also rejects opaque `js.Syntax`/legacy `__js__` bodies:
raw target text could conceal `this`, `super`, or `new.target`, so the compiler
cannot prove that changing lexical location is safe. The only admitted
`js.Syntax` calls are an exact, arity-checked set of compiler-library
identity/undefined templates (`undefined`, `{0}`, `{0} ?? null`, and
`({0}) === undefined`), the exact `await {0}` template under an already typed
native-async owner, the exact `{0}.findIndex({1})` template owned by
`genes.js.ArrayCallbacks.findIndex`, plus `construct` with a resolved Haxe type
expression. The latter is required by Haxe's typed JavaScript `Array.map`
implementation, which allocates its result as
`js.Syntax.construct(Array, length)`. Every admitted argument remains part of
the ordinary typed traversal, while non-async await, string-named constructors,
and arbitrary templates remain opaque. The focused runtime and rollback suite
covers both admitted and rejected boundaries.
Similar-looking or newly introduced raw templates still fail closed until they
receive an explicit generalized proof.

## Exact names and collisions

The metadata argument must be one nonempty direct string literal using:

```text
[A-Za-z_$][A-Za-z0-9_$]*
```

Reserved ES-module bindings such as `class`, `await`, `arguments`, and `eval`
are rejected. Genes also rejects host/global spellings already unavailable to
ordinary generated locals, including `Object` and `undefined`. Declaring a
module function with one of those names would redirect later compiler-generated
uses away from the JavaScript global or absence value they mean. Genes never
sanitizes or suffixes the requested name: analyzer conventions may depend on
that exact spelling.

Collision validation runs after import aliases and local-name plans are known.
It checks real module types and fields, imports in both projections,
module-scope locals and compiler temporaries, JSON support aliases, private
lowered helpers, other selected functions, and compiler-owned bindings. Members
of a generated value do not reserve unrelated top-level names: for example, an
enum constructor emitted as `State.Ready` does not block a module function
called `Ready`. A collision reports the requested name, owner field, and prior
binding kind at the metadata source position. It does not silently rename an
unrelated import.

Public member exports apply the same identifier policy to `@:expose`. They also
participate in the compilation-root export inventory, so a collision with an
exposed type, module field, or another public function fails before any output
is published.

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
ESM behavior, inspects private and public exact identity, generic inference,
root re-exports, descriptors, own-key order, registration, initialization,
inheritance, and cyclic-module behavior, verifies DCE, declarations and source
maps, and exercises exact diagnostics plus transactional rollback across the
supported profiles.

The complete compiler gate remains:

```sh
yarn test:ci
```

That blocking gate runs `yarn test:module-functions` directly. A pull request or
release therefore cannot pass merely because unrelated compiler suites remain
green while this opt-in lowering regresses.
