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

## Shadow plan and finite operation matrix

The production TypeScript emitter historically decided indexed reads and
read/write targets while recursively printing them. That local state cannot
reliably distinguish the indexed slot from a nullable receiver or see through
every target wrapper. A fix that adds `!` to one failing spelling can therefore
break another valid spelling, especially a logical assignment whose right-hand
side is still nullable.

`TsIndexedAccessPlan` moves that decision before printing. It records immutable
facts for exact typed Haxe expressions and keeps six questions separate:

1. Is the receiver itself present?
2. Is the indexed slot present under Haxe's contract?
3. Does the operator have a proven JavaScript number or string domain?
4. Must the target remain writable as a nullable or undefined-aware value?
5. Is every wrapper transparent in an assignment target?
6. Does the surrounding typed expression consume or discard the operation
   result?

This first landing runs the plan in **shadow mode**. The TypeScript emitter
builds and inventories the plan but does not use it to choose output syntax, so
the existing generated files and runtime behavior remain unchanged. The
follow-up emitter change can switch authority only after this finite inventory
is stable.

The source inventory covers plain writes, every admitted arithmetic and
bitwise assignment, prefix and postfix increments/decrements, nullable number
and string coercion, nested and flow-narrowed receivers, generic reads,
explicit `undefined`, `Unknown`, and `Dynamic` boundaries. Haxe 4.3 cannot
spell retained `&&=` or `||=` in source and erases several target wrappers
during typing. A focused macro therefore creates typed-expression copies for
those cases and sends them directly through the same production classifier; it
does not edit the program being generated.

Negative typed probes reject undefined-aware or unknown arithmetic,
unconstrained generic arithmetic, unresolved types, runtime casts,
syntax-producing metadata, operators outside the reviewed matrix, compound or
nested writes through Haxe's runtime registries, an explicit cast around a
registry read, and an unresolved local that only resembles the exact
`Type.enumParameters` parameter. The inventory also distinguishes
value-producing and discarded assignments and every prefix and postfix update.
Every rejection must preserve the last accepted output tree. The
compiler-server fixture then runs a safe request, a `Dynamic` request, and the
safe request
again, requiring each warm decision inventory to match its isolated cold build
and the restored output to match the first bytes.

The compile-time controls resolve both a lazy compiler type and a monomorphic
compiler placeholder to the fixture's exact type parameter. Genes must return
that canonical parameter to the TypeScript printer; forwarding either wrapper
would fall through the general conservative printer as `any`. An unresolved
placeholder and an unexpectedly deep lazy chain fail closed. The fixture also
checks the generated assertion's source-map line, a generic `Undefinable`
instantiation, and a value-producing generic assignment target.

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
