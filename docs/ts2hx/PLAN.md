# ts2hx: TS/JS → Haxe migration/scaffolding experiment

This is a **low-priority, post-1.0 experiment** for genes-ts:

- Input: an existing **TypeScript/JavaScript** project (optionally TSX)
- Output: **Haxe source** that can compile (initially) to **JavaScript** via genes-ts (or classic Genes)
- Primary goal: make it **easier to port TS/JS projects into Haxe**, so later work can target other Haxe backends (or be refactored toward other ecosystems) with less manual rewrite.

Terminology: this is a **subset translator and migration tool**, not a reverse
compiler or a lossless general TypeScript-to-Haxe compiler.

## Current status (July 14, 2026)

ts2hx supports a practical subset of modern TypeScript for **Haxe-for-JS**
compilation, with deterministic golden/snapshot tests and selected runtime
differentials.

What is implemented:

- Project loading via `tsconfig.json` (Program + TypeChecker) and deterministic file traversal
- Import/export coverage (default/named/namespace, local export lists, common re-export forms)
- Statement + expression coverage for a broad JS/TS subset
- Destructuring patterns:
  - variable declarations
  - destructuring assignments
  - function/arrow params (defaults + rest)
- Optional chaining and logical assignment operators (`??=`, `&&=`, `||=`) best-effort
- Haxe smoke compilation for all fixtures, and node runtime smoke for most fixtures
- A default `strict-js` mode with structured, source-positioned diagnostics,
  transactional output, and nonzero status for known unsupported source files
  or top-level statements
- An `assisted` mode whose incomplete output carries explicit loss markers and
  a deterministic `ts2hx-manifest.json`
- A minimal semantic plan for exact undefined/default absence, typed
  uninitialized locals, truthiness, lvalue evaluation order, `for` continuation
  steps, switch fallthrough, bounded finally completion, and feature provenance
- A schema-v3 manifest that records the complete support/portability matrix,
  exact TypeScript compiler facts, effective module-request dispositions, and
  the selected Haxe runtime capability profile
- An explicit `genes-esm` versus request-free `standard-haxe-js` boundary;
  standard Haxe fails transactionally at the first effective ESM request, and
  generated compiler-owned carriers repeat the guard during Haxe typing
- An exact original-TS versus classic-JS versus genes-ts-JS event differential
  for seventeen supported contracts, plus thirteen feature-specific
  fail-closed cases (including the standard-Haxe request-capability boundary)

Important limitations:

- This is still **JS-centric**: undefined, truthiness, finally, and async use
  named genes helpers with J1 grades.
- Not all TS syntax is accepted yet (TSX is not a core focus unless/until a fixture demands it).
- Some patterns are supported only in the “high signal” shapes we see in fixtures (e.g. logical assigns currently require identifier LHS).
- Exit `0` means the encountered constructs fit the declared matrix; it does
  not prove arbitrary TypeScript semantics. Dynamic prototype mutation,
  labeled switch continue and outer completion through finally intentionally
  reject today. Side-effect imports support packages and manifest-owned runtime
  files while ambiguous relative/attribute/re-export variants fail closed. Other
  unmodeled syntax still requires a focused contract before promotion.

Tracking:

- Existing implementation history remains under `genes-dhg`; the first
  fail-closed semantic IR/differential milestone landed under `genes-09r.7`.

## North star

The long-term goal is to give every source item in a real-world TypeScript
project an explicit, machine-readable disposition:

- supported losslessly under a declared strict contract;
- supported on JS through a named, recorded runtime helper;
- emitted only as explicitly incomplete assisted scaffolding; or
- rejected with a stable source-positioned diagnostic.

"Accepting" a project means complete inventory without crashes or silent
omission; it does not mean fabricating executable output for unsupported
semantics. Strict mode may use narrow named helpers only when the helper has a
tested semantic contract. Dynamic fallbacks, generated extern approximations,
and raw syntax that lose information belong in assisted output unless their
behavior has been explicitly supported and differentially tested.

The planned contracts are:

- **`strict-js`**: preserve the declared supported TypeScript/JavaScript subset
  on Haxe's JS target, including named JS-specific helpers recorded in the
  manifest;
- **`strict-portable`**: future subset that avoids JS-only runtime semantics and
  carries a portability grade; it is not implemented today;
- **`assisted`**: reviewable inventory/scaffolding with explicit losses and no
  executable-parity claim.

---

## Why Haxe is used more for transpilers than TypeScript (and why that matters here)

In practice, “compile TS to other languages” is harder than “compile Haxe to other languages” for structural reasons:

- **Haxe is a multi-target language by design**:
  - It has a stable typed compilation pipeline intended to end in different backends.
  - Macro facilities + compiler APIs are built for whole-program transforms.
- **TypeScript is “JavaScript + types” by design**:
  - Runtime semantics are JavaScript’s (modules, prototypes, `this`, dynamic objects, side-effect imports, etc.).
  - Many TS types are **erased** and have no direct runtime representation.
  - The type system is extremely expressive and structural (unions/intersections/conditional types/declaration merging), which often does not map cleanly to nominal/other target languages without a runtime and/or a restricted subset.

Implication for ts2hx:
- Treat it primarily as a **migration tool** (TS/JS → Haxe-for-JS), not as
  “TS → portable Haxe for all targets”.
- Demonstrate JS behavioral equivalence feature by feature with differential
  traces.
- Prefer an honest diagnostic to compiling Haxe whose runtime behavior is only
  an undocumented approximation.
- Explore portable Haxe later through explicit grades and cross-target tests;
  see `PORTABILITY.md`.

---

## Scope

### v0 goals (minimum useful subset)

- Parse a TS project using its `tsconfig.json` (including TSX).
- Emit Haxe that **compiles and runs on JS** with genes-ts.
- Cover a practical subset:
  - `import`/`export` forms (default/named/namespace, re-exports)
  - top-level const/let/var (as far as expressible)
  - functions (including arrow functions where possible)
  - classes (fields, methods, constructors, `extends`, `implements`)
  - interfaces + type aliases (best-effort mapping)
  - enums (best-effort)
- Provide escape hatches:
  - generate small `extern` stubs when a value is “ambient”/unrepresentable
  - optionally inject `js.Syntax.code(...)` at narrow boundaries for unsupported patterns

### Non-goals (v0)

- “Perfect” semantics for all JS edge cases (prototype mutation, `Proxy`, `with`, etc.).
- Producing perfectly idiomatic Haxe for every construct.
- Automatic porting to non-JS targets (that’s a later, manual refactor process).
- Framework remapping (e.g. React Router → Phoenix) — this belongs to a future “meta framework” layer, not the compiler.

### v1+ goals (long-term)

- **Full project inventory**: parse and type-check real TS projects (including
  TSX) and give every reachable item a deterministic support disposition.
- **Import/export completeness**: handle all module syntaxes/re-exports encountered in the wild.
- **Statement/expression completeness**: either preserve a statement/expression
  under the selected strict mode or report why it is unsupported.
- **Type coverage**: best-effort mapping for advanced TS types (unions, intersections, generics, mapped/conditional types, declaration merging), with explicit fallbacks when required.
- **Interop strategy** for “unrepresentable” JS patterns (prototype mutation, dynamic property bags, `Proxy`, etc.) that still compiles for JS via tightly scoped escape hatches.

---

## Architecture recommendation

### Use the TypeScript compiler API (Program + TypeChecker)

Avoid writing a parser or resolver:
- Use `ts.createProgram(...)` with `ts.parseJsonConfigFileContent(...)`.
- Get correct module resolution, symbol identity, `import` shape, and TSX parsing “for free”.
- Use `TypeChecker` to:
  - resolve symbols and aliases
  - handle `typeof` and inferred types
  - distinguish type-only vs value positions

### Preferred implementation language: TypeScript (Node CLI)

Default recommendation: implement ts2hx in **TypeScript**.

Pros:
- Fastest iteration against the TypeScript compiler API.
- No extern drift/maintenance burden for TS compiler internals.
- Easier to keep up with TS language changes.

Cons:
- Harder to share code with genes-ts (Haxe) directly.

Alternative: implement in Haxe (compile to Node), like `haxiomic/dts2hx`.
- This can make sharing utilities easier and keeps everything “in Haxe”, but it requires maintaining TS compiler API externs which change frequently.

### Add a minimal semantic IR, not a TypeScript AST clone

The current direct AST-to-string emitter remains useful for already safe,
simple forms. Migrate only categories that currently lose semantics into a
small validated representation:

- values: `Undefined`, `Null`, `AbsentParameter`, and `Uninitialized`;
- expressions: `EvalSequence`, `TempBinding`, `Read`, `Write`, `Call`,
  `Construct`, `Coerce`, and `Truthiness`;
- control flow: `If`, `Loop` with an explicit `continueStep`, `Switch` with
  fallthrough, `Try`/`catch`/`finally`, `Return`, and `Throw`;
- modules: value, type-only, side-effect, default, `export =`, and merged
  namespace identities;
- provenance/support data on every normalized node.

The translator decides support and produces diagnostics before printing. The
printer renders only validated IR and must not invent defaults, silently drop
statements, or insert generic "unsupported" throws. Migrate one risk category
at a time behind snapshots and TypeScript-versus-Haxe runtime traces. This work
is `genes-09r.7`.

### Output strategy (important constraint)

Target **Haxe-for-JS** first:
- Prefer output that is valid Haxe and compiles under the JS platform.
- When uncertain, prefer emitting **JS-native externs / small `js.lib.*` wrappers** rather than inventing “portable” abstractions.

---

## Codegen strategy (v0)

### Naming + files

- Mirror the TS module graph to Haxe packages where possible.
- Keep stable file paths for diff-friendly output.
- Maintain a mapping table:
  - TS module specifier → Haxe package path
  - exported names → local identifiers

### Types (best-effort)

Map TS types to Haxe types with intentional fallbacks:
- `string/number/boolean/null/undefined` → `String/Float/Bool/Null<T>` (or `Null<T>` equivalents)
- union/intersection → prefer `Dynamic` or `EitherType` patterns (with opts)
- structural object types → anonymous structures `{ field: Type }` where possible
- generics → Haxe type parameters (best-effort)

When a type can’t be expressed:
- fall back to `Dynamic` (configurable) while preserving enough structure to make downstream manual refactors possible.

---

## Testing strategy (layered and deterministic)

Snapshots over emitted Haxe are a shape/determinism layer, not the semantic
oracle.

Recommended harness:
- `fixtures/` directory containing small TS/TSX inputs (each fixture is its own mini-project).
- A test runner that:
  1) runs ts2hx on the fixture,
  2) normalizes output (line endings, paths, maybe formatting),
  3) diffs against committed snapshots.

Integration layers must additionally:

- compile supported output through Haxe/genes-ts;
- compare stable runtime traces from original TypeScript with translated
  Haxe-to-JS for every feature declared supported;
- assert that strict failures publish no partial output tree;
- verify one disposition record for every root source file;
- keep assisted losses machine-readable and visibly marked in generated files.

This retains the useful dts2hx-style diff stability while recognizing that
implementation-source translation needs semantic differentials that declaration
conversion does not.

---

## Tracking (beads)

This work is tracked under:

- Epic: `genes-dhg` (ts2hx experiment)
- Task: `genes-dhg.1` (roundtrip fixture harness)

It should remain isolated from the main genes-ts compiler pipeline (`src/genes/**`).

Suggested milestone breakdown:

1) **M0 — Plan + scope**
   - Write a design doc (this file) + define v0 supported subset + non-goals.
2) **M1 — Tool scaffold**
   - Add `tools/ts2hx/` package + CLI skeleton.
3) **M2 — Program + resolution**
   - Parse `tsconfig.json`, build Program, walk SourceFiles deterministically.
4) **M3 — Minimal codegen**
   - Emit compiling Haxe for a small subset (imports/exports, functions, interfaces/type aliases).
5) **M4 — Classes + TSX**
   - Add class emission and basic TSX lowering strategy (likely to Haxe extern/react layer rather than “render TSX”).
6) **M5 — Snapshots + integration compile**
   - Golden tests + a couple compile+run fixtures.
7) **M6 — Docs + workflow**
   - Document limitations and intended migration workflow.

---

## M7 — Roundtrip fixture harness (TS→Haxe→TS→JS)

Goal: a medium TS fixture project is:

1) executed in its **original TS** form (compiled by `tsc`),
2) transpiled to **Haxe** by `ts2hx`,
3) compiled back to **TypeScript** by **genes-ts** (Haxe→TS),
4) compiled to **JS** by `tsc`,
5) executed again; it must still pass.

This is a “migration parity” harness. It is **not** attempting to prove that the
emitted Haxe is portable to non-JS targets.

### Fixture layout (planned)

Location:
- `tools/ts2hx/fixtures/roundtrip-fixture/`

Files:
- `tsconfig.json` (NodeNext)
- `src/index.ts` (entrypoint; calls `main()` and exits non-zero on failure)
- `src/Main.ts` (exports `main(): void` and runs all assertions)
- `src/todo.ts` (domain model + operations)
- `src/assert.ts` (tiny assertion helpers)

The entry should print a stable success marker, e.g. `ROUNDTRIP_OK`.

Implementation:
- Harness: `tools/ts2hx/src/test-roundtrip.ts` (wired into `yarn --cwd tools/ts2hx test`)
- Temporary outputs: `tools/ts2hx/.tmp/roundtrip-fixture-*`

### Required feature surface (initial)

We intentionally choose a feature set that:
- is common in real TS,
- maps well to Haxe-for-JS, and
- drives ts2hx improvements beyond the existing minimal fixtures.

Types:
- primitives (`string`, `number`, `boolean`, `void`)
- arrays (`T[]` and/or `Array<T>`)
- type references with type args (e.g. `Array<T>`, `Map<K, V>`, small generic helpers)
- string literal unions (or an `enum`) for status-like modeling
- object types (interfaces / type aliases with fields)

Expressions/statements:
- `if` / `throw new Error(...)`
- array literals, object literals
- property access, method calls, `new`
- `===` / `!==` comparisons

Imports/exports:
- relative imports (`./x`)
- named exports (no default export required)

Out of scope for the first roundtrip fixture:
- TSX / JSX
- async/await and Promises
- advanced TS type-level features (conditional types, mapped types, declaration merging)
- decorators / metadata

### Output quality checks

The harness should:
- run `tsc --noEmit` on the **roundtripped** TS output,
- and enforce that `any`/`unknown` do not leak into *fixture* modules (allowing
  them only inside the runtime/stdlib boundary directories).

This is intended to catch “everything became Dynamic” regressions early.

## M8 — Expand roundtrip coverage (advanced fixture)

We maintain a second dependency-free fixture:

- `tools/ts2hx/fixtures/roundtrip-advanced/`

This fixture intentionally adds a more “real-world TS” surface area while still
being deterministic and cheap to run in CI:

- exported `const` bindings (function values)
- object literals (incl shorthand properties)
- arrow functions (used with `Array.filter`/`Array.map`)
- optional chaining (property access) + nullish coalescing
- string-literal union type aliases (emitted as Haxe `enum abstract`)

The roundtrip harness (`yarn --cwd tools/ts2hx test:roundtrip`) runs **both**
fixtures.

## M9 — Module syntax coverage fixture

We maintain a small fixture focused on module syntax that is common in real TS:

- `tools/ts2hx/fixtures/module-syntax/`

It is snapshot+smoke covered via `yarn --cwd tools/ts2hx test:snapshots` and includes:

- default exports + default imports,
- namespace imports (`import * as NS from ...`),
- re-exports (`export { ... } from ...` and `export * from ...`).

## M10 — Type literal / struct typing fixture

We maintain a small fixture focused on TS “struct-like” typing:

- `tools/ts2hx/fixtures/type-literals/`

It covers:
- `type Foo = { ... }` object type literals,
- optional fields (`?:`),
- object literal expressions matching those types.
