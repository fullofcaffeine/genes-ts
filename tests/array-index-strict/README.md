# Strict array-index differential

This fixture compiles one consumer-neutral Haxe program through TypeScript
source, classic Genes ESM, and standard Haxe JavaScript. The TypeScript lane
enables `noUncheckedIndexedAccess` over every generated module.

The proof distinguishes three Haxe contracts:

- `Array<T>` reads remain the typed `T` selected by the Haxe compiler;
- `Array<Null<T>>` reads normalize JavaScript absence to Haxe `null`; and
- `Array<Undefinable<T>>` reads preserve their explicit TypeScript
  `undefined` union.

It also verifies that ordinary assignment targets are not decorated with a
read-only TypeScript assertion and that classic/standard runtime behavior does
not change.

## Why `shift` and `pop` need an owner check

JavaScript returns `undefined` when `Array.shift()` or `Array.pop()` removes
from an empty array. Haxe presents that built-in result as `Null<T>`, where
`T` is the array element type, so Genes emits `?? null` when the result is
actually used:

```haxe
static function removeMissing(values:Array<Null<String>>):Null<String> {
  return values.shift();
}
```

```ts
static removeMissing(values: (string | null)[]): string | null {
  return (values.shift() ?? null);
}
```

The method name alone is not enough evidence for that conversion. A user class
can also declare `shift():Void`; `Void` means the call is performed only for
its effect and has no value to normalize:

```haxe
cursor.shift();
```

The correct generated statement is therefore:

```ts
cursor.shift();
```

It must not become `(cursor.shift() ?? null)`, because TypeScript rejects
nullish coalescing on a `void` result. The fixture includes both `Void` and
value-returning user methods named `shift` and `pop`, plus real Array calls.

Haxe also permits a module to contain a secondary user class named `Array`.
For example, `RootArrayCarrier.hx` in this fixture contains both
`RootArrayCarrier` and a separate `Array` class. That user class and Haxe's
built-in Array have the same short class name and both are in the root package,
but their canonical modules differ:

```text
built-in Array owner: module Array, class Array
user Array owner:     module RootArrayCarrier, class Array
```

The fixture calls `shift():Void` and `pop():Void` on that secondary user class
and verifies that both remain plain statements. Together, these controls prove
that Genes checks the compiler's package, module, and class identities—not
only the emitted spelling.
