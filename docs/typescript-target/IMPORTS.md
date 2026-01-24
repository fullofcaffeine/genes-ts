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

