# React / TSX authoring in Haxe (genes-ts)

genes-ts includes a **compile-time JSX/HXX macro** so you can write TSX-like
markup in Haxe and get **idiomatic, type-checked TS/TSX output**.

Key properties:
- **Compile-time only** (no runtime template engine)
- `{ ... }` interpolations are **real Haxe expressions** (typed by Haxe)
- Resulting output is type-checked by **TypeScript** against React typings

## Requirements

- Use **TypeScript output mode**: `-D genes.ts`
  - Classic Genes JS output does **not** lower JSX markers.
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

## Inline markup (opt-in)

Inline markup enables writing:

```haxe
return <div className={"x"}>{title}</div>;
```

Enable it in your build:
- `-D genes.react.inline_markup` (scoped)
- `-D genes.react.inline_markup_all` (global; use sparingly)

Note: The build macro that rewrites inline markup is installed automatically by
`-lib genes-ts` (via `extraParams.hxml`). The defines above control whether it
does any work.

Scoped enablement requires class metadata:

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
