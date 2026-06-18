# Async/await sugar (genes-ts)

genes-ts includes an opt-in async/await authoring layer that compiles to **native** TypeScript/JavaScript `async` / `await`.

Note: When you `-lib genes-ts`, the build macro that powers `@:async` is installed automatically via the library’s `extraParams.hxml`. You only need to use `@:async` plus either `await(...)` or `@:await expr`.

## Usage

1) Mark functions with `@:async`.
2) Import `await`:

```haxe
import genes.js.Async.await;
```

3) Use `await(...)` or `@:await expr` inside `@:async` functions.

Example:

```haxe
import genes.js.Async.await;
import js.lib.Promise;

class Example {
  @:async
  public function plusOne(x: Int): Promise<Int> {
    final v = @:await Promise.resolve(x);
    return v + 1;
  }
}
```

This emits idiomatic TS/JS:

```ts
async plusOne(x: number): Promise<number> {
  const v = await Promise.resolve(x);
  return v + 1;
}
```

## Notes / constraints

- `@:async` functions must declare a return type, and it must be `js.lib.Promise<T>` (or `Promise<T>` if imported).
  - If you want to await a `tink.core.Promise<T>`, convert it with `toJsPromise()`.
- Anonymous async functions are supported:

```haxe
final fn = @:async function(x: Int): Promise<Int> {
  final v = await(Promise.resolve(x));
  return v + 1;
};
```

`@:await expr` is optional sugar over the same lowering as `await(expr)`.
Prefer `@:await` when it makes callback-heavy code read closer to TypeScript.
Prefer `await(...)` when grouping is clearer or when you want the classic
function-call macro style.

Do not write `@:await(expr)`: that is parsed as metadata arguments, not as the
expression to await. Use `@:await expr`, `@:await (expr)` with a space, or
`await(expr)`.

- For `Promise<Void>`, the macro ensures an implicit resolved return on fallthrough so Haxe type-checks cleanly.
- For `Promise<Void>`, `await(...)` is intended to be used for side effects (statement position). Since the underlying `js.Syntax.code(...)` boundary is typed as `Dynamic`, genes-ts does not attempt to check-type the result to `Void` (Haxe rejects `Dynamic → Void`).
