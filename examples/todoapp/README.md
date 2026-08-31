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

## React Router 8 baseline

The harness uses React Router 8.3 or newer in client-side Declarative Mode.
Router 8 removed the transitional `react-router-dom` package, so the Haxe
externs and every generated profile import `BrowserRouter`, `Routes`, `Route`,
`Link`, `useNavigate`, and `useParams` from `react-router`.

React Router 8.3 requires Node 22.22 or newer and React/React DOM 19.2.7 or
newer. The repository uses the stricter Node 26.1 floor required by its safe
raw-exec tooling path; CI exercises that exact floor and the latest Node 26
release. The Todo harness does not use Router's unstable React Server
Components APIs.

This upgrade removed the time-bounded OSV exception for
`GHSA-qwww-vcr4-c8h2`: the advisory marks React Router 8.3 as patched, so
`yarn test:vulns` now passes without suppressing that Router finding. Run
`yarn test:examples --playwright` to verify the same routing journeys through
generated TS/TSX and direct classic ESM output.

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
build. Each build command is self-contained: neither command needs the other
profile's generated files to exist first.

Run the complete example matrix with:

```bash
yarn test:examples                 # both profiles, API/runtime smoke
yarn test:examples --playwright    # both profiles, same browser journeys
```

Backend changes can use the API-only observer after building the matching
profile. It exercises the real generated Node server without requiring a web
bundle, so a backend failure is not hidden by unrelated browser setup:

```bash
yarn build:example:todoapp
yarn build:scripts
node scripts/dist/qa-todoapp.js --profile ts --skip-build --api-only

yarn build:example:todoapp:classic
node scripts/dist/qa-todoapp.js --profile classic --skip-build --api-only
```

`--api-only` and `--playwright` are intentionally mutually exclusive because
they prove different product surfaces. The full example commands above remain
the broader integration evidence before merge.

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

## Profile-independent generated imports

The authored `web/src-ts/interop/haxeInterop.ts` module deliberately imports a
Haxe-generated value. A relative import such as `../../src-gen/...` would tie
that shared source file to the TypeScript profile and would make a clean classic
build fail unless the TypeScript build happened to run first.

Instead, authored code imports the stable name
`@todoapp/generated/todo/shared/TodoText`. The selected build configuration
resolves that name to exactly one generated tree:

| Build | Configuration | Resolved tree |
| --- | --- | --- |
| TypeScript/TSX | `web/tsconfig.json` | `web/src-gen` |
| Classic ESM | `web/tsconfig.classic-interop.json` | `web/classic-src-gen` |

The same configuration is passed to TypeScript and esbuild, so type checking
and runtime bundling cannot silently choose different modules. Each build also
checks esbuild's input report and fails if it consumed the other profile's
tree. This keeps the direct “authored TypeScript imports generated Haxe” example
while allowing both build commands to start from a fresh checkout.

## What the harness verifies

- React Router rendering and inline-markup lowering;
- Express CRUD API behavior, checked decoding of untrusted JSON request
  bodies, omitted PATCH-field preservation, and static asset hosting;
- Haxe → authored TS/TSX imports via `genes.ts.Imports`;
- authored TS → generated Haxe module imports;
- strict generated TS and classic `.d.ts` consumers on TS 5.5, 6, and 7;
- absence of unsafe user-module types at the checked boundaries;
- an All/Open/Completed list filter backed by an ordinary Haxe enum and
  exhaustive switch; and
- exact same API and Playwright journeys against both runtime profiles.

The filter is a deliberately bounded application example. Its manually
authored browser truth table proves that one closed domain value and ordinary
switch produce the same visible result through TSX and direct classic ESM. It
does not replace the focused fixtures for generic classes, payload enums,
exception/finally completion, or adversarial evaluation order.

The server follows the same bounded-proof rule. Express request bodies enter
Haxe as `genes.ts.Unknown`; `todo.server.ApiRequestDecoder` checks the object
shape and each field before constructing a `CreateTodoBody` or an internal
validated update. The public `UpdateTodoBody` is a non-empty union: callers
must provide `title`, `completed`, or both, and TypeScript callers cannot send
`null` for either value. Haxe UI code does not accept that wire record directly:
`Client.updateTodoTitle` and `Client.updateTodoCompleted` take concrete values.
Every Todoapp HXML enables recursive Loose null safety for the owned
`todo.shared`, `todo.extern`, `todo.web`, and `todo.server` packages. The
Playwright-only `todo.e2e` harness is deliberately outside that application
claim because its host Promise overloads are a separate test-runner boundary.
A checked negative compilation opts its own caller into null safety and proves
that passing Haxe `null` to completion is rejected. The few local
`@:nullSafety(Off)` expressions sit immediately after runtime guards or at
documented Haxe 4.3.7 macro/anonymous-record narrowing limitations; they do
not disable checking for a package, class, or method.

The API transcript deliberately sends malformed JSON, arrays, wrong field
types, `null`, extra fields, an empty patch, and a blank identifier. JSON parser
failures use the same stable API envelope as decoder failures. The generated
web client exposes only route-specific request methods rather than a generic
method/URL/body escape hatch, and the importable generated Store title-update
methods reject blanks even when a target-language caller bypasses HTTP. The transcript also
proves that a rejected patch leaves the Todo unchanged, a title-only patch
preserves `completed`, and a completed-only patch preserves `title`. These checks prove this Todo API
boundary; focused nullish fixtures remain authoritative for the complete JavaScript
`null`/`undefined`/missing-property matrix.

`examples/profiles.json` owns the repository-wide example inventory and the
structured build/runtime/browser command for each profile. The aggregate
runner executes those records directly without a shell. Adding a new immediate
directory under `examples/` without declaring and testing both profiles fails
`yarn test:examples`.

### Living feature coverage

[`feature-coverage.json`](feature-coverage.json) answers a different question
from the profile manifest: for every stable user-facing Genes feature family,
where is the evidence today?

Each row gives a separate disposition for source TSX, low-level TypeScript,
minimal TypeScript, classic JavaScript, classic declarations, Node runtime,
browser runtime, and the smallest focused fixture. The status words are
deliberately modest:

- `covered` means the named owner directly exercises that contract;
- `partial` means the profile exercises a useful representative case while a
  named focused owner or follow-up retains the remaining shapes;
- `gap` means Todoapp does not yet exercise the stable feature; and
- `not-applicable` means that observer cannot prove the contract, such as a
  runtime test trying to prove declaration precision.

When an application-facing column is incomplete, `applicationDisposition`
records what should happen next:

- `planned` points to an open Bead for useful Todoapp work that has not landed;
- `focused-only` points to the exact smaller compiler fixture that owns the
  remaining edge cases after this app has shown a representative case; and
- `not-applicable` explains why Todoapp cannot honestly observe the behavior
  and points to the focused test that does.

The reason and revisit trigger are part of the record. For example, the app
uses arrays but has no user feature that needs a `Map`, so missing-key semantics
remain with the focused Array/Map fixture until a real keyed Todo feature or an
application regression justifies another vertical test. Similarly, dynamic
imports and module directives are supported compiler contracts, but inventing
an unused import or directive would not prove useful Todo behavior.

This map does not run the tests or turn one green application into a universal
compiler claim. Existing focused gates remain authoritative. Run
`yarn test:agent-test-routing` to reject deleted, duplicate, or missing feature
IDs; unknown evidence references; dead package scripts and paths; missing,
closed, or mismatched disposition owners; application evidence on a wholly
inapplicable row; or a feature family without focused evidence. The stable ID
list is kept outside this JSON file, so removing a row cannot make the validator
forget that the feature exists.

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
- `web/src-ts/interop/haxeInterop.ts` — authored TS importing generated Haxe
  through the active profile mapping described above;
- `web/build*.hxml`, `server/build*.hxml` — explicit compiler profiles;
- `e2e/src/` — Playwright specs authored in Haxe and compiled through genes-ts.

Haxe DCE cannot see symbols referenced only by authored TS, so the source keeps
that narrow interop export explicitly. This is a general module-boundary fact,
not a todoapp-specific compiler exception. The
[bidirectional interop cookbook](../../docs/typescript-target/INTEROP.md)
extracts this example into reusable import, extern, DCE, packaging, and
dual-output recipes.
