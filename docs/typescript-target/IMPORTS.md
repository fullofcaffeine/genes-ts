# Importing existing JS/TS/TSX (genes-ts)

genes-ts aims to make it easy to consume existing JS/TS/TSX libraries while:
- keeping Haxe code ergonomic, and
- producing correct ESM imports in **both** output modes:
  - genes-ts TypeScript output (`-D genes.ts`)
  - classic Genes JS output (default)

There are two supported approaches:

1) Standard Haxe interop (`@:jsRequire(...)` externs)
2) The macro-based helper `genes.ts.Imports` (recommended for new genes-ts projects)

## 1) Standard Haxe interop: `@:jsRequire` externs

This is the classic Haxe approach:

```haxe
@:jsRequire("react-dom/server", "renderToString")
extern function renderToString(node: Dynamic): String;
```

Pros:
- explicit
- familiar to Haxe JS users

Cons:
- more boilerplate when you just want a single import in a local scope
- harder to keep import names stable/diff-friendly across refactors

## 2) `genes.ts.Imports` (macro-based helper)

`genes.ts.Imports` generates hidden `@:jsRequire` externs and returns a typed
expression referencing the imported value.

This keeps import generation compatible with Genes’ dependency tracking in both
output modes.

### Default import

```haxe
import genes.ts.Imports;

final Button = Imports.defaultImport("./components/Button.js");
```

### Named import

```haxe
import genes.ts.Imports;

final renderToString = Imports.namedImport("react-dom/server", "renderToString");
```

### Namespace import

```haxe
import genes.ts.Imports;

final Path = Imports.namespaceImport("node:path");
final joined = Path.join("a", "b");
```

### Alias control

All helpers accept an optional alias override:

```haxe
final ReactDOMServer = Imports.namespaceImport("react-dom/server", "ReactDOMServer");
```

## Import specifiers: `.js` vs extensionless

genes-ts TypeScript output defaults to emitting explicit `.js` import specifiers
for Node ESM compatibility.

That means *your* module specifiers should normally also be `.js`-shaped, even
when the source file is `.ts` or `.tsx`:

- `./components/Button.js` (recommended; NodeNext-friendly)
- `./components/Button` (bundler-friendly; use `-D genes.ts.no_extension`)

TypeScript’s `moduleResolution: "NodeNext"` supports resolving `.js` specifiers
to `.ts`/`.tsx` sources during type-checking, and after compilation Node will
load the real `.js` file.

## Notes

- `genes.ts.Imports` expects string literals (so the compiler can generate stable
  imports).
- For dotted exports (e.g. `"Dropdown.Menu"`), prefer using the helper from a
  local scope (it handles local aliasing correctly).

---

## TS importing Haxe-generated modules (migration story)

genes-ts is designed so you can gradually port a codebase to “pure TS” over time.
One important pattern is:

- **TS-authored** modules import and call **Haxe-generated** modules, while
- the overall app/library still builds with normal TS tooling.

This is especially useful when:
- you want TS-only code to wrap or adapt a generated Haxe module,
- you want to expose a stable public API boundary to TS consumers, or
- you are migrating incrementally (some modules rewritten in TS, others still in Haxe).

The todoapp harness contains a concrete example:

- `examples/todoapp/web/src-ts/interop/haxeInterop.ts` (TS) imports a Haxe-emitted
  value from `examples/todoapp/web/src-gen/**`
- Haxe then imports the TS function back via `genes.ts.Imports` and renders the
  returned banner in the UI

Important DCE note:

Haxe DCE does not see TS-only imports. If a Haxe-emitted value is *only* referenced
from TS-authored code, it may be removed. In apps/examples, keep such values
explicitly (e.g. call them once or use `@:keep`) so the interop boundary remains
stable and deterministic.
