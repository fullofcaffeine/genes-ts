# genes-ts: Haxe → TypeScript compiler (approach + implementation plan)

## Executive summary

You want a new compiler named **genes-ts**: **Haxe → TypeScript source output** (not just `.d.ts`), with “fully-featured” meaning: if a project compiles to the Haxe **JavaScript target**, it should compile to this TS target with equivalent runtime semantics and strong interop.

After reviewing:
- **Genes** (this repo): a custom JS generator that already outputs **split ESM** and **very complete `.d.ts`**.
- **Reflaxe** patterns and **Reflaxe.Elixir** (in `/Users/fullofcaffeine/workspace/code/haxe.elixir.codex` and `/Users/fullofcaffeine/workspace/code/haxe.elixir.reference`).

The best “get to 1.0 fastest without painting ourselves into a corner” approach is:

> **Build a TS emitter on top of the JS platform pipeline (Genes-style custom JS generator), but change the output shape to real TS declarations (`export class`, `export interface`, etc.) so the `.ts` files type-check and can be the source of truth.**

Then optionally:
- generate `.d.ts` via `tsc` from the emitted `.ts`, and
- add a Haxe 5 `--custom-target typescript=...` UX wrapper later (Reflaxe.Elixir shows how to gate activation cleanly on Haxe 5).

This leverages the biggest advantage we have: **Haxe’s JS-platform typing + stdlib + semantics are already correct for the runtime we ultimately want (JavaScript).**

## Current status (Jan 23, 2026)

- A TS emission mode is wired behind `-D genes.ts` with a minimal emitter (`src/genes/ts/TsModuleEmitter.hx`).
- A strict TS typecheck + runtime smoke test harness exists in `tests_ts/` and runs via `npm run test:genes-ts`.
- `npm test` and `npm run test:genes-ts` are green.

## Decisions (Jan 2026 discussion)

- **Output contract:** TS is the primary artifact; output should be **idiomatic TS** in both code and project/module structure.
  - Packaging: do **both** — emit TS source as the “primary” human-readable artifact, and provide an official build path that produces `dist/` (`.js` + `.d.ts`) for npm consumption.
- **TypeScript strictness:** **strict by default**, but configurable.
- **Haxe version:** start with **Haxe 4.3.7** (latest stable Haxe 4.x).
- **Debugging:** first-class Haxe→TS sourcemaps early; TS→JS map composition can be a later milestone.
- **Interop/idioms:** support Haxe stdlib + reflection conventions by default, while allowing “TS-first” coding via externs/metadata/opt-in behaviors.
- **Module/import policy:** support both:
  - Default to explicit **`.js` import specifiers** (Node ESM / `NodeNext` friendly).
  - Provide an opt-in **extensionless import** mode for bundler-first workflows.
- **`Dynamic` mapping:** default `Dynamic` → `any`, with an opt-in mode for `Dynamic` → `unknown`.
- **Runtime profiles:** default “Haxe runtime compatibility” output, plus an opt-in “minimal runtime / no-reflection” profile.
- **Metadata:** prefer TS-specific metadata (e.g. `@:ts.type`, `@:ts.returnType`), with optional compatibility aliases for Genes metadata (`@:genes.type`, `@:genes.returnType`).
- **Foundation choice:** use a **Genes-style custom JS generator** as the base (for JS-semantics fidelity on Haxe 4.x); borrow Reflaxe patterns (prepasses, config profiles) as needed.

---

## What “fully-featured” should mean (proposed success criteria)

### Language + typing
- Supports mainstream Haxe language features used by production JS targets:
  - classes, interfaces, enums, abstracts, typedefs, pattern matching, generics
  - closures, iterators, exceptions, inline, optional args/defaults, rest args
  - externs (`@:native`, `@:jsRequire`, `@:selfCall`, etc.)
  - `js.Syntax.code` / `__js__` style “raw JS” injection
- Output `.ts` type-checks under an agreed `tsconfig` profile (see “Open questions”).

### Runtime semantics
- Runtime semantics match Haxe→JS as closely as practical:
  - reflection-ish needs remain viable (e.g. `Type`, class identity, enum identity)
  - module splitting retains correct initialization order and handles cycles

### Tooling contract
- Deterministic output formatting (stable diffs).
- Source maps: at least **Haxe → TS** maps.
- CI guarantees:
  - `tsc --noEmit` succeeds on generated TS
  - runtime tests (node) pass for representative programs

---

## Options considered

### Option A — Extend/fork Genes (custom JS generator) to emit TypeScript (recommended)

**Idea:** keep the JS platform pipeline (`Compiler.setCustomJSGenerator`), but replace emission so output is **real TypeScript source**:
- `export class` statements (not `export const Foo = class Foo {}`)
- typed fields/params/returns
- `import type` where needed
- preserve Genes’ module graph/cycle handling + sourcemap machinery

**Pros**
- **Correct platform semantics for free**: Haxe truly compiles for JS (TS shares JS runtime).
- Reuses Genes’ hard work:
  - module splitting & dependency resolution
  - cycle detection and “deferred extends” mechanisms (`Register.inherits`)
  - robust TS type mapping already implemented in `src/genes/dts/TypeEmitter.hx`
  - the existing `tests/` corpus as a known-good baseline
- Still possible to fall back to JS generator output for raw-injection expressions.

**Cons / risks**
- Needs a deliberate TS-friendly output shape (Genes’ JS output patterns do not automatically become good TS).
  - Biggest example: `export const Foo = class Foo {}` does **not** introduce a TS “type name” `Foo` the way `export class Foo {}` does.
- DCE + type-only reachability: TS signatures may require types that are not runtime-reachable.

**Why it’s still best**
- “Fully-featured” is mostly about **semantic fidelity** to Haxe JS.
- A TS backend that doesn’t ride the JS platform pipeline will spend a lot of effort re-achieving what Haxe already does correctly.

---

### Option B — Implement a Reflaxe TypeScript target from scratch

**Idea:** write a Reflaxe compiler (`compileClassImpl/compileEnumImpl/compileExpressionImpl`) that emits TS.

**Pros**
- Clean “new target” ergonomics: output dir defines, file-per-module, preprocessors, hooks.
- Strong patterns from Reflaxe.Elixir:
  - prepass pipeline for AST hygiene (remove temp vars, normalize switches, etc.)
  - Haxe 5 `--custom-target` gating (avoid activation just because the lib is present)

**Cons / risks**
- Unless we deliberately force JS-platform semantics, we risk subtle mismatches:
  - stdlib selection and platform-dependent compiler behavior
  - `#if js` gated code and JS extern assumptions
- Still needs a complete expression compiler and runtime strategy.

**When to choose it**
- If “first-class target UX” (Haxe 5 custom target, clean `-D typescript_output=...`) matters more than the fastest path to correctness.

---

### Option C — Fork Haxe compiler and add an official TS backend

**Pros**
- Total control, best integration, could share infrastructure with JS backend.

**Cons**
- Highest long-term maintenance cost; not worth it unless upstreamed.

---

## Recommendation

Start with **Option A**:

1) Build a new TS emitter using **Genes’ macro integration + module graph**, but output **TS-native declarations** so the `.ts` files are self-typed.

2) Copy/port the most valuable *patterns* from Reflaxe targets:
- an explicit “prepasses” layer (optional but useful)
- Haxe 5 activation gating (avoid “target runs on every compile”)
- clear config surface (defines) and “profiles” (fast vs full)

3) Use `tsc` as a verifier (and optionally as the `.d.ts` generator).

This keeps you on the JS semantics rails while still producing TS that’s correct and pleasant to consume.

### Note on `Dynamic` mapping (recommendation)

- Default: `Dynamic` → **`any`** (matches Haxe’s intent and avoids “cast-everywhere” pain, including in stdlib/JS extern-heavy code).
- Optional strict mode: `Dynamic` → **`unknown`** (stronger safety, but expect significant friction; best as an opt-in define).

---

## Proposed architecture (high-level)

### 1) Compilation phase hooks (macro side)

**Goals:**
- Capture all types you may need for TS signatures (even if runtime DCE drops them).
- Collect module graph and output configuration deterministically.

**Key hook points:**
- `Context.onAfterTyping` (or equivalent) to snapshot a *pre-DCE* view for type-only needs.
- `Context.onGenerate` to produce final emitted modules (post-DCE), but with access to the earlier snapshot.

### 2) Internal IR (keep it close to Genes)

Reuse the existing `genes.Module` concept:
- member list: classes/enums/typedefs/main
- computed imports: **value imports** vs **type-only imports**
- cycle detection (`Module.isCyclic`) so `extends` can be deferred when needed

Add TS-specific IR facts:
- whether a dependency is needed at runtime or only for type positions
- which declarations must exist as **types** vs **values** (or both) in TS’s namespaces

### 3) TS emission strategy

**Key rule:** emitted `.ts` must carry its own types; do not rely on a sidecar `.d.ts`.

#### Classes
Prefer:
- `export class Foo extends Register.inherits(...) { ... }`
- then separately: `$hxClasses["pkg.Foo"] = Foo`

This preserves:
- real TS class declaration (type name + value)
- Genes’ runtime behavior and cycle strategy

#### Interfaces
Use TS’s split namespaces:
- `export interface IFoo { ... }` for type-checking
- plus a runtime stub to preserve reflection patterns used by the Haxe JS runtime:
  - `export const IFoo = function() {};`
  - `IFoo.__isInterface__ = true;`

TS allows a type-level interface and a value with the same name (type/value namespaces).

#### Enums
Keep Genes’ proven runtime encoding while improving typing:
- runtime: `export const MyEnum = { ... } as const;`
- typing: `export type MyEnum = ...` (discriminated union)
- optionally: `export namespace MyEnum { export type ... }` for constructor-member types

Important: preserve enum identity fields used by Haxe (e.g. `_hx_index`, `__enum__`) while optionally offering a friendlier discriminator (Genes already supports `-D genes.enum_discriminator=_kind`).

#### Typedefs and abstracts
Map to TS:
- typedef → `export type`
- abstract (non-extern) → usually a `type` alias to the underlying representation, unless a runtime wrapper is required
- `@:coreType` abstracts likely map to `any`/`unknown` depending on strictness goals

### 4) Type mapping (bootstrap from Genes’ `TypeEmitter`)

Genes already has a solid baseline mapping:
- `String` → `string`
- `Int`/`Float` → `number`
- `Bool` → `boolean`
- `Void` → `void`
- `Null<T>` → `null | T`
- `EitherType<A,B>` → `A | B`
- `Dynamic` → `any` (or `unknown` if you want a stricter mode)

For TS *implementation* output, we’ll also need:
- when to emit type arguments on methods/constructors
- how to represent Haxe constraints (`T:SomeBase`) as `T extends SomeBase`
- how to ensure “type-only” imports are generated as `import type`

### 5) DCE and type-only reachability (must address explicitly)

Haxe DCE is runtime-driven; TS signatures are type-driven.

Plan:
- Maintain two graphs:
  1) **runtime graph**: what must be emitted as executable code
  2) **type graph**: what must exist as a TS type name so signatures resolve
- If a type is type-reachable but not runtime-reachable:
  - still emit a file containing the relevant `export type` / `export interface` / `declare class` shape
  - ensure those exports do **not** create runtime side effects

This is the place where borrowing from Reflaxe’s “trackUsedTypes/manualDCE” thinking helps a lot.

### 6) Source maps

There are two realistic tiers:

1) **Haxe → TS** sourcemaps (single-stage). This is straightforward since Genes already has `SourceMapGenerator`.
2) **Haxe → JS** sourcemaps via TS compilation (two-stage). This requires sourcemap composition, or tooling that can follow chained maps.

Recommendation:
- ship Tier 1 early
- treat Tier 2 as an explicit later milestone

---

## Implementation roadmap (milestones)

### Milestone 0 — Align on target contract
- Confirm TS is the primary artifact (agreed) and define the expected output layout (e.g. `src-gen/` with ESM).
- Decide `tsconfig` expectations (`strict` by default is agreed; confirm `useDefineForClassFields`, module target, lib target).
- Confirm import-specifier policy for emitted TS (default explicit `.js` specifiers; opt-in extensionless mode) and define names.
- Confirm default `Dynamic` mapping (`any`) and the opt-in `unknown` mode define name.
- Lock minimum Haxe version to 4.3.7 (latest stable Haxe 4.x).
- Decide how important composed source maps are for 1.0 (deferred is agreed).

Deliverable:
- a small “compiler contract” doc + sample `build.hxml` + sample `tsconfig.json`

### Milestone 1 — Skeleton emitter + “hello world” correctness
- Emit `.ts` files per module with correct ESM imports/exports.
- Implement class declaration emission for:
  - empty classes
  - constructors, methods, static methods
  - basic expressions (const/local/call/return/if/block/new)
- Ensure `tsc --noEmit` passes on a tiny example and output runs in Node after compilation.

Tests:
- golden snapshot of TS output
- runtime check: execute compiled JS and compare output

### Milestone 2 — Full expression coverage (JS parity)
- Port/adapt Genes’ `ExprEmitter` coverage to TS output.
- Handle edge cases:
  - closures and `this` binding (`Register.bind`)
  - `switch` lowering, loops, labeled breaks
  - `try/catch` and throw semantics
  - `js.Syntax.code` passthrough rules

Tests:
- run the existing Genes `tests/` corpus, but type-check the emitted TS

### Milestone 3 — Enums + pattern matching
- Implement enum value encoding + TS union typing.
- Ensure pattern matching compiles to correct runtime checks.
- Support discriminator define (like Genes’ `genes.enum_discriminator`).

Tests:
- enum constructors, parameter extraction, switch on enums

### Milestone 4 — Interfaces, abstracts, typedefs, generics
- Interfaces:
  - TS interface emission + runtime stub merge
- Generics:
  - class type params + method type params + constraints
- Typedefs:
  - `export type` + proper type-only imports
- Abstracts:
  - map common std abstracts correctly (Int, Float, Null, etc.)
  - decide strategy for user-defined abstracts

Tests:
- generics-heavy code + constraints
- abstract operator overload patterns

### Milestone 5 — Externs + JS ecosystem interop
- `@:jsRequire` import styles (default/named/namespace) as Genes already handles
- `@:native` dotted access behavior
- externs with `__init__` warnings/behavior (Genes already warns)

Tests:
- import shape snapshots + runtime correctness

### Milestone 6 — DCE/type graph correctness + packaging
- Implement the two-graph strategy so TS signatures never reference missing types.
- Produce a recommended publishing layout:
  - emit TS to `src-gen/`
  - optionally run `tsc` to `dist/` (JS + `.d.ts`)

Tests:
- ensure type-only referenced types are present in generated output

### Milestone 7 — Debuggability and sourcemap composition (optional but valuable)
- Emit robust Haxe→TS sourcemaps.
- Investigate/implement map composition or provide tooling guidance for chained maps.

---

## Testing and CI strategy (practical)

1) **Golden tests (output stability)**
- Snapshot generated TS for a suite of Haxe inputs.
- Assert deterministic output (no timestamps, stable ordering).

2) **Type-check tests**
- Run `tsc --noEmit` on the generated TS with the chosen `tsconfig`.

3) **Runtime tests**
- Compile generated TS to JS (tsc/esbuild/swc).
- Execute Node tests to confirm semantics.

4) **Compatibility matrix**
- Haxe 4.3.7 baseline (optionally add Haxe 5 preview compatibility later)
- Node LTS versions
- TS versions (likely a modern baseline, not TS 3.7)

---

## “Known hard problems” to solve deliberately

### 1) TS class/type namespace correctness
Avoid output forms that erase TS “type names”:
- bad for TS typing: `export const Foo = class Foo { ... }`
- good: `export class Foo { ... }`

### 2) Cycles + `extends`
Genes’ `Register.inherits` strategy exists for a reason; TS output must keep the cycle-safe behavior.

### 3) Type-only imports vs runtime imports
TS requires careful separation:
- `import type {T} from ...` should not create runtime cycles
- runtime `import {X} from ...` must exist when values are referenced

### 4) Nullability / optionality
Haxe semantics and TS flags (`strictNullChecks`, `exactOptionalPropertyTypes`) can create surprising differences.
We need an explicit compatibility profile.

### 5) Source maps across multiple compilation stages
If we rely on TS compilation, debugging quality depends on map chaining/composition.

---

## Locked defaults (Milestone 0)

- **Packaging:** do both — emit TS as the primary artifact, and provide a standard packaging build that outputs `dist/` (`.js` + `.d.ts`) for npm consumption.
- **Imports:** do both — default to explicit `.js` specifiers, with an opt-in “extensionless imports” mode.
- **`Dynamic`:** default to `any`, with opt-in `unknown` mode.
- **Runtime:** default Haxe runtime compatibility, with an opt-in “minimal runtime / no reflection” mode.
- **Overrides:** prefer TS-specific metadata (`@:ts.type`, `@:ts.returnType`), with optional compatibility aliases for Genes metadata.

## Remaining spec details (small but important)

1) **Default TS compiler profile**
   - Proposed baseline: `moduleResolution: NodeNext`, `module: NodeNext`, `target: ES2022`, `strict: true`.
   - Provide a documented “bundler profile” alternative for extensionless imports.

2) **Define/metadata names (proposed)**
   - `-D ts.output=<dir>` (or `-D typescript_output=<dir>`) for output directory.
   - `-D ts.no_extension` for extensionless import specifiers.
   - `-D ts.dynamic_unknown` for `Dynamic -> unknown`.
   - `-D ts.minimal_runtime` for no-reflection/minimal runtime output.
   - `@:ts.type("...")`, `@:ts.returnType("...")` (and support `@:genes.*` aliases).

3) **Distribution shape**
   - Decide whether we output TS into `src-gen/` vs `generated/ts/`, and define the recommended `package.json` exports map for `dist/`.

---

## Future (low priority): `ts2hx` (TypeScript/JS → Haxe) “reverse compiler”

This is **not** part of genes-ts 1.0, but is a useful long-term experiment to make it easier to:
- migrate existing TS/JS codebases into Haxe, and then
- reuse Haxe as a multi-target “portability layer” (e.g. later porting subsets toward other backends like Reflaxe.Elixir).

### Goal / scope

- **Goal:** translate “real world” TS projects into Haxe with **maximum type preservation** and a pragmatic interop story.
- **Scope target:** “all TS code” is aspirational; in practice we should define tiers:
  - Tier 0: TS syntax coverage + buildable Haxe output (even if extern-heavy)
  - Tier 1: strong typing parity for the majority of code (interfaces, generics, unions, narrowing)
  - Tier 2: higher-fidelity patterns (decorators, emit helpers, JSX/TSX, advanced conditional types where representable)

### Recommended implementation approach

- Implement `ts2hx` in **TypeScript** (Node tool), using the **TypeScript compiler API**:
  - build a `Program` and use a `TypeChecker` to recover types, symbols, and resolved signatures
  - this is critical for accurate output (AST-only transforms lose too much semantic information)
- Produce Haxe source + extern stubs as needed:
  - prefer generating Haxe that compiles without `Dynamic` escape hatches in *translated* code
  - allow a controlled boundary of “extern + unsafe interop” for patterns that don’t map cleanly

### Why keep it in this repo?

Recommendation: keep it in the same repo only if:
- it shares significant type-mapping logic and golden fixtures with genes-ts, and
- we can keep it isolated (e.g. `tools/ts2hx/` with its own tests and CI step).

Otherwise, publish it as a sibling repo once it becomes substantial.

### References / inspiration

- `dts2hx` is a useful reference for *declaration* conversion patterns, but `ts2hx` must go further:
  - full AST + module graph + runtime semantics
  - a strategy for code that depends on JS runtime behavior (prototype mutation, global augmentation, etc.)

### Testing strategy (proposed)

- Golden “fixture projects” (realistic TS apps/libs) + snapshot tests for generated Haxe.
- A smoke pipeline:
  1) `ts2hx` translates → Haxe
  2) Haxe compiles back to TS/JS via genes-ts
  3) original test suite (or a reduced suite) runs against the rebuilt output

This turns `ts2hx` into a measured experiment rather than a speculative rewrite tool.
