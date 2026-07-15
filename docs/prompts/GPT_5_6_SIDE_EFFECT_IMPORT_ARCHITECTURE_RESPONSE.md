# Reviewed decision: source-ordered ESM side-effect imports

This decision records the reviewed GPT-5.6 Pro response to
`GPT_5_6_SIDE_EFFECT_IMPORT_ARCHITECTURE.md` and the repository validation made
against `ba82e74459c2311a38c88d6dae57fe5cdd28ef9e`. It is an implementation
contract, not evidence that the feature has landed. Every supported category
still requires the focused experiments and full CI gates below.

## Verdict

Adopt a hybrid of the first two candidates:

- keep `DependencyEdgeKind.RuntimeSideEffect` as the semantic category;
- represent a binding-free module request separately from a named/default/
  namespace binding;
- preserve runtime module requests in an explicit ordered projection shared by
  the TypeScript and classic JavaScript emitters;
- lower external package/resource helpers directly to binding-free requests;
- lower a relative ts2hx import of converted source to the generated Haxe
  module identity through a typed, compiler-internal module token plus targeted
  retention metadata on observable initialized declarations.

Reject the fake namespace/default-binding candidate. It assumes an export
shape, creates a value that does not exist in the source contract, and does not
solve converted-module identity.

Do not add `DSideEffect` to `DependencyType`. `DName`, `DDefault`, and
`DAsterisk` describe bindings and participate in alias allocation. A bare
module request has no name and must not enter that allocator as a fabricated
symbol.

## Repository facts validated

- `DependencyPlan.edges` already preserves stable encounter order.
- `DependencyPlan.dependencies(...)` loses an explicit cross-module order when
  it projects those edges into `Dependencies.imports`, a path-keyed `Map`.
- Grouping by path before import attribute can also reorder requests shaped
  like `A(type=x), B, A(type=y)`, irrespective of incidental `Map` iteration
  behavior.
- Both implementation emitters currently print only bound `import ... from`
  declarations. The TS emitter additionally reconstructs runtime/type-only
  classification from grouped maps.
- Runtime-side-effect edges already participate in implementation
  reachability, while declaration reachability remains separate.
- ts2hx records bare imports but intentionally rejects them transactionally.
  A relative source import cannot safely retain its original `.js` spelling
  after that source has been converted to Haxe.

The review was based on `9438783`; the live `ba82e74` delta contains only the
review packet and Bead, so these production-code observations remain current.

## Shared semantic model

The immutable plan distinguishes a request from its optional bindings:

```haxe
class DependencyModuleRequest {
  public final external: Bool;
  public final path: String;
  public final importAttributeType: Null<String>;
  public final pos: Null<SourcePosition>;
}

enum DependencyImportSpec {
  Bound(binding: DependencyImport);
  SideEffect(request: DependencyModuleRequest);
}

class RuntimeModuleRequestPlan {
  public final request: DependencyModuleRequest;
  public final bindings: ReadOnlyArray<Dependency>;
  public final firstProvenance: DependencyProvenance;
}
```

A concrete implementation projection owns:

1. one `Dependencies` instance for collision-safe binding allocation and type
   lookup;
2. an ordered runtime-request array consumed by both implementation emitters;
3. deterministic TS-only binding declarations, which never create runtime
   requests.

Runtime request identity is `(external, path, importAttributeType)`. Projection
walks the immutable edge array exactly once. The first occurrence creates the
request slot. A bound import for the same identity attaches its canonical,
alias-allocated binding to that slot, so one declaration satisfies both a bare
and a bound occurrence. Repeated identical requests coalesce at their first
slot; different import attributes remain distinct requests in encounter order.

`Dependencies` remains the binding allocator and lookup owner. Its map becomes
lookup-only for implementation printing. A `pushAndGet`-style operation returns
the canonical binding so the ordered request can reference the exact allocated
alias. Type-only and runtime bindings share one allocator in TS mode, but only
runtime edges create runtime-request slots.

An internal request retains a compiler-owned `ModuleType`, uses the generated
Haxe module identity, and participates in cycle/reachability traversal. An
external request has no referenced type and preserves its literal runtime
specifier. Side-effect-only edges never enter declaration reachability or
`.d.ts` output.

## Direct Haxe helper contract

The public API is statement-shaped and returns `Void`:

```haxe
class Main {
  static function __init__():Void {
    Imports.sideEffect("./runtime/setup.js");
    Imports.sideEffectWith("./runtime/config.json", "json");
  }
}
```

Both arguments must be non-empty string literals. Calls are accepted only as
direct statements in the outer block of `static function __init__()`. Reject
field initializers, conditions, loops, nested functions, ordinary methods, and
return/argument expressions: ESM requests are statically hoisted and those
contexts would promise conditional or call-time behavior that cannot be
preserved.

The macro expands to an effectful typed call on a hidden extern marker. The
builder recognizes the exact marker owner/member, records a
`RuntimeSideEffect` edge at the typed encounter position, and consumes that
subtree so ordinary reference collection does not invent a binding for the
marker. Shared expression lowering erases the call after the semantic edge has
been captured; printers never parse helper strings.

The helper is supported only while the Genes custom JS generator is active.
Standard Haxe with `genes.disable`, a non-JS target, or a classpath-only import
must receive a stable compile-time capability diagnostic. It must not silently
erase required initialization or substitute CommonJS `require()` semantics.

Duplicate helpers for the same request identity emit one ESM request. This API
guarantees the encounter order of direct helper statements. It does not claim a
new source-order relationship with arbitrary value dependencies discovered in
unrelated Haxe expressions; ts2hx needs the unified carrier below when it must
preserve a complete original TypeScript import sequence.

## Printer and graph ownership

- `DependencyPlanBuilder` owns marker recognition and semantic edges.
- `DependencyPlan` owns request identity, ordered projection, and coalescing.
- `Dependencies` owns bindings, aliases, de-duplication, and type access.
- The classic and TS emitters iterate the same runtime-request array. Empty
  bindings print `import "specifier"`; non-empty bindings reuse the current
  binding syntax and print no redundant bare declaration.
- The TS emitter prints remaining type-only declarations afterward from the
  shared allocator. Because those declarations erase, their relative placement
  cannot change module evaluation.
- The declaration emitter consumes only declaration bindings and never emits a
  side-effect request or compiler-internal marker.
- Cycle traversal uses de-duplicated internal runtime requests rather than map
  keys so binding-free internal edges participate.
- Internal extension rewriting remains profile-owned; external literals are
  never rewritten. Import attributes are part of request identity and source
  maps point at the helper/import occurrence.

## ts2hx boundary

ts2hx must build a project-level ordered runtime-import inventory before
per-file emission. It includes every runtime import declaration, not only bare
ones, because later Haxe value-use order is not the original TypeScript import
declaration order.

The first sound support boundary is:

| Input | Disposition |
| --- | --- |
| Bare package specifier | J1 support through an external request |
| Relative source in the conversion set | J1 support only after the DCE marker experiment, initially acyclic |
| Relative runtime/resource file | J1 only with an explicit generic staging/runtime-module manifest |
| Unresolved relative | Strict source-positioned failure |
| Resolved source outside the conversion set or declaration-only | Strict source-positioned failure |
| Unsupported attribute, or any attribute on converted source | Strict source-positioned failure |
| Converted side-effect cycle | Strict failure until a three-runtime cycle differential proves parity |
| File mixing a side-effect import with a runtime re-export | Strict failure until re-exports join the ordered request plan |

For converted modules, a kept compiler-internal request carrier records the
original import sequence. A real imported runtime binding may anchor an ordered
request. A deterministic target token is generated only for converted targets
that otherwise have no value anchor. The token makes that module reachable;
observable initialized declarations in such a target receive targeted
`@:keep`, because the local Haxe 4.3.7 experiment proved that a pure
`{ initialized; true; }` token read is optimized away before Genes runs. The
token is consumed by the dependency builder and must be absent from TS, JS,
`.d.ts`, public-surface capture, and source maps.

The original relative `.js` spelling is never emitted for converted source.
External relative resources require a manifest that owns runtime spelling and
staging; they are not inferred from failed source resolution. Assisted output
may record a loss but makes no executable-equivalence claim.

## Required experiments before each producer lands

1. Compile a direct helper under `-dce full` in both Genes profiles and prove
   its typed marker reaches dependency planning in stable `cl.init` order.
2. Compile the reduced `state/first/second/main` project and prove a minimal
   typed target token plus targeted initializer retention survives DCE and
   leaks no compiler-internal field into implementation or declarations.
3. Make the ts2hx semantic differential install the classic Genes generator
   explicitly and use `-dce full` before treating it as three-profile evidence.
4. Keep converted cycles fail-closed until observable values, TDZ/errors, and
   once-only execution match original TS, classic Genes, and genes-ts.
5. Keep runtime re-export interleaving fail-closed until those declarations use
   the same ordered module-request plan.
6. Run import-attribute syntax through all pinned TypeScript lanes and both
   runtime profiles rather than extrapolating from bound-import coverage.

The first two experiments now have executable evidence under
`tests/side-effect-import`: marker encounter order is `First -> Second`, a
completely unreferenced target remains outside the typed graph, targeted
initializer `@:keep` is required, and the existing map projection demonstrably
reverses runtime order to `second,first`. Producing `first,second` is therefore
an acceptance condition of the ordered projection task, not an assumed Haxe
fact.

## Test and landing sequence

Land independently reversible changes in this order:

1. evidence-only DCE/marker fixture;
2. immutable request records and shadow-compared ordered projection;
3. both implementation printers, byte-stable for existing bound-only input;
4. direct Haxe helper, diagnostics, runtime/source-map tests;
5. ts2hx package and manifest-backed external requests;
6. converted-relative retention plus conservative cycle/re-export diagnostics;
7. semantic matrix/docs/compatibility evidence and full `yarn test:ci`.

The focused tests must include `A, B, A`,
`A(type=x), B, A(type=y)`, bare-plus-bound coalescing, duplicate once-only
execution, direct-helper target/context failures, the three-runtime
`first,second` trace, transactional unresolved/unconverted/resource failures,
marker leakage checks, deterministic clean-tree hashes, and exact source-map
tokens. No support row or roadmap count changes until the relevant runtime
differentials and full repository gate are green.
