# React HXX (genes-ts): TSX-like authoring in Haxe

Goal: let users write **React/TSX-style markup in Haxe**, compile it with `genes-ts`, and get:
- **Type-safe** component props (at least for Haxe-defined components)
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

Output shape v1:
- Generate `React.createElement(...)` calls (works in `.ts`, no TSX required).

Future option:
- Emit TSX (`.tsx`) for more idiomatic generated output and better debug UX.

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

### C) Type safety strategy (incremental)

Phase 1 (good UX, minimal scope):
- **Component tags** get typed props:
  - `<MyComponent foo={123} />` should type-check against `MyComponent`’s props type.
- **Intrinsic tags** (`div`, `span`, …) accept `Dynamic` props initially.

Phase 2 (strict intrinsic elements):
- Add an optional registry that maps intrinsic tag names → props types (like TS’s `JSX.IntrinsicElements`).
- Use it for compile-time validation and better IDE completion.

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

- Add a small fixture under `tests_ts_full/` that:
  - Uses `genes.react.JSX.jsx(...)` to create a tree
  - Renders it via `react-dom/server` (`renderToString`)
  - Asserts output (runtime smoke)
- Add an opt-in inline-markup fixture gated by `-D genes.react.inline_markup`

## Tracking

Beads issue: `genes-t6g.12`

