# Native async/await from Haxe

genes-ts provides a typed Haxe authoring layer that emits native JavaScript or
TypeScript `async`/`await`. It is shared by both Genes implementation profiles:

| Profile | Status |
| --- | --- |
| Classic Genes ESM JavaScript | Supported |
| genes-ts TypeScript (`-D genes.ts`) | Supported |
| Stock Haxe JS, anonymous async function | Supported through explicit syntax lowering |
| Stock Haxe JS, named async method | Explicit compile-time capability error |

This distinction follows the generated mechanism. An anonymous async function
is wrapped in explicit `async function` syntax by the macro, which stock Haxe
can carry safely. A named method uses a private semantic fact consumed by the
Genes printers. Haxe 4 does not understand that fact, so accepting the named
form under stock Haxe would produce an ordinary method containing `await`,
which is invalid JavaScript. The helper reports `GENES-ASYNC-TARGET-001` before
replacing an existing output instead of publishing code that fails later.

When a build uses `-lib genes-ts`, `extraParams.hxml` installs the build macro
and Genes generator. No additional setup is normally required.

## Basic use

Mark the function `@:async`, import the typed `await` macro, and give the
function an explicit return type:

```haxe
import genes.js.Async.await;
import js.lib.Promise;

class Example {
  @:async
  public function plusOne(value:Int):Promise<Int> {
    final resolved = await(Promise.resolve(value));
    return resolved + 1;
  }
}
```

Both Genes profiles emit the same native control flow:

```ts
async plusOne(value: number): Promise<number> {
  const resolved = await Promise.resolve(value);
  return resolved + 1;
}
```

`@:await expression` is optional syntax over the same typed lowering:

```haxe
final resolved = @:await Promise.resolve(value);
```

Use `@:await expr`, `@:await (expr)` with a space, or `await(expr)`. Do not
write `@:await(expr)`: Haxe parses that spelling as metadata arguments rather
than as the expression being awaited.

## Functions and return types

Named methods and anonymous functions are supported, including nested async
functions:

```haxe
final increment = @:async function(value:Int):Promise<Int> {
  return await(Promise.resolve(value)) + 1;
};
```

Every `@:async` function must declare its return type. An existing
`Promise<T>` remains `Promise<T>`; a declared `T` is lifted to `Promise<T>` by
the build macro. Declaring the Promise explicitly is recommended because it
makes the calling contract clear in Haxe as well as in generated TypeScript.

For `Promise<Void>`, an awaited expression should be used for its side effect.
The macro adds the compile-only fallthrough bridge needed by Haxe, while both
Genes printers emit ordinary native async completion. The implementation uses
one narrow `js.Syntax` typing boundary because Haxe cannot check a dynamic
syntax expression to `Void`; that boundary is contained in the macro and does
not emit `any` or `unknown` into user modules.

If a library exposes another Promise abstraction, convert it to
`js.lib.Promise<T>` before awaiting it. For example, use `toJsPromise()` for a
`tink.core.Promise<T>` when that adapter is available.

## Lexical and target validation

An await belongs to the innermost function that contains it. A normal nested
function does not inherit permission from an async parent:

```haxe
@:async
function outer():Promise<Int> {
  final synchronous = function():Int {
    return await(Promise.resolve(1)); // GENES-ASYNC-CONTEXT-001
  };
  return synchronous();
}
```

The build macro records immutable, compiler-only source ranges for named and
anonymous functions. When the `await(...)` macro is typed later, it selects the
smallest containing range. This preserves nested-function ownership without a
process-global registry that could leak across compile-server runs. Parameter
default expressions are also outside the async body contract.

Stable diagnostics cover the first supported boundary:

- `GENES-ASYNC-TARGET-001`: a named async method lacks the active Genes JS
  generator, or the target is not JS;
- `GENES-ASYNC-CONTEXT-001`: `await(...)` or `@:await` is outside its enclosing
  async function, including inside a normal nested function;
- `GENES-ASYNC-CONSTRUCTOR-001`: a constructor is marked async;
- `GENES-ASYNC-RETURN-001`: an async function omits its return type;
- `GENES-ASYNC-AUTHORING-001`: `@:async` is attached to a non-function
  expression.

These errors happen during typing. Compiler output is therefore not opened or
replaced for an invalid async program.

## Evidence boundary

`yarn test:async-await:evidence` runs one source through classic Genes and
genes-ts, compiles the generated TypeScript with the pinned TypeScript 5, 6,
and 7 lanes, and compares exact runtime JSON. The fixture covers static and
instance methods, anonymous and nested anonymous functions, value and `Void`
promises, property and index access after await, exception propagation, and
single evaluation/order. It also checks the await source-map token, absence of
the historical `__async_marker__` protocol, compiler-metadata containment, and
transactional negative builds. Its standard-Haxe lanes execute the anonymous
syntax-lowered form and separately prove the named-method capability guard.
The ts2hx async snapshot independently runs its generated anonymous carrier
through stock Haxe as part of the migration-tool aggregate.
