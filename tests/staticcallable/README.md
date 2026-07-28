# Static callable generic fixture

This fixture proves that a static Haxe method receives every generic parameter
needed by its generated TypeScript signature—even when the method did not
declare that parameter in source.

## Why this can happen

`InferredStaticFactory.wrap` is intentionally unannotated:

```haxe
public static function wrap(payload) {
  return new InferredStaticFactory(payload);
}
```

Haxe later checks a call from a generic method:

```haxe
public static function create<T>(value:T):InferredStaticFactory<T> {
  return InferredStaticFactory.wrap(new InferredStaticPayload(value));
}
```

That call supplies the missing `T` while Haxe finishes the typed signature of
`wrap`. The final compiler type therefore mentions a parameter that `wrap`
did not declare. A direct TypeScript rendering leaves `T` out of scope:

```ts
static wrap(payload: InferredStaticPayload<T>): InferredStaticFactory<T>
//                                      ^ TypeScript cannot find this T here
```

Genes projects the free compiler parameter into a method-level declaration:

```ts
static wrap<T>(
  payload: InferredStaticPayload<T>
): InferredStaticFactory<T>
```

This changes only static type syntax. JavaScript erases `<T>`, so runtime
evaluation and values stay the same.

## What the controls prove

- `InferredStaticFactory.hx` covers the ordinary inferred parameter.
- `ConstrainedStaticFactory.hx` covers a retained parameter whose constraint
  names another parameter and a type imported from another module.
- `CallableSignaturePlanProbe.hx` runs at macro time so it can inspect exact
  Haxe compiler identities. It proves two unrelated parameters both named `T`
  become `T` and `T_1`, constraints close transitively, ordinary declared
  parameters are not duplicated, and static properties are not treated as
  generic callables.
- `TestStaticCallableSignature.hx` proves runtime behavior.
- the generated TypeScript consumer in `scripts/test-genes-ts-full.ts` proves
  strict TypeScript accepts valid calls and rejects wrong result types.
- `tests/classic-dts/consumer.ts` proves classic `.d.ts` output exposes the same
  callable contract.

Run the owning gates from the repository root:

```sh
yarn test:genes-ts:full
yarn test:classic:dts
```

The complete design and its limits are documented in
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#static-callable-generic-scope).
