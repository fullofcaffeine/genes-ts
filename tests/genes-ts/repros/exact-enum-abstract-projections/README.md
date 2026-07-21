# Exact enum-abstract projections

This repro protects closed Haxe string domains as they cross a generic host
boundary. The host returns a zero-runtime tuple view, while Haxe application
code exposes an exact enum-abstract value and replacement callback.

The same fixture also protects source-level enum abstracts nested inside
anonymous-structure callbacks, arrays, nullability, aliases, and generic
containers. Those types deliberately have no `@:ts.type` override: the normal
genes-ts enum-abstract projection must remain recursive after Haxe's generator
view erases the leaf to its String backing type.

## Why this regression matters

The gap was found while a downstream Haxe application built a closed URL-state
model. Haxe correctly rejected the wrong status domain, and genes-ts emitted the
model's value as a literal union, but the model's callback widened from
`Status -> Void` to `(arg0: string) => void`. Passing that callback value into an
exact generic host API then failed strict TypeScript even though Haxe had already
proved the program.

Before the fix, representative output looked like:

```ts
export type ReviewModel = {
  select: (arg0: string) => void;
  selectMany: (arg0: string[]) => string[];
  envelope: Envelope<string>;
};
```

The positive control now requires:

```ts
export type ReviewModel = {
  select: (arg0: "approved" | "pending") => void;
  selectMany: (
    arg0: ("approved" | "pending")[]
  ) => ("approved" | "pending")[];
  envelope: Envelope<"approved" | "pending">;
};
```

The negative Haxe control passes `OtherReviewState` to a parameter requiring
`ReviewState` and checks the exact nominal-domain diagnostic. The output check
also rejects broad callback strings and concrete specialization of
`Envelope<Value>`. A separate `ReviewEnvelope = Envelope<ReviewState>` alias
proves that one exact use retains its argument without rewriting the shared
generic declaration. Only the three deliberately broad host controls may need
TypeScript assertions; the exact nested types and runtime helpers may not add
their own.

The TypeScript profile must emit the tuple and callbacks with the same literal
union, then use already-exact values directly. A redundant `as` expression is
not harmless output polish: it hides whether genes-ts actually retained the
source type at the expression boundary.

Three controls deliberately expose broad `string` in TypeScript: one parameter,
one generic host field, and one receiver whose whole target type is overridden.
Those values still need a small assertion when they enter the closed phase
slot. They prevent the compiler from confusing a narrow Haxe authoring type
with the broader type it actually printed. The existing basic snapshot's
lowered array-loop control separately proves that a genuinely widened mutable
string keeps the same safeguard.

The classic profile runs the same Haxe source against a tiny global host and
proves that the metadata and TypeScript-only reasoning add no wrapper, helper,
or changed JavaScript behavior. Its generated declaration also keeps
`Envelope<Value>` generic and preserves the explicit `Phase` projection. The
unannotated `ReviewState` literals remain a genes-ts source-profile feature;
this change does not silently alter classic Genes' broader declaration policy.
The typed consumer runs on the repository's TypeScript 5, 6, and 7
compatibility lanes.

Run the focused proof with:

```sh
node tests/genes-ts/repros/exact-enum-abstract-projections/check.mjs
```
