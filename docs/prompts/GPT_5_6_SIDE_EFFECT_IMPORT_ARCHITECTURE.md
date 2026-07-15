# GPT-5.6 Pro review: source-ordered side-effect imports

Use this prompt with GPT-5.6 Pro after uploading the focused files listed at
the end. The request is intentionally a design review. Do not ask the model to
write a broad patch before it has resolved the initialization-order contract.

---

You are reviewing a real Haxe-to-TypeScript/JavaScript compiler and its
experimental TypeScript-to-Haxe migration tool. Work evidence-first from the
uploaded repository files. Distinguish directly observed facts, inferences,
and hypotheses. If an important fact cannot be established from the supplied
files, name the smallest additional artifact or experiment needed.

## Decision requested

Design the smallest sound architecture for **source-ordered ESM side-effect
imports** across:

1. Genes TypeScript source output (`-D genes.ts`);
2. classic Genes modern ESM JavaScript output;
3. a target-polymorphic Haxe authoring helper under `genes.ts`; and
4. ts2hx lowering of TypeScript `import "specifier"` declarations.

The goal is not merely to print `import "x"`. The design must preserve module
initialization, source order, cycles, DCE/reachability, and relative-module
identity. It must work through one maintainable semantic plan shared by the TS
and classic printers. It must not port Genes to Reflaxe, create separate
compiler engines, or build a universal IR.

Be willing to reject the feature or keep a narrower form fail-closed if the
available architecture cannot preserve a category honestly. A successful
compile is not sufficient evidence of semantic parity.

## Repository state and observed facts

Assume the review commit is `943878356823bbf5a534e548e53ffe78208c727f`
unless the uploaded checkout reports a newer commit.

- `src/genes/DependencyPlan.hx` already defines
  `DependencyEdgeKind.RuntimeSideEffect`. Its hxdoc explicitly says current
  Genes inputs only produce value imports.
- `DependencyPlan` preserves an ordered edge array, but
  `DependencyPlan.dependencies(...)` projects edges into
  `Dependencies.imports`, currently a `Map<ModuleName, Array<Dependency>>`.
  Determine whether that projection preserves the cross-module source order
  required by ESM; do not assume that it does.
- `src/genes/Dependencies.hx` currently has only `DName`, `DDefault`, and
  `DAsterisk` import forms. `push` de-duplicates and allocates aliases while
  grouping dependencies by module.
- `src/genes/es/ModuleEmitter.hx` and
  `src/genes/ts/TsModuleEmitter.hx` print bound imports with `from`. Neither
  printer has a bare side-effect import form.
- `src/genes/DependencyPlanBuilder.hx` builds runtime, type-only, and
  declaration-only facts from typed Haxe declarations and expressions. It is
  the intended semantic owner; printers should not rediscover meaning.
- `src/genes/ts/Imports.hx` provides macro-backed default, named, namespace,
  resource, and dynamic imports. It creates typed `@:jsRequire` boundaries so
  both Genes output modes use normal dependency planning. It has no side-effect
  helper.
- `tools/ts2hx/src/semantic/ir.ts` classifies
  `modules.side-effect-import` as unsupported/U. The strict fixture proves that
  it fails transactionally rather than disappearing.
- `tools/ts2hx/src/haxe/emit.ts` notices an `ImportDeclaration` with no
  `importClause`, records the semantic occurrence, and emits
  `TS2HX-MODULES-SIDE-EFFECT-IMPORT-001`. `collectImports` deliberately omits
  such declarations.
- For a relative import, ts2hx can resolve the corresponding TypeScript source
  through `resolveRelativeSourceFile(...)` and calculate its generated Haxe
  module identity through `moduleTargetFromImport(...)`.
- Importing the original relative `./effect.js` from translated Haxe output is
  generally wrong: that JavaScript file may no longer exist because its source
  was converted into a Haxe module.
- A package/resource side-effect import and a relative converted-source import
  therefore may require different lowering mechanisms even though both share
  one semantic feature ID.
- The authoritative dual-output gate is
  `scripts/test-output-modes.ts` with one Haxe source tree compiled to TS and
  classic ESM. Standard Haxe JS and read-only `../genes-vanilla` are semantic or
  regression oracles where applicable, not byte-identity targets.
- Full `yarn test:ci` is mandatory before any implementation is considered
  usable.

Verify these claims against the uploaded files and correct any that are wrong.

## Reduced semantic repros

### A. Direct Haxe authoring, external/resource module

We want a compiler-owned helper whose conceptual use is similar to:

```haxe
package sample;

import genes.ts.Imports;

class Main {
  // The exact return/token shape is part of this design decision. A module-level
  // field is shown only because Haxe has no standalone module-body statement.
  static final setup = Imports.sideEffect("./runtime/setup.js");

  static function main():Void {
    trace("main");
  }
}
```

Required TS and classic ESM shape, modulo extension policy and comments:

```ts
import "./runtime/setup.js"
// normal generated module body
```

If two helpers occur in source order, their module evaluation must occur in
that order. No fake default export, namespace value, `any`, `Dynamic`, or
runtime no-op binding should leak into the generated public surface.

The helper should erase or degrade honestly when Genes-specific TS annotations
are absent. Explain the exact standard-Haxe behavior rather than claiming
portability implicitly.

### B. ts2hx relative converted modules

Use a differential fixture at least this strong:

```ts
// state.ts
export const events: string[] = [];

// first.ts
import { events } from "./state.js";
export const initialized = events.push("first");

// second.ts
import { events } from "./state.js";
export const initialized = events.push("second");

// main.ts
import "./first.js";
import "./second.js";
import { events } from "./state.js";

export function trace(): string {
  return events.join(",");
}
```

Original TypeScript, translated Haxe through classic Genes, and translated
Haxe through genes-ts must all return `first,second`. The generated Haxe must
retain `first.ts` and `second.ts` even though no exported binding is named by
`main.ts`.

Resolve these questions explicitly:

- Does each converted source module need a synthetic initialization marker?
- If so, is it generated for every module or only modules targeted by a
  side-effect edge, and how is its collision-free name shared with importers?
- Does reading a marker guarantee that all target-module top-level
  initializers run before the importer under both Genes emitters?
- How does full Haxe DCE affect the target, marker, and imported module?
- How are repeated imports and cycles handled without executing a module more
  than once?
- How is the original import order kept when dependencies are projected into
  the current map-based allocator?

### C. ts2hx external package or non-converted resource

Add a local, deterministic package/resource fixture whose module performs an
observable initialization action when imported without bindings. It must not
depend on the network. Decide how ts2hx distinguishes:

1. a relative specifier resolved to a converted TS/JS source file;
2. a relative non-code asset or runtime file that remains external;
3. a bare package specifier; and
4. an unresolved specifier.

For each category, specify whether strict-js supports it, supports it with a
named helper/manifest grade, or fails closed. Do not silently reinterpret a
converted local module as an external runtime file.

## Candidate designs to evaluate

These are hypotheses, not instructions. Compare them and propose a better
hybrid if warranted.

### Candidate 1: first-class runtime-side-effect dependency

- Add a side-effect import form to the immutable dependency data.
- Let a macro helper attach compiler-owned metadata/provenance to the enclosing
  Haxe module and return an erased typed marker suitable for Haxe syntax.
- Have `DependencyPlanBuilder` create `RuntimeSideEffect` edges.
- Preserve ordered edges through projection and teach both printers to emit a
  bare import.

Questions: should side-effect imports be represented by a new
`DependencyType`, by a binding-free `DependencyImport`, or by a separate
ordered declaration plan? How can existing alias de-duplication remain intact
without pretending a bare import has a symbol name?

### Candidate 2: split local converted-module and external lowering

- Use Candidate 1 / `Imports.sideEffect(...)` for external packages and
  resources.
- For a relative specifier resolved to another converted source file, emit a
  typed Haxe reference to a compiler-generated per-module initialization
  marker, thereby creating a real internal runtime edge.

Questions: is the marker semantically sufficient, or is an explicit module
initialization plan/call required? How should initialization order and cycles be
proved? Can this remain ordinary Haxe/P0, or is it JS-specific/J1?

### Candidate 3: always bind a namespace/default value

- Create an empty extern and emit a namespace/default import merely to trigger
  evaluation.

Treat this candidate skeptically. It may assume exports that do not exist,
produce misleading bindings, fail for converted relative modules, interact
badly with tree shaking, and conceal the semantic distinction already present
in `RuntimeSideEffect`.

## Unsafe approaches already identified

Do not recommend any of these without disproving the stated problem:

- raw `js.Syntax.code("import ...")`: an import is module syntax, not a normal
  expression, and raw text bypasses dependency planning, extension policy,
  source maps, and target parity;
- defining an unused extern type: Haxe/Genes DCE may remove it and no typed
  expression necessarily creates a runtime edge;
- importing the original relative `.js` after ts2hx converted that module to
  Haxe;
- treating a side-effect edge as type-only or declaration-only;
- relying on current `Map` iteration order without an explicit invariant and
  test;
- adding a synthetic marker to every converted file without analyzing output
  churn, declarations, DCE, and initialization order;
- printing all side-effect imports before all bound imports if that changes the
  source-ordered ESM dependency evaluation graph;
- supporting only a compile-time snapshot without a three-runtime ordered
  trace.

## Non-negotiable architecture rules

1. Keep genes-ts a general-purpose Haxe-to-TS **and** Haxe-to-modern-JS
   compiler. Both modes are first-class and share semantic planning.
2. Do not port to Reflaxe and do not create separate TS/classic compiler
   engines.
3. Keep the typed Haxe AST authoritative. Add only the smallest semantic fact
   or normalized node needed for this behavior; no universal IR.
4. No downstream project names, paths, DTOs, schemas, or product conventions
   in compiler code.
5. No `untyped`, `Dynamic`, emitted `any`, broad `unknown`, raw import strings,
   or unchecked casts in the framework/test implementation. If a truly
   unavoidable runtime boundary is proposed, prove why and contain/document it
   precisely.
6. Unsupported or ambiguous ts2hx input must remain source-positioned,
   deterministic, transactional, and fail-closed.
7. Declaration output must not acquire a fake value API for a side-effect-only
   edge.
8. DCE must retain exactly the modules required by runtime initialization and
   must not broaden declaration-only or type-only reachability.
9. Import attributes, extension policy, aliases, source maps, output ownership,
   deterministic tree hashes, and existing package shapes must not regress.
10. Preserve ESM evaluation order and once-only execution, including cycles,
    or document and reject the unsupported boundary precisely.
11. Use didactic Why/What/How hxdoc around new macro/compiler metadata and
    semantic invariants.
12. Implementation must land incrementally behind focused fixtures, then pass
    `yarn test:ci` including the same-source todoapp TS/classic E2E.

## Required answer

Return a decision document with these sections:

1. **Verdict** — adopt/reject/modify each candidate and state the exact first
   supported boundary.
2. **Semantic model** — immutable records/edge kinds, ownership, ordering, and
   provenance. Show concise typed pseudocode.
3. **Haxe helper contract** — exact authoring API and macro expansion strategy,
   including module-level syntax, duplicate calls, validation, standard-Haxe
   degradation, import attributes if relevant, and why it survives DCE.
4. **Printer/projection changes** — exact responsibility of
   `DependencyPlan`, `Dependencies`, TS printer, classic printer, and
   declaration printer. Resolve ordering rather than hand-waving it.
5. **ts2hx lowering** — separate algorithms for converted relative modules,
   external relative resources, packages, unresolved specifiers, duplicates,
   and cycles. Include support/portability grades and diagnostics.
6. **Initialization proof** — walk the reduced `first`/`second` example through
   Haxe typing, dependency planning, generated imports, ESM instantiation, and
   execution in both profiles. Identify any Haxe static-initialization facts
   that require an experiment.
7. **Failure modes/threat model** — ordering, DCE, cycles, declaration leakage,
   tree shaking, extension rewriting, stale artifacts, source maps, and
   assisted-mode behavior.
8. **Incremental implementation plan** — dependency-ordered commits or Beads,
   shadow/compare stage if needed, precise file ownership, and rollback points.
9. **Test matrix** — positive and negative fixtures with the exact failure each
   catches. Require at least:
   - direct Haxe TS/classic generated-source assertions;
   - two ordered side-effect imports with an observable runtime transcript;
   - a relative converted-module ts2hx three-runtime differential;
   - an external local-package/resource differential;
   - duplicate import and cyclic-module cases;
   - `-dce full` retention and no declaration leakage;
   - TS 5.5/6/7 output checks where applicable;
   - deterministic clean-tree and source-map checks where output changes;
   - strict rejection/transaction preservation for every intentionally
     unsupported category;
   - full `yarn test:ci`.
10. **Exact documentation changes** — support matrix counts/wording,
    `LIMITATIONS.md`, architecture docs, helper docs, and compatibility report.
11. **Open questions** — only questions that genuinely require a local
    experiment, each paired with the smallest command/fixture that answers it.

Do not return a generic compiler essay. Cite uploaded paths and line ranges for
every important claim. Prefer a narrow sound first increment over a broad
approximation.

## Focused files to upload

Upload a Repomix archive containing at least:

- `AGENTS.md`
- `package.json`
- `src/genes/DependencyPlan.hx`
- `src/genes/DependencyPlanBuilder.hx`
- `src/genes/Dependencies.hx`
- `src/genes/Generator.hx`
- `src/genes/Module.hx`
- `src/genes/es/ModuleEmitter.hx`
- `src/genes/ts/TsModuleEmitter.hx`
- `src/genes/ts/Imports.hx`
- `tools/ts2hx/src/haxe/emit.ts`
- `tools/ts2hx/src/semantic/ir.ts`
- `tools/ts2hx/src/test-semantic-diff.ts`
- `tools/ts2hx/fixtures/semantic-diff/**`
- `tools/ts2hx/fixtures/semantic-unsupported/**`
- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_ROADMAP.md`
- `docs/OUTPUT_MODES.md`
- `docs/ts2hx/LIMITATIONS.md`
- `docs/ts2hx/PORTABILITY.md`
- `scripts/test-output-modes.ts`
- `tests/output-modes/**`, excluding generated `out/**`

Also include the generated TS/classic files from one tiny experimental helper
fixture if available. Do not include `node_modules`, unrelated generated
bundles, secrets, or machine-local paths.

---
