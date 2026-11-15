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
| Declarations of one Haxe module, read during generation without a lookup by name | `TypedModuleInventory.hx` |
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
3. Add the smallest fixture that fails under the old or tempting-wrong
   implementation. Record the exact pre-fix command, concise red result, and
   independent semantic oracle in the Bead or PR.
4. Inspect generated TS and classic JS when the semantic fact is shared.
5. Add runtime, strict TypeScript consumer, declaration consumer, diagnostic,
   source-map, determinism, or rollback evidence according to the claim.
6. Update the nearby Why/What/How hxdoc and the relevant user or architecture
   guide in the same change.
7. Run the focused gate while iterating, then `yarn test:ci` before declaring
   the compiler usable downstream.

For a new capability, prove one vertical tracer bullet before multiplying
fixtures: authored Haxe through Genes, target checking/building, any claimed
package/framework boundary, and a real runtime or system observer. When that
vertical path reveals a compiler defect, keep it and add a focused deterministic
regression—the two tests protect different claims. Do not infer an affected
product surface merely because a broad selected gate also covers it.

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
- Code that can run during generation must not look up a module or type by
  name. `Context.getModule` and `Context.getType` make Haxe record a
  dependency from an unrelated module, and the compilation server keeps it.
  The next one-file edit then makes Haxe type many modules again. Use
  `TypedModuleInventory.moduleTypes` or `TypedModuleInventory.typeByPath`,
  or a typed value that you already hold. A macro that runs while Haxe types
  a module may still look up by name: that dependency is a real one. The
  retyped-module case of `yarn test:compiler-server` protects this rule.
- A map with typed expressions as keys must be a `genes.TypedExprMap`, not
  a `haxe.ds.ObjectMap`, when it can get more than about 500 keys. Example:
  one entry for each expression of a module. The Haxe 4.3.7 macro interpreter
  gives every `ObjectMap` key the same hash, so each `set`, `get`, or `exists`
  compares the key with every stored key; 20,000 keys need about 200 million
  comparisons. Below about 500 keys an `ObjectMap` is correct and faster,
  because `TypedExprMap` reads one source position (about one microsecond) for
  each operation.
- `ref.get()` on a declaration reference is not a field read. Haxe copies the
  complete declaration into a new macro value, which takes about 10
  microseconds. In code that runs for every typed expression, read
  `ref.toString()` first when that text can answer the question, as
  `JsonTypeQuery.search` does. The text is the dotted path of the
  declaration, and it does not always contain the package of its module: a
  class or enum with `@:native` has its native path, a type parameter of a
  method is `method.T`, and the typedef for a class used as a value is
  `Class<path>`. Use the text only to skip `ref.get()` when it proves the
  answer; read the declaration for the exact fact. Two cases are exact: the
  text of a class, enum, typedef, or abstract reference is always its `pack`
  and `name` joined with dots, so it can replace a comparison of these two
  fields (`NullishContract.classify`, `JsxPlan.markerKind`); and the text of
  a field reference is the field name. The text cannot replace a comparison
  of `module`. `tests.referencetext.ReferenceTextProbe` (in `yarn test`)
  pins both cases. A cache key built from `module` and `name` is not exact
  either: Haxe renames a `@:native("Lib")` class to `Lib` before generation,
  so two classes of one module can then share both.
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
