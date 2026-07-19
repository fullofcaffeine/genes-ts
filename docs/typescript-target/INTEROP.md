# TypeScript ↔ Haxe interop cookbook

genes-ts runs on Haxe's JavaScript platform, so JavaScript module interop is a
first-class compiler boundary in both output profiles:

- `ts-strict`: Haxe emits TypeScript/TSX, then TypeScript or a bundler emits JS;
- `classic-esm`: the same Haxe emits ESM JavaScript directly, with optional
  `.d.ts` declarations.

This guide covers both directions across that boundary:

1. Haxe imports values from authored JavaScript, TypeScript, TSX, or npm;
2. authored TypeScript imports values and types emitted from Haxe.

It does not treat interop as source conversion. Use
[dts2hx](#dts2hx-versus-ts2hx) to ingest package declarations and use
[ts2hx](../ts2hx/WORKFLOWS.md) only for its explicitly supported
implementation-migration subset.

## Choose the narrowest boundary

| Need | Recommended mechanism | Type owner |
| --- | --- | --- |
| Import one default, named, or namespace value | `genes.ts.Imports` | A precise Haxe field/local type, checked again by TypeScript in TS mode |
| Model a reusable JS/npm API | A small `extern` with `@:jsRequire` | The Haxe extern; optional focused TS metadata only where Haxe cannot express the canonical type |
| Consume a broad npm declaration surface | dts2hx-generated externs | The package `.d.ts`, translated into reviewable Haxe externs |
| Call generated Haxe from authored TS in one app | Import the generated module directly | The generated `.ts`, or classic `.d.ts` beside `.js` |
| Publish a stable Haxe-authored package | `@:genes.library` plus `-D genes.library` | One retained public graph projected into TS or classic JS + declarations |
| Translate TS implementation source to Haxe | ts2hx strict/assisted workflows | A support manifest and semantic differential evidence, not declarations alone |

Prefer a typed boundary over `Dynamic`, `untyped`, or a raw emitted import
string. The import syntax and the API contract are separate concerns: Genes can
generate the correct ESM binding only after Haxe has a useful type for the
value.

## Direction 1: Haxe consumes JavaScript or TypeScript

### Import a small value with `genes.ts.Imports`

`genes.ts.Imports` is the concise choice when the Haxe module needs one or a
few runtime values. Give every import an expected Haxe type:

```haxe
package app;

import genes.ts.Imports;

class Paths {
  static final join:(a:String, b:String)->String =
    Imports.namedImport("node:path", "join");

  public static function cacheFile(root:String):String {
    return join(root, "cache.json");
  }
}
```

The helper defines a hidden `@:jsRequire` extern and lets Genes' dependency
planner emit a normal named ESM import. TypeScript output is shaped like:

```ts
import {join as __genes_import_join} from "node:path";
```

Classic output emits the equivalent runtime ESM binding with Haxe annotations
erased. The exact alias is compiler-owned and may change to avoid a collision;
application code should not depend on it.

The explicit function type is important. `Imports` does **not** run the
TypeScript checker inside Haxe or copy a `.d.ts` type into the Haxe program. It
uses the expected Haxe type to type the expression. In `ts-strict`, the emitted
assignment also lets strict TypeScript verify that the real imported value is
compatible with that contract. For a large or evolving API, generate or write
an extern instead of duplicating many structural types locally.

The other static forms follow the same rule:

```haxe
typedef PathNamespace = {
  final join:(a:String, b:String)->String;
  final basename:(path:String)->String;
};

typedef Client = {
  final close:Void->Void;
};

static final Path:PathNamespace =
  Imports.namespaceImport("node:path");

static final createClient:(endpoint:String)->Client =
  Imports.defaultImport("./client.js");
```

Module, export, attribute, and explicit-alias arguments must be string literals.
That makes dependency identity and generated output deterministic. See the
[complete Imports API](IMPORTS.md) for import attributes, text/file resources,
dynamic WASM imports, dotted exports, and alias control.

#### How Genes keeps similarly named imports separate

The local word used in generated code is not an import's identity. This matters
when a package legally exports more than one value with the same visible name.
For example, these two declarations select different JavaScript values even
though both would naturally be called `Foo`:

```haxe
@:jsRequire("example-package", "default")
extern class DefaultFoo {}

@:jsRequire("example-package", "Foo")
extern class NamedFoo {}
```

Genes records four separate facts before it prints either output profile:

- the module request (`example-package`);
- the selected export (default, named `Foo`, or the namespace);
- the preferred local name;
- the exact typed Haxe declaration or compiler-owned field that requested it.

The package is still evaluated as one ESM request, but the bindings receive
separate collision-safe locals such as `Foo` and `Foo__1`. Expressions, public
TypeScript annotations, classic JavaScript, and classic `.d.ts` declarations
all resolve from the typed Haxe origin rather than choosing the first import
whose text happens to match.

Explicit `@:genes.importAlias` values change only the preferred local spelling;
they do not turn a default export into a named export. For a dotted selector
such as `Dropdown.Menu`, Genes imports the root `Dropdown`, resolves any local
collision, and only then appends `.Menu`. This preserves both the package's ESM
shape and the member access.

The same identity rule covers two Haxe forms that can look less like imports at
first glance. An extern enum abstract may read constants from a package:

```haxe
@:jsRequire("status-package", "Codes")
@:enum extern abstract StatusCode(String) to String {
  var Ready;
}
```

`StatusCode.Ready` is a read from the package's `Codes` export; Genes does not
invent or inline the string value. The one-argument form
`@:jsRequire("status-package")` instead imports the whole module namespace and
reads the constant from that namespace, matching hxnodejs-style module
constants. A module-level extern function works in the same way:

```haxe
@:jsRequire("status-package", "readStatus")
extern function readStatus(): StatusCode;
```

Haxe represents that top-level function internally as a static field owned by
its `.hx` module. Genes keeps the full typed owner, so a different module may
declare another function named `readStatus` without redirecting either call.
This is useful for hxnodejs-style extern libraries as well as application-owned
package bindings.

Older hxnodejs releases describe Node's built-in `process` and `console`
objects with an old Haxe helper named `__js__`. Haxe 5 preview leaves that
helper visible to custom generators, even though `__js__` is not a real
JavaScript function. Genes recognizes the narrow form those externs use—one
literal global identifier—and writes the real `process` or `console` value in
both output profiles. Arbitrary source strings are deliberately not accepted
by this compatibility rule; new interop code should use typed externs or
`js.Syntax` instead.

Older Haxe JavaScript externs sometimes combine `@:native` and `@:jsRequire`:

```haxe
@:native("React.Component")
@:jsRequire("react", "Component")
extern class ReactComponent {}
```

The two annotations answer different questions. `@:jsRequire` says the runtime
value comes from the package. The native name preserves the older binding's
expected JavaScript spelling and, for this dotted form, describes the member
path Genes appends after resolving the imported root. Genes must still use the
collision-safe package local; it never writes raw `React.Component` in a way
that could select an unrelated local or global named `React`.

The same runtime rule applies when the old native spelling matches a built-in
name. For `@:native("String")` combined with a package request, constructor and
method calls still use the imported package value rather than JavaScript's
global constructor. Haxe itself treats a native class called `String` as a core
type in some public type positions, so reusable public APIs should give such a
package type a non-core Haxe class name and let `@:jsRequire` name the `String`
export, or wrap it in a separately typed Haxe abstraction.

When there is no `@:jsRequire`, `@:native` is the whole runtime identity. For
example, an extern annotated only with `@:native("Date")` continues to use
JavaScript's built-in `Date` directly and emits no package import.

`Genes.dynamicImport` is the deliberate exception to a top-level import
mapping. Its callback values are created by `import()` at runtime, so the
compiler keeps those names local to the callback instead of adding a static ESM
request that would defeat code splitting.

### Import an authored TSX component

Model the component's props on the Haxe side, then give the default import a
component function type:

```haxe
import genes.react.Element;
import genes.ts.Imports;

typedef ButtonProps = {
  final label:String;
  final onClick:Void->Void;
};

typedef ButtonComponent = ButtonProps->Element;

static final Button:ButtonComponent =
  Imports.defaultImport("../src-ts/Button.js");
```

In a NodeNext TypeScript build, the `.js` specifier can resolve to
`Button.tsx` while type-checking and to `Button.js` after compilation. A
bundler-first project can instead opt into extensionless generated specifiers
with `-D genes.ts.no_extension`.

Classic Genes removes the generated-TypeScript stage, but it does not teach
Node to execute `.ts` or `.tsx`. The runtime module must still be one of:

- JavaScript already produced by the authored module's build;
- a package export Node can execute; or
- TS/TSX handled by the application's normal bundler or host loader.

The todoapp deliberately uses the third form. Its same Haxe UI imports an
authored TSX button under both profiles, and the web bundler owns TSX loading in
both cases.

### Use an extern for a reusable boundary

An extern is preferable when several Haxe modules share the API or when the
value has constructors, methods, overloads, or companion types:

```haxe
package interop;

/** Options accepted by the specific package version used by this app. */
typedef FormatOptions = {
  final uppercase:Bool;
};

/**
 * Why: the implementation lives in an npm module, not in generated Haxe code.
 * What: Haxe callers see one typed function and emit no local implementation.
 * How: `@:jsRequire` binds the declaration to the package's named ESM value;
 * Genes projects that dependency into both TS and classic ESM imports.
 */
@:jsRequire("format-package", "formatLabel")
extern function formatLabel(value:String, options:FormatOptions):String;
```

Externs describe values that exist at runtime; they do not install or bundle
the package. Keep package installation, export conditions, and host types in
the owning application or library build.

### Preserve a contextual generic extern call

Haxe and TypeScript independently infer a generic call. Usually that is useful:
the generated TypeScript remains concise and idiomatic. Occasionally Haxe can
use a destination type that TypeScript cannot see at the call itself. For this
package contract:

```haxe
extern class Cell<Value> {}

private extern class Cells {
  @:jsRequire("cell-package", "makeCell")
  static function makeCell<Value>(initial:Value):Cell<Value>;
}

final cell:Cell<Null<String>> = Cells.makeCell(null);
```

the unspecialized output is a negative control:

```ts
const cell: Cell<string | null> = makeCell(null);
// TypeScript infers Cell<null>, which is not the Haxe-proven result.
```

When the real package declaration cannot infer the intended argument, annotate
the generic extern field:

```haxe
private extern class Cells {
  /**
   * Haxe's destination chooses `Null<String>`; the annotation preserves that
   * checked choice as a TypeScript call argument and has no JS runtime effect.
   */
  @:ts.explicitTypeArguments
  @:jsRequire("cell-package", "makeCell")
  static function makeCell<Value>(initial:Value):Cell<Value>;
}
```

genes-ts then emits the direct, handwritten TypeScript form:

```ts
const cell: Cell<string | null> = makeCell<string | null>(null);
```

The same contract handles a no-argument overload whose exact result is fixed by
Haxe and multiple method type parameters. It is deliberately opt-in: an
unannotated neighboring generic extern continues to use TypeScript inference.
The annotation is valid only on a generic extern callable, takes no arguments,
and fails closed if genes-ts cannot recover a precise Haxe instantiation. A
runtime function-valued local does not retain declaration metadata, so call the
annotated extern field directly (Haxe import aliases still preserve field
identity). Classic Genes emits the ordinary call with identical evaluation
order and no `<...>` syntax.

The package-neutral positive, negative, strict-TypeScript, and classic-JS
evidence lives in [`tests/explicit-type-arguments`](../../tests/explicit-type-arguments/README.md).

Use raw `@:ts.type(...)` only when the canonical ecosystem type cannot be
expressed cleanly with Haxe types. It changes the generated TS/declaration
surface but erases from classic executable JS, so the underlying Haxe extern or
runtime representation must remain truthful. The todoapp's
[`Express.hx`](../../examples/todoapp/src/todo/extern/Express.hx) demonstrates
this narrow pattern with explanatory hxdoc.

For a CommonJS `export =` constructor whose value does not occupy TypeScript's
type namespace—or a package constructor whose `@:native` name is `String` or
`RegExp`—use the explicit `@:ts.instanceType` extern contract described in
[IMPORTS.md](IMPORTS.md#commonjs-export--constructor-instances). Do not hide
that package shape behind `Dynamic`.

### Generate package externs with dts2hx

For a nontrivial npm surface, declaration ingestion scales better than a large
handwritten facade:

```bash
npx dts2hx package-name --modular
```

Review and version the generated externs like other generated API code. The
externs become ordinary Haxe APIs; Genes owns the final runtime/type import
projection for the selected output profile.

The repository's blocking package-shape gate exercises ESM roots, subpaths,
conditional exports, and a CommonJS constructor through handwritten and
dts2hx-generated boundaries:

```bash
yarn test:interop:module-shapes
```

That evidence is deliberately package-shape-specific. A green gate does not
prove every npm package or declaration-merging pattern is already supported.

### Keep import specifiers honest in both profiles

| Runtime | Relative specifier guidance |
| --- | --- |
| NodeNext / published ESM | Write `./module.js`; TypeScript resolves it to the source `.ts`/`.tsx` during its build. |
| Bundler-first TS and classic output | Extensionless imports are available through `-D genes.ts.no_extension` and `-D genes.no_extension`. |
| Direct classic Node execution | Point at executable `.js`; Node does not transpile authored TypeScript for Genes. |
| npm package | Use the public package/subpath specifier and let its `exports` map choose the runtime and types. |

Do not add a file extension merely to silence the Haxe compiler. Choose the
specifier that the final runtime or bundler resolves, then exercise that same
path in both intended output profiles.

## Direction 2: TypeScript consumes Haxe output

### Import a generated module inside an application

Every emitted Haxe module is a normal ESM module. A public Haxe class can be
imported directly from its generated path:

```haxe
package demo;

/**
 * Kept because the only production caller is authored TypeScript, which Haxe
 * DCE cannot see while compiling the Haxe graph.
 */
@:keep
class Greeter {
  final prefix:String;

  public function new(prefix:String) {
    this.prefix = prefix;
  }

  public function greet(name:String):String {
    return '$prefix, $name';
  }
}
```

With `-js src-gen/index.ts -D genes.ts`, authored TypeScript can consume it:

```ts
import {Greeter} from "../src-gen/demo/Greeter.js";

const greeter = new Greeter("Hello");
const message: string = greeter.greet("Ada");
```

Use `.js` in a NodeNext import even though the current source file is
`Greeter.ts`. Ensure the TypeScript project includes both authored and
generated source roots, and set `rootDir` to a directory that contains both (or
let the bundler own the graph). A `rootDir` fixed to `src-gen` cannot also own a
sibling `src-ts` tree.

Direct module imports do not require `@:expose`. They do require the module to
survive Haxe DCE. If a value is called only from authored JS/TS, retain it with
one of these explicit policies:

- reference it from reachable Haxe code for an application-local seam;
- add `@:keep` to a narrow external entry;
- use the reusable-library profile for a published API graph.

Do not disable DCE globally just to preserve one interop symbol.

### Consume classic JavaScript with declarations

The same consumer pattern works without generated TypeScript. Build classic
Genes with `-D dts`:

```hxml
-lib genes-ts
-cp src
-js classic-src-gen/index.js
-D js-es=6
-D dts
```

Then import the executable `.js`; TypeScript resolves its adjacent `.d.ts`:

```ts
import {Greeter} from "../classic-src-gen/demo/Greeter.js";

const message: string = new Greeter("Hello").greet("Grace");
```

This is a real alternative product profile, not a compatibility shim. The
consumer gets types from classic declarations while Node or a bundler executes
Genes' direct ESM output. Run strict consumers with `skipLibCheck: false` so a
bad generated declaration cannot hide behind dependency skipping.

### Publish one retained package surface

Use `@:genes.library` for entry classes whose callers are outside the Haxe
compilation:

```haxe
package my.library;

/**
 * Why: external JS/TS calls are invisible to application DCE.
 * What: this class is a retained package root only in the library profile.
 * How: Genes captures its transitive public graph before DCE and emits a root
 * ESM export with a matching TS or classic declaration surface.
 */
@:genes.library
class PublicApi {
  public function new() {}

  public function greet(name:String):String {
    return 'Hello, $name';
  }
}
```

Enable the profile explicitly:

```hxml
-D genes.library
--macro include('my.library')

# Required in classic output; omit this line only for -D genes.ts.
-D dts
```

The marker is inert in ordinary application builds. In the library profile,
runtime values and public types are retained together, while private
implementation details remain subject to normal reachability. See the
[reusable-library contract](../OUTPUT_MODES.md#reusable-library-profile) and
[packaging guide](../PACKAGING.md).

### Preserve JavaScript boundary semantics

Generated types reflect Haxe semantics plus explicit boundary helpers:

- `Null<T>` is nullable with JavaScript `null`;
- `genes.ts.Undefinable<T>` models real JavaScript `undefined`;
- `@:ts.optional` models an optional object property rather than merely a
  nullable value;
- Haxe enum abstracts can deliberately project narrow string/number unions;
- `Unknown` values must be narrowed or decoded before application use.

Do not collapse these distinctions in an authored TS adapter. If a public
consumer unexpectedly sees `any`, an open index signature, a missing member,
or `undefined` where the Haxe contract says `null`, reduce it to a generic
compiler fixture instead of papering over it with a consumer cast.

## A real bidirectional graph: the todoapp

The fullstack todoapp exercises both directions from one Haxe source tree:

1. Haxe emits `todo.shared.TodoText` as a typed ESM value.
2. Authored
   [`haxeInterop.ts`](../../examples/todoapp/web/src-ts/interop/haxeInterop.ts)
   imports that generated Haxe module and calls it.
3. Haxe imports the authored `interopBanner` function with
   `Imports.namedImport`.
4. The same UI builds and runs as generated TSX or direct classic ESM JS.

The authored TypeScript call is invisible to Haxe DCE, so the Haxe source keeps
`TodoText` reachable explicitly. Invocation happens after module
initialization, avoiding an eager top-level call through the bidirectional
cycle.

Run the same browser journeys against both profiles:

```bash
yarn test:examples --playwright
```

See the [todoapp workflow](../../examples/todoapp/README.md) for directories,
build profiles, and committed output evidence.

## dts2hx versus ts2hx

The names are similar, but they solve different problems:

| Tool | Input | Output | Use it for |
| --- | --- | --- | --- |
| dts2hx | `.d.ts` declarations | Haxe externs | Calling an existing npm/TS library from Haxe without converting its implementation |
| ts2hx | TS/JS implementation source | Haxe implementation/scaffolding plus a manifest | A reviewed, fail-closed migration of supported implementation semantics |

Normal ecosystem interop should not flow through ts2hx. If the package already
has declarations, ingest or hand-model those declarations and keep executing
the upstream JavaScript implementation. Read
[ts2hx limitations](../ts2hx/LIMITATIONS.md) before choosing source migration.

## Failure recipes

### TypeScript cannot resolve a generated relative import

- Use a `.js` specifier under NodeNext even when the source is generated `.ts`.
- Include the generated and authored roots in the same TS/bundler graph.
- Ensure `rootDir` contains both roots.
- Use extensionless imports only when the configured bundler/resolver owns them.

### A Haxe export disappeared

Haxe DCE cannot see authored JS/TS callers. Add narrow reachability, `@:keep`,
or the library profile; do not rely on a generated snapshot accidentally
retaining the symbol.

### Haxe accepted an import but TypeScript reports incompatibility

That is the intended second type-check. Reconcile the local Haxe type or extern
with the real package declaration. `Imports` supplies syntax and dependency
identity, not declaration inference.

### Classic output tries to load `.ts` or `.tsx` in Node

Compile that authored module to JS, point at its package export, or run both
graphs through a bundler/loader that supports the source extension. Classic
Genes deliberately does not add a hidden TypeScript runtime stage.

### An imported constructor is a value but not the right TypeScript type

Model the constructable extern and opt into `@:ts.instanceType`. This covers
CommonJS constructor values and package-backed `@:native("String")` /
`@:native("RegExp")` externs. Verify it with the package-shape gate rather
than switching the instance to `Dynamic`.

### A bidirectional import fails during module initialization

ESM cycles expose partially initialized bindings. Keep interop adapters small,
avoid eager top-level calls across both directions, and invoke the callback only
after both modules initialize.

## Verification checklist

For an interop boundary intended to support both compiler profiles:

1. Give every imported value a precise Haxe type or extern.
2. Build generated TS with strict mode and `skipLibCheck: false`.
3. Execute the TS-compiled or bundled runtime.
4. Build classic ESM from the same Haxe source; add `-D dts` for TS consumers.
5. Compile a strict consumer against the classic declarations.
6. Execute the classic runtime through the actual Node/bundler/package resolver.
7. Add negative `@ts-expect-error` cases for public members that must remain
   invalid.
8. Reduce any compiler defect to a package-neutral fixture.

Repository gates that own these layers include:

```bash
yarn test:interop:module-shapes
yarn test:library-profile
yarn test:classic:dts
yarn test:examples --playwright
```

These commands prove the checked package shapes, retained library graph,
declaration consumers, and todoapp journeys. They are strong bounded evidence,
not a blanket guarantee for every npm package or JavaScript module system.
