# genes-ts — fullstack todoapp example

This example is a small **frontend + backend** Todo app written in **Haxe**, compiled to **TypeScript/TSX** with genes-ts, and then built with standard TS tooling.

Goals:
- demonstrate `-D genes.ts` output (both Node and browser)
- demonstrate React Router authoring from Haxe (`.tsx` output)
- show practical extern usage (`@:jsRequire`) for JS/TS ecosystem libraries
- share Haxe types between frontend and backend

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
  - `build.hxml` emits TSX into `web/src-gen/`
  - `tsconfig.json` typechecks generated TSX
  - `index.html` is copied into `web/dist/`
- `examples/todoapp/server/` — server build inputs/outputs
  - `build.hxml` emits TS into `server/src-gen/`
  - `tsconfig.json` compiles TS → JS into `server/dist/`

