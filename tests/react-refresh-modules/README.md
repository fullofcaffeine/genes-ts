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
  slot assignments, and a re-export of every binding that `Panel.tsx`
  exported before. Importers do not change.
- `Panel.fields.tsx`: every other declaration, each one exported. It never
  imports `Panel.tsx`: only the component file imports the other one. The
  sibling's own code reads a component through the slot
  (`<Panel_Fields_.Badge />`), which the component file sets after the
  sibling has loaded.

An edit of a component body changes only `Panel.tsx`. The re-exported values
come from the unchanged sibling and are the same objects, so Fast Refresh
accepts the update.

Genes keeps a module as one file (`ReactRefreshModulePlan.componentNames`)
when:

- it has no component, or no other runtime declaration (`Greeting`, `LoadLog`);
- it is the entry module (`Main`);
- code that runs while the module loads (a static initializer or a class
  `__init__`) can reach a component of the module, directly (`Unsplit`) or
  through calls of other functions, constructors or methods of the module
  (`Transitive`). In a split module that code would call the placeholder
  slot;
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
applies the Fast Refresh export rule of `@vitejs/plugin-react` 6.0.4 to a new
instance of each component module, as a dev server does. The probe copies
only part of that rule: `isLikelyComponentType` and the same-value check. It
does not copy `isCompoundComponent` or the checks for a new or a removed
export; the Vite proof below runs the complete rule. Without the define
`Panel` and `App` are rejected; with it all modules are accepted. A classic
JavaScript build with the define must fail with `GENES-REACT-REFRESH-001`.

The compiler-server replay of split modules is covered by
`yarn test:compiler-server:shadow --react-refresh`: it runs every edit with
the define, and its React edits check a component-body edit, a module that
becomes split, and a module whose last component is removed (its stale
`X.fields.tsx` must disappear), in compare and reuse modes.

## Vite dev-server evidence (manual)

Vite is not a Genes test dependency. `vite-proof.mjs` runs the real dev
server (instructions at the top of the file). Measured with Vite 8.2.6,
`@vitejs/plugin-react` 6.0.4 and React 19.2.8, after three clicks on the
counter:

| Define | Edit | Files changed | Vite | Page reloads | Counter after edit |
| --- | --- | --- | --- | --- | --- |
| off | component body | `Panel.tsx` | invalidate, `page reload` | 1 | 0 (lost) |
| on | component body | `Panel.tsx` | `hmr update /refresh/Panel.tsx` | 0 | 3 (kept) |
| off | non-component function | `Panel.tsx` | invalidate, `page reload` | 1 | 0 (lost) |
| on | non-component function | `Panel.fields.tsx` | updates up to `App.tsx` | 0 | 3 (kept) |

The last row depends on the import graph: an update of the sibling is
accepted by the nearest importers whose exports pass the rule. In an app where
a chain of importers reaches the entry module first, Vite still reloads.

## Limits

- TypeScript profile only.
- Both files repeat the full import list of the module. With
  `verbatimModuleSyntax` (no import elision) the load order of other modules is
  the same as with one file. A consumer that elides unused imports can load a
  dependency used only by one part later than before.
- The component file imports every binding of the sibling (and both files
  declare `const $global` when the build uses `js.Lib.global`), also when it
  does not use them. A consumer that checks with `noUnusedLocals` gets
  TS6133 for these imports. The repeated import lists have the same effect.
- Calls through `Dynamic` values are not visible to the stay-one-file rules.
- If the module is in an ESM import cycle with one of its dependencies, the
  sibling also imports a module that imports the component file. Vite then
  loads the sibling again on a component update, the re-exported values are
  new objects, and the update is handled like a non-component edit (it can
  end in a reload).
