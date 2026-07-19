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
a base interface.

An imported extern class can name a closed property contract directly. This is
useful when `@:jsRequire` represents a React component as a class value rather
than a Haxe function:

```haxe
@:genes.compilerInternal typedef LinkProps = {
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
open, or unsafe.

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
`GTS-HXX-SCHEMA-007` at the duplicate declaration.

The bundled provider is deliberately a reviewed common subset, not a loose
copy of every version of `@types/react`. If an application needs another valid
attribute, extend a typed provider or contribute the missing generic contract.
Do not work around a missing field with `Dynamic`, a cast, or a raw TypeScript
type string: those approaches would move the error past Haxe again.

Default React event contracts retain their element parameter. For example, an
`<input>` callback contextually receives
`genes.react.ChangeEvent<genes.react.InputElement>`, so
`event.target.value` is checked in Haxe and is emitted as React's canonical
`ChangeEvent<HTMLInputElement>`. Anchor events similarly retain
`genes.react.AnchorElement`/`HTMLAnchorElement`. A callback may intentionally
omit supplied event parameters or return a value when the consumer expects
`Void`, matching JavaScript/TypeScript callback subtyping. The reverse is not
safe: a callback that requires an argument cannot fill a contract whose caller
may omit that argument. Declared parameters are checked contravariantly, and
incompatible event targets fail in Haxe even when their extern wrappers have no
runtime fields.

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
extra, duplicate and wrong props, unsafe keys and nested values, handler target/optionality,
required and unexpected children, non-renderable children, and invalid spreads
before any TypeScript lane runs. The harness checks the exact authored HXX line,
not merely the source filename. Positive alias, generic, inherited-interface,
wrapper, prefix, custom-provider, packed-release, and runtime fixtures run
beside them. Provider coverage is explicit and extensible; it is not a claim
that every third-party JSX namespace is built in.
