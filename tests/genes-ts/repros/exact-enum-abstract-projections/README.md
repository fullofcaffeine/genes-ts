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

A local declared with an enum type retains its closed domain,
including non-null fallback and conditional initializers. For example, `final
code: Null<ReviewState> = parseReview(raw)` must keep the literal union plus
`null`. After a null check, returning `{value: code}` in an
`Envelope<ReviewState>` must type-check without an assertion. The runtime
fixture checks a known value, an unknown string, and null input. The fixture
also checks saved-versus-default values and nested fallback initializers in
both runtimes. Before the fix, their locals widened to `string`. The declared type survives even when lowering splits an initializer into
branch assignments in a cached compiler-server tree. Reassigned enum locals
retain the same declared domain because Haxe checks their later assignments.

The TypeScript profile must emit the tuple and callbacks with the same literal
union, then use already-exact values directly. A redundant `as` expression is
not harmless output polish: it hides whether genes-ts actually retained the
source type at the expression boundary.

Three controls deliberately expose broad `string` in TypeScript: one parameter,
one generic host field, and one receiver whose whole target type is overridden.
Those values still need a small assertion when they enter the closed phase
slot. They prevent the compiler from confusing a narrow Haxe authoring type
with the broader type it actually printed. The mutable enum-local control retains its declared domain and returns a typed
record after reassignment. A separate local declared as `String` accepts an
outside value. The basic array-loop snapshot keeps exact iteration domains
and needs no cast.

An ordinary `ReviewDecision.Selected(ReviewState)` constructor must preserve
the same domain in its parameter and payload field. The native TypeScript
consumer accepts known values, rejects outside text, and reads the payload
after discriminant narrowing. Both runtimes execute the Haxe switch. The
compiler-server fixture separately checks this declaration across warm builds.
Classic declaration profile semantics remain unchanged.

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

Nullable decoded values must also retain the closed domain when passed to an
ordinary enum constructor. The generic throwing guard is opaque to TypeScript;
the existing identity assertion remains, but its target must use the captured
constructor signature, not the erased `string` backing type. Both runtimes
check the accepted value and reject invalid input before construction. This
adds no claim that Genes analyzes arbitrary throwing helper functions.

A generic `DomainResult<ReviewState>` return must instantiate `Value` with the
same closed domain under full DCE. Before the fix, branches emitted
`Value<string>` and strict TypeScript rejected the method body. The declaration
already preserved the right union; the missing fact was at the constructor
call. This fixture pairs strict generated-code and external-consumer checks
with both runtimes. It does not widen the return type or assert away the error.

The same result contract is exercised by a direct module function, a return
inside a loop, and a nullable payload after an opaque throwing guard. A nested
callback deliberately returns `DomainResult<String>` containing `outside`;
it must keep its own broad contract even inside a closed-result method. The
nullable conversion remains authorized by lowered Haxe types, but its printed
target agrees with the captured generic argument. The compiler-server corpus
also carries this declared generic return through cold and warm requests.
