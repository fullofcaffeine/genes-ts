# Compiler source guide

This file applies to `src/genes/**`. Read the repository
[`AGENTS.md`](../../AGENTS.md) first for workflow, issue tracking, documentation,
typing, and landing requirements.

## What this source tree does

Haxe remains the parser, type checker, dead-code eliminator, and owner of the
typed abstract syntax tree (`TypedExpr`, `Type`, and `ModuleType`). Genes reads
that typed tree and preserves only the additional semantic facts that an
emitter would otherwise lose or rediscover inconsistently:

```text
typed Haxe program
  -> shared module, public-surface, dependency, name, temporary, nullish,
     JSX, and runtime facts
  -> TypeScript/TSX syntax
  -> classic ESM JavaScript syntax
  -> optional classic declaration syntax
  -> one transactional output tree
```

Do not introduce a cloned universal target AST, Reflaxe pass architecture, or
printer-local reconstruction merely to regularize a local change. A new plan is
justified when a semantic decision must survive typing/DCE, cross recursive
emission, or serve more than one consumer—or when mutable printer inference has
demonstrated a correctness bug.

Read [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) before changing these
boundaries.

## Find the owner

| Concern | Authoritative source |
| --- | --- |
| Generator installation, module graph, output-profile selection | `Generator.hx`, `Module.hx` |
| Complete-tree staging, stale cleanup, rollback | `OutputTransaction.hx`, `Writer.hx`, `SourceMapGenerator.hx` |
| Runtime/type/declaration/side-effect dependencies | `DependencyPlan.hx`, `DependencyPlanBuilder.hx`, `Dependencies.hx`, `BindingIdentity.hx` |
| Pre-DCE reusable/public contract | `PublicSurface.hx`, `LibraryProfile.hx`, `TypeReferenceCollector.hx` |
| Static callable generic scope shared by implementation and declarations | `CallableSignaturePlan.hx`, `Module.fieldsOf` |
| Deterministic emitted names, local mutability, and required temporaries | `NamePlan.hx`, `LocalBindingPlan.hx`, `TempPlan.hx`, `EmittedMemberName.hx` |
| Haxe `null`, JavaScript `undefined`, missing values | `NullishContract.hx` |
| JSX meaning and Haxe-side validation | `JsxTypeChecker.hx`, `JsxPlan.hx`, `react/` |
| TypeScript implementation syntax and flow narrowing | `ts/TsModuleEmitter.hx`, `ts/TsNarrowingPlan.hx`, `ts/SignatureCache.hx` |
| Classic ESM implementation syntax | `es/ModuleEmitter.hx`, `es/ExprEmitter.hx` |
| Classic `.d.ts` syntax | `dts/DefinitionEmitter.hx`, `dts/TypeEmitter.hx` |
| Shared Haxe-JS runtime behavior | `Register.hx`, `js/`, `../haxe/` |
| Compiler-owned typed carrier calls | `CompilerInternal.hx`, `internal/` |

The Haxe typed declaration or expression is normally the identity. Source
positions are provenance for diagnostics and maps, not a substitute for
declaration, field, local, export-binding, or module-request identity.

## Make a compiler change

1. Reduce the behavior to an ordinary Haxe/JS/TS construct. Downstream
   application names and schemas do not belong in the compiler.
2. Identify the semantic owner before the printer. If two surfaces need the
   same decision, normalize it once and let each emitter own only syntax.
3. Add the smallest fixture that would fail under the old or tempting-wrong
   implementation.
4. Inspect generated TS and classic JS when the semantic fact is shared.
5. Add runtime, strict TypeScript consumer, declaration consumer, diagnostic,
   source-map, determinism, or rollback evidence according to the claim.
6. Update the nearby Why/What/How hxdoc and the relevant user or architecture
   guide in the same change.
7. Run the focused gate while iterating, then `yarn test:ci` before declaring
   the compiler usable downstream.

[`docs/TESTING_STRATEGY.md`](../../docs/TESTING_STRATEGY.md) explains which
harness owns each type of claim. [`docs/ARCHITECTURE.md#compiler-fixture-guide`](../../docs/ARCHITECTURE.md#compiler-fixture-guide)
maps fixture locations to compiler surfaces.

## Preserve these boundaries

- `-D genes.ts` and classic output are both first-class.
- Classic runtime behavior follows Haxe's JavaScript semantics.
- Declaration reachability must not broaden classic runtime dead-code
  elimination.
- TypeScript-specific helpers must erase or lower safely in classic output.
- Generated user TypeScript stays strongly typed; weak types belong only at
  narrow, documented runtime or interop boundaries.
- Printers do not decide dependency identity, public reachability, JSX meaning,
  nullish semantics, flow proof, or output ownership.
- Validation that can fail should run before public output is committed.
- Compilation-server correctness requires request-local typed facts or an
  explicit reset/rebuild rule; never persist typed compiler objects casually.
- `extraParams.hxml` enables recursive Haxe Loose null safety for the owned
  `genes.*` implementation before `Generator.use()` can load compiler types.
  Keep any `@:nullSafety(Off)` statement local, documented at the mismatch, and
  registered in `config/null-safety-escapes.json`; verify with
  `yarn test:null-safety`. This source-quality gate does not replace
  `NullishContract`, `TsBoundaryPlan`, or target runtime evidence.
- A host-selected output destination is generic compiler configuration. Keep
  it request-local through `-D genes.output=<path>` and let
  `OutputTransaction` own the selected tree; never add framework names,
  routes, environments, or application policy to output selection. Capture
  both the path and `genes.ts` profile before typing, reject later macro
  mutation, and validate the exact case-sensitive suffix that emitters use.

If the correct semantic boundary remains ambiguous after a reduced fixture,
stop and prepare the focused architecture review required by the root guide
rather than hiding the uncertainty in a cast, raw target string, name scan, or
downstream special case.
