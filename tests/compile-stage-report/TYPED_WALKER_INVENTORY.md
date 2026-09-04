# Typed-program boundary inventory

This inventory records the Haxe compiler objects that Genes reads during one
build. It supports architecture decisions. It does not authorize a worker,
snapshot format, cache, or merged traversal.

The inventory was reviewed against `src/genes` on 2026-09-04. These commands
find the primary recursive sites:

```bash
rg -n 'TypedExprTools\.(iter|map)|ExprTools\.(iter|map)|\.iter\(' src/genes --glob '*.hx'
rg -n 'JSGenApi|\bapi\.(types|main|outputFile|generateStatement|generateValue|hasFeature|addFeature|setTypeAccessor)' src/genes --glob '*.hx'
rg -o 'Context\.[A-Za-z_][A-Za-z0-9_]*' src/genes --glob '*.hx'
```

## Recursive typed-expression work

“Root” means the expression that starts one traversal. “Scope” explains when
the traversal runs. Several builders are lazy, but one module can force all of
them during planning or emission.

| Owner | Root and result | Scope |
| --- | --- | --- |
| `genes.ts.SignatureCache.captureExpression` | Pre-DCE class field bodies; records local source types. | One installed `onAfterTyping` callback. |
| `genes.Genes.collectDirectFunctions` | A typed dynamic-import callback; finds direct module functions. | One pass for each dynamic-import macro call. |
| `genes.DependencyPlanBuilder.addJsRequireFromExpr` | Module field bodies; finds runtime `@:jsRequire` uses. | One pass for each ordinary expression root. |
| `genes.DependencyPlanBuilder.containsMarker` | Module field bodies; detects side-effect import markers. | One early-exit pass before marker handling. |
| `genes.RuntimeTypeOccurrenceCollector.collect` | Module field bodies; preserves ordered runtime type occurrences. | One recursive collection for each ordinary expression root. |
| `genes.DependencyPlanBuilder.visitExpressionTypes` | Module field bodies; collects local and marker-owned type edges. | One pass in each requested dependency profile. |
| `genes.JsonTypeSupport.visitExpr` | Planned module members; detects JSON type use in expression-owned types. | One early-exit pass per module query. |
| `genes.ModuleFunctionPlan` local `visit` | Candidate field bodies; rejects captured locals and invalid direct bindings. | One pass for each module-function candidate. |
| `genes.LocalBindingPlanBuilder.visit` | Module member roots; records reassigned locals. | One full module pass when the plan is forced. |
| `genes.NativeAsyncPlanBuilder.visit` | Module member roots; records native async carriers and return payloads. | One full module pass when the plan is forced. |
| `genes.TempPlanBuilder.visit` | Module member roots; chooses lowering temporaries and module-context values. | One full module pass when the plan is forced. |
| `genes.NamePlanBuilder.visit` | Module member roots; allocates stable local names by lexical scope. | One full module pass per output name profile. |
| `genes.NamePlanBuilder.reserveDirectBindings` | Each function body; reserves imported and direct binding names. | One nested pass for each planned function. |
| `genes.NamePlanBuilder.countLocalUses` | Selected blocks and JSX candidates; counts exact local reads. | Repeated bounded subtree passes. |
| `genes.TemplateLiteralPlan.visitModuleExpressions` | Module member roots; validates template literal markers. | One full module pass when the plan is forced. |
| `genes.LexicalBindingUsePlanBuilder.visit` | Module member roots; records runtime binding authorities by scope. | One full module pass when the plan is forced. |
| `genes.react.ReactStateInitializationPlan.visit` | Module member roots; records state initializer type references. | One full module pass when React state bindings exist. |
| `genes.react.ReactStateProjectionPlan.visit` | Module member roots; records state reads, writes, and callback captures. | One full module pass when the plan is forced. |
| `genes.JsxPlan.visitImplementationExpressions` | Emittable implementation roots; records exact output occurrences. | One full implementation-only pass. |
| `genes.JsxPlan.visitModuleExpressions` | All semantic module roots; records locals, intents, carrier ownership, and inline-local uses. | Four separate full module passes in one JSX plan build. |
| `genes.JsxPlan.planSourceInlineLocals.visitScopes` | Implementation roots; records function and block ownership. | One additional full implementation pass. |
| `genes.ts.TsBoundaryPlanBuilder.visit` | Module member roots; plans TypeScript value and enum boundaries. | One evaluation-order-aware full module pass. |
| `genes.ts.TsIndexedAccessPlanBuilder.visit` | Module member roots; plans indexed reads, writes, and updates. | One evaluation-order-aware full module pass. |
| `genes.ts.TsIndexedAccessPlanBuilder.containsLocalRead` | One field body; proves whether a candidate local is observed. | A bounded extra pass for unresolved direct indexed initializers. |
| `genes.ts.TsNarrowingPlanBuilder.analyze` | Module function scopes; computes flow-sensitive narrowing state. | One control-flow-aware full module analysis. |
| `genes.ts.TsNarrowingPlanBuilder.collectEffects` | Loop, try, and condition subtrees; summarizes mutations. | Repeated bounded subtree passes during narrowing. |
| `genes.ts.TsNarrowingPlanBuilder.inventorySourceExpression` | Module member roots; records source ownership independently. | Test-only pass under `genes.ts.narrowing_inventory`. |
| `genes.ts.TsModuleEmitter.hasReturnExpr` | One switch-expression subtree; finds outer-function returns. | Repeated printer-local early-exit pass. |
| `genes.util.TypeUtil.typesInExpr` | Classic emitter expression roots; collects runtime module types. | One recursive pass at classic expression emission sites. |

The benchmark adds `genes.GenerationFloorProbe.scanExpression`. It is not a
production traversal. It visits each declaration body once and counts every
encountered expression and type component.

Three recursive sites operate on source `Expr`, not `TypedExpr`:
`genes.js.Async`, `genes.react.JSX`, and `genes.react.InlineMarkup`. The
`FlightValueValidation` recursion visits `Type` only. They do not belong in the
typed-expression count, but a future snapshot design must still account for
their earlier macro work.

## Compiler-owned API dependencies

The custom generator receives `haxe.macro.JSGenApi`. Genes currently uses this
surface:

| API evidence | Current use |
| --- | --- |
| `outputFile` | Select the output transaction root and owner. |
| `types` | Build the module inventory and benchmark the typed boundary. |
| `main` | Add the compilation-root expression. |
| `generateStatement` and `generateValue` | Delegate supported native Haxe expression rendering. |
| `hasFeature` and `addFeature` | Preserve Haxe runtime feature decisions. |
| `setTypeAccessor` | Route compiler-generated type accesses through Genes names. |

Genes does not currently call `isKeyword`, `quoteString`, `buildMetaData`, or
`setCurrentClass` from `JSGenApi`.

The wider macro surface also binds work to the Haxe process:

- Lifecycle APIs install callbacks and the custom generator. They include
  `onAfterTyping`, `onGenerate`, `onAfterGenerate`, and
  `setCustomJSGenerator`.
- Typed objects expose lazy compiler callbacks. These include `Ref.get()`,
  `ClassField.expr()`, `MetaAccess`, and lazy `Type` resolution.
- Type authority comes from `follow`, `followWithAbstracts`, `unify`,
  `getType`, `getModule`, `resolveType`, `typeExpr`, and `typeof`.
- Output isolation uses `Compiler.getOutput()` and `Compiler.setOutput()`.
- Diagnostics and source maps use compiler positions, warnings, and errors.
- Defines select output profiles and private evidence paths.

A worker cannot retain these objects after the request. A later prototype must
capture immutable values while the callback is active. It must also preserve
every API result that affects output, diagnostics, or transaction ownership.

This static inventory shows possible traversal multiplicity. It does not
measure calls. The compiler-stage report supplies request-local node counts,
wall time, process CPU, and peak RSS where the host exposes them.
