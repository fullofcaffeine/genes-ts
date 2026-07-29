# Abstract implementation properties

This fixture protects the boundary between a source-facing Haxe abstract and
the synthetic class Haxe uses to implement it.

No Tink or downstream product type is required to reproduce the behavior.

Run the focused test from the Genes repository root:

```sh
yarn test:abstract-implementation-properties
```

## What is a Haxe abstract?

A Haxe abstract can expose an API while storing another runtime type. This
example presents a `readable` property but stores a JavaScript array:

```haxe
abstract Readable<T>(Array<T>) {
  public var readable(get, never):T;

  public inline function new(value:T) {
    this = [value];
  }

  function get_readable():T {
    return this[0];
  }
}
```

Application code reads the property in the ordinary Haxe form:

```haxe
final words = new Readable("hello");
trace(words.readable);
```

The abstract wrapper does not become a separate object at runtime. `words` is
the underlying array.

## How Haxe represents that API

The Haxe compiler records abstract members on an internal implementation class,
reported to macros as `KAbstractImpl`. The instance getter becomes a static
helper whose first argument is the erased receiver:

```ts
class Readable {
  static get_readable<T>(this1: T[]): T {
    return this1[0]!;
  }
}
```

The `<T>` belongs to the helper method. Callers supply it through the receiver
array's element type.

Haxe 4.3.7 also exposes the source property as a static `FVar` on that internal
class. It does not attach `@:compilerGenerated` metadata to the property.

## Why the previous TypeScript was invalid

Genes previously printed every static `FVar` as a TypeScript class property:

```ts
class Readable {
  declare static readable: T;

  static get_readable<T>(this1: T[]): T {
    return this1[0]!;
  }
}
```

The class itself is not generic, so the first `T` has no declaration.
TypeScript reports:

```text
TS2304: Cannot find name 'T'.
```

Adding `<T>` to the class would describe the wrong model. TypeScript static
members cannot use a class's instance type parameter, and the runtime class is
only Haxe's implementation container. The actual generic scope already belongs
to `get_readable<T>`.

## What Genes emits now

The TypeScript implementation class keeps the runtime helper and omits only the
storage-shaped property:

```ts
class Readable {
  static get_readable<T>(this1: T[]): T {
    return this1[0]!;
  }
}
```

There is no runtime deletion. A `declare` property would have erased during
TypeScript compilation anyway; the executable getter remains unchanged.

Classic Genes JavaScript and standard Haxe JavaScript do not consume this
TypeScript-only implementation projection. The fixture executes all three
profiles and requires the same transcript:

```text
read|7|after|9|static-control|value
```

## How Genes distinguishes instance and static properties

A property name is not sufficient evidence. A user may define a genuine static
property with a normal static getter:

```haxe
abstract StaticControl<T>(Array<T>) {
  public static var label(get, never):String;

  static function get_label():String {
    return "static-control";
  }
}
```

That property must remain:

```ts
class StaticControl {
  declare static label: string;

  static get_label(): string {
    return "static-control";
  }
}
```

`PublicSurface.ownershipFor` classifies the two cases from the typed Haxe
contract before emission:

1. the owner must be `KAbstractImpl`;
2. the property must use Haxe's `AccCall` accessor form;
3. the exact accessor helper must have a typed leading `this` receiver.

The `Readable` helper receives `this1: T[]`, so its property is
`AbstractInstanceProperty`. `StaticControl.get_label()` has no receiver, so
`label` remains `Static`.

`TsModuleEmitter` consumes this immutable ownership fact. It does not infer the
answer from generated TypeScript, downstream diagnostic text, or an arbitrary
method that merely resembles a getter.

## What the focused test covers

The fixture contains:

- a generic readable property;
- a generic writable property;
- a generic read/write property;
- a non-generic abstract instance property;
- a genuine static abstract property and similarly named static accessor.

It verifies:

- no synthetic instance property leaks onto the TypeScript implementation
  class;
- typed receiver helpers remain;
- the real static property remains;
- TypeScript 5, 6, and 7 accept the generated project with
  `skipLibCheck: false`;
- Genes TypeScript, classic Genes JavaScript, and standard Haxe JavaScript
  execute identically;
- the retained helper keeps its original Haxe source-map line;
- the existing classic declaration surface still contains the source-facing
  abstract properties.

The test is owned by the normal acceptance gate, not only by release CI.

## Declaration limitation

This change fixes TypeScript implementation classes. It does not redesign
classic Genes `.d.ts` representation for generic Haxe abstracts.

Classic declarations currently preserve a source-facing property in a shape
such as:

```ts
export declare class Readable {
  static readonly readable: T;
}
```

That existing declaration has its own unbound-parameter problem. Silently
deleting it here would lose public API information, while repairing it requires
a broader decision about how erased Haxe abstracts should appear to direct
TypeScript consumers. The fixture therefore proves that this PR does not remove
the declaration and records the limitation explicitly. A separate declaration
design should address it.

## Downstream evidence

The package-neutral GameCarry `tink_cli` fixture previously reported four
instances of this defect:

- `Future.status`;
- `Pair.a`;
- `Pair.b`;
- `Ref.value`.

Against this worktree, strict TypeScript moves exactly from 40 diagnostics to
36:

```text
TS2304: 4 -> 0
```

Every other diagnostic-code count remains unchanged. Unsupported clusters stay
visible instead of being hidden by a broad cast, `any`, `skipLibCheck`, or
`ts-nocheck`.
