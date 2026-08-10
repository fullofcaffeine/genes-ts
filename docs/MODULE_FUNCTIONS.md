# Analyzer-visible module functions

`@:genes.moduleFunction("name")` is an opt-in compiler capability for a narrow
case: a supported public static Haxe method must remain callable as
`Owner.field(...)`, but an external source analyzer or native consumer needs
the implementation body to be a genuine module-scope function.

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

The Haxe field name may differ when both annotations explicitly choose the same
public binding:

```haxe
@:expose("identity")
@:genes.moduleFunction("identity")
function authoredName<T>(value:T):T {
	return value;
}
```

Both the implementation and declarations export `identity`; the replaced
Haxe-only name `authoredName` does not leak into the JavaScript package.

## Module initialization still runs

A source module may also define `function __init__()`. Haxe stores that hidden
initializer on its compiler-created module owner, outside the visible function
list. Genes keeps the owner in this case so the established initialization
order and side effects remain intact:

```haxe
@:genes.moduleFunction("readReady")
function readReady():Bool {
	return State.ready;
}

function __init__():Void {
	State.ready = true;
}
```

`readReady` is still a genuine module function, but importing its module still
runs `__init__` exactly as ordinary Genes output did.

Direct-function imports also stay at their original typed-expression
occurrence. This matters because ESM dependencies initialize in source order:
if a call reads an ordinary module value before calling a direct function,
Genes preserves that ordinary-before-direct module order instead of grouping
all direct imports at the top of dependency planning.

## Lazy imports stay lazy

When a selected function is used inside `Genes.dynamicImport()`, Genes must not
add an ordinary top-level import for it. A top-level import would load and run
the target module immediately, defeating the purpose of code splitting.

For example, if the lazily loaded `Reports` module exports a selected
`formatReport` function, the callback keeps using the Haxe function normally:

```haxe
Genes.dynamicImport(Reports -> {
	trace(formatReport(Reports.current()));
});
```

Genes reads both exports from the namespace after `import()` resolves:

```ts
import("./Reports.js").then(function (module: unknown) {
  var Reports = (module as typeof import("./Reports.js")).Reports;
  var formatReport =
    (module as typeof import("./Reports.js")).formatReport;
  console.log(formatReport(Reports.current()));
});
```

There is no static `import {formatReport} from "./Reports.js"` above this code.
The callback carrier records the selected function's exact Haxe owner and field,
so an unrelated static field from the same source module still uses its normal
collision-safe import mapping.

Lazy callback names are planned separately from namespace export names. This
matters when two modules export the same declaration name but Haxe imports
them under different aliases:

```haxe
import reports.foo.MyClass as FooClass;
import reports.bar.MyClass as BarClass;

Genes.dynamicImport((FooClass, BarClass) -> {
	trace(new FooClass());
	trace(new BarClass());
});
```

Representative generated setup:

```js
var FooClass = modules[0].MyClass;
var BarClass = modules[1].MyClass;
```

`FooClass` and `BarClass` are the callback-local bindings. `MyClass` is the
export read from each resolved namespace. Genes records both facts with the
exact Haxe declaration identity. If a selected lazy function also requests
`FooClass`, Genes reports `GENES-DYNAMIC-IMPORT-BINDING-COLLISION-002` instead
of overwriting the class binding.

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

The binding is public from its own generated module, not implicitly
re-exported from the compilation-root barrel. Separate Haxe source modules may
therefore export the same conventional name (for example `render`) without a
false global collision; callers receive the ordinary collision-safe ESM import
alias.

Add an explicit matching `@:expose` when the genuine module-level function
must also be published from the compilation root:

```haxe
@:expose("identity")
@:genes.moduleFunction("identity")
function identity<T>(value:T):T {
	return value;
}
```

```ts
// values/Identity.ts
export function identity<T>(value: T): T {
  return value;
}

// compilation root
export {identity} from "./values/Identity.js";
```

The owner-module and root exports are the same function object. The distinction
is intentional: ordinary public Haxe module fields remain local to their own
generated ESM file, while `@:expose` is an explicit request for the package's
root public API.

That root request also works in a library-only build with no `--main`. In Haxe,
`--main` selects an application entry point; a library generator may instead
ask a macro to type only the modules it publishes. For example:

```text
Haxe types values.Identity without an application Main
  -> @:expose requests the public package binding
  -> Genes emits values/Identity and the root index re-export
```

Genes therefore treats the matching `@:expose` and
`@:genes.moduleFunction` pair as independent evidence that the root module must
exist. It does not rely on an application `Main` importing the function:

```ts
// index.ts, even when the Haxe build has no --main
export {identity} from "./values/Identity.js";
```

This matters for package builds because silently omitting `index.ts`,
`index.js`, or `index.d.ts` would leave the owner file on disk but remove the
public import path the author explicitly requested.

## Direct module values use a separate rule

Genes also supports closed module-level data through `@:genes.moduleValue`.
The value rule is separate because a JavaScript `const` initializer runs while
its module loads. A function body runs only after code calls the function.

The value rule accepts constants, nested array or object literals, and exact
references to earlier selected values. It rejects calls and other computed
expressions before output publication.

Read [`MODULE_VALUES.md`](MODULE_VALUES.md) for the complete contract, output
examples, and the reason that later-value reads are unsafe.

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

Dependency planning remains authoritative for code moved to module scope. For
example, extracting an instance method can emit `Register.bind`, and Haxe's
project-wide `js.Lib.global` feature can make a module emit:

```ts
import {Register} from "../genes/Register.js";

const $global = Register.$global;
```

Genes records that helper before import aliases are frozen. It does not wait
for the expression or module printer to discover the dependency.

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
- synchronous or `@:jsAsync` methods;
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
are rejected. Genes also rejects host/global spellings already unavailable to
ordinary generated locals, including `Object` and `undefined`. Declaring a
module function with one of those names would redirect later compiler-generated
uses away from the JavaScript global or absence value they mean. Genes never
sanitizes or suffixes the requested name: analyzer conventions may depend on
that exact spelling.

Genes plans direct functions in two stages. An early request plan validates the
exact typed owner and field, requested binding, public name, function shape,
and relocation safety. Import and local-name allocators consume those fixed
facts. A later final plan checks the completed, unaliasable module namespace.
This split prevents printers and dependency collectors from rediscovering
meaning from a metadata string after names have already been allocated.

Collision validation checks real module types and fields, imports in both projections,
module-scope locals and compiler temporaries, JSON support aliases, private
lowered helpers, other selected functions, and compiler-owned bindings. Members
of a generated value do not reserve unrelated top-level names: for example, an
enum constructor emitted as `State.Ready` does not block a module function
called `Ready`. A collision reports the requested name, owner field, and prior
binding kind at the metadata source position. It does not silently rename an
unrelated import.

Aliasable imports yield to a fixed source-module binding, including when the
requested ESM name differs from the authored Haxe field name:

```haxe
import other.Values.renamedBinding as foreignBinding;

@:expose("renamedBinding")
@:genes.moduleFunction("renamedBinding")
function authoredLocalName():String {
	return "local";
}
```

Representative generated output:

```ts
import {renamedBinding as renamedBinding__1} from "./other/Values.js";

export function renamedBinding(): string {
  return "local";
}
```

Genes renames only the foreign import's local spelling. Both source modules
keep their exact requested export names.

Haxe locals and parameters are also aliasable. JavaScript `let` and `const`
bindings shadow an entire block, even before their declaration, so this Haxe:

```haxe
final before = selected();
final selected = "local";
```

must not become `const before = selected(); const selected = "local";`. The
second declaration would place the local `selected` in JavaScript's temporal
dead zone at the first line. Genes reserves the exact direct binding before
allocating parameters and locals, then renames only the Haxe local:

```ts
const before = selected();
const selected_1 = "local";
```

This decision uses the exact static-field occurrence and exact Haxe `TVar`
identity. It does not inspect generated text or move either expression.

An extern marker fails before dependency or output planning:

```haxe
@:genes.moduleFunction("externalSelected")
extern function externalSelected():String;
```

An extern has no generated body or owner module, so Genes reports
`GENES-MODULE-FUNCTION-OWNER-007`. It never manufactures an internal import to
a file that cannot exist. Ordinary extern functions without this metadata,
including supported `@:jsRequire` fields, retain their existing behavior.

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
