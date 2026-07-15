# React / TSX authoring in Haxe (genes-ts)

genes-ts includes a **compile-time JSX/HXX macro** so you can write TSX-like
markup in Haxe and get **idiomatic, type-checked TS/TSX output**.

Key properties:
- **Compile-time only** (no runtime template engine)
- `{ ... }` interpolations are **real Haxe expressions** (typed by Haxe)
- Resulting output is type-checked by **TypeScript** against React typings

## Requirements

- Use **TypeScript output mode**: `-D genes.ts`
  - Classic Genes JS output does **not** currently lower JSX markers. Inline
    markup can be parsed outside TS mode when explicitly enabled, but the
    resulting marker calls are not a supported classic output contract.
- Install React + typings in your consuming project:
  - `react`, `react-dom`, `@types/react`, `@types/react-dom`

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
legacy scoped switch, or `-D genes.react.inline_markup_all` globally. These
flags do not make classic Genes lower JSX markers; they only control the Haxe
markup rewrite.

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
| TSX (`.tsx`, `-D genes.ts`) | Inline markup or `jsx("...")` | Emits JSX/TSX and lets the configured JSX type namespace validate it. |
| TS (`.ts`, `-D genes.ts`) | Inline markup or `jsx("...")` | Lowers to `React.createElement(...)`. |
| Classic Genes JS | Ordinary non-JSX Haxe | First-class runtime path. JSX marker lowering is currently unsupported. |

`genes-09r.5` tracks a target-neutral `JsxIntent` and an explicit capability
decision for classic output. Until that lands, JSX-bearing modules are outside
the general same-source dual-output promise.

## TSX runtime: automatic vs classic

Default expectation:
- TypeScript `jsx: "react-jsx"` (automatic runtime)

If your project uses classic runtime (`jsx: "react"`), add:
- `-D genes.ts.jsx_classic`

This makes genes-ts emit `import * as React from "react"` in `.tsx` modules that
use JSX markers.

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

The React snapshot profiles currently include negative prop checks. The broader
matrix for intrinsic props, required component props, child types, spread
props, and component identity remains part of `genes-09r.5`; a passing positive
TSX build alone is not evidence that all JSX surfaces are closed.
