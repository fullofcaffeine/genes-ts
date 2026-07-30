# Direct module values

`@:genes.moduleValue("name")` is a framework-neutral output-shape capability
for immutable Haxe module-level values. It emits the selected value as an
ordinary ESM `const` in both Genes output profiles, while Haxe remains the
authoritative typechecker.

Use it when a JavaScript/TypeScript consumer, source analyzer, host convention,
or code reviewer needs the value to exist directly at module scope. Genes does
not attach meaning to the value. React hosts, Gutenberg, Next.js, build tools,
and other consumers can layer their own conventions over the same generic ESM
mechanism.

## Haxe, TypeScript, and JavaScript

This Haxe module declares one closed type, one direct value, and one direct
function:

```haxe
package catalog;

typedef CatalogMetadata = {
	final title:String;
	final tags:Array<String>;
}

@:genes.moduleValue("metadata")
final metadata:CatalogMetadata = {
	title: "Products",
	tags: ["typed", "esm"]
};

@:genes.moduleFunction("identity")
function identity<T>(value:T):T {
	return value;
}
```

With `-D genes.ts`, Genes emits direct typed source:

```ts
export type CatalogMetadata = {
  tags: string[];
  title: string;
};

export function identity<T>(value: T): T {
  return value;
}

export const metadata: CatalogMetadata = {
  "title": "Products",
  "tags": ["typed", "esm"]
};
```

Classic output emits the same runtime module shape without TypeScript syntax:

```js
export function identity(value) {
  return value;
}

export const metadata = {
  "title": "Products",
  "tags": ["typed", "esm"]
};
```

The generated module contains no `_Fields_` class, registration import,
descriptor seed, wrapper, or assignment. Classic `.d.ts` output still exposes
the exact Haxe type:

```ts
export const metadata: CatalogMetadata;
export const identity: <T>(value: T) => T;
```

## Why the annotation is explicit

Ordinary Haxe module fields retain Genes' established synthetic-owner output.
The annotation is an explicit request to change that representation into a
native ESM binding. This keeps output-shape decisions local and reviewable
instead of silently changing every Haxe program.

The string must equal the public Haxe field name. Although that may look
redundant, it gives compiler macros a stable, literal contract and lets Genes
reject accidental renames rather than inventing aliases. The name must be one
non-reserved ASCII ESM identifier.

## Imports and module-local identity

Haxe callers import the source value normally:

```haxe
import catalog.Catalog.metadata;

final title = metadata.title;
```

Genes emits a direct named import:

```ts
import {metadata} from "./Catalog.js";

const title = metadata.title;
```

Separate source modules may each export a value called `metadata`. Genes uses
its normal collision-safe import allocator:

```ts
import {metadata} from "./Catalog.js";
import {metadata as metadata__1} from "./Blog.js";
```

Functions selected with `@:genes.moduleFunction` and values selected with
`@:genes.moduleValue` share one ESM binding namespace. A value cannot hide an
imported type, compiler temporary, selected function, or another local binding.
Same-named imports are safe: Genes reserves local direct exports before import
allocation and gives the foreign binding its normal `__N` alias. Unaliasable
local ESM collisions fail at the Haxe metadata position before output is
published.

Within the owning module, Genes also reserves each direct binding name from
function parameters and locals. Haxe may distinguish a qualified field such as
`Catalog.metadata` from a parameter also called `metadata`; emitted ESM cannot
qualify its own top-level binding. Genes therefore keeps the direct binding
spelling and deterministically renames the local:

```haxe
@:genes.moduleFunction("readTitle")
function readTitle(metadata:String):String {
	return catalog.Catalog.metadata.title + metadata;
}
```

```ts
export function readTitle(metadata_1: string): string {
  return metadata.title + metadata_1;
}
```

The final emitted-name set also owns generated suffixes. If the same function
contains a different source local already called `metadata_1`, Genes assigns a
second deterministic suffix instead of publishing duplicate JavaScript
bindings.

## Supported initial contract

The first released shape deliberately accepts only:

- a genuine Haxe module-level `final`, represented by Haxe's compiler-synthetic
  `KModuleFields` owner;
- one retained initializer and a public static property shape;
- an exact requested name equal to the Haxe field name;
- a non-cyclic module;
- a synthetic owner whose other retained fields are also selected direct
  module functions or direct module values; and
- no module-level `__init__()` body still attached to that owner.

Named classes, enums, abstracts, and typedefs in the same `.hx` file are
separate owners and remain supported. The “all retained fields” rule applies
only to the compiler-synthetic owner for top-level functions and values.

The narrow rule protects initializer order. Genes can remove the synthetic
owner only when no ordinary top-level initializer or method still depends on
its class-shaped lifecycle. A cyclic value remains on the established deferred
static path rather than being changed into an ESM temporal-dead-zone failure.
Move ordinary helpers to another Haxe module or opt eligible top-level
functions into `@:genes.moduleFunction`. A hidden module `__init__` is not a
retained field, so Genes checks Haxe's separate `ClassType.init` fact as well
and keeps the owner when that body still has initialization side effects.

A direct initializer also cannot read a later direct value from the same Haxe
module:

```haxe
@:genes.moduleValue("first")
final first = second;

@:genes.moduleValue("second")
final second = 2;
```

Haxe can represent that dependency through its synthetic static owner, but
native ESM would emit `const first = second` while `second` is still in its
temporal dead zone. Genes rejects the source with
`GENES-MODULE-VALUE-FORWARD-015`. Reorder the values or defer the read inside a
function that is called only after module initialization. Merely wrapping the
read in a function is not enough when the initializer calls that function
immediately:

```haxe
@:genes.moduleValue("first")
final first = {
	final read = () -> second;
	read(); // still runs before `second` is initialized
};

@:genes.moduleValue("second")
final second = 2;
```

Control flow, not source visitation order, decides which reassigned callback
can run:

```haxe
@:genes.moduleValue("first")
final first = {
	var read = () -> 0;
	if (Date.now().getTime() > 0) {
		read = () -> second;
	} else {
		read = () -> 0;
	}
	read(); // either exact callback can reach this call
};

@:genes.moduleValue("second")
final second = 2;
```

Genes carries the union of exact callback bodies across `if`, short-circuit
boolean, `switch`, `try`/`catch`, and loop joins. A loop body may execute zero
times, and a catch is an alternative to a normal try exit; neither construct
may erase a callback merely because a safer assignment appears later in the
typed tree.

The same rule applies when an initializer directly calls an exact method or
constructor emitted into the same generated ES module:

```haxe
class Helper {
	public static function readSecond():Int {
		return second;
	}
}

@:genes.moduleValue("first")
final first = Helper.readSecond(); // executes the method now

@:genes.moduleValue("second")
final second = 2;
```

Genes follows the compiler-owned method/constructor field identity, never a
printed class or function name. It also connects exact callback arguments to
the corresponding Haxe parameter when a known helper invokes them. Recursive
bodies use an identity-based recursion guard. Any reachable exact body that
reads the later value reports `GENES-MODULE-VALUE-FORWARD-015` before an output
writer opens.

Replacing a callback with a non-callable value clears the old callable fact,
so a later expression cannot be judged from stale ownership. A closure that is
only stored remains safe because creating it captures the binding without
reading it. Safe same-module methods and constructors remain legal. This is
intentionally bounded analysis, not general alias, dynamic-dispatch, or
whole-program call-effect inference: unknown external/dynamic targets keep
their ordinary Haxe semantics and are not guessed from generated names.

Class static fields are intentionally rejected:

```haxe
class Configuration {
	@:genes.moduleValue("metadata")
	public static final metadata = {title: "Products"};
}
```

`Configuration.metadata` has meaningful class identity. Moving it to module
scope would be a different contract from lowering a compiler-only
`KModuleFields` owner. Keep the class field or expose a genuine module-level
value.

Mutable values are also rejected:

```haxe
@:genes.moduleValue("metadata")
var metadata = {title: "Products"};
```

An ESM import cannot reassign an exported `const`, so accepting a mutable Haxe
binding would make Haxe and native callers observe different update semantics.

## DCE, declarations, and source maps

The metadata is not a DCE root. If Haxe removes the value, Genes emits no
binding, reserves no name, imports no dependency, and creates no module.
Framework macros that require a convention value to survive must retain it
through their normal typed/DCE contract; `@:genes.moduleValue` does not guess
that policy.

The value is public from its own generated module only. Even if a macro or
source declaration also supplies `@:expose`, Genes does not duplicate a genuine
module field in the compilation-root barrel. Separate modules may therefore
own the same conventional value name without a false global collision.

Both TypeScript source and classic `.d.ts` retain the closed Haxe type. The
binding and every initializer expression keep their Haxe source-map
provenance. Validation occurs before transactional publication, so a bad
marker, unsupported shape, collision, or cycle leaves the previous output tree
byte-for-byte intact.

## Verification

Run:

```sh
yarn test:module-functions
```

The shared direct-binding fixture covers TypeScript, TSX, classic JavaScript,
classic declarations, TS 5/6/7, same-named cross-module imports, exact runtime
values, same-module local/suffix shadowing, local-export/foreign-import aliases,
owner-only exports, deterministic output, source maps, DCE neutrality, safe
method/constructor and branch/loop controls, structured callable joins, exact
same-module call-target forward-read/cycle diagnostics, and rollback.
`yarn test:ci` invokes that focused owner directly.

See [`MODULE_FUNCTIONS.md`](MODULE_FUNCTIONS.md) for genuine module functions
and the distinct compatibility contract for moving a static class method body.
