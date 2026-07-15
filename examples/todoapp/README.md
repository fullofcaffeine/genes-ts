# genes-ts fullstack dual-output todoapp

This React Router + Express app is written once in Haxe and exercised through
both first-class compiler profiles:

1. `ts-strict`: Haxe → TypeScript/TSX → JavaScript;
2. `classic-esm`: the same Haxe → modern ESM JavaScript directly, plus strict
   `.d.ts` declarations.

It is the real-world proof that genes-ts enriches Haxe for the TypeScript
ecosystem without turning the source into a TypeScript-only dialect. It is
still a bounded integration harness, not a claim that every Haxe/JS program is
already equivalent across both profiles.

## Build and run

From the repository root:

```bash
# TypeScript/TSX profile
yarn example:todoapp

# Classic ESM profile (no TypeScript implementation compilation)
yarn example:todoapp:classic
```

Both servers default to `http://localhost:8787`. Build without starting a
server with `yarn build:example:todoapp` or
`yarn build:example:todoapp:classic`; use the matching `:run` command after a
build.

Run the complete example matrix with:

```bash
yarn test:examples                 # both profiles, API/runtime smoke
yarn test:examples --playwright    # both profiles, same browser journeys
```

## Graceful TS → JS degradation

The web and server profiles point at the identical `examples/todoapp/src/`
tree. There are no profile-specific Haxe forks.

| Source concept | `ts-strict` projection | `classic-esm` projection |
| --- | --- | --- |
| Haxe inline markup / shared JSX intent | idiomatic TSX | `React.createElement(...)` calls |
| `genes.ts.Imports` | typed value/type-aware ESM imports | ordinary runtime ESM imports |
| `@:ts.type(...)` boundary metadata | precise ecosystem types in TS/declarations | erased from JS; retained only where useful in `.d.ts` |
| Haxe classes, DTOs, nullability, runtime helpers | typed TS source | equivalent executable ES2022 and reviewed declarations |

The classic build bundles the generated web entry together with the same
authored TS/TSX ecosystem modules used by the TS profile. This is intentional:
classic mode removes the generated-TypeScript stage; it does not forbid an
application from consuming existing npm or TS-authored modules through its
normal bundler.

## What the harness verifies

- React Router rendering and inline-markup lowering;
- Express CRUD API behavior and static asset hosting;
- Haxe → authored TS/TSX imports via `genes.ts.Imports`;
- authored TS → generated Haxe module imports;
- strict generated TS and classic `.d.ts` consumers on TS 5.5, 6, and 7;
- absence of unsafe user-module types at the checked boundaries;
- exact same API and Playwright journeys against both runtime profiles.

`examples/profiles.json` owns the repository-wide example inventory and the
structured build/runtime/browser command for each profile. The aggregate
runner executes those records directly without a shell. Adding a new immediate
directory under `examples/` without declaring and testing both profiles fails
`yarn test:examples`.

## Generated output and snapshots

The canonical TS profiles check in their intended generated source:

- `web/dist-ts/src-gen/` and `server/dist-ts/src-gen/` (default);
- `web/dist-ts-minimal/`, `web/dist-ts-lowlevel/`, and
  `server/dist-ts-minimal/` (bounded variants).

Ephemeral build trees are gitignored:

- TS: `web/src-gen`, `server/src-gen`, `web/dist`, `server/dist`;
- classic: `web/classic-src-gen`, `server/classic-src-gen`,
  `web/classic-dist`.

Update reviewed TS snapshots only after inspecting the compiler change:

```bash
UPDATE_SNAPSHOTS=1 yarn build:example:todoapp
```

Classic output uses bounded semantic and shape checks instead of duplicating a
second large checked-in source tree.

## Source layout and interop

- `src/todo.shared.*` — domain and API payload types shared by web/server;
- `src/todo.web.*` — React Router UI authored in Haxe;
- `src/todo.server.*` — Express API and persistence authored in Haxe;
- `web/src-ts/components/PrettyButton.tsx` — authored TSX imported by Haxe;
- `web/src-ts/interop/haxeInterop.ts` — authored TS importing generated Haxe;
- `web/build*.hxml`, `server/build*.hxml` — explicit compiler profiles;
- `e2e/src/` — Playwright specs authored in Haxe and compiled through genes-ts.

Haxe DCE cannot see symbols referenced only by authored TS, so the source keeps
that narrow interop export explicitly. This is a general module-boundary fact,
not a todoapp-specific compiler exception. The
[bidirectional interop cookbook](../../docs/typescript-target/INTEROP.md)
extracts this example into reusable import, extern, DCE, packaging, and
dual-output recipes.
