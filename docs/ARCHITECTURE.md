# genes-ts architecture and contributor map

This document explains the compiler that exists in this repository, where each
kind of change belongs, and which fixture must prove it. For readiness status
and future extraction work, see [ARCHITECTURE_ROADMAP.md](ARCHITECTURE_ROADMAP.md).
For the complete test philosophy, see [TESTING_STRATEGY.md](TESTING_STRATEGY.md).

## System boundary

genes-ts is one Haxe custom JavaScript generator with two implementation
profiles and an optional declaration profile:

```text
Haxe source
  -> Haxe typer and DCE
  -> genes.Generator (typed Haxe AST)
       -> shared semantic facts and dependency plans
       -> TypeScript profile: genes.ts.TsModuleEmitter
       -> classic ESM profile: genes.es.ModuleEmitter
       -> optional declarations: genes.dts.DefinitionEmitter
  -> .ts/.tsx or .js, plus optional .d.ts and source maps
```

`-D genes.ts` selects TypeScript source output. Without it, the same generator
emits classic Genes ESM JavaScript. `-D dts` adds declarations where the active
profile supports them. The profiles share Haxe typing, module discovery,
runtime semantics, public-surface facts, nullish contracts, dependency facts,
names, and source provenance. They differ only where the target syntax or
package contract differs.

The Haxe typed AST remains the source IR. genes-ts intentionally does not clone
the whole Haxe AST into a universal backend IR. Small normalized plans exist
where multiple emitters or passes need the same semantic decision.

## Compilation sequence

1. `extraParams.hxml` installs `genes.Generator.use()` as the JS generator and
   redirects Haxe's compiler-owned output slot to a private sentinel. The
   user-visible `-js` path belongs exclusively to the Genes transaction, so
   Haxe cannot delete a previously good entry file after a generator error.
2. Before Haxe DCE can erase source-level API information, `PublicSurface` and
   `genes.ts.SignatureCache` capture the facts needed by TS interfaces and
   declarations.
3. `Generator` receives `JSGenApi`, groups typed types into `Module` values,
   records exposed/library roots, and creates shared plans.
4. Runtime, type-only, and declaration-only reachability are expanded without
   treating all three graphs as interchangeable.
5. Target capabilities known during planning, including JSX policy, are
   validated before output publication. Each emitter registers a complete file
   in a private stage; source maps use the same path.
6. `Generator` chooses `TsModuleEmitter` or classic `ModuleEmitter` for the
   implementation graph.
7. If requested, `DefinitionEmitter` emits the declaration graph. Declaration
   reachability may include public types removed from runtime output; it must
   not broaden classic JavaScript DCE.
8. `OutputTransaction` stages the complete tree, snapshots every destination it
   will mutate, publishes the ownership manifest last, removes only stale
   manifest-owned paths, and rolls the whole mutation set back on failure.

This ordering is a correctness contract. In particular, moving declaration
expansion before implementation emission can accidentally retain runtime
modules, and discovering dependencies while printing can make reachability
depend on formatting.

## Ownership map

| Concern | Primary owner | Contract |
|---|---|---|
| Generator lifecycle and profile selection | `src/genes/Generator.hx` | Orchestrates typed input, reachability, validation, implementation emission, and declarations. |
| Generation diagnostics | `src/genes/CompilerDiagnostic.hx` | Throws source-positioned Haxe macro errors through normal stack unwinding so staged output is cleaned before diagnostics escape. |
| Module/member inventory | `src/genes/Module.hx` | Presents one emitter-facing module view and materializes declaration-only members without changing the runtime graph. |
| Public API facts | `src/genes/PublicSurface.hx` | Captures visibility, inheritance, generics, overload identity, and complete closed interface members before DCE. |
| Null, undefined, and optionality | `src/genes/NullishContract.hx` | Keeps Haxe `Null<T>`, native `undefined`, optional fields, absent parameters, and unknown boundaries distinct. |
| Dependency graphs and module-request order | `src/genes/DependencyPlan.hx`, `DependencyPlanBuilder.hx` | Records runtime-value, runtime-side-effect, type-only, and declaration-only edges with provenance; projects runtime requests by external/path/attribute identity into one ordered plan. |
| Import bindings and aliases | `src/genes/Dependencies.hx` | Allocates canonical named/default/namespace bindings and collision-safe local aliases. A binding-free request never invents a dependency name. |
| JSX intent and capability | `src/genes/JsxPlan.hx` | Represents markup before choosing TSX, `createElement`, classic lowering, or an unsupported diagnostic. |
| Names and required temporaries | `src/genes/NamePlan.hx`, `TempPlan.hx` | Preserves scopes and evaluation order while creating only necessary generated names. |
| Reusable-library retention | `src/genes/LibraryProfile.hx` | Opts public package APIs into matched TS/classic/declaration surfaces without making every build library-shaped. |
| CommonJS instance/type identity | `src/genes/ExternTypeContract.hx` | Models target type/value identities such as constructor instances without downstream-specific import rules. |
| TypeScript implementation syntax | `src/genes/ts/TsModuleEmitter.hx` | Prints TS/TSX annotations, type imports, interfaces, and TS-specific syntax from shared facts. |
| Classic JavaScript syntax | `src/genes/es/ModuleEmitter.hx`, `ExprEmitter.hx` | Prints modern ESM JavaScript while preserving Haxe JS runtime behavior. |
| Declaration syntax | `src/genes/dts/DefinitionEmitter.hx`, `TypeEmitter.hx` | Prints public declarations from the same API/nullish facts; it does not infer API semantics independently. |
| JS runtime and stdlib support | `src/genes/Register.hx`, `src/genes/js/**`, `src/haxe/**` | Implements real Haxe-on-JS behavior shared by both profiles. Haxe overrides are for runtime incompatibilities, not TS declaration gaps. |
| TypeScript host/global support | `src/genes/StdTypesSupport.hx`, `src/genes/ts/StdTypesEmitter.hx` | Describes runtime-written metadata and narrow TypeScript lib augmentations. |
| File output and mappings | `src/genes/OutputTransaction.hx`, `Writer.hx`, `SourceMapGenerator.hx` | Buffers complete artifacts, publishes an ownership-scoped tree transaction, removes stale owned files, rolls back failures, and preserves source provenance. |

## Shared semantics and profile-specific syntax

The shared layer decides what a Haxe program means:

- visibility, inheritance, overloads, and generic substitution;
- evaluation order, side effects, expression results, and temporary needs;
- runtime class, interface, enum, and reflection identity;
- null, undefined, missing, and optional contracts;
- runtime, type-only, and declaration reachability;
- symbol identity, ordered runtime module requests, collision-free names, JSX
  intent, and source spans.

An output profile decides how those facts are spelled:

| TypeScript implementation | Classic JavaScript | Declarations |
|---|---|---|
| Type annotations, closed interfaces, `import type`, TSX, TS source extensions | Type erasure, runtime imports, executable ESM, classic registration syntax | Exported API only, declaration imports, overloads, null/undefined/optional spelling |

A profile must not silently redefine Haxe runtime semantics. If a helper has a
rich TS surface, it also needs a real Haxe/runtime representation or a stable
capability diagnostic in classic mode.

## Non-negotiable invariants

- Both output modes are first-class. Ordinary Haxe source should compile to TS
  or classic JS without source changes; TS-aware helpers degrade deliberately.
- Haxe's JavaScript target is the runtime semantic baseline. The read-only
  `../genes-vanilla` checkout is a regression and output-quality oracle, not a
  destination for patches and not a byte-for-byte specification.
- Runtime, type-only, and declaration-only edges remain distinct. A type import
  must not introduce a runtime side effect; a declaration-only type must not
  broaden classic DCE.
- Runtime module-request order is an explicit immutable array keyed by
  internal/external identity, path, and optional loader attribute. Printers do
  not infer evaluation order from a path-grouped map. Equal requests coalesce
  at first occurrence, and a real binding can satisfy an earlier bare request.
- Public generated TypeScript is closed and precise. Broad `any`, `unknown`, or
  catch-all index signatures require a named, documented foreign boundary.
- Capability and dependency errors that planning can identify are diagnosed
  before committing output. A failed TS, classic JS, declaration, support-file,
  or source-map emission leaves the prior owned tree byte-identical. Successful
  builds remove stale manifest-owned paths and preserve unrelated files.
- Diagnostics reachable during planning/emission use `CompilerDiagnostic`, not
  an uncatchable macro-host abort, so transaction cleanup is an invariant of
  every compiler failure path.
- Output is deterministic. ESM specifiers, module paths, names, resources,
  source maps, and generated file ownership are deliberate contracts.
- Compiler fixes are generic Haxe/JS/TS fixes. Downstream product paths, DTOs,
  module names, schemas, and policies never become compiler branches.
- A snapshot proves deterministic shape only. Runtime behavior, public typing,
  rejection behavior, and source maps each require their own evidence.

## Where a compiler change belongs

| If the change is about... | Start in... | Usually prove it with... |
|---|---|---|
| A semantic decision needed by TS and JS | A small shared plan under `src/genes/` | Same-source runtime fixture plus focused output checks |
| TS/TSX spelling only | `src/genes/ts/` | TS snapshot, strict `tsc`, and a negative consumer when public typing changes |
| Classic JS syntax only | `src/genes/es/` | Classic runtime assertion and vanilla comparison where useful |
| Public members or declarations | `PublicSurface`, then the relevant printers | Closed-surface negative tests and strict external declaration consumer |
| Null/undefined/optional behavior | `NullishContract` and the native boundary | Strict nullish consumer plus runtime absent-value assertion in both modes |
| Imports, DCE, or package shapes | `DependencyPlan*`, then `Dependencies` | Type-only/DCE or package-shape fixture with runtime import execution |
| JSX behavior | `JsxPlan` and React marker/macro layer | TSX type negatives plus TS and classic runtime profiles |
| Runtime metadata or Haxe stdlib behavior | `Register`, `genes/js`, or narrowly `src/haxe` | Haxe JS semantic assertion in both implementation profiles |
| A broad emitter branch with repeated mutable reasoning | A narrowly scoped plan such as `TempPlan` | Evaluation-order differential and output-quality budget |

Do not start with a full IR, a Reflaxe port, or a target-specific copy of shared
logic. Extract the smallest immutable fact or normalized node that removes a
demonstrated class of duplicated decisions.

## Compiler fixture guide

Choose the smallest fixture that directly owns the claim. Add more than one
layer when a change affects more than one contract.

| Evidence needed | Fixture/source location | Harness |
|---|---|---|
| Classic runtime semantics | `tests/*.hx` and `test.hxml` | `yarn test` |
| Generated TS/TSX shape | `tests/genes-ts/snapshot/<case>/` | `yarn test:genes-ts:snapshots` |
| General TS compile/runtime behavior | `tests/genes-ts/` or `tests/genes-ts/full/` | `yarn test:genes-ts`, `yarn test:genes-ts:full` |
| Minimal-runtime behavior | `tests/genes-ts/snapshot/minimal/` and minimal fixture | `yarn test:genes-ts:minimal` |
| JSX profiles and prop/child typing | React snapshot fixture and TSX consumers | `yarn test:genes-ts:tsx` |
| Exported-surface rejection | `tests/typing-policy/`, `tests/publicsurface/` | `yarn test:types:exports` |
| Classic `.d.ts` consumer behavior | `tests/classic-dts/` | `yarn test:classic:dts` |
| Nullish/map/iterator contract | `tests/nullish/` | Owning genes-ts/full and exported-surface gates |
| Type-only reachability and DCE | `tests/typeonly/` | Owning genes-ts/full and dual-output gates |
| Same-source TS/classic parity | `tests/output-modes/` | `yarn test:dual-output` |
| Reusable package surface | `tests/library-profile/` | `yarn test:library-profile` |
| ESM/CommonJS/package import shape | `tests/genes-ts/package-shapes/` | `yarn test:interop:module-shapes` |
| Source-map contract | Existing source-map fixture | `yarn test:genes-ts:sourcemaps` |
| Determinism, size, modules, or temporaries | Curated compiler fixtures | `yarn test:output-quality` |
| Transactional publication and stale ownership | `tests/output-transaction/` | `yarn test:output-transaction` |
| User-facing end-to-end workflow | An immediate child of `examples/` plus `examples/profiles.json` | `yarn test:examples --playwright` |
| Full product integration | `examples/todoapp/` | `yarn test:todoapp:e2e` |

The todoapp uses one Haxe application source tree for TS and classic JS. Keep it
as an integration witness, not the first reproduction for a compiler defect.
Reduce failures to a generic fixture above, fix the compiler there, and let the
todoapp prove the complete workflow afterward.

### Adding or updating a genes-ts snapshot

Each snapshot case under `tests/genes-ts/snapshot/` contains:

- `src/`: Haxe input;
- one or more `build*.hxml` profiles;
- `out/`: generated, disposable output retained locally for inspection;
- `intended/`: committed normalized golden output.

To add a case:

1. Create the source and build profile under
   `tests/genes-ts/snapshot/<case>/`.
2. Add an explicit case record to `scripts/test-genes-ts-snapshots.ts`. A
   directory alone is not discovered automatically.
3. Give the behavior a typecheck, runtime, negative, or other semantic owner.
   Do not add a snapshot-only language guarantee.
4. Run the harness normally and inspect the `intended` versus `out` diff.
5. If the new output is correct, update deliberately:

   ```bash
   UPDATE_SNAPSHOTS=1 yarn test:genes-ts:snapshots
   ```

6. Review every changed generated file, then rerun the command without
   `UPDATE_SNAPSHOTS` and run the owning semantic gate.

`scripts/snapshots.ts` compares the complete file set and normalized content.
It normalizes line endings and trailing whitespace, but it does not bless
missing files, extra files, typing holes, or runtime drift.

### Adding an example

Every immediate example directory is declared in `examples/profiles.json`.
Declare both TS and classic profiles, including build/typecheck/runtime owners.
A TS-aware helper example must prove graceful classic erasure or an intentional
capability error. `yarn test:examples` rejects an undeclared example directory;
use `yarn test:examples --playwright` when browser behavior is in scope.

## ts2hx architecture

ts2hx is a separate, experimental TypeScript-to-Haxe migration tool under
`tools/ts2hx/`. It does not share the genes implementation emitter and it is
not a lossless inverse compiler.

```text
tsconfig + TypeScript source
  -> project.ts: Program/TypeChecker and deterministic source inventory
  -> semantic/ir.ts + haxe/emit.ts: supported semantic decisions,
     Haxe translation, provenance, and diagnostics
  -> transactional Haxe output + ts2hx-manifest.json
  -> optional Haxe -> classic JS / genes-ts -> TS differential harnesses
```

| Owner | Responsibility |
|---|---|
| `src/project.ts` | Loads tsconfig through the TS Program/TypeChecker API and sorts source files deterministically. |
| `src/typescript-api.ts` | Isolates the TypeScript 6 compiler-API bridge from tool logic. |
| `src/semantic/ir.ts` | Owns stable semantic feature IDs, support grades, and the deliberately small normalized model. |
| `src/haxe/emit.ts` | Translates validated constructs, records source provenance, and stages output. Unsupported input must not disappear. |
| `src/haxe/runtime-modules.ts` | Validates hash-pinned external-relative runtime ownership before emission; staged bytes share the Haxe output transaction, while the named build owner copies them beside final JS. |
| `src/cli.ts` | Owns strict/assisted modes, exit codes, human diagnostics, and deterministic JSON output. |

Strict mode succeeds only for the supported subset and preserves the previous
output tree on failure. Assisted mode may create scaffolding only when every
loss has a stable `TS2HX-*` marker and manifest record. Printers may not turn an
unsupported construct into a silent omission or behavior-changing default.
For a source file with a supported bare import, a project prepass inventories
every runtime import declaration in source order. The generated Haxe contains
one kept `@:genes.compilerInternal` carrier whose typed marker calls survive
full DCE, become ordered Genes module requests, and disappear from both final
profiles and declarations. Maps remain lookup structures; neither ts2hx nor a
Genes printer may reconstruct request order from grouped bindings.

### Contributing a ts2hx fixture

1. Create `tools/ts2hx/fixtures/<name>/src/` and a local `tsconfig.json`.
2. Add an explicit `Fixture` entry in
   `tools/ts2hx/src/test-snapshots.ts`; fixtures are not auto-enrolled. Choose
   strict or assisted mode and the narrowest smoke expectations.
3. Run `yarn --cwd tools/ts2hx test:snapshots`. Inspect the generated Haxe and
   manifest before updating the golden tree.
4. Update approved output with:

   ```bash
   UPDATE_SNAPSHOTS=1 yarn --cwd tools/ts2hx test:snapshots
   ```

5. Add evidence matching the claim:

   - output shape only: snapshot;
   - generated Haxe validity: compile smoke in the snapshot fixture;
   - selected end-to-end execution: `test:roundtrip`;
   - claimed JS semantics in both genes profiles: `test:semantic-diff`;
   - intentionally unsupported behavior, source position, exit status, and
     preserved output: `test:strict-diagnostics` or the unsupported half of the
     semantic differential.

6. For a new semantic claim, add a stable feature ID and support grade in
   `tools/ts2hx/src/semantic/ir.ts`. Exercise it in the supported differential
   or the fail-closed fixture; compilation alone is not semantic evidence.
7. Update [ts2hx usage](ts2hx/USAGE.md) and
   [limitations](ts2hx/LIMITATIONS.md) when the fixture/support inventory
   changes. `yarn --cwd tools/ts2hx test:docs` derives fixture counts, semantic
   IDs, CLI options, and local links from their source owners.
8. Finish with `yarn --cwd tools/ts2hx test`, then the repository-wide
   `yarn test:ci` gate.

The runtime differential executes the original TypeScript, translated
Haxe-to-classic-JS, and translated Haxe-to-genes-TS-to-JS, then compares stable
JSON traces. Add cases there for defaults, undefined, coercion, evaluation
order, control flow, `this`, async behavior, and module side effects. Never
promote a construct from “unsupported” because a snapshot looks plausible.

## Adding a target-polymorphic helper or metadata contract

Before adding a `genes.ts` helper or advanced metadata, write down:

1. its typed Haxe authoring contract and runtime value;
2. the shared semantic fact it represents;
3. its precise TypeScript projection;
4. its classic JavaScript erasure or lowering;
5. its declaration representation;
6. its unsupported-profile diagnostic, if any;
7. paired TS and classic fixtures, including negative typing where relevant;
8. didactic hxdoc explaining Why, What, and How.

Raw `@:ts.type`, `@:genes.type`, `Dynamic`, `untyped`, and casts are boundary
tools, not recurring semantic models. Prefer a reusable typed abstraction and a
small compiler plan when Haxe cannot express a host contract directly.

`Imports.sideEffect(...)` is the reference flow for a helper with no runtime
value. Its macro first proves that the Genes JS generator is active, validates
literal arguments and `static __init__` context, then emits an effectful typed
marker. Full Haxe DCE retains the marker; `DependencyPlanBuilder` consumes it
into an ordered `RuntimeSideEffect` request; both implementation printers erase
the call and render the same binding-free ESM declaration; declaration
reachability never sees it. Nested use and inactive targets fail at the Haxe
source position before a partial output tree can be published.

## Gate escalation

During development, run the smallest owner first. Before a compiler or ts2hx
change is considered usable, run:

```bash
yarn test:ci
```

That command covers security and dependency checks, toolchain/version policy,
compatibility evidence, the TypeScript API bridge, exported-surface policy,
classic runtime, declarations, reusable-library behavior, genes-ts acceptance,
examples/todoapp, snapshots, and all ts2hx harnesses. A green focused test is
diagnostic evidence; it is not a substitute for the full gate.

## Related references

- [WORKFLOWS.md](WORKFLOWS.md) — choose a user-facing compilation or migration path.
- [OUTPUT_MODES.md](OUTPUT_MODES.md) — TS, classic JS, declarations, helpers, and library profiles.
- [COMPILER_CONTRACT.md](typescript-target/COMPILER_CONTRACT.md) — generated TypeScript file/module contract.
- [TYPING_POLICY.md](typescript-target/TYPING_POLICY.md) — public typing and boundary policy.
- [INTEROP.md](typescript-target/INTEROP.md) — Haxe/TypeScript package and source interop.
- [TOOLCHAINS.md](TOOLCHAINS.md) — Haxe, Node, and TypeScript lanes.
- [ts2hx WORKFLOWS.md](ts2hx/WORKFLOWS.md) — strict, assisted, and differential migration loops.
- [ts2hx LIMITATIONS.md](ts2hx/LIMITATIONS.md) — exact supported and unsupported boundary.
