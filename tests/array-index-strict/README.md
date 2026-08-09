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

## Authoritative plan and finite operation matrix

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

The TypeScript emitter now consumes that plan. It does not inspect a generated
name, source spelling, or mutable "currently assigning" flag to decide whether
an indexed target needs a type-only assertion. It asks for the decision attached
to the exact typed operation, then prints only that syntax.

For example, Haxe accepts this native read-modify-write operation:

```haxe
return values[0] |= mask;
```

Haxe lowers the value-producing source into one update and one later read.
Genes therefore plans and emits both occurrences independently:

```ts
values1[tmp]! |= mask;
return values1[tmp]!;
```

This is not a JavaScript behavior change. The two `!` tokens exist only for the
TypeScript checker and disappear when TypeScript is erased. The classic Genes
and standard Haxe lanes execute the same receiver, index, update, and result.

A plain write stays writable without a read assertion:

```ts
return values[0] = value;
```

Logical and nullish assignments need a direct nullable writable target; adding
`!` would make a nullable right-hand side invalid. Haxe 4.3, however, cannot
carry retained `&&=`, `||=`, or `??=` indexed operations into Genes' generated
program. It rejects the first two spellings and lowers the third before the
custom generator runs. This PR therefore does **not** claim native source
emission for those forms. The classifier records their required future
decision, while production admission fails closed if such a typed form ever
arrives. A future Haxe version can enable emission only after a real fixture
passes the exact operation through `TsModuleEmitter` and strict TypeScript.

The typed source inventory covers plain writes, every admitted arithmetic and
bitwise assignment, prefix and postfix increments/decrements, nullable number
and string coercion, nested and flow-narrowed receivers, generic reads,
explicit `undefined`, `Unknown`, and `Dynamic` boundaries. The runtime
transcript exercises representative compound operations, effectful receiver
and index evaluation, one native Proxy get/RHS/set sequence, nullable coercion,
nested targets, and all four update forms through TypeScript, classic Genes,
and standard Haxe. The Proxy transcript requires the exact order
`receiver,index,get,rhs,set`, with every step occurring once. Haxe 4.3 cannot
spell retained `&&=` or `||=` in source and erases several target wrappers
during typing. A focused macro therefore creates typed-expression copies for
those cases and sends them directly through the same classifier; it does not
edit the program being generated. Separate strict TypeScript 5, 6, and 7
fixtures prove that direct logical targets are a viable future syntax choice.
Additional negative probes apply the real production-admission rule and prove
that logical/nullish operations and transparent wrappers stop before emission
today. Classifier evidence is deliberately not presented as emitter evidence.

Negative typed probes reject undefined-aware or unknown arithmetic,
unconstrained generic arithmetic, unresolved types, runtime casts,
syntax-producing metadata, operators outside the reviewed matrix, compound or
nested writes through Haxe's runtime registries, metadata or casts around a
registry access, registry aliases and calls, a same-named noncanonical
`enumParameters` function, and an unresolved local that only resembles the
exact standard-library parameter. The inventory also distinguishes
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
