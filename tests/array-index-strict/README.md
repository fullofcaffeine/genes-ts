# Strict array-index differential

This fixture compiles one consumer-neutral Haxe program through TypeScript
source, classic Genes ESM, and standard Haxe JavaScript. The TypeScript lane
enables `noUncheckedIndexedAccess` over every generated module.

The proof distinguishes three Haxe contracts:

- `Array<T>` reads remain the exact `T` selected by the Haxe compiler,
  including when `T` itself permits `null`;
- `Array<Null<T>>` reads normalize JavaScript absence to Haxe `null`; and
- `Array<Undefinable<T>>` reads preserve their explicit TypeScript
  `undefined` union.

It also verifies that ordinary assignment targets are not decorated with a
read-only TypeScript assertion and that classic/standard runtime behavior does
not change.

## Why a generic array read uses `as T`, not `!`

Haxe types an indexed `Array<T>` read as `T`:

```haxe
static function first<T>(values:Array<T>):T {
  return values[0];
}
```

With TypeScript's `noUncheckedIndexedAccess` option, the generated
`values[0]` starts as `T | undefined` because a JavaScript array can be read
past its end. Genes must remove that checker-added `undefined` to preserve
Haxe's source contract.

A postfix non-null assertion looks tempting:

```ts
static first<T>(values: T[]): T {
  return values[0]!;
}
```

However, TypeScript defines `!` as removing both `undefined` and `null`.
Therefore the expression itself has type `NonNullable<T>`, not `T`. That
difference escapes when another generic function infers its own parameter from
the read:

```haxe
return Converted(matched
  ? InvariantFactory.single(values[0])
  : fallback);
```

The overly narrow output makes TypeScript reject Haxe's valid program:

```ts
// Wrong: single(...) becomes InvariantValue<NonNullable<T>>.
return InferenceResult.Converted<T>(
  matched ? InvariantFactory.single(values[0]!) : fallback
);
```

Genes instead asserts the exact type already established by Haxe:

```ts
// Correct: single(...) remains InvariantValue<T>.
return InferenceResult.Converted<T>(
  matched ? InvariantFactory.single((values[0] as T)) : fallback
);
```

`as T` changes only TypeScript's static view. It does not convert, validate, or
even wrap the JavaScript value. If `T` is `string | null`, a real `null` stays
`null`; only TypeScript's extra missing-index possibility is removed. The
fixture exercises that nullable instantiation at runtime and uses an invariant
generic destination so the old `NonNullable<T>` leak fails strict type
checking rather than passing unnoticed.

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
