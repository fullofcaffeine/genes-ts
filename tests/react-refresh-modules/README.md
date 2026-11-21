# React Fast Refresh modules fixture

This fixture proves `-D genes.react_refresh_modules`: Genes splits a
generated React module into two files, so that a dev server with React Fast
Refresh (for example Vite with `@vitejs/plugin-react`) can hot-update it and
keep React state.

## The problem

React Fast Refresh accepts a hot update of a module only when each value that
the module exports is a component, or is the same object as before the
update. Genes writes one Haxe module as one file. When `Panel.hx` has the
component `Panel` and also a class, an enum, a Hook or a module-level
function, `Panel.tsx` exports `Counter`, `Tone`, `useCount` and
`Panel_Fields_` beside `Panel`. An edit of the component body then fails:

```text
hmr invalidate /refresh/Panel.tsx Could not Fast Refresh ("Counter" export is incompatible)
page reload refresh/App.tsx
```

The page reloads and React state is lost.

## What the define does

With the define, a module that has at least one `@:genes.reactComponent`
module function and at least one other runtime declaration becomes:

- `Panel.tsx`: the component functions, the `Panel_Fields_.Panel = Panel`
  slot assignments, and a type-only re-export of the exported types
  (`export type {PanelProps, BadgeProps}`). Its only runtime exports are
  components.
- `Panel.fields.tsx`: every other declaration, each one exported. It never
  imports `Panel.tsx`: only the component file imports the other one. The
  sibling's own code reads a component through the slot
  (`<Panel_Fields_.Badge />`), which the component file sets after the
  sibling has loaded.

Importers that Genes writes take each component from `Panel.js` and each
other value from `Panel.fields.js`. The import of `Panel.js` always comes
first, so that the slots are set and modules load in the same order as with
one file:

```ts
// App.tsx uses the component and three other values of Panel.hx
import {Panel} from "./Panel.js"
import {Tone, Counter, Panel_Fields_} from "./Panel.fields.js"

// Greeting.tsx uses only the function formatCount of Panel.hx
import "./Panel.js"
import {Panel_Fields_} from "./Panel.fields.js"
```

A `Genes.dynamicImport` of a split module loads both files and merges the two
namespaces (`Main.loadLazy` reads the class `LazyEntry` of `Lazy.hx`):

```ts
import("./Lazy.js").then(components => import("./Lazy.fields.js")
  .then(fields => ({...fields, ...components})))
```

An edit of a component body changes only `Panel.tsx`. It exports only
components, so Fast Refresh accepts the update. An edit of a non-component
declaration changes only `Panel.fields.tsx`. The dev server then updates each
importer of the sibling. `Panel.tsx`, `App.tsx` and `Greeting.tsx` export only
components, so Fast Refresh accepts these updates too and keeps React state.

Why `Panel.tsx` does not re-export the other values: an edit of the sibling
makes new objects of all its values. Up to genes-ts 1.59.3 the component file
re-exported them, so an edit of a non-component function failed in the
component file:

```text
hmr invalidate /refresh/Panel.tsx Could not Fast Refresh ("Counter" export is incompatible)
```

When no importer of the component file accepted the update (for example when
the entry module imports the component directly), the page reloaded.

Genes keeps a module as one file (`ReactRefreshModulePlan.componentNames`)
when:

- it has no component, or no other runtime declaration (`Greeting`, `LoadLog`);
- it is the entry module (`Main`);
- code that runs while the module loads (a static initializer or a class
  `__init__`) can reach a component of the module, directly (`Unsplit`) or
  through calls of other functions, constructors or methods of the module
  (`Transitive`). Creating an instance of a class of the module, or using
  the class as a value, counts as a call of the constructor and of every
  instance method of the class and its ancestors in the module, because
  other code can call any of them: an interface call in another module
  (`CallbackIface`), a parent constructor in another module that calls an
  override (`CallbackSuper`), or `Std.string` calling `toString`
  (`CallbackString`). In a split module that code would call the
  placeholder slot;
- a direct (hoisted) non-component function can reach a component through
  other direct functions (`Cycle`). Another module in an import cycle can
  call it before the sibling has defined the slot class (`CycleDep`);
- the owner class of a component is omitted, because all its fields are
  direct functions, and other code of the module names the component
  (`Omitted`): the sibling would have no slot to read.

## Automated evidence

```sh
yarn test:react-refresh-modules
```

The harness builds the fixture with and without the define, checks the file
set and the snapshots in `intended/`, type-checks both builds with the
TypeScript 5, 6 and 7 lanes, and runs `probe.mjs` on each build. The probe
compares module load order and server-rendered HTML (they must be equal), and
applies the Fast Refresh export rule of `@vitejs/plugin-react` 6.0.4 to new
instances of modules, as a dev server does:

- a component edit: a new instance of each component module. Without the
  define `Panel` and `App` are rejected; with it all are accepted.
- a sibling edit (with the define): new instances of `Panel.fields.js` and of
  each module that imports it. Each importer that exports a component must
  accept the update, and the new `App` instance must render the same HTML.
- mixed exports: a module that exports a component and another runtime value.
  With the define only the modules that stay one file (listed above) may do
  this.
- a dynamic import of the split module `Lazy` must render `LazyEntry`.

The probe copies only part of the rule: `isLikelyComponentType` and the
same-value check. It does not copy `isCompoundComponent` or the checks for a
new or a removed export; the Vite proof below runs the complete rule. A
classic JavaScript build with the define must fail with
`GENES-REACT-REFRESH-001`.

The compiler-server replay of split modules is covered by
`yarn test:compiler-server:shadow --react-refresh`: it runs every edit with
the define. Its React edits check a component-body edit, a module that
becomes split, a module whose last component is removed (its stale
`X.fields.tsx` must disappear), and a module whose component dead-code
elimination removes while another module imports its function from
`X.fields.tsx`, in compare and reuse modes.

An importer's output depends on the split of each module that it imports. The
incremental generator records that question for the importer
(`refreshSplit`, `Module.reactRefreshSplitOf`), as it records import cycles,
and does not replay stored output when the answer changed.

## Vite dev-server evidence (manual)

Vite is not a Genes test dependency. `vite-proof.mjs` runs the real dev
server (instructions at the top of the file). Measured with Vite 8.2.6,
`@vitejs/plugin-react` 6.0.4, React 19.2.8 and Playwright 1.62.1, after three
clicks on the counter:

| Genes | Edit | Files changed | Vite | Rejected files | Page reloads | Counter after edit |
| --- | --- | --- | --- | --- | --- | --- |
| 1.59.3, define on | non-component function | `Panel.fields.tsx` | updates `App.tsx`, `Greeting.tsx` | `Panel.fields.tsx`, `Panel.tsx` | 0 | 3 (kept) |
| this change, define on | component body | `Panel.tsx` | `hmr update /refresh/Panel.tsx` | none | 0 | 3 (kept) |
| this change, define on | non-component function | `Panel.fields.tsx` | updates `App.tsx`, `Greeting.tsx`, `Panel.tsx` | `Panel.fields.tsx` | 0 | 3 (kept) |

In the first row the fixture keeps its state only because `App.tsx` accepts
the update that `Panel.tsx` rejected. In an application whose entry module
imports the component directly, the same edit reloads the page. That is the
reported Caffeine case: `Could not Fast Refresh ("WorkspacePreview_Fields_"
export is incompatible)` and a reload on each edit of
`WorkspacePreview.hx`. `Panel.fields.tsx` itself is rejected in both
versions: its enum `Tone` is a function with a capital letter, so the plugin
treats the file as a component module. The dev server then passes the update
on to its importers, which accept it.

Without the define, each edit of `Panel.hx` changes `Panel.tsx`, which
exports `Counter` beside the component. Fast Refresh rejects it, and the page
reloads when no importer accepts the update.

## Limits

- TypeScript profile only.
- Hand-written TypeScript that imports a non-component value of a split
  module must import it from `X.fields.js` and import `X.js` first. Type
  imports from `X.js` still work.
- An importer that is not a component module (for example the entry module)
  and that uses a non-component value of `X` imports `X.fields.tsx`
  directly. An edit of that value then reaches the entry module and reloads
  the page, as it does for any plain TypeScript module.
- Both files repeat the full import list of the module. With
  `verbatimModuleSyntax` (no import elision) the load order of other modules is
  the same as with one file. A consumer that elides unused imports can load a
  dependency used only by one part later than before.
- The component file imports every binding of the sibling (and both files
  declare `const $global` when the build uses `js.Lib.global`), also when it
  does not use them. A consumer that checks with `noUnusedLocals` gets
  TS6133 for these imports. The repeated import lists have the same effect.
  When the dev server keeps unused imports (`verbatimModuleSyntax`), a
  sibling such as `App.fields.tsx` also imports `Panel.fields.tsx`. An edit of
  `Panel.fields.tsx` then also reaches the importers of `App.fields.tsx`, and
  the page reloads when one of them is the entry module. Vite with default
  settings removes these unused imports.
- The stay-one-file rules see only the typed tree of the module. They do not
  see calls through `Dynamic` values, reflection by name (for example
  `Type.createInstance(Type.resolveClass("..."))`), or code of another module
  that calls back into this module's classes while an import cycle loads.
- If the module is in an ESM import cycle with one of its dependencies, the
  sibling also imports a module that imports the component file. Vite then
  loads the sibling again on a component update, the re-exported values are
  new objects, and the update is handled like a non-component edit (it can
  end in a reload).
