# React / TSX authoring in Haxe (Genes TS and classic JS)

genes-ts includes a **compile-time JSX/HXX macro** so you can write TSX-like
markup in Haxe and get **idiomatic, type-checked TS/TSX output**.

Key properties:
- **Compile-time only** (no runtime template engine)
- `{ ... }` interpolations are **real Haxe expressions** (typed by Haxe)
- Resulting output is type-checked by **TypeScript** against React typings
- The same validated marker intent lowers to React-compatible runtime calls in
  classic Genes JavaScript

## Requirements

- TypeScript source profiles use `-D genes.ts`; classic ESM omits it.
- Install `react` and `react-dom` for runtime execution.
- TypeScript source profiles also need `@types/react` and `@types/react-dom`.
- Classic inline markup is opt-in with `@:jsx_inline_markup`,
  `-D genes.react.inline_markup`, or `-D genes.react.inline_markup_all`.
  The explicit `jsx("...")` macro already creates marker intent without that
  parser-level opt-in.

## Two output styles: `.tsx` vs `.ts`

genes-ts supports both:

1) **TSX mode** (`.tsx` output)
   - Emit `.tsx` and print real TSX markup.
   - Configure TypeScript with `jsx: "react-jsx"` (recommended).

2) **Low-level mode** (`.ts` output)
   - Emit `.ts` and lower JSX into `React.createElement(...)`.
   - Useful when you want plain `.ts` output (or when TSX is undesirable).

Selection is based on the `-js` output filename extension:

```hxml
# TSX mode
-js src-gen/index.tsx
-D genes.ts

# Low-level mode
-js src-gen/index.ts
-D genes.ts
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
- Interpolations are parsed with `Context.parse(...)`, so `{ ... }` must be valid Haxe.

## Inline markup (default in TypeScript mode)

Inline markup enables writing:

```haxe
return <div className={"x"}>{title}</div>;
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
| TSX automatic (`.tsx`, `-D genes.ts`) | Inline markup or `jsx("...")` | Emits JSX/TSX; TypeScript validates tags/props/children. Runtime string tags use the planned factory namespace. |
| TSX classic (`.tsx`, plus `-D genes.ts.jsx_classic`) | Inline markup or `jsx("...")` | Emits JSX/TSX plus the required `React` namespace import. |
| TS (`.ts`, `-D genes.ts`) | Inline markup or `jsx("...")` | Lowers to typed `React.createElement(...)`, including `satisfies` prop checks. |
| Classic Genes JS | `jsx("...")`, or opted-in inline markup | Lowers the same ordered intent to plain React-compatible `createElement(...)`/`Fragment` calls. |

`src/genes/JsxPlan.hx` owns marker recognition, tags/components, ordered
named/spread props, children, fragments, source provenance, and capability
selection before either printer runs. It also distinguishes a direct value
from a Haxe-lifted marker local, so property and child side effects are read
from their evaluated path instead of executing twice. The identical-source fixture
`DualJsxMain.hx` renders through TSX and classic JS under
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

return jsx('<Button label={"Save"} />');
```

---

## Typechecking behavior (important)

The JSX/HXX macros are **syntactic sugar**: they don’t typecheck React props at
Haxe compile time.

Instead, the contract is:

- Haxe typechecks the **interpolated expressions** (`{ ... }`) as normal Haxe.
- TypeScript typechecks the **resulting TS/TSX** against React typings (`@types/react`).

This is why genes-ts strongly recommends:

- `tsc --noEmit` in CI for your generated output, and
- strict React typings installed in the consuming project.

### Testing for expected TS errors

In snapshot fixtures and harnesses, it’s often useful to assert that TypeScript
*rejects* an invalid pattern (e.g. wrong prop type).

Since the invalid code must still pass Haxe typing, the pattern used in this repo
is to inject `// @ts-expect-error` right before the generated TS expression:

```haxe
js.Syntax.code("// @ts-expect-error");
final bad = jsx('<Button label={123} />');
```

If the generated TS becomes “too loose” (e.g. `any` leaks), TypeScript will stop
erroring and then fail due to an unused `@ts-expect-error` directive — which is
exactly what we want for regression protection.

The React profiles include negative checks for event handlers, component prop
types, invalid intrinsic attributes, and invalid child records across TSX and
typed createElement output. Positive spread/component/reactive examples and
the same-source classic differential run beside them. This is strong evidence
for those cases, not a claim that every framework-specific JSX namespace or
component identity pattern is covered.
