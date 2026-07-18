# Importing existing JS/TS/TSX (genes-ts)

genes-ts aims to make it easy to consume existing JS/TS/TSX libraries while:
- keeping Haxe code ergonomic, and
- producing correct ESM imports in **both** output modes:
  - genes-ts TypeScript output (`-D genes.ts`)
  - classic Genes JS output (default)

This page is the import-helper and extern reference. For complete recipes in
both directions—including TypeScript consuming generated Haxe modules, DCE,
classic declarations, and same-source verification—read the
[TypeScript ↔ Haxe interop cookbook](INTEROP.md).

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

### CommonJS `export =` constructor instances

Some `@types` packages describe a callable or constructable CommonJS export as
a value plus a merged namespace rather than as a TypeScript class:

```ts
declare namespace Database {
  interface Instance { close(): void }
  interface Constructor { new(path: string): Instance }
}
declare const Database: Database.Constructor;
export = Database;
```

The normal Haxe extern remains class-shaped because that is the useful
authoring and runtime contract. Add `@:ts.instanceType` when the imported value
does not itself occupy TypeScript's type namespace:

```haxe
/**
 * CommonJS constructor value whose `@types` package exposes instances through
 * its construct signature instead of a class declaration.
 */
@:jsRequire("database-package")
@:ts.instanceType
extern class Database {
  public function new(path:String);
  public function close():Void;
}
```

Constructor expressions still emit against the ordinary default import. Type
positions in generated TypeScript and classic `.d.ts` instead use the resolved
import alias:

```ts
import Database from "database-package"

declare db: InstanceType<typeof Database>
```

This annotation is explicit because `@:jsRequire("package")` may also point to
a genuine class export, where the direct `Database` type is already correct.
The current contract accepts non-generic extern classes bound to default or
named `@:jsRequire` values. It rejects namespace imports, generic applications,
arguments, and combinations with raw `@:ts.type` / `@:genes.type` overrides so
an unsupported package shape cannot silently widen or change meaning. The
blocking `yarn test:interop:module-shapes` fixture type-checks the same source on
TS 5, TS 6, and TS 7, then executes both TS and classic Genes output.

### Generating externs from npm declarations with dts2hx

Use dts2hx for package `.d.ts` ingestion; ts2hx serves the separate and much
more constrained implementation-source migration workflow. A normal modular
package can be generated into a class path or haxelib wrapper:

```bash
npx dts2hx package-name --modular
```

The resulting `@:jsRequire` externs are ordinary Haxe APIs. genes-ts converts
their value imports to typed TypeScript imports, while classic Genes erases the
types and emits the equivalent ESM runtime imports. Haxe 5's dts2hx
`@:js.import` mode is a separate preview capability; the stable Haxe 4.3
contract remains `@:jsRequire` plus Genes ESM emission.

The repository pins a reproducible bridge rather than embedding dts2hx's
converter. `yarn test:interop:module-shapes` resolves shared local packages
through both tools' TypeScript API seams, generates externs twice, compares a
checked-in hash manifest, forbids generated `Dynamic`/`Any`, and exercises:

- an ESM root with named values and types;
- a typed package subpath;
- conditional `types` / `import` / `require` exports; and
- a class-shaped CommonJS `export =` constructor.

dts2hx 0.34.0 does not completely merge the constructed instance surface of a
`const` plus namespace `export =` declaration. Keep that uncommon shape as a
small precise handwritten extern using `@:ts.instanceType`; do not patch the
generated file with `Dynamic`. The bridge manifest records this limitation so
a future dts2hx improvement can replace the manual boundary deliberately.

## 2) `genes.ts.Imports` (macro-based helper)

`genes.ts.Imports` generates hidden `@:jsRequire` externs and returns a typed
expression referencing the imported value.

This keeps import generation compatible with Genes’ dependency tracking in both
output modes.

### Binding-free side-effect import

Use `sideEffect` when a module must run during ESM initialization but no value
is imported. Because ESM declarations are statically hoisted, the helper is
valid only as a direct outer statement of `static function __init__():Void`:

```haxe
import genes.ts.Imports;

class Main {
  static function __init__():Void {
    Imports.sideEffect("./runtime/setup.js");
    Imports.sideEffectWith("./runtime/config.json", "json");
  }
}
```

Both Genes profiles preserve request order and emit:

```ts
import "./runtime/setup.js"
import "./runtime/config.json" with { type: "json" }
```

Equal requests coalesce at their first occurrence, and a normal value import of
the same request identity satisfies that slot without a redundant bare import.
The module and optional attribute must be non-empty string literals. Conditional
or call-time use fails with `GENES-SIDE-EFFECT-IMPORT-CONTEXT-001`; standard
Haxe (`genes.disable`) and non-JS targets fail with
`GENES-SIDE-EFFECT-IMPORT-TARGET-001`. The helper never falls back to
`require()` or silent erasure because neither preserves ESM initialization
semantics. The host application still owns package resolution and external
resource staging.

ts2hx-generated binding-free and bound requests consume this same ordered plan
in both Genes output modes. Their presence is decided by configured TypeScript
emit, so an elided import creates no carrier while a retained unused import
still initializes in its source slot. This generated-Haxe contract requires
`genes.esm-runtime-requests`: the `standard-haxe-js` translation profile fails
with `TS2HX-MODULES-ESM-RUNTIME-TARGET-001`, and the internal carrier macro has
its own `GENES-ESM-REQUEST-TARGET-001` guard against later miscompilation.

### Default import

```haxe
import genes.ts.Imports;

final Button = Imports.defaultImport("./components/Button.js");
```

### Default import with an import attribute

Some NodeNext/Bun/bundler resources need TypeScript import attributes. Use
`defaultImportWith` when the generated import must include
`with { type: "..." }`:

```haxe
import genes.ts.Imports;

final theme = Imports.defaultImportWith("./theme.json", "json");
```

This emits an import shaped like:

```ts
import Theme from "./theme.json" with { type: "json" }
```

`defaultImportWith` is the preferred authoring API because its macro checks the
module and attribute literals at the call site. Low-level extern declarations
may instead place `@:genes.importAttributeType("json")` beside `@:jsRequire`,
but that metadata is a strict loader contract: it must appear once with exactly
one non-empty string literal. Genes rejects malformed forms before publishing
either output profile:

- wrong arity or duplicate annotations:
  `GENES-IMPORT-ATTRIBUTE-ARITY-001`;
- a computed/nonliteral value:
  `GENES-IMPORT-ATTRIBUTE-LITERAL-001`;
- an empty or whitespace-only literal:
  `GENES-IMPORT-ATTRIBUTE-EMPTY-001`.

These errors intentionally do not fall back to an ordinary import. Silently
dropping an attribute could defer the mistake until the host loader starts the
application, and could make a failed build replace previously working output.

An import alias only changes the local name used by generated code; it does not
change how the host loads the module. Genes therefore rejects two bound imports
of the same module export when their attributes disagree, even if they ask for
different aliases:

```haxe
// Rejected: both declarations select the same default export, but they ask the
// host to interpret that one resource in two incompatible ways.
@:jsRequire("./profile.json", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("JsonProfile")
extern class JsonProfile {}

@:jsRequire("./profile.json", "default")
@:genes.importAttributeType("file")
@:genes.importAlias("ProfilePath")
extern class ProfilePath {}
```

This reports `GENES-IMPORT-ATTRIBUTE-BINDING-001` before either output profile
is published. Repeating the export with the same attribute remains valid: an
equal alias reuses one generated binding, while different aliases remain
available when an application needs both local spellings. If the resources are
genuinely different, give the host genuinely different supported module
specifiers instead of relying on aliases to distinguish them. Ordered
side-effect-only requests do not introduce a local binding and continue to use
their own request-level attribute rules.

### Resource imports

`Imports.text` names the common bundler/Bun contract where a text resource is a
default string import:

```haxe
import genes.ts.Imports;

final prompt = Imports.text("./prompt.txt");
```

This emits:

```ts
import Prompt from "./prompt.txt"
```

`Imports.file` names the path/URL asset contract used by loaders that support
`with { type: "file" }`:

```haxe
final soundPath = Imports.file("./pulse.wav");
```

This emits:

```ts
import Pulse from "./pulse.wav" with { type: "file" }
```

For lazy binary assets, use `dynamicWith` or the `dynamicWasm` convenience
wrapper. The caller supplies the expected module shape:

```haxe
typedef AssetModule = {
  @:native("default")
  final value:String;
};

final wasm = Imports.dynamicWasm<AssetModule>("./parser.wasm");
```

This emits a dynamic import shaped like:

```ts
import("./parser.wasm" as string, { with: { type: "wasm" } })
```

Resource helpers only generate typed imports. The target app still owns the
loader, bundler, package export/import map, or ambient declaration that gives a
particular extension runtime meaning. The compiler fixture
`tests/genes-ts/snapshot/resource-imports` proves the generated TypeScript shape
and strict `tsc` compatibility without claiming plain Node can execute arbitrary
text, file, or WASM imports without a loader.

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

The [interop cookbook](INTEROP.md#direction-2-typescript-consumes-haxe-output)
is the authoritative workflow for this direction. The summary below records
the original todoapp migration pattern.

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
