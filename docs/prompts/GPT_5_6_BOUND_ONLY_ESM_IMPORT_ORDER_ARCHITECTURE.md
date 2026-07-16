# GPT-5.6 Pro review: bound-only ESM request order across output targets

Use this prompt with GPT-5.6 Pro after uploading the focused Repomix XML
listed at the end. This is a narrow architecture review. Do not write a broad
patch until the runtime contract and the standard-Haxe boundary are explicit.

---

You are reviewing a real TypeScript-to-Haxe migration tool inside a
Haxe-to-TypeScript/JavaScript compiler. Work evidence-first from the uploaded
repository files. Label important claims as **observed**, **inference**, or
**experiment required**. Cite uploaded paths and line ranges. If the supplied
files cannot establish a Haxe or TypeScript compiler fact, name the smallest
fixture and command that would establish it.

## Decision requested

Define the exact runtime-initialization contract of ts2hx feature
`modules.esm-bindings`, then design the smallest sound implementation for a
TypeScript module that contains only bound runtime imports.

The same translated Haxe should retain every support claim made for:

1. original TypeScript/JavaScript ESM behavior under the configured tsconfig;
2. classic Genes split ESM JavaScript output;
3. Genes TypeScript source output (`-D genes.ts`); and
4. standard Haxe JavaScript wherever the project continues to claim that the
   generated Haxe compiles or runs without the Genes custom generator.

If those four contracts cannot honestly share one source representation, state
the narrowest support boundary and diagnostic/matrix change. Do not preserve a
green snapshot by silently dropping initialization, and do not broaden a J1
claim into target portability without runtime evidence.

The review baseline is production commit
`42e3a5ef95a8ecf5983a21bb2775c0dc42349c4b`. The uploaded tree may additionally
contain this prompt and repository-agent guidance; those do not change compiler
behavior.

## Why this review exists

The earlier side-effect-import architecture is now implemented. Genes owns an
explicit ordered runtime-request projection, both implementation printers
consume it, and ts2hx can generate compiler-internal request carriers. The
landed follow-up at `80f85d1` fixed a real transitive bug by carrying ordered
plans through the converted dependency closure of a **bare-import seed**.

That scope is intentionally incomplete. A standalone translated module with
runtime bindings but no upstream bare import receives no request carrier.
Genes then discovers dependencies from typed Haxe value expressions, which can
differ from TypeScript import-declaration order. Emitting the current carrier
for every such file fixes both Genes profiles, but the marker is Genes-only and
crashes standard Haxe output at runtime.

The repository currently advertises `modules.esm-bindings` as `supported` / J1
and says it preserves the exercised ESM binding subset. The answer must decide
whether source-ordered initialization and unused runtime binding retention are
part of that feature, a new separately graded feature, or an explicit strict
failure.

## Current implementation facts to verify

- `tools/ts2hx/src/haxe/emit.ts` inventories every runtime import, but
  `orderedPlanSourcePaths` starts only from files containing a declaration with
  no `importClause`, then traverses converted runtime dependencies. A bound-only
  project with no bare-import ancestor is outside the plan.
- Within a planned file, the request carrier records runtime declarations in
  source order. A named/default runtime binding can be an internal anchor;
  package requests and binding-free converted requests use other request forms.
- The carrier is `@:keep`, `@:genes.compilerInternal`, and contains direct calls
  to `genes.internal.SideEffectImportMarker`. Genes consumes those calls into
  semantic edges and erases the field/calls from TS, JS, and declarations.
- `SideEffectImportMarker` is an `extern class` with no standard-Haxe runtime
  implementation. Its contract assumes that the active Genes generator will
  consume it.
- `genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE` is set by
  `genes.Generator.use()`. `extraParams.hxml` installs that generator when the
  library is active, while the standard ts2hx snapshot smoke uses generated
  Haxe plus the repository `src/` classpath and `genes.js.Async.enable()` without
  installing `Generator.use()`.
- `DependencyPlanBuilder` walks typed member expressions and records ordinary
  runtime references in encounter order. Haxe source imports are not themselves
  an explicit ordered Genes request plan.
- `DependencyPlan` and both Genes printers can already express and coalesce an
  ordered runtime request with a binding. The unresolved problem is producing
  those semantic facts from bound-only translated Haxe without lying to another
  output target.
- The snapshot suite currently owns 20 projects and 48 generated Haxe files.
  Most compile and run through standard Haxe JS; documented exceptions are
  explicit. Semantic parity, however, is established by the three-runtime
  differential rather than snapshots alone.
- `tools/ts2hx/src/semantic/ir.ts` currently gives
  `modules.esm-bindings` one broad supported/J1 row. It does not distinguish
  binding shape, declaration order, binding use, or TypeScript import-elision
  options.

Correct any of these claims that the uploaded files disprove.

## Reduced repro A: all bindings live, declaration order observable

```ts
// state.ts
export const events: string[] = [];

// first.ts
import { events } from "./state.js";
export const first = events.push("first");

// second.ts
import { events } from "./state.js";
export const second = events.push("second");

// Main.ts
import { first } from "./first.js";
import { second } from "./second.js";
import { events } from "./state.js";

export function main(): void {
  console.log(`BOUND_ONLY_TRACE:${events.join(",")}|${second}:${first}`);
}
```

The reverse value reads are deliberate. They prevent ordinary dependency
discovery from accidentally matching the import declarations.

Current ts2hx output has this shape:

```haxe
package boundaudit;

import boundaudit.First.first;
import boundaudit.Second.second;
import boundaudit.State.events;

function main():Void {
  trace("BOUND_ONLY_TRACE:" + events.join(",") + "|" + second + ":" + first);
}
```

A local Haxe 4.3.7 / TypeScript 6.0.2 experiment produced:

| Pipeline | Runtime trace | Main's final runtime request order |
| --- | --- | --- |
| Original TS compiled as NodeNext ESM | `first,second\|2:1` | First, Second, State |
| Standard Haxe JS (`-dce full`, no Genes generator) | `first,second\|2:1` | monolithic output; mechanism not yet treated as a contract |
| Classic Genes ESM JS | `second,first\|1:2` | State, Second, First |
| Genes TypeScript source output | `second,first\|1:2` | State, Second, First |

Adding this carrier to the generated Haxe changes both Genes profiles to
`first,second|2:1` and prints First, Second, State:

```haxe
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.SideEffectImportMarker.internal(first);
  genes.internal.SideEffectImportMarker.internal(second);
  genes.internal.SideEffectImportMarker.internal(events);
  true;
};
```

The same source compiled by the snapshot-style standard Haxe command emits the
marker call and fails at runtime:

```text
ReferenceError: genes is not defined
    at ... SideEffectImportMarker.internal(...)
```

This is the conflict to resolve. Do not assume standard Haxe's observed
`first,second` result is guaranteed without identifying the compiler rule and
testing the supported Haxe lanes.

## Reduced repro B: unused value binding and tsconfig import elision

Prepend another request whose imported name is never read:

```ts
// unused.ts
import { events } from "./state.js";
export const unused = events.push("unused");

// first line of Main.ts
import { unused } from "./unused.js";
```

With `compilerOptions.verbatimModuleSyntax: true`, TypeScript retains the
declaration and the original trace is:

```text
unused,first,second|3:2
```

Current ts2hx emits a Haxe import for `unused`, but no value expression refers
to it. Under full DCE, standard Haxe omits that module and produces
`first,second|2:1`; both Genes profiles omit it and additionally reorder the
live dependencies to `second,first|1:2`.

Without `verbatimModuleSyntax`, the pinned TypeScript compiler may elide that
unused import from its own JavaScript output. Decide explicitly whether ts2hx
must mirror configured TypeScript import-elision semantics, preserve every
runtime-shaped source import, or reject configurations/shapes it cannot model.
Do not let this choice remain an accidental consequence of Haxe DCE.

Also account for `import {}`, unused default imports, namespace imports,
mixed type/value specifiers, and aliases. Type-only declarations must not
create runtime requests.

## Candidate directions to evaluate

These are hypotheses, not instructions. Reject or combine them as needed.

### Candidate 1: conditionally emit the existing Genes carrier

Generate ordered carriers for every file with runtime import declarations, but
guard them with a compiler-owned condition such as:

```haxe
#if genes.generator.active
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  // ordered marker calls
  true;
};
#end
```

Genes would receive the complete request plan; standard Haxe would see today's
ordinary source. Determine whether a define created by `Generator.use()` exists
early enough for conditional parsing in every supported invocation and compile
server reuse. More importantly, determine whether omitting the carrier under
standard Haxe is sound for declaration order, unused imports, packages,
namespace imports, cycles, and DCE. Repro B suggests it is not a complete
general solution by itself.

### Candidate 2: make an internal carrier target-polymorphic

Introduce a real, narrowly typed standard-Haxe implementation for internal
order/retention anchors while Genes continues to consume and erase the calls.
Possibilities include a non-extern generic `touch<T>(value:T):Void`, a dedicated
per-module token, or separate Genes/standard expansions.

Analyze whether evaluating a value merely to retain its module can introduce
observable getter reads, TDZ changes, static-initialization changes, cycle
differences, or output/runtime helper leakage. A fake no-op is not sufficient
unless its argument evaluation and DCE behavior are proven. Do not use
`Dynamic`, `untyped`, raw JS syntax, or a process-global macro registry.

### Candidate 3: generate neutral per-module request tokens

Give converted modules deterministic typed tokens and have importers reference
tokens in declaration order rather than reading real imported values. Genes
could turn each token reference into a module request; standard Haxe could use
the same references to retain and order modules through a small real runtime
boundary.

Evaluate output churn, public/declaration filtering, ordinary Haxe behavior,
cycle semantics, token initialization timing, collision rules, and whether a
token reference actually establishes standard-Haxe module initialization order.
The prior DCE experiment showed that pure anchor reads can disappear before
Genes, so proof is required.

### Candidate 4: recover Haxe import declaration order inside Genes

Teach Genes to derive request order from Haxe imports rather than generated
carriers. First establish whether the typed macro API retains source import
declarations, aliases, unused imports, module identity, positions, and order.
Do not recommend compiler-internal reflection, raw-source reparsing, or a global
side channel merely to avoid generated semantic facts.

### Candidate 5: narrow or split the support contract

Keep the safe bare-import-root closure supported and fail closed for standalone
bound-only cases whose initialization cannot be proven. Alternatively split
binding surface/type translation from runtime-request ordering/retention into
separate semantic rows and grades.

If choosing this direction, define the exact source-positioned diagnostic. A
rule that rejects every file with two runtime imports may be honest but far too
broad; a rule that tries to predict Genes value-use order may be fragile. State
what the tool can decide transactionally before writing output, how assisted
mode reports the loss, and whether a target capability must become an explicit
CLI/manifest choice.

### Candidate 6: make this subset explicitly Genes-only

Treat source-ordered bound ESM requests as J1 behavior guaranteed only when the
translated Haxe is compiled with classic Genes or genes-ts. Preserve standard
Haxe compile/run claims only for fixtures that do not require this semantic
carrier, and document the boundary.

This may be the honest answer, but explain how users and automated manifests
know the required compiler capability. A generated file that compiles under
standard Haxe and silently changes initialization is worse than an explicit
capability error.

## Questions the decision must resolve

1. Is declaration-ordered module evaluation required by
   `modules.esm-bindings`, including when all imports have bindings?
2. How should configured TypeScript import elision, especially
   `verbatimModuleSyntax`, affect runtime-request retention?
3. What exact binding shapes are in the first supported subset: named,
   default, namespace, aliases, `import {}`, mixed type/value, package externs,
   converted relatives, and re-exports?
4. Does every runtime import need a request fact, even when its binding is
   unused or only used in a type position?
5. Can one generated Haxe carrier be semantically real under both Genes and
   standard Haxe, or must standard Haxe become an explicit capability boundary?
6. If conditional compilation is used, when is
   `genes.generator.active` defined relative to parsing/typing, and how is state
   isolated across compile-server sessions?
7. How do duplicate requests coalesce without changing first occurrence?
8. How are cycles and live bindings handled without converting ESM
   instantiation into call-time reads or introducing TDZ differences?
9. Must runtime re-exports join the same ordered declaration plan before this
   feature can be broad, or can they stay separately fail-closed?
10. Which facts belong to ts2hx's project plan, generated Haxe, Genes'
    `DependencyPlan`, and output-specific printers?

## Non-negotiable repository rules

1. genes-ts remains one general-purpose Haxe-to-TS and Haxe-to-modern-JS
   compiler. Both Genes output modes are first-class and share semantic facts.
2. The typed Haxe AST remains authoritative. Do not port to Reflaxe, create a
   second compiler engine, or build a universal IR.
3. No downstream project names, paths, schemas, DTOs, or product conventions
   may enter compiler code.
4. No `untyped`, `Dynamic`, emitted `any`, broad `unknown`, raw import strings,
   unchecked casts, or process-global occurrence registries.
5. Generated Haxe and TS APIs stay strongly typed. Compiler-internal evidence
   must not leak into user JS, TS, `.d.ts`, public surfaces, or source maps.
6. Unsupported input remains deterministic, source-positioned,
   transactional, and fail-closed in strict mode. Assisted output must carry an
   explicit loss and no executable parity claim.
7. Type-only and declaration-only reachability must not become runtime
   reachability. Runtime requests must retain only what ESM evaluation needs.
8. Preserve aliases, module identity, extension policy, import attributes,
   package boundaries, source maps, output ownership, and deterministic tree
   hashes.
9. Standard-Haxe behavior must be either executable evidence or a documented
   capability error. A marker that compiles but crashes is not degradation.
10. Advanced macros/metadata and codegen invariants require didactic
    Why/What/How hxdoc.
11. Land incrementally with rollback points, focused differentials, then full
    `yarn test:ci`, including classic/TS todoapp journeys and security gates.

## Required answer

Return a decision document with these sections:

1. **Verdict and exact contract** — state what `modules.esm-bindings` promises
   today versus after the proposed change. Adopt/reject/modify each candidate.
2. **ECMAScript and TypeScript semantics** — explain source request order,
   once-only evaluation, live bindings, cycles, and configured import elision.
   Separate language facts from TypeScript emitter policy.
3. **Target matrix** — exact support/grade for original TS, classic Genes,
   genes-ts, and standard Haxe for each supported binding shape.
4. **Semantic ownership** — immutable project/edge/request records and the
   responsibility of ts2hx, generated Haxe, `DependencyPlanBuilder`,
   `DependencyPlan`, and each printer. Include concise typed pseudocode.
5. **Generated Haxe contract** — exact carrier/token/helper shape, conditional
   rules, target guard, collision policy, DCE behavior, and why it does not add
   observable reads or leak public API.
6. **Initialization proof** — walk repro A and B through TS emit, Haxe typing
   and DCE, both Genes profiles, standard Haxe if retained, and Node ESM
   execution. Do not treat source shape as runtime proof.
7. **Cycles, duplicates, and re-exports** — exact first boundary and stable
   diagnostics for anything still unproven.
8. **Failure modes/threat model** — include unused imports, default/namespace
   anchors, getters, TDZ, package externs, compile-server state, source maps,
   declaration leakage, output churn, and stale artifacts.
9. **Incremental implementation plan** — dependency-ordered commits/Beads,
   shadow comparison, rollback points, and the smallest producer/printer
   changes.
10. **Test matrix** — require original TS, classic Genes, genes-ts, and every
    retained standard-Haxe claim; `-dce full`; live and unused bindings;
    duplicates; cycles; packages; namespace/default/named imports; type-only
    imports; `verbatimModuleSyntax` on/off; no marker leakage; transaction
    preservation; deterministic trees; pinned TS lanes; and full CI.
11. **Exact matrix/docs/compatibility changes** — stable feature IDs, support
    counts, portability grades, limitations, usage wording, fixture inventory,
    and compatibility evidence.
12. **Open experiments** — only facts not provable from the upload, each with
    the smallest fixture and command that resolves it.

Do not return a generic ESM essay. Prefer a narrow, mechanically provable
contract over a clever carrier. If a candidate relies on undocumented Haxe
ordering, mark it experimental until the proposed differential proves it.

## Focused files to upload

Upload the companion Repomix XML containing at least:

- `AGENTS.md`, `package.json`, `haxelib.json`, and `extraParams.hxml`;
- the earlier side-effect-import prompt and reviewed response;
- `src/genes/CompilerInternal.hx`;
- `src/genes/DependencyPlan.hx`;
- `src/genes/DependencyPlanBuilder.hx`;
- `src/genes/Dependencies.hx`;
- `src/genes/Generator.hx`;
- `src/genes/Module.hx`;
- `src/genes/PublicSurface.hx`;
- `src/genes/internal/SideEffectImportMarker.hx`;
- the classic, TS, expression, and declaration emitters involved in consuming
  compiler-internal fields and printing imports;
- `src/genes/ts/Imports.hx`;
- `tools/ts2hx/src/haxe/emit.ts`;
- `tools/ts2hx/src/semantic/ir.ts`;
- `tools/ts2hx/src/test-semantic-diff.ts`;
- `tools/ts2hx/src/test-snapshots.ts` and `test-roundtrip.ts`;
- the complete semantic-diff and semantic-unsupported fixtures;
- the module-syntax, module-regexp, and non-relative-import fixtures and their
  reviewed Haxe snapshots;
- `tests/side-effect-import/**`, excluding generated `out/**`;
- the architecture, output-mode, compatibility, and ts2hx support documents;
- this prompt.

Do not include `node_modules`, build outputs, `.tmp`, unrelated archives,
secrets, or machine-local paths.

---
