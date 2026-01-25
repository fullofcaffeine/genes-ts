# ts2hx: TS/JS → Haxe transpiler (post-1.0 experiment)

This is a **low-priority, post-1.0 experiment** for genes-ts:

- Input: an existing **TypeScript/JavaScript** project (optionally TSX)
- Output: **Haxe source** that can compile (initially) to **JavaScript** via genes-ts (or classic Genes)
- Primary goal: make it **easier to port TS/JS projects into Haxe**, so later work can target other Haxe backends (or be refactored toward other ecosystems) with less manual rewrite.

Terminology: this is a **transpiler / migration tool**, not a “reverse compiler”.

## North star (new requirement)

The long-term goal is for `ts2hx` to be able to take **arbitrarily complex real-world
TypeScript projects** and produce **Haxe** that:

- **Compiles** (initially) for the **JS platform** (genes-ts or classic Genes)
- Is **behaviorally equivalent** enough to unblock migration
- Uses **best-effort typing** (fall back only when required)

Important nuance: “support all TS” should be interpreted as:
- **All TS syntax / module shapes** are accepted without the tool crashing.
- If a construct can’t be expressed cleanly in Haxe, the tool may emit:
  - narrow `Dynamic`/`Any`-style escape hatches at the boundary,
  - small generated `extern` stubs, and/or
  - targeted `js.Syntax.code(...)` wrappers (kept rare and well-isolated),
  so the overall project still compiles and runs.

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
- We should treat this primarily as a **migration tool** (TS/JS → Haxe-for-JS), not as “TS → portable Haxe for all targets”.
- A realistic path to “support all TS” is:
  - prioritize **JS behavioral equivalence**,
  - accept that some portions may translate into “less-idiomatic” Haxe initially,
  - provide clear escape hatches rather than blocking on perfect modeling.

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

- **Full TS project acceptance**: parse + type-check + emit for “real” TS projects (including TSX).
- **Import/export completeness**: handle all module syntaxes/re-exports encountered in the wild.
- **Statement/expression completeness**: cover the full TS/JS statement and expression set.
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

## Testing strategy (SOTA, cheap, deterministic)

Primary testing tool: **golden/snapshot tests** over emitted Haxe.

Recommended harness:
- `fixtures/` directory containing small TS/TSX inputs (each fixture is its own mini-project).
- A test runner that:
  1) runs ts2hx on the fixture,
  2) normalizes output (line endings, paths, maybe formatting),
  3) diffs against committed snapshots.

Add a small number of integration checks:
- compile emitted Haxe to JS (genes-ts) for at least a couple fixtures
- execute a tiny runtime smoke test (node) for those fixtures

This mirrors the approach used successfully by `dts2hx` (diff-based stability), but adapted to our “source-to-source” context.

---

## Tracking (beads)

This work is tracked under:

- Epic: `genes-8uq` (ts2hx experiment)
- Task: `genes-6my.6` (minimal spike)

It should remain isolated from the main genes-ts compiler pipeline.

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
