# Typed binding after an opaque runtime guard

This dependency-free fixture explains why one typed Haxe catch needs an
explicit TypeScript assertion even though its runtime check is correct.

## Why TypeScript loses the Haxe proof

Haxe lets a program catch a specific enum:

```haxe
try {
  throw GuardedFailure.Rejected("no");
} catch (failure:GuardedFailure) {
  return failure;
}
```

Haxe lowers all catch clauses to one broad JavaScript catch value. It unwraps
that value, asks its runtime helper whether the value is the requested enum,
and creates the typed catch variable only inside the successful branch:

```ts
const raw: {} | null | undefined = Exception.caught(caught).unwrap();

if (Boot.__instanceof(raw, GuardedFailure)) {
  const failure: GuardedFailure = raw; // TS2322 before this fix
}
```

The runtime check is valid, but TypeScript sees `Boot.__instanceof` as an
ordinary function returning `boolean`. Unlike the built-in `instanceof`
operator, that Boolean result does not narrow `raw`.

## What Genes emits

Genes keeps Haxe's runtime guard and records the typed binding explicitly:

```ts
if (Boot.__instanceof(raw, GuardedFailure)) {
  const failure: GuardedFailure =
    Register.unsafeCast<GuardedFailure>(raw);
}
```

`Register.unsafeCast<T>(value)` is a runtime identity operation. It returns the
same value without wrapping, cloning, checking, or converting it. Haxe's guard
still decides whether execution enters the branch; the assertion only carries
that already-established fact into TypeScript.

## How the rule stays narrow

The pre-emission boundary plan requires all of these compiler facts:

- the broad local came from exactly
  `haxe.Exception.caught(...).unwrap()`;
- the condition calls the exact compiler-owned
  `js.Boot.__instanceof` field;
- the guard target is an exact Haxe class or enum type expression;
- the typed local is initialized from the same raw `TVar` identity;
- the initializer remains inside the guard's true branch;
- the local's declared type exactly matches the guard target.

The scan never enters a nested function and stops if the raw local is assigned
again. A class catch lowered through native JavaScript `instanceof` remains
direct because TypeScript already understands that guard. Ordinary dynamic
locals and unrelated Boolean helpers receive no assertion.

Run the focused task with:

```sh
yarn test:runtime-guarded-binding
```
