# genes-ts — fullstack todoapp example

This example is a small **frontend + backend** Todo app written in **Haxe**, compiled to **TypeScript/TSX** with genes-ts, and then built with standard TS tooling.

Goals:
- demonstrate `-D genes.ts` output (both Node and browser)
- demonstrate React Router authoring from Haxe (`.tsx` output)
- show practical extern usage (`@:jsRequire`) for JS/TS ecosystem libraries
- share Haxe types between frontend and backend

## Committed generated output

This example checks in the **intended** generated TypeScript output:

- `examples/todoapp/web/dist-ts/src-gen`
- `examples/todoapp/server/dist-ts/src-gen`

During development, the build generates into `examples/todoapp/{web,server}/src-gen` (gitignored)
and the build/test pipeline compares it against the committed `dist-ts/src-gen`.

Why `dist-ts/`?

- It provides a stable, browsable “what genes-ts emits” source tree next to a real app.
- It’s useful as an audit trail when changing the compiler (diffs are obvious).
- It helps the long-term goal of TS-only porting: the TS project structure is already present.

What `dist-ts/` is not:

- It is **not** the runtime build output. Runtime artifacts still go to `dist/`:
  - `examples/todoapp/web/dist/**` (bundled browser assets)
  - `examples/todoapp/server/dist/**` (Node `.js` + `.d.ts`)

Update the committed output after a compiler change:

```bash
UPDATE_SNAPSHOTS=1 npm run build:example:todoapp
```

## Build + run (from repo root)

```bash
npm install
npm run build:example:todoapp
node examples/todoapp/server/dist/index.js
```

Then open `http://localhost:8787`.

## Layout

- `examples/todoapp/src/` — Haxe sources
  - `todo.shared.*` — shared types (Todo, API payloads)
  - `todo.server.*` — backend (Express JSON API + static hosting)
  - `todo.web.*` — frontend (React Router)
- `examples/todoapp/web/` — web build inputs/outputs
  - `src-ts/` — hand-written TS/TSX modules used to demonstrate TS ecosystem interop
  - `build.hxml` emits TSX into `web/src-gen/`
  - `tsconfig.json` typechecks generated TSX
  - `index.html` is copied into `web/dist/`
- `examples/todoapp/server/` — server build inputs/outputs
  - `build.hxml` emits TS into `server/src-gen/`
  - `tsconfig.json` compiles TS → JS into `server/dist/`

## TS ↔ Haxe interop (explicitly tested)

This example is intentionally set up to demonstrate *both* directions of interop:

1) **Haxe imports TS/TSX**:
   - `examples/todoapp/web/src-ts/components/PrettyButton.tsx` is a TSX component
   - imported from Haxe using `genes.ts.Imports`

2) **TS imports generated Haxe output**:
   - `examples/todoapp/web/src-ts/interop/haxeInterop.ts` imports `TodoText` from
     `web/src-gen/**` and re-exports a stable function
   - the UI renders that banner and Playwright asserts it exists

Why the explicit “keep” in Haxe?

Haxe DCE does not know about TS-only imports, so if a Haxe value is *only* referenced
from TS-authored code, it may be removed from output. The harness keeps the relevant
symbol explicitly so the interop boundary is stable.
