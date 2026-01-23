# React HXX (genes-ts): TSX-like authoring in Haxe

Goal: let users write **React/TSX-style markup in Haxe**, compile it with `genes-ts`, and get:
- **Type-safe** component props
- **Type-safe** intrinsic elements (e.g. `<div ...>`), no Dynamic fallback
- **Ergonomic** authoring (string templates and/or inline markup)
- **Zero runtime template engine** (compile-time only)

This is intentionally modeled after the Reflaxe.Elixir `HXX` + `InlineMarkup` pattern in:
- `/Users/fullofcaffeine/workspace/code/haxe.elixir.codex/docs/05-architecture/HXX_ARCHITECTURE.md`
- `/Users/fullofcaffeine/workspace/code/haxe.elixir.codex/src/reflaxe/elixir/macros/InlineMarkup.hx`

## Proposed user API

### 1) String template macro (recommended baseline)

```haxe
import genes.react.JSX.*;

return jsx('
  <div className={completed ? "done" : ""}>
    <Button onClick={save}>Save</Button>
  </div>
');
```

Notes:
- `{ ... }` inside markup is parsed as a **Haxe expression** (typed by Haxe).
- This is TSX-like while still being “just Haxe”.

### 2) Inline markup (opt-in syntax sugar)

Haxe parses inline markup as `@:markup "<...>"` and requires a build-macro rewrite.

```haxe
@:jsx_inline_markup // or global define + scoped auto-enable
class MyView {
  function render() {
    return <div className={"x"}>{title}</div>;
  }
}
```

Implementation mirrors Reflaxe.Elixir:
- Rewrite `@:markup "<...>"` → `JSX.jsx("<...>")` before typing
- Keep it opt-in to avoid global compile-time overhead

## Implementation approach

### A) Compile-time only macro expansion

Implement `genes.react.JSX.jsx(template: Expr): Expr` (macro):
- Accepts a **string literal** (including multi-line `'\n ...'`).
- Parses a JSX-ish subset (XML-like tags + attributes + children).
- Lowers to a normal Haxe expression that builds React nodes.

Output shapes (do both):
- **Default (idiomatic):** emit `.tsx` and print TSX markup for React element expressions.
- **Low-level mode:** emit `.ts` and keep `React.createElement(...)` calls.

JSX runtime recommendation:
- Default to the **automatic runtime** (TypeScript `jsx: "react-jsx"`), since it:
  - avoids per-file `import React from "react"` boilerplate
  - matches modern React projects
- Allow classic runtime as an opt-in for older setups.

### B) Interpolation + attribute values

Support:
- Text children
- Nested elements
- `{haxeExpr}` children
- Attributes:
  - `name="string"`
  - `name={haxeExpr}`

Avoid “stringly” expression parsing wherever possible:
- Use `Context.parse()` on the `{...}` contents to get a real `Expr`.
- Keep error positions readable (line/column mapping relative to the template literal).

### C) Type safety strategy (always typed)

- **Component tags** get typed props:
  - `<MyComponent foo={123} />` type-checks against `MyComponent`’s props type.
- **Intrinsic tags** are always typed:
  - `<div onClick={...} />` is validated against a typed intrinsic-props surface (no `Dynamic` fallback).
  - `data-*` / `aria-*` support should be included (typed) so real-world apps don’t get blocked.

### D) Inline markup rewrite (opt-in)

Implement `genes.react.InlineMarkup` similar to Reflaxe.Elixir’s `InlineMarkup`:
- Define gate: `-D genes.react.inline_markup` (name TBD; keep consistent with other `genes.ts.*` defines)
- Global `@:build(...)` install when the gate is enabled
- Rewrite `EMeta(name=":markup", CString(...))` → `JSX.jsx(CString(...))`
- Keep it scoped:
  - per-module opt-in meta like `@:jsx_inline_markup`
  - or “React-facing module” metas (TBD)

## Known constraints (from Haxe inline markup)

Same constraints as Reflaxe.Elixir inline markup:
- Root must be a valid XML tag name (no fragment roots like `<>...</>`)
- Some JSX/TSX tag names are not valid XML (`<Foo.Bar>`, `<React.Fragment>`, etc.)
  - Mitigation: allow aliases (`<Fragment>...</Fragment>`) or require string-template form for advanced tags.

## Testing plan

- Add a TSX-focused harness (separate from `tests_ts_full`) that:
  - compiles with `tsc` `jsx: "react-jsx"` (default)
  - runs a Node runtime smoke test with `react-dom/server`
- Add a small fixture under that harness that:
  - Uses `genes.react.JSX.jsx(...)` to create a tree
  - Renders it via `react-dom/server` (`renderToString`)
  - Asserts output (runtime smoke)
- Add an opt-in inline-markup fixture gated by `-D genes.react.inline_markup`

## Consuming existing TSX/JSX components

genes-ts relies on normal Haxe JS-platform interop patterns for importing values:
- `@:jsRequire(...)` on an `extern` type (default/named imports)
- regular Haxe `import` / `using` for module structure

### Import a local TSX component (default export)

```haxe
// ButtonExterns.hx (or any module you keep externs in)
@:jsRequire("./components/Button.tsx", "default")
extern class Button {}
```

Then use it in markup:

```haxe
import genes.react.JSX.*;

return jsx('<Button label={"Save"} />');
```

Type-safety comes from the emitted TS/TSX being checked by `tsc` against the component’s real props type.

### Import a named export from an npm package

```haxe
@:jsRequire("@radix-ui/react-dialog", "Root")
extern class DialogRoot {}
```

## Tracking

Beads issue: `genes-t6g.12`

## Output mode note

React HXX is designed for **genes-ts TypeScript output** (`-D genes.ts`), where the TS emitter can lower JSX markers into either:
- idiomatic `.tsx` output, or
- low-level `.ts` output using `React.createElement(...)`.
