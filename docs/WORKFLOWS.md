# genes-ts workflows

genes-ts supports one Haxe authoring model with two first-class JavaScript
ecosystem outputs. It also ships an experimental `ts2hx` tool for moving a
validated subset of existing TypeScript implementation source into Haxe.

Use this page to choose a path. The commands assume a checkout of this
repository and run from its root unless a section says otherwise.

## Pick a path

| Starting point | Desired result | Recommended path |
| --- | --- | --- |
| Haxe | Reviewable, typed source for a TS codebase or TS-native tooling | [Haxe → TypeScript → JavaScript](#haxe--typescript--javascript) |
| Haxe | Direct modern ESM JavaScript with no generated-TS build step | [Haxe → classic JavaScript](#haxe--classic-javascript) |
| One Haxe application | A choice of either output without source forks | [One source, both outputs](#one-source-both-outputs) |
| TypeScript/JavaScript implementation source | Haxe that will continue to run on JavaScript | [TypeScript → Haxe → JavaScript](#typescript--haxe--javascript) |
| TypeScript implementation source | Haxe as an intermediate migration layer, then generated TS again | [TypeScript → Haxe → TypeScript](#typescript--haxe--typescript) |
| npm `.d.ts` declarations | Haxe externs for an existing package | Use the [dts2hx workflow](typescript-target/INTEROP.md#generate-package-externs-with-dts2hx), not ts2hx |
| TypeScript implementation source | Portable Haxe for a non-JS target | Start with the [portability checklist](ts2hx/PORTABILITY.md); automatic portability is not currently promised |

The short rule is:

- choose `-D genes.ts` when generated TypeScript is a useful product surface;
- omit `-D genes.ts` when direct, compact ESM JavaScript is the better runtime
  artifact;
- use ts2hx only when migrating implementation source and review its manifest;
- use externs or dts2hx when consuming declarations from an existing package.

## Install and verify the checkout

For a consuming project, install the haxelib with lix:

```bash
lix +lib genes-ts
```

For this repository's examples and harnesses:

```bash
yarn install
yarn test:examples
```

The blocking toolchain and compatibility lanes are documented in
[`TOOLCHAINS.md`](TOOLCHAINS.md). `yarn test:examples` builds every checked-in
example under its declared TypeScript and classic profiles, strictly consumes
the generated declarations, and runs the application smoke checks.

## Haxe → TypeScript → JavaScript

Choose this path when generated `.ts` or `.tsx` belongs in your toolchain: for
example, a TS-first team wants to review it, a bundler consumes it, or an
application needs strong TS/React ecosystem interop.

### 1. Configure the Haxe compilation

The Haxe compiler still uses `-js` because genes-ts runs as a custom generator
on Haxe's JavaScript platform. Point it at a TypeScript entry path and enable
the TypeScript profile:

```hxml
-lib genes-ts
-cp src
--main my.app.Main
-js src-gen/index.ts
-D genes.ts
```

Use an `.tsx` entry path when the module should retain JSX syntax. Ordinary
Haxe modules are split under the entry directory either way.

### 2. Compile the generated TypeScript

A Node ESM project can use a conventional strict config:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src-gen",
    "strict": true,
    "skipLibCheck": false,
    "sourceMap": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src-gen/**/*.ts", "src-gen/**/*.tsx"]
}
```

For Node ESM, the nearest `package.json` should also declare
`"type": "module"`. Add the ambient `types` your program actually uses rather
than inheriting unrelated workspace globals.

Then build and run it:

```bash
haxe build.hxml
tsc -p tsconfig.json
node --enable-source-maps dist/index.js
```

Bundler projects can use extensionless generated imports with
`-D genes.ts.no_extension`. Read the exact file/import/define contract in
[`typescript-target/COMPILER_CONTRACT.md`](typescript-target/COMPILER_CONTRACT.md).

### Repository proof

The smallest maintained example builds, type-checks, and executes both outputs:

```bash
yarn build:example:genes-ts
```

See [`examples/typescript-target`](../examples/typescript-target/) for its HXML
and TS configs. For React/TSX and a real Express server, use the
[dual-output todoapp](../examples/todoapp/).

## Haxe → classic JavaScript

Choose classic output when Haxe remains the source of truth and a generated TS
implementation stage adds no value. This path emits split modern ESM
JavaScript directly. Add declarations when TypeScript consumers need a typed
package surface.

```hxml
-lib genes-ts
-cp src
--main my.app.Main
-js dist/index.js
-D js-es=6
-D dts
```

The important difference is the absence of `-D genes.ts`. Build and execute
the result directly:

```bash
haxe build.classic.hxml
node --enable-source-maps dist/index.js
```

`-D dts` is optional for applications. Keep it for libraries or any output
whose declarations are consumed externally. Use `-D genes.no_extension` when
a classic bundler requires extensionless imports.

Classic output is not a TypeScript-quality fallback. It is the mature direct
runtime path, while TS-specific annotations erase and shared runtime semantics
remain executable JavaScript. The supported boundary and differential gates
are described in [`OUTPUT_MODES.md`](OUTPUT_MODES.md).

### Reusable packages

Haxe DCE cannot infer calls that will arrive later from JavaScript consumers.
Mark package entry classes and enable the explicit library overlay so runtime
exports and declarations retain the same public graph:

```haxe
/**
 * Why: external JavaScript callers are invisible to Haxe DCE.
 * What: this class becomes a public runtime and declaration root only when
 * `genes.library` is enabled.
 * How: the compiler retains its transitive public graph before DCE and emits
 * a matching package export; ordinary application builds ignore the marker.
 */
@:genes.library
class PublicApi {
  public function new() {}
  public function greet(name:String):String return 'Hello $name';
}
```

```hxml
-D genes.library
-D dts
--macro include('my.library')
```

The same marked source can use `-D genes.ts` instead to emit a typed
implementation surface. Without `-D genes.library`, the marker is inert and
normal application DCE stays compact. See the
[reusable-library profile contract](OUTPUT_MODES.md#reusable-library-profile).

## One source, both outputs

The recommended architecture is one Haxe source tree plus two small build
profiles. Do not fork application logic into `src-ts` and `src-js` trees.

```text
src/                    # shared Haxe implementation
build.ts.hxml           # includes -D genes.ts
build.classic.hxml      # omits -D genes.ts; may include -D dts
src-gen/                # generated TS/TSX
classic-src-gen/        # generated direct ESM JS and optional declarations
dist/                   # runnable/bundled artifacts
```

Target-polymorphic helpers under `genes.ts` model real JS/TS boundary concepts
such as `undefined`, guarded unknown data, typed imports, and JSX intent. In TS
mode they retain the strongest justified type surface; in classic mode their
annotations erase or lower to explicit runtime behavior. An unsupported
capability should fail before output instead of leaking a TS-only marker into
JavaScript.

The canonical full application is [`examples/todoapp`](../examples/todoapp/).
Its web app, server, shared types, authored TS/TSX imports, and Haxe Playwright
specs use one Haxe source tree. Run either profile:

```bash
yarn example:todoapp
yarn example:todoapp:classic
```

Or verify both with identical API and browser journeys:

```bash
yarn test:examples --playwright
```

This is graceful degradation in the intended sense: TS output stays idiomatic
and strongly typed when selected; classic output removes the generated-TS
compilation step while preserving the exercised runtime behavior. The tests
prove the checked application paths, not universal equivalence for every Haxe
or JavaScript construct.

## TypeScript → Haxe → JavaScript

Use ts2hx when migrating TypeScript or JavaScript *implementation source* into
Haxe while JavaScript remains the first runtime target. It is experimental and
fail-closed: strict success covers only the support manifest emitted for that
run. The dedicated [`ts2hx/WORKFLOWS.md`](ts2hx/WORKFLOWS.md) expands this
overview into an inventory, transaction, bootstrap, differential, and CI loop;
read [`ts2hx/LIMITATIONS.md`](ts2hx/LIMITATIONS.md) before selecting a source
slice.

Build the tool and translate a project:

```bash
yarn --cwd tools/ts2hx build
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.json \
  --out ./src-generated \
  --clean \
  --diagnostics-json ./ts2hx-result.json
```

`strict-js` is the default. Exit `0` means every encountered construct was in
the currently validated strict subset; it does not certify all TypeScript
semantics. Inspect `src-generated/ts2hx-manifest.json` before treating the
translation as executable.

Compile the accepted Haxe through classic Genes first while stabilizing the
migration:

```hxml
-lib genes-ts
-cp src-generated
--main your.generated.Main
-js dist/index.js
-D js-es=6
```

Replace `your.generated.Main` with the translated entry type. Calls that lived
only as TypeScript top-level side effects may need an explicit, reviewed Haxe
entry point; strict mode will not silently discard unsupported statements.

When strict translation rejects a project, use assisted mode only to produce
an inventory or reviewable scaffold:

```bash
node tools/ts2hx/dist/cli.js \
  --project ./tsconfig.json \
  --out ./src-generated \
  --clean \
  --mode assisted
```

Assisted output exits `3`, contains explicit loss markers, and has no
executable-parity claim. See [`ts2hx/USAGE.md`](ts2hx/USAGE.md) for exit codes,
diagnostics, module limitations, and test commands.

## TypeScript → Haxe → TypeScript

This path is useful for an incremental TS-first migration: translate selected
implementation modules to Haxe, keep the rest of the repository in
TypeScript, then emit readable TypeScript from the Haxe portion with
`-D genes.ts`.

The stages are deliberately separate:

```text
authored TypeScript
  → ts2hx strict-js translation + support manifest
  → reviewed/generated Haxe
  → genes-ts with -D genes.ts
  → generated TypeScript
  → tsc or the application's bundler
```

After a strict ts2hx run, use a TypeScript genes profile for its output:

```hxml
-lib genes-ts
-cp src-generated
--main your.generated.Main
-js roundtrip-src/index.ts
-D genes.ts
```

```bash
haxe build.roundtrip.hxml
tsc -p tsconfig.roundtrip.json
node dist-roundtrip/index.js
```

Do not judge parity from compilation alone. Compare stable observable results
from the original TS program and both generated runtimes. This repository's
roundtrip and semantic-differential harnesses show the intended QA shape:

```bash
yarn --cwd tools/ts2hx test:roundtrip
yarn --cwd tools/ts2hx test:semantic-diff
```

The semantic suite executes the original TypeScript, translated Haxe through
classic JS, and translated Haxe through genes-ts plus `tsc` for its declared
contracts. Add a minimized generic fixture whenever a migration exposes a
compiler or translation issue.

## Common boundary choices

| Need | Use | Avoid |
| --- | --- | --- |
| Import an existing npm/TS/TSX implementation | Typed externs or `genes.ts.Imports` | Translating a package merely to call it |
| Generate Haxe externs from a package's `.d.ts` | dts2hx bridge | ts2hx implementation conversion |
| Represent `T | undefined` | `genes.ts.Undefinable<T>` | Treating absence as an untyped value |
| Decode JSON/plugin/host data | Typed codecs or immediate `UnknownNarrow` checks | Letting broad unknown data become an application model |
| Publish Haxe output as a library | `@:genes.library`, `-D genes.library`, and matched declarations | Assuming Haxe DCE can see future JS callers |
| Explore a future non-JS target | Adapter boundaries plus the portability checklist | Assuming strict-js output is portable Haxe |

For bidirectional module recipes, DCE rules, and classic declaration consumers,
read the [`typescript-target/INTEROP.md`](typescript-target/INTEROP.md)
cookbook. The complete helper/extern reference remains
[`typescript-target/IMPORTS.md`](typescript-target/IMPORTS.md). For packaging
layouts, exports, and declaration placement, read [`PACKAGING.md`](PACKAGING.md).

## Which gate should I run?

| Change or workflow | Focused gate |
| --- | --- |
| Minimal Haxe dual output | `yarn build:example:genes-ts` |
| All checked-in examples in both profiles | `yarn test:examples` |
| Todoapp API plus both browser profiles | `yarn test:examples --playwright` |
| Shared compiler semantic differential | `yarn test:dual-output` |
| Reusable package retention/declarations | `yarn test:library-profile` |
| ts2hx translation | `yarn --cwd tools/ts2hx test` |
| Complete repository acceptance | `yarn test:ci` |

Focused gates shorten iteration. Compiler changes are not ready for downstream
use until the complete repository gate passes.
