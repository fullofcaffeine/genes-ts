# Enum payload narrowing after an erased Haxe match

This dependency-free fixture covers a strict-TypeScript mismatch that can
remain after Haxe has already proved an enum match safe.

## Why the mismatch exists

Haxe supports generic enum constructors whose result fixes selected type
parameters. In this reduced example, `Crashed` requires `Safety = Failure` and
`Failed` requires `Quality = Failure`:

```haxe
enum Reduction<Item, Safety, Quality, Result> {
  Crashed(error:Failure, at:Item):
    Reduction<Item, Failure, Quality, Result>;
  Failed(error:Failure):
    Reduction<Item, Safety, Failure, Result>;
  Reduced(result:Result):
    Reduction<Item, Safety, Quality, Result>;
}
```

For `Reduction<Int, Never, Never, String>`, neither failure constructor can
produce that application: the nominal `Never` marker is not `Failure`. Haxe
therefore accepts this
single-case match and may remove its runtime switch:

```haxe
static function elided(
    value:Reduction<Int, Never, Never, String>):String {
  return switch value {
    case Reduced(result): result;
  };
}
```

The final typed Haxe tree still contains strong evidence: an exact
`TEnumParameter` node naming the `Reduced` constructor, payload slot `0`, the
fully applied receiver type, and the `String` result type.

TypeScript does not see Haxe's impossible-constructor proof. Genes deliberately
emits the public enum type as the complete discriminated union, so a plain
property read is rejected:

```ts
// Before: TS2339 because the full union also contains Crashed and Failed.
const result: string = value.result;
```

The TypeScript boundary plan now records the exact constructor view before
imports are allocated. Emission consumes only that decision:

```ts
const result: string =
  Register.unsafeCast<
    Reduction.Reduced<number, Never, Never, string>
  >(value).result;
```

`Register.unsafeCast<T>(value)` is an identity operation. It evaluates `value`
once and returns the same JavaScript value; it does not convert, validate, or
repair data at runtime. The type argument explains the static fact Haxe already
proved to TypeScript.

## Why ordinary switches stay direct

When Haxe keeps the pattern match, Genes emits the enum's literal `_hx_index`
discriminator:

```ts
switch (value._hx_index) {
  case 2: {
    const result: string = value.result;
    return result;
  }
}
```

That is ordinary, idiomatic TypeScript narrowing. Adding an assertion inside
the case would be redundant, so the planner matches the exact stable receiver
and constructor index and records no boundary decision there.

The rule does not infer authority from generated property names, unqualified
type spellings, diagnostic text, or framework types. It correlates exact enum
declarations through Haxe's compiler-owned module/type coordinates; the shared
type comparison may use its documented request-local source-range fallback
when Haxe re-encodes one type parameter through multiple wrapper objects.
Compile-time negative controls prove that a Dynamic or unresolved receiver, an
invalid payload slot, a constructor-local generic parameter, and a `Reduced`
constructor from an unrelated same-shaped enum cannot authorize the
projection.

The fixture also matches directly on `Factory.read()`. Its marker payload is
otherwise named only in `Factory.ts`; `Main.ts` needs it solely because the
planned constructor view prints the type. This proves dependency collection
reserves that type-only import before binding allocation and that the original
call is evaluated once.

Run the focused task with:

```sh
yarn test:enum-payload-narrowing
```

Prepared by the GameCarry agent.
