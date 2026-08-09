# Null safety in Genes projects

Genes uses two complementary null-safety checks:

1. Haxe can check selected Haxe packages before code generation.
2. TypeScript can check the generated TypeScript after Genes has chosen its
   target types.

Neither check replaces the compiler's null and `undefined` lowering. Genes
still has to preserve the runtime meaning of a missing JavaScript field,
`Null<T>`, `genes.ts.Undefinable<T>`, and optional properties in both output
profiles.

## Short recommendation

- Genes enables Haxe **Loose** null safety recursively for its own `genes.*`
  implementation.
- Application authors should enable Haxe null safety package by package for
  code they own.
- TypeScript-output projects should also keep TypeScript `strict` mode,
  including `strictNullChecks`.
- Genes does not enable Haxe null safety globally for application code,
  dependencies, or the Haxe standard library.

For an application package, place the null-safety macro before `-lib genes-ts`
and before any other macro that might load that package:

```hxml
--macro haxe.macro.Compiler.nullSafety("my.application", Loose, true)
-lib genes-ts

-cp src
--main my.application.Main
-js src-gen/index.ts
-D genes.ts
```

`"my.application"` is a package prefix. With the final `true`, Haxe also checks
subpackages such as `my.application.api`. It does not select an unrelated
package such as `third.party`. For the same reason, Genes treats `genes.*` as
its owned namespace: a consuming project should not place application modules
under that prefix unless it intentionally accepts the compiler's checking
policy.

## Three different responsibilities

### 1. Haxe checks authored source

`haxe.macro.Compiler.nullSafety(...)` adds Haxe null-safety rules to matching
types. It can reject code that passes a `Null<T>` where a non-null `T` is
required, and it uses Haxe's control-flow analysis to recognize guards.

This is a source-quality gate. It normally reports unsafe code; it does not
insert JavaScript conversions or decide how a target language represents a
value.

The macro must run before a selected type is loaded. That is why Genes installs:

```hxml
--macro haxe.macro.Compiler.nullSafety("genes", Loose, true)
--macro genes.Generator.use()
```

in this order. If a project adds its own package rule, put it before macros that
inspect or generate types from that package.

### 2. Genes preserves target representation

Haxe's checker cannot change JavaScript behavior. Reading a missing property
still produces JavaScript `undefined`, even if the Haxe source that performs the
read passed null-safety checking.

Genes therefore keeps a separate compiler contract:

- Haxe `Null<T>` projects to `T | null` in strict TypeScript.
- `genes.ts.Undefinable<T>` projects to `T | undefined`.
- an ordinary Haxe optional field keeps Haxe's nullable-value behavior;
- `@:ts.optional` explicitly models a TypeScript property that can be omitted
  or contain `undefined`;
- `NullishContract` and the TypeScript boundary plan add a conversion or a
  contained type assertion only where the typed Haxe and target contracts
  differ.

For example, `Undefinable.orNull()` must turn target `undefined` into Haxe
`null`. Haxe null-safety checking can verify callers of that typed helper, but
only Genes can preserve the emitted `value ?? null` operation and its
`T | undefined` input type.

The inverse proof, `Undefinable.assumePresent()`, is also target-aware. After an
exact absence check, TypeScript asserts the value to Haxe's exact instantiated
`T`; classic output keeps a runtime identity. Genes cannot use TypeScript's
postfix `!` alone here because it removes both `undefined` and `null`, while
`Undefinable<Null<T>>` must retain a present Haxe `null`.

The generated TypeScript form is `((value)! as T)`. Both operators are erased.
The operand has its own parentheses so a conditional or another low-precedence
expression is proved as one value; without that grouping, TypeScript would
apply `! as T` only to the conditional's last branch. The first operator
prevents TypeScript's disjoint-cast diagnostic when control flow has otherwise
narrowed the operand to `undefined`; the final exact assertion restores the
Haxe `T`, including any legitimate nested `null`. This is not a runtime check
or conversion.

This is also why enabling null safety does not replace `TsBoundaryPlan`.
The plan records exact TypeScript-only boundary conversions that ordinary Haxe
accepted, while classic JavaScript continues to follow Haxe's JavaScript
runtime semantics.

### 3. The target checker verifies generated code

With TypeScript output, `strictNullChecks` checks the representation Genes
emitted. A recommended baseline is:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Classic JavaScript output has no TypeScript checker. Haxe null safety is still
useful for the source, while Genes' runtime fixtures verify the emitted
JavaScript behavior.

## Indexed reads and updates are different operations

`noUncheckedIndexedAccess` makes TypeScript treat `values[index]` as possibly
`undefined`, even when Haxe has already typed that same expression as `T`.
Genes cannot solve every indexed occurrence with one postfix `!`:

- a plain write does not read the old slot and needs no read assertion;
- an ordinary `Array<T>` read must preserve the exact Haxe `T`, including a
  legitimate nested `null`;
- `Array<Null<T>>` normalizes a missing JavaScript slot to Haxe `null`;
- `Array<Undefinable<T>>` must retain its explicit `undefined` boundary;
- arithmetic and update operators read before writing and require a proven
  number or string operation domain; and
- `??=`, `||=`, and `&&=` must retain the complete nullable writable target,
  because narrowing the target can make a nullable right-hand side invalid.

`TsIndexedAccessPlan` records those facts independently for each exact typed
expression. It also records whether the surrounding tree consumes or discards
an assignment/update result, and distinguishes a nullable receiver, such as
`base` in `base[index]`, from the indexed slot itself. Parentheses, erased
metadata, and an erased implicit cast are accepted only through a closed wrapper
policy; runtime casts and syntax-producing metadata fail before publication.

Three narrow Haxe-owned forms can retain an unresolved compiler variable after
typing: `DynamicAccess<Dynamic>.get`, reads and initialization writes on the
compiler-owned `$hxClasses` and `$hxEnums` registry identifiers, and the indexed
parameter read inside Haxe's standard `Type.enumParameters` implementation.
Genes admits registry reads only through a closed field/index chain rooted at
the exact compiler `TIdent`. Parentheses may group the chain, but metadata,
casts, aliases, and calls are not part of that grammar.
Only a direct registry slot accepts a plain initialization write. Compound
assignments, updates, and writes through a derived registry value fail closed.
The enum-parameter case additionally requires the exact outer standard-library
function and the exact argument `TVar`; another local in that function does not
inherit the exception. An unrelated unresolved indexed type still fails closed.

The TypeScript emitter consumes this plan directly. For example, Haxe accepts
a bitwise update whose old array slot has the declared type `Int`:

```haxe
values[index] |= mask;
```

With `noUncheckedIndexedAccess`, TypeScript adds a checker-only `undefined` to
that read. The plan authorizes the type-only assertion needed by the native
operation:

```ts
values[index]! |= mask;
```

The emitter does not decide that `!` is safe from the operator spelling or the
generated text. It prints the exact plan decision for that typed operation.
Plain writes and logical/nullish assignments receive no assertion, because
their complete writable type must remain intact. A nested nullable receiver
gets its own receiver assertion independently from the outer indexed slot.

Prefix and postfix updates remain native TypeScript syntax, preserving their
different result values. Receiver, index, and right-hand-side expressions are
still evaluated once and in Haxe order. Classic JavaScript does not build or
consume this TypeScript-only plan.

## Loose and Strict modes

Genes begins with Haxe's `Loose` mode because it is a practical source-quality
baseline for a macro-heavy compiler:

- it rejects ordinary unsafe nullable use;
- it retains some field narrowing across calls and mutation;
- it makes adoption possible without hiding whole modules behind escape
  metadata.

Haxe `Strict` mode invalidates more flow facts after calls and mutation. It may
find additional bugs, but it also reaches more compiler-API and host-interop
boundaries. Genes will evaluate it separately; it is not the current default.

Projects can make the same staged choice:

1. enable `Loose` for one owned package;
2. repair real diagnostics and isolate host boundaries;
3. add the next owned package;
4. consider `Strict` only after the Loose baseline is clean.

Do not enable a broad root package merely to avoid listing ownership
boundaries. Recursive package matching can include more code than intended.

## JavaScript boundaries still require care

Haxe and TypeScript declarations describe what a host API promises; neither
checker proves that an untrusted runtime honors the declaration.

Review these boundaries explicitly:

- JavaScript externs and npm package declarations;
- `Dynamic`, reflection, and raw `js.Syntax.code`;
- missing versus explicitly `undefined` properties;
- macros and compiler APIs with nullable fields;
- callbacks whose runtime order establishes a fact the Haxe type cannot
  express.

Prefer a typed wrapper that validates or normalizes the value. If a
`@:nullSafety(Off)` escape is genuinely necessary, keep it on the smallest
statement after a guard, explain the mismatch, and return immediately to a
typed value. Do not disable null safety for a package, class, or method merely
to make the build green.

Genes enforces that rule for its own source with
`config/null-safety-escapes.json` and:

```bash
yarn test:null-safety
```

The gate rejects an unrecorded escape, a stale inventory entry, a broad
module-level escape, or a macro-order change.

## Relationship to Reflaxe compilers

Genes is not a Reflaxe compiler and does not use a Reflaxe target AST or pass
manager. The useful lesson from neighboring compiler projects is narrower:

- upstream Reflaxe and the reviewed Elixir and Go backends enable package-scoped
  Loose null safety for their own compiler implementations;
- each backend still owns its target representation of Haxe `null`, option
  values, and missing data;
- the reviewed Ruby backend performs explicit target `nil` lowering without
  enabling package-scoped Haxe null safety, which demonstrates that source
  checking and target lowering are independent.

Reflaxe's optional `NullTypeEnforcer` is also a different mechanism. It is not
Haxe null safety and does not model JavaScript missing fields, `undefined`, or
Genes' precise TypeScript boundary types. Genes does not enable or copy it.

The transferable practice is scoped compiler-source checking, small documented
escapes, and target-specific runtime evidence—not a shared compiler
architecture.

## Verification and support boundary

The blocking compiler-source contract is Haxe 4.3.7:

```bash
yarn test:null-safety
yarn test
yarn test:genes-ts:full
yarn test:compiler-server
yarn test:ci
```

The Haxe 5 preview lane remains advisory. At the time this policy was adopted,
the pinned preview compilation was blocked earlier by the pinned Tink
dependencies (`tink.OutcomeTools` and `ClassBuilder` compatibility), before
Genes' null-safety diagnostics could be evaluated. This is an explicit
toolchain blocker, not evidence that the Genes source passed the preview
checker.

No compiler-server cache or session object is introduced for null safety.
Every request installs the package rule before Genes types load; the existing
cold/warm server gate verifies that repeated TS, TSX, and classic requests
remain isolated.

See also:

- [`typescript-target/TYPING_POLICY.md`](typescript-target/TYPING_POLICY.md) for
  emitted `null`, `undefined`, and optional-property types;
- [`ARCHITECTURE.md`](ARCHITECTURE.md) for `NullishContract`,
  `TsBoundaryPlan`, and compiler-process ownership;
- [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) for the evidence supplied by
  each gate.
