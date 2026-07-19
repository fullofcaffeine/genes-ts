# Haxe-authoritative React HXX (`.tsx`, `.jsx`, `.ts`, and `.js`)

genes-ts includes a **compile-time JSX/HXX macro** so you can write TSX-like
markup in Haxe and get idiomatic checked React source in four output profiles.

Key properties:
- **Compile-time only** (no runtime template engine)
- Tags, component props, handlers, spreads, and children are checked by Haxe
  against real Haxe types before any output is committed.
- `{ ... }` interpolations remain real, contextually typed Haxe expressions.
- TypeScript checks `.tsx` and `.ts` output independently as a parity oracle.
- One validated semantic plan emits typed TSX, type-erased JSX, typed
  `createElement`, or equivalent classic JavaScript calls.

## Requirements

- TypeScript source profiles use `-D genes.ts`; classic ESM omits it.
- Install `react` and `react-dom` for runtime execution.
- TypeScript source profiles also need `@types/react` and `@types/react-dom`.
- Classic inline markup is opt-in with `@:jsx_inline_markup`,
  `-D genes.react.inline_markup`, or `-D genes.react.inline_markup_all`.
  The explicit `jsx("...")` macro already creates marker intent without that
  parser-level opt-in.

## Four output profiles

Genes supports all four from the same HXX source:

1) **TSX mode** (`.tsx` output)
   - Emit `.tsx` and print real TSX markup.
   - Configure TypeScript with `jsx: "react-jsx"` (recommended).

2) **Low-level mode** (`.ts` output)
   - Emit `.ts` and lower JSX into `React.createElement(...)`.
   - Useful when you want plain `.ts` output (or when TSX is undesirable).

3) **JSX mode** (`.jsx` output)
   - Omit `-D genes.ts`; Haxe types are erased while JSX syntax remains.
   - Internal imports use runtime-correct `.js` specifiers for the JSX transform.

4) **Classic JavaScript mode** (`.js` output)
   - Omit `-D genes.ts`; JSX lowers directly to React-compatible runtime calls.

Selection is based on the `-js` output filename extension:

```hxml
# TSX mode
-js src-gen/index.tsx
-D genes.ts

# Low-level mode
-js src-gen/index.ts
-D genes.ts

# Type-erased JSX mode
-js src-gen/index.jsx
-D genes.react.inline_markup

# Classic JavaScript mode
-js src-gen/index.js
-D genes.react.inline_markup
```

## Basic usage: `jsx("...")` template

```haxe
import genes.react.JSX.*;

function render(title: String, completed: Bool) {
  return jsx('
    <div className={completed ? "done" : ""}>
      <h1>{title}</h1>
    </div>
  ');
}
```

Supported syntax (intentionally small, TSX-like subset):
- Tags + nested tags
- String attrs (`className="x"`)
- Expr attrs (`onClick={handler}`)
- Boolean attrs (`disabled`)
- Spread attrs (`{...props}`)
- Children as text and `{haxeExpr}`
- Fragments in templates (`<>...</>`)

Notes:
- `jsx(...)` expects a **string literal** (for stable codegen).
- Interpolations are parsed with `Context.parseInlineString(...)`, so `{ ... }`
  must be valid Haxe and diagnostics retain the authored expression span.

## Inline markup (default in TypeScript mode)

Inline markup enables writing:

```haxe
return <div className="x">{title}</div>;
```

The build macro is installed automatically by `-lib genes-ts` (via
`extraParams.hxml`). In `-D genes.ts` builds it rewrites inline markup for every
class by default. Disable it globally with
`-D genes.react.no_inline_markup`, or for a single class with
`@:jsx_no_inline_markup`.

Outside TypeScript mode, the parser rewrite remains opt-in. Use
`@:jsx_inline_markup` for one class, `-D genes.react.inline_markup` for the
scoped switch, or `-D genes.react.inline_markup_all` globally. Once rewritten,
classic Genes consumes the same `JsxPlan` and emits React-compatible
`createElement`/`Fragment` calls; no marker extern remains at runtime.

Example of the narrow opt-in outside TS mode:

```haxe
@:jsx_inline_markup
class MyView {
  function render(title: String) {
    return <div>{title}</div>;
  }
}
```

Haxe inline markup has XML constraints, so prefer `jsx("...")` templates when you
need fragment roots (`<>...</>`) or tags that aren’t valid XML names.

## Output capability table

| Profile | Authoring input | Current lowering contract |
| --- | --- | --- |
| TSX automatic (`.tsx`, `-D genes.ts`) | Inline markup or `jsx("...")` | Emits JSX/TSX after Haxe validation; TypeScript checks parity. Runtime string tags use the planned factory namespace. |
| TSX classic (`.tsx`, plus `-D genes.ts.jsx_classic`) | Inline markup or `jsx("...")` | Emits JSX/TSX plus the required `React` namespace import. |
| TS (`.ts`, `-D genes.ts`) | Inline markup or `jsx("...")` | Lowers to typed `React.createElement(...)`, including `satisfies` prop checks. |
| JSX (`.jsx`, without `-D genes.ts`) | `jsx("...")`, or opted-in inline markup | Keeps JSX syntax while erasing Haxe types; runtime string tags use the planned factory namespace. |
| Classic Genes JS | `jsx("...")`, or opted-in inline markup | Lowers the same ordered intent to plain React-compatible `createElement(...)`/`Fragment` calls. |

`src/genes/JsxPlan.hx` owns marker recognition, tags/components, ordered
named/spread props, children, fragments, source provenance, and capability
selection before either printer runs. It also distinguishes a direct value
from a Haxe-lifted marker local, so property and child side effects are read
from their evaluated path instead of executing twice. The identical-source fixture
`DualJsxMain.hx` renders through TSX, type-erased JSX, and classic JS under
`yarn test:genes-ts:tsx` and compares the resulting HTML transcript.

## TSX runtime: automatic vs classic

Default expectation:
- TypeScript `jsx: "react-jsx"` (automatic runtime)

If your project uses classic runtime (`jsx: "react"`), add:
- `-D genes.ts.jsx_classic`

This makes genes-ts emit `import * as React from "react"` in `.tsx` modules that
use JSX markers.

Direct createElement profiles use a namespace module selected by:

```hxml
# Default is react; another module must expose compatible runtime and TS types.
-D genes.react.jsx_runtime_module=react
```

`-D genes.react.jsx_runtime_module=none` explicitly disables that capability.
If a module needs direct runtime calls (classic JS, `.ts`, or a dynamic string
tag in automatic TSX), compilation fails with `GTS-JSX-CAPABILITY-001` at the
original Haxe markup position before generated files are committed.

## Return type: `genes.react.Element`

The macro result is typed as `genes.react.Element`, which maps to TypeScript’s
`JSX.Element` in generated TS.

You can annotate your APIs with `genes.react.Element` to keep signatures clean.

## Consuming existing components (TSX/JSX)

Use either:
- standard Haxe `@:jsRequire(...)` externs, or
- the macro helper `genes.ts.Imports` (recommended)

See `docs/typescript-target/IMPORTS.md`.

Example (default export):

```haxe
import genes.react.JSX.*;
import genes.ts.Imports;

final Button = Imports.defaultImport("./components/Button.js");

return jsx('<Button label="Save" />');
```

---

## Typechecking behavior (important)

Haxe is the primary checker. A component function's first argument is its exact
prop contract; `genes.react.ComponentType<Props>` and compatible wrappers can
declare a prop type parameter with `@:genes.jsxComponentProps(index)`. HXX uses
that identity to provide contextual callback typing, infer generic props, and
check required, optional, extra, duplicate, spread, and `children` values.
Extern and ordinary Haxe interfaces may extend other property interfaces; HXX
collects their public inherited fields before it checks the tag. This matters
for library contracts that keep common accessibility or callback properties in
a base interface. Closed recursive typedefs are valid too—for example, a tree
node may contain `Array<Node>`. HXX follows the fields once, checks every
concrete value it can observe, and recognizes the repeated typed declaration as
recursion rather than mistaking it for an unresolved type.

Property contracts must remain concrete all the way through their nested
fields. HXX rejects `Dynamic`, Haxe's core `Any`, and `genes.ts.Unknown` in both
supplied values and declared component or intrinsic schemas; supplied values
also cannot rely on an unresolved monomorph. Fresh inference variables on a
generic component are different: Haxe binds them from checked HXX arguments,
so generic components retain their ordinary inference. Attribute-prefix
declarations follow the same rule because their one field type is the complete
contract for every matching property. A value typed as `Null<T>` fills only a
nullable or union contract; it cannot fill a required non-null `T` merely
because Haxe's JavaScript target can unify those types. `@:optional` spread
fields remain distinct from explicit nullable values: they represent possible
omission and are checked against required-field rules.

HXX keeps three absence contracts separate:

- `@:optional` means that an object may omit the property;
- `Null<T>` means that a supplied value may be Haxe `null`;
- `genes.ts.Undefinable<T>` means that a supplied host value may be JavaScript
  `undefined`.

For example, a required `Undefinable<String>` property must still be present,
and `Null<String>` cannot fill it. The bundled React DOM provider opts into
explicit `undefined` for its optional properties because React's TypeScript
definitions accept that form. This opt-in removes only the outer `Null<T>` that
Haxe adds internally for an optional field: a supplied Haxe `null` still fails
when React expects `T | undefined`. A provider can spell
`Undefinable<Null<T>>` when its real host contract intentionally accepts both.
A custom intrinsic provider keeps ordinary Haxe optional/null behavior unless
its class declares `@:genes.jsxOptionalValuesAllowUndefined`.

HXX also distinguishes a child that **might** come from a spread from one that
is **definitely** present. This matters when the component requires a child.
For example, this `Card` always needs one React element:

```haxe
typedef CardProps = {
  final children: genes.react.Element;
}

typedef MaybeChildren = {
  @:optional
  var children: genes.react.Element;
}

function Card(props: CardProps): genes.react.Element {
  return <section>{props.children}</section>;
}

final props: MaybeChildren = {};
final card = <Card {...props}><strong>nested child</strong></Card>;
```

`@:optional` means the field may be missing, so the spread alone cannot satisfy
`Card`'s required child. The nested `<strong>` supplies that required value. If
`props.children` is present, the nested child still wins because it comes after
the spread. TSX keeps that source order; typed `createElement` output places the
nested value last in the checked property object; classic `createElement`
passes it after the property object. All three forms therefore give `Card` the
same final child.

`@:ts.optional` is not needed for this presence rule. That separate annotation
controls whether an optional value is represented with JavaScript
`undefined` in generated TypeScript. A direct `children={...}` property or a
required `children` field in a spread is definitely present, so combining
either one with nested markup still reports `GTS-HXX-CHILD-004`.

Array-shaped child contracts follow React's actual runtime shape. With
`children: Array<Item>`, one nested expression must itself be an `Array<Item>`:

```haxe
<List>{items}</List>
```

Two or more separately written children are collected into that array. One
scalar child is rejected because React would pass the scalar directly; it does
not create a one-item array automatically. Write `{[item]}` when a one-item
array is intended.

An imported extern class can name a closed property contract directly. This is
useful when `@:jsRequire` represents a React component as a class value rather
than a Haxe function:

```haxe
@:genes.compilerInternal
@:genes.semanticOnly
typedef LinkProps = {
  final to: String;
  final children: genes.react.Node;
}

@:jsRequire("react-router-dom", "Link")
@:genes.jsxComponentProps("my.extern.ReactRouter.LinkProps")
extern class Link {}
```

The string must be a fully qualified Haxe type path. It is resolved by Haxe at
compile time; it is not emitted or interpreted at runtime. Both the generic
index and type-path forms fail closed when the referenced contract is missing,
open, or unsafe. `@:genes.compilerInternal` keeps an ordinary alias available
to generated code while hiding it from exports and declarations.
`@:genes.semanticOnly` is the narrower opt-in used above: it says the checker
is the only consumer and no emitted annotation may name the alias. Do not add
that second annotation to a type used by generated local code.

Direct generic function components keep Haxe's inferred property type in the
plain `.ts` createElement profile. For example, a checked call to
`GenericValue<Int>` emits `createElement<GenericValueProps<number>>(...)`
instead of allowing React's utility type to widen the generic argument to
`unknown`. If HXX cannot determine every generic parameter, it leaves the
specialization to React rather than printing a type parameter that is not in
scope.

Lowercase tags are resolved through the typed
`genes.react.IntrinsicElements` provider. A JSX runtime can replace it with a
comma-separated provider list:

```hxml
-D genes.react.jsx_intrinsic_providers=my.ui.IntrinsicElements
```

Provider fields use `@:genes.jsxIntrinsic("tag-name")`; prefix fields use
`@:genes.jsxAttributePrefix("data-")`. The field type—not its metadata
spelling—is the Haxe prop/value contract. Unknown tags and unresolved contracts
fail closed rather than falling back to a permissive top type. A provider also
cannot declare the same prefix twice: competing value types would make the
accepted contract depend on field order, so HXX reports
`GTS-HXX-SCHEMA-007` at the duplicate declaration. A weak component, intrinsic,
or prefix field fails with `GTS-HXX-SCHEMA-008` before its type can erase HXX's
compile-time guarantees. Prefixes such as `data-` and `data-count-` may not
overlap (`GTS-HXX-SCHEMA-009`), because the chosen contract would otherwise
depend on provider field order. A schema-changing annotation may appear only
once on a field (`GTS-HXX-SCHEMA-010`).

The bundled provider is deliberately a reviewed common subset, not a loose
copy of every version of `@types/react`. If an application needs another valid
attribute, extend a typed provider or contribute the missing generic contract.
Do not work around a missing field with `Dynamic`, a cast, or a raw TypeScript
type string: those approaches would move the error past Haxe again.

Default React event contracts retain their element parameter. For example, an
`<input>` callback contextually receives
`genes.react.ChangeEvent<js.html.InputElement>`, so the complete standard Haxe
DOM surface—including methods such as `setSelectionRange`—is checked before
output exists and is emitted as React's canonical
`ChangeEvent<HTMLInputElement>`. Anchor events similarly retain
`js.html.AnchorElement`/`HTMLAnchorElement`. Genes' focused compatibility
facades provide stable schema identities, while contextual inline callbacks are
projected to those complete standard externs. Genes does not publish browser
typedef modules merely because Haxe loaded them while resolving an ambient
extern: a type-only module must be named by emitted syntax or explicitly
exported before it becomes reachable. Existing annotated handlers may name the
standard DOM extern directly. HXX compares compiler-owned browser identities
rather than a printed type string. A callback may intentionally
omit supplied event parameters or return a value when the consumer expects
`Void`, matching JavaScript/TypeScript callback subtyping. The reverse is not
safe: a callback that requires an argument cannot fill a contract whose caller
may omit that argument. Declared parameters are checked contravariantly, and
incompatible event targets fail in Haxe even when their extern wrappers have no
runtime fields. HXX still rejects weak callback parameters and observable
return values. It ignores only a result paired with an expected `Void`, because
the caller has explicitly promised not to read that result; this lets an event
handler start a typed async boundary without exposing the boundary value as a
component property.

Renderable children include the closed `genes.react.OneOf*` carriers and
standard `haxe.extern.EitherType` unions. Domain abstracts backed by a React
scalar remain renderable without erasing their Haxe identity.

Keep `tsc --noEmit` and strict React typings in CI for `.tsx`/`.ts`. They prove
that Haxe-derived output still matches the real consumer ecosystem, but an
invalid HXX program must already have failed in Haxe.

### Negative Haxe evidence

Negative fixtures compile one invalid HXX operation at a time and assert its
stable source-positioned diagnostic. For example:

```haxe
final bad = <Button label={123} />;
// [GTS-HXX-PROP-002] component `Button` property `label` expects `String`
// but received `Int`.
```

The repository covers tag typos, component identity/return types, missing,
extra, duplicate and wrong props, unsafe keys, weak schemas and nested values,
nullable-to-required assignments, handler target/optionality, required and
unexpected children, non-renderable children, and invalid spreads before any
TypeScript lane runs. The harness checks the exact authored HXX line, not merely
the source filename. Positive alias, generic, inherited-interface, wrapper,
nullable, recursive, prefix, custom-provider, packed-release, and runtime
fixtures run beside them. Provider coverage is explicit and extensible; it is
not a claim that every third-party JSX namespace is built in.
