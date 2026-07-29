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

1. `extraParams.hxml` first applies recursive Haxe Loose null safety to the
   compiler-owned `genes.*` package, then installs `genes.Generator.use()` as
   the JS generator and redirects Haxe's compiler-owned output slot to a
   private sentinel. The order matters because Haxe package metadata has no
   effect after a type is loaded. This checks the compiler implementation; it
   does not opt user packages into null safety or replace target
   `null`/`undefined` lowering. The
   user-visible `-js` path belongs exclusively to the Genes transaction, so
   Haxe cannot delete a previously good entry file after a generator error.
2. Before Haxe DCE can erase source-level information, `PublicSurface`,
   `ModuleDirectivePlan`, and `genes.ts.SignatureCache` capture the facts needed
   by TS interfaces, module prologues, and declarations. For closed enum
   abstracts, the signature cache retains only affected source type subtrees
   and freezes their literal sets before dead-code elimination (DCE) removes
   unused declarations; the ordinary type printer remains the single recursive
   renderer. Directive capture adds no roots or dependency edges.
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
   manifest-owned paths, and rolls the whole mutation set back on failure. Its
   v2 owner is the exact configured output basename including the extension;
   a readable SHA-256-scoped filename keeps distinct entrypoints isolated.
   Before reading or mutating an existing destination or private stage path,
   the transaction compares its lexical absolute path with the symlink-resolving
   `FileSystem.fullPath`. A mismatch fails closed, and abort cleanup
   deliberately leaves the unowned link untouched instead of following it.
   This is a preflight safety boundary, not an operating-system no-follow lock;
   the existing requirement to serialize writers to one destination remains.

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
| Top-level output projection | `Module.memberProjection`, `src/genes/CompilerInternal.hx` | Separates local implementation presence, ESM export, consumer declarations, Haxe runtime registration, and source provenance. Printers consume these facts instead of treating one visibility flag as every policy. |
| Public API facts | `src/genes/PublicSurface.hx` | Captures visibility, inheritance, generics, overload identity, and complete closed interface members before DCE. |
| Callable generic scope | `src/genes/CallableSignaturePlan.hx`, `Module.fieldsOf` | Declares every type parameter named by a static callable's final Haxe signature, including parameters retained through inference, while preserving ordinary method parameters, constraints, and collision-safe identity across implementation and declaration output. |
| Module directive prologues | `src/genes/ModuleDirectivePlan.hx` | Captures literal module intent before DCE, validates single-owner source order, and exposes one immutable plan without changing reachability. |
| Null, undefined, and optionality | `src/genes/NullishContract.hx` | Keeps Haxe `Null<T>`, native `undefined`, optional fields, absent parameters, and unknown boundaries distinct. |
| Dependency graphs and module-request order | `src/genes/DependencyPlan.hx`, `DependencyPlanBuilder.hx` | Records runtime-value, runtime-side-effect, type-only, and declaration-only edges with provenance; projects runtime requests by external/path/attribute identity into one ordered plan. |
| Import bindings, aliases, and host globals | `src/genes/BindingIdentity.hx`, `TypeAccessor.hx`, `Dependencies.hx` | Keeps the requested module, selected export, requested local, and typed Haxe origin as separate facts; then allocates collision-safe locals. Exact compiler-owned JavaScript globals retain semantic identity and TypeScript renders them through `globalThis`. A binding-free request never invents a dependency name. `@:native` alone may identify a direct host value, while a declaration that also has `@:jsRequire` always resolves through its package binding and any normalized member path. |
| Dynamic-import runtime requests | `src/genes/Genes.hx`, `src/genes/internal/DynamicImportMarker.hx`, `ExprEmitter.hx` | Carries an extension-free typed request from the macro to the shared emitter, which applies the current build's runtime suffix. Cached typing never owns `.ts`/`.tsx`/`.mjs` policy. |
| Explicit generic-call witnesses | `src/genes/ExplicitTypeArguments.hx`, `src/genes/ts/ExplicitTypeArgumentCallSite.hx` | Keeps a pre-erasure type fact on the exact typed call occurrence. The carrier uses inert typed-null placeholders, both emitters erase it, and cached compiler-server trees never depend on a macro static registry or source position as identity. |
| JSX intent, carrier ownership, provenance, and capability | `src/genes/JsxPlan.hx` | Represents markup before choosing TSX, `createElement`, classic lowering, or an unsupported diagnostic. A local linked-record carrier may preserve one-time evaluation, but no other read, write, or escape may change the compiler-owned structure after it is recognized. HXX marks direct nested elements/fragments with a distinct typed call; exact declaration/use facts may remove only that parser-owned scaffolding in source-preserving `.tsx`/`.jsx`, while positions remain mapping facts rather than ownership. |
| Names, local mutability, and required temporaries | `src/genes/NamePlan.hx`, `LocalBindingPlan.hx`, `TempPlan.hx` | Preserves scopes and evaluation order while creating only necessary generated names and selecting `const` only for initialized bindings with no typed writes. |
| Reusable-library retention | `src/genes/LibraryProfile.hx` | Opts public package APIs into matched TS/classic/declaration surfaces without making every build library-shaped. |
| Imported constructor instance/type identity | `src/genes/ExternTypeContract.hx` | Models value-derived constructor instances without downstream-specific import rules. Explicit metadata also keeps package-backed native `String`/`RegExp` values from being mistaken for host built-ins in public types. |
| Type-reference projection and retention | `src/genes/TypeReferenceCollector.hx`, `src/genes/dts/TypeEmitter.hx`, `TypeUtil.enumConstructorApplication` | Keeps named Haxe declarations keyed by compiler-owned module/type identity, never by an unqualified spelling. The collector mirrors every type the printers may name, including destination-applied enum payloads, so an emitter cannot invent an unplanned import or weaken a missing declaration to `any`. |
| TypeScript null-narrowing proof | `src/genes/ts/TsNarrowingPlan.hx` | Derives function-local null and map-presence facts from `TypedExpr`, then ends them after exact receiver/key assignment, `Map.remove`/`clear`, loop mutation, or a nested function boundary. It carries typed identities and no output text; the [ownership inventory](TS_NARROWING_OWNERSHIP.md) records the bounded design and evidence. |
| TypeScript value-boundary projection | `src/genes/ts/TsBoundaryPlan.hx` | Records the exceptional returns, initializers, assignments, call arguments, constructor arguments, enum-constructor arguments, native-host callbacks, and typed bindings after opaque Haxe runtime guards that strict TypeScript needs stated explicitly. It also exposes every assertion target to dependency planning before import aliases are allocated. |
| TypeScript implementation syntax | `src/genes/ts/TsModuleEmitter.hx` | Prints TS/TSX annotations, type imports, interfaces, and TS-specific syntax from shared facts. |
| Classic JavaScript syntax | `src/genes/es/ModuleEmitter.hx`, `ExprEmitter.hx` | Prints modern ESM JavaScript while preserving Haxe JS runtime behavior. |
| Declaration syntax | `src/genes/dts/DefinitionEmitter.hx`, `TypeEmitter.hx` | Prints public declarations from the same API/nullish facts; it does not infer API semantics independently. |
| JS runtime and stdlib support | `src/genes/Register.hx`, `src/genes/js/**`, `src/haxe/**` | Implements real Haxe-on-JS behavior shared by both profiles. Haxe overrides are for runtime incompatibilities, not TS declaration gaps. |
| Callback-modeled finally completion | `src/genes/js/TryFinally.hx`, `FinallyCompletion.hx` | Keeps the existing local-completion IIFE separate from the request-free typed runner that carries an opaque outer completion and applies finalizer precedence. |
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

Named type identity is never inferred from a simple name. Two unrelated Haxe
declarations may both be called `Result`, `Status`, or any other spelling. The
dependency plan retains their exact `ModuleType` owners and the type printer
uses the resulting collision-safe accessor. Compatibility with one library
must therefore be expressed as a generic Haxe/TypeScript semantic rule, not a
name allowlist or a fallback to `any`.

### Host-global identity

Some Haxe externs represent constructors that JavaScript already provides on
its global object. `js.lib.Promise` and `js.lib.Error` are two examples. A Haxe
module may also declare unrelated user classes with the same short names:

```haxe
class Promise {
  public static function marker():String {
    return "local";
  }
}

function load():js.lib.Promise<String> {
  return js.lib.Promise.resolve("ready");
}
```

If Genes printed only the word `Promise`, TypeScript would resolve both uses to
the local class. The local class is not generic and does not own the built-in
`resolve` method:

```ts
export class Promise {
  static marker(): string {
    return "local";
  }
}

// Wrong: both names now mean the local class.
function load(): Promise<string> {
  return Promise.resolve("ready");
}
```

`TypeAccessor` keeps exact compiler declaration identity until the output
profile chooses a spelling. TypeScript implementations and declarations use
`globalThis` for the reviewed host identities, while ordinary local references
remain local:

```ts
function load(): globalThis.Promise<string> {
  return globalThis.Promise.resolve("ready");
}
```

The same accessor feeds annotations, class values, `new`, static access,
`instanceof`, `extends`, and cyclic superclass thunks, so those positions
cannot disagree. Dependency collection consumes the same identity and collects
only generic argument types; it never allocates an import for a host
constructor.

Haxe's JavaScript standard library also uses private `@:native("Error")`
externs when implementing `haxe.Exception` and V8 stack support. Haxe rewrites
their short name to `Error` but retains their defining module. Genes recognizes
those compiler-owned aliases by exact module identity. It does not classify
every user-authored `@:native("Error")` extern as the built-in constructor.
Classic JavaScript keeps its established unqualified runtime spelling;
TypeScript-readable source and declarations use the collision-proof spelling.

### Native host callback properties

Haxe's generated WebIDL externs sometimes know only that a browser property is
callable. Haxe 4.3.7 therefore declares properties such as
`js.html.FileReader.onerror` as `haxe.Constraints.Function`, an opaque type that
accepts any function signature:

```haxe
function install(reader:js.html.FileReader):Void {
  reader.onerror = function(error:js.lib.Error):Void {
    trace(error.message);
  };
}
```

TypeScript's DOM library describes that same property more narrowly as a
callback receiving `ProgressEvent<FileReader>`. Printing the Haxe function
directly makes strict TypeScript reject a program Haxe has already accepted:

```ts
reader.onerror = function (error: globalThis.Error) {
  console.log(error.message);
};
```

This is not permission to treat arbitrary function variance as safe.
`TsBoundaryPlan` records a separate host-callback decision only when the typed
Haxe assignment proves all of the following:

- the field belongs to an exact native `js.*` extern with no module import;
- the Haxe field type is exactly the opaque `haxe.Constraints.Function`;
- the assigned value is a function literal;
- the receiver is a non-null, non-unknown stable local rather than an
  expression that could have side effects or emit a value wrapper;
- the field has no authored `@:ts.type` or `@:genes.type` projection.

TypeScript emission then asks the destination property for its own authoritative
host signature:

```ts
reader.onerror = Register.unsafeCast<typeof reader.onerror>(
  function (error: globalThis.Error) {
    console.log(error.message);
  }
);
```

`Register.unsafeCast` returns the same callback reference. It does not wrap,
bind, validate, or convert the function. `typeof reader.onerror` is a
TypeScript type query, so the second textual appearance of `reader` is not a
runtime evaluation or property read.

A concrete native callback type is emitted directly. So is a normal Haxe class
property that happens to be named `onerror` or typed as
`haxe.Constraints.Function`. A nullable local can emit as `(target!)`, and a
receiver such as `makeReader()` can emit a call; neither is a legal entity name
for this type query. Authored field type overrides keep their existing,
more-specific emission branch. Classic JavaScript never consumes this
TypeScript-only plan.

### Opaque runtime guards and typed catch bindings

Haxe lowers several typed `catch` arms to one broad unwrapped value followed by
a runtime helper call. An enum catch is a representative example:

```haxe
try {
  throw GuardedFailure.Rejected("no");
} catch (failure:GuardedFailure) {
  use(failure);
}
```

The emitted runtime check is authoritative, but TypeScript cannot infer a type
from a helper whose declaration returns only `boolean`:

```ts
const raw: {} | null | undefined = Exception.caught(caught).unwrap();

if (Boot.__instanceof(raw, GuardedFailure)) {
  const failure: GuardedFailure = raw; // strict TypeScript rejects this
}
```

`TsBoundaryPlan` records a guarded binding only when the typed Haxe tree proves
the complete lowered relationship: `raw` came from the exact
`haxe.Exception.caught(...).unwrap()` sequence; the condition calls the exact
compiler-owned `js.Boot.__instanceof` field; its target is an exact class or
enum type expression; and the true branch initializes a local of that same type
from the same `TVar` identity as its first expression. Haxe places that binding
first when lowering the typed catch. Genes does not search later statements:
doing so would require proving that calls and captured closures cannot replace
the raw value after the guard.

TypeScript emission consumes that immutable decision:

```ts
if (Boot.__instanceof(raw, GuardedFailure)) {
  const failure: GuardedFailure =
    Register.unsafeCast<GuardedFailure>(raw);
}
```

`Register.unsafeCast` is a runtime identity operation; the existing Haxe guard
still decides whether the branch runs. A class catch emitted with native
JavaScript `instanceof` remains direct because TypeScript already narrows it.
Arbitrary dynamic locals, user Boolean helpers, a different bound variable or
type, a nested initializer, or any statement before the binding receive no
assertion. Every planned target is collected before import binding allocation,
and classic JavaScript does not consume this TypeScript-only decision.

### Static callable generic scope

A generic parameter is the placeholder inside angle brackets, such as `T` in
`Box<T>`. On an instance method, the class's `T` is available through the
instance. A static method belongs to the class value itself, before any
`Box<String>` or `Box<Int>` instance has been chosen, so TypeScript does not
allow that method to use the class parameter implicitly.

Haxe inference can expose a less obvious version of the same representation
gap. In this example, `wrap` declares no generic parameter in source:

```haxe
class Factory<T> {
  final payload:Payload<T>;

  function new(payload:Payload<T>) {
    this.payload = payload;
  }

  public static function wrap(payload) {
    return new Factory(payload);
  }
}

class Api {
  public static function create<T>(value:T):Factory<T> {
    return Factory.wrap(new Payload(value));
  }
}
```

While checking `Api.create<T>`, Haxe completes `Factory.wrap`'s inferred
signature with that call site's `T`. The final typed Haxe field is effectively
`(Payload<T>) -> Factory<T>`, even though `wrap` itself has no source-level
`<T>`. Emitting the signature directly produces invalid TypeScript:

```ts
class Factory<T> {
  static wrap(payload: Payload<T>): Factory<T> {
    return new Factory<T>(payload);
  }
}
```

TypeScript reports that a static member cannot reference a class type
parameter. The readable letter is misleading here: the retained compiler
parameter came from `Api.create`, not from `Factory`. Matching the word `T`
would therefore join two unrelated declarations and would fail as soon as two
different parameters share a name.

`CallableSignaturePlan` examines the final typed function signature before
printing. For a static callable, it finds every referenced compiler
`KTypeParameter` that the method did not already declare, closes over any other
parameters used by its constraints, and gives the resulting scope to both the
TypeScript implementation and classic declaration emitters:

```ts
class Factory<T> {
  static wrap<T>(payload: Payload<T>): Factory<T> {
    return new Factory<T>(payload);
  }
}
```

The runtime JavaScript is unchanged because generic parameters are erased. The
dependency plan collects the projected parameters and their constraints before
import aliases are allocated, so a constraint type referenced nowhere else
still receives its type import.

Haxe can clone a type-parameter reference while specializing a public field.
The plan prefers the exact compiler declaration and joins those clones by the
declaration's module, name, and source position. It never uses the name alone.
If a class parameter and method parameter are both written as `T`, their
different declaration positions remain separate and the TypeScript names
become `T` and `T_1`.

The projection is deliberately limited to callable signatures. A static
property cannot acquire method-level `<T>` syntax, and a parameter appearing
only in a method body gives callers no type position from which to bind it.
Those cases require a different representation or a focused diagnostic.
Ordinary method-declared generics remain in their authored order and are not
declared twice.

### Haxe runtime byte caches on native buffers

Haxe 4.3.7's JavaScript `haxe.io.Bytes` implementation adds `hxBytes` and
`bytes` caches to the `ArrayBuffer` it wraps and a `bufferValue` cache to its
`Uint8Array`. hxnodejs 10.0.0 repeats all three writes on Node `Buffer`, a real
`Uint8Array` subclass, when implementing zero-copy `Buffer.hxToBytes()`.
TypeScript's standard libraries do not declare these Haxe-private properties.

`StdTypesEmitter` contributes only those named properties and keeps them
optional. That optionality is important: an arbitrary native buffer has not
necessarily been initialized by Haxe. `bufferValue` permits
`ArrayBuffer | Uint8Array` because Haxe stores the former while hxnodejs stores
the Node buffer itself.

The ambient declaration describes possible host shape; it does not by itself
prove that a particular read is initialized. `TsBoundaryPlan` recognizes only
the original untyped property access on an exact `ArrayBuffer`, `Uint8Array`,
or typed subclass:

- a nullable `hxBytes` destination emits `?? null` followed by an exact
  `Bytes | null` identity assertion;
- initialized `bytes` reads receive a presence assertion; and
- initialized `bufferValue` reads receive a presence assertion plus the exact
  compiler-known destination type.

The same plan models hxnodejs's `Object.create(Bytes.prototype)` construction.
It asserts the returned local as `Bytes` only when the exact prototype class
matches the declared return type. A different prototype, unrelated dynamic
receiver, or same-named user field receives no decision. Every assertion type
is collected before import projection, classic JavaScript remains unchanged,
and the complete beginner-facing examples and negative controls live in
[`tests/byte-buffer-cache/README.md`](../tests/byte-buffer-cache/README.md).

One such boundary comes from ordinary Haxe nullability. Unless a project opts
into additional null-safety rules, Haxe can accept a `Null<Int>` expression
where an `Int` parameter is declared:

```haxe
static function acceptConcrete(value:Int):Int {
  return value;
}

static function forward(value:Null<Int>):Int {
  return acceptConcrete(value);
}
```

The equivalent strict TypeScript types are `number | null` and `number`, so a
direct translation fails with “`number | null` is not assignable to
`number`”:

```ts
static forward(value: number | null): number {
  return Example.acceptConcrete(value); // strict TypeScript error
}
```

`TsBoundaryPlan` reads the already-checked Haxe abstract syntax tree (AST),
which is the compiler's structured representation of the program after name
resolution and type checking. It records the exact argument expression and
parameter type before dependency and import planning. TypeScript emission then
renders that one decision:

```ts
static forward(value: number | null): number {
  return Example.acceptConcrete(
    Register.unsafeCast<number>(value)
  );
}
```

`unsafeCast` is an identity assertion, not a runtime conversion: it evaluates
`value` once and returns the same JavaScript value. The assertion only carries
Haxe's accepted static relationship into TypeScript. If Haxe source first
checks `value != null`, TypeScript understands the same guard and Genes emits
the direct call without an assertion.

The proof also works through generic declarations, but it compares every
generic argument. `Pair<Null<Int>, String>` is not accepted as a
nullability-only version of `Pair<Int, Int>` merely because the first argument
qualifies; the unrelated `String`/`Int` sibling makes the whole relation
incompatible. Unresolved compiler types, `Dynamic`, arbitrary structural
objects, unrelated generics, and user-defined abstract conversions receive no
boundary assertion.

Enum constructors add one related inference problem. Haxe can take generic
enum parameters from the destination type even when they are absent from the
constructor payload. `TypeUtil.enumConstructorApplication` supplies the
destination-applied enum and payload types to `TsBoundaryPlan`; planning and
emission therefore use the same compiler-owned types for both explicit generic
arguments and any exact payload assertion. A payload that already has the
right nullable/plain shape is unchanged.

Public declarations remain precise, classic JavaScript remains unchanged, and
every type named only by an assertion or explicit enum argument is collected
before import aliases are frozen. Expression printing is therefore a consumer
of the decision, not a late type-inference pass.

An output profile decides how those facts are spelled:

| TypeScript implementation | Classic JavaScript | Declarations |
|---|---|---|
| Type annotations, closed interfaces, `import type`, TSX, TS source extensions | Type erasure, runtime imports, executable ESM, classic registration syntax | Exported API only, declaration imports, overloads, null/undefined/optional spelling |

A profile must not silently redefine Haxe runtime semantics. If a helper has a
rich TS surface, it also needs a real Haxe/runtime representation or a stable
capability diagnostic in classic mode.

## Warm compilation-server lifecycle

A warm Haxe server may reuse typed declarations between requests, but it must
not make generated output depend on request order. State has five practical
lifetimes:

- **compiler-process state** is exceptional. A persistent macro scalar or map
  must be refreshed by a documented request entrypoint, use compiler-owned
  identity rather than generated names/positions, and have a cold/warm
  equivalence fixture;
- **request state** includes pre-DCE surfaces, signature caches,
  directives, capability defines, and generation membership. Its owner
  replaces or reinstalls it for every compilation before the first consumer;
- **module state** includes dependency, JSX, template, narrowing, TypeScript
  value-boundary, temporary, naming, and projection plans. `Module.addTypes`
  invalidates plans whose typed inputs can expand through declaration
  reachability;
- **emitter state** includes writers, source-map buffers, and syntax-local
  stacks. It is constructed for one artifact and never cached across requests;
- **filesystem state** includes public output and ownership manifests.
  `OutputTransaction` is request-local, while the manifest deliberately
  survives as exact evidence for later stale-file cleanup.

Concrete rules follow from those lifetimes:

- typed carriers may survive Haxe typing caches only when they contain stable,
  profile-independent facts; `DynamicImportMarker` carries an extension-free
  path and authored position, while `ExplicitTypeArgumentCallSite` carries
  inert occurrence-local witness types. The active emitter chooses `.js`,
  `.mjs`, or no dynamic-import suffix from the current generation;
- a typed carrier must be self-contained when Haxe can reuse it. An ordinary
  macro static map is not a valid companion store: the generator may execute
  in a different macro context, and a persistent map would retain typed
  objects without a safe eviction boundary;
- `@:genes.generate` metadata is a request-membership stamp. Cached declarations
  may retain older stamps, so generation checks for the current stamp instead
  of requiring the metadata list to contain exactly one entry;
- emitter plans, dependencies, names, mappings, writers, and output
  transactions belong to one module or generation and are rebuilt;
- compiler-owned output sentinels and private stages are removed on their
  owning request's completion. They are never reusable semantic caches.

### State-owner ledger

The table below is the review checklist for mutable compiler state. “Key”
means the identity that prevents one declaration, request, or output owner from
being mistaken for another; it is not necessarily a `Map` key in the code.
Immutable keyword tables and generated-program statics such as
`genes.Register.fid` are omitted: the former never change, and the latter live
in the emitted application rather than the Haxe compiler process.

| Owner | Purpose and lifetime | Refresh, identity, and failure rule | Executable proof |
|---|---|---|---|
| `Genes.outExtension` | Process-visible scalar holding the current implementation artifact suffix for emitters. It is **not** the runtime-import policy. | `Generator.generateTransactional` assigns it from the current configured output before creating modules or emitters. Runtime imports instead carry extension-free typed markers and call `Genes.runtimeImportExtension` with the active artifact extension, so a cached macro expansion cannot preserve `.ts`, `.tsx`, or an earlier request's suffix. | `yarn test:dynamic-import-policy`; `yarn test:compiler-server` |
| `Generator.generation` and `@:genes.generate` | Monotonic process-visible request stamp used only to decide which typed modules participated in the current generation. | The request's `onGenerate` callback increments the stamp and adds it to each current type. A module matches when **any** metadata entry has the current number; older entries on a Haxe-cached declaration are ignored. A failed request cannot make an old stamp current again. | `yarn test:compiler-server` |
| `Generator.configuredOutputFile` and `compilerSentinelFile` | Installation-time paths that isolate Haxe's own `-js` cleanup from Genes' public output transaction. | `Generator.use` calls `isolateCompilerOutput` for the current request. The request-local `genes.output` define may replace the HXML destination before capture; no process registry carries the choice. Genes snapshots both that value and the `genes.ts` profile because together they select legal syntax and suffixes, then rejects later macro mutation before opening a writer. The selected destination owns the output, while a SHA-256 of its absolute path identifies Haxe's private sentinel. Normal completion, generator failure, and the after-generate hook remove the sentinel. Public publication still belongs only to `OutputTransaction`. | `yarn test:output-transaction`; `yarn test:compiler-server` |
| `ModuleDirectivePlan` | Request-local ordered module-prologue facts stored in `@:persistent` maps because capture happens before generation. | Every `install()` replaces all maps and the finalized flag, then registers the current request's `onAfterTyping` capture. Full typed module/field owner keys establish identity; source positions only order directives. Validation fails before emitters open. | `yarn test:module-directives`; `yarn test:compiler-server` |
| `PublicSurface` | Request-local pre-DCE public API records, including compiler-owned `Type` values needed by TS and declarations. | Every `install()` replaces the map before registering `onAfterTyping`. Full Haxe module/type identity is the key; consumers substitute current type parameters. Post-DCE fallback capture is confined to the current map. | `yarn test:library-profile`; `yarn test:compiler-server` |
| `genes.ts.SignatureCache` | Request-local pre-DCE signature and enum-abstract facts used when later JS-oriented typing has erased a precise TS surface. It contains compiler-owned `Type` values. | Every `install()` replaces all maps before registering `onAfterTyping`. Named declarations use full owner identity; anonymous/local entries may use positions or `TVar.id` only inside that reset boundary. A cached source type is printed through the normal type emitter, not a second renderer. | `yarn test:types:exports`; `yarn test:compiler-server` |
| `genes.react.ReactDiagnosticsMacro` and `ReactAnalyzerFunctionMacro` | Compilation-local callback installation for typed React placement/purity diagnostics and analyzer-visible function metadata. They keep no cross-request semantic cache. | Haxe resets the ordinary module `installed` guards per compilation; each request installs its global build metadata and `onAfterTyping` audit exactly once. The whole-server sequence installs both passes on every cold and warm request so callback lifecycle errors change the output or diagnostics rather than remaining hidden behind a one-shot React fixture. | `yarn test:react-hooks`; `yarn test:compiler-server` |
| Explicit type-argument carriers | Occurrence-local typed facts for `TypeArguments.call` and `@:ts.explicitTypeArguments`; deliberately **no** process registry exists. | The exact typed call occurrence carries inert witness types. Emitters revalidate the declaration and erase the carrier. Neither copied positions nor same-named projects can retrieve another occurrence's fact, and a cached typed tree remains self-contained. | `yarn test:explicit-type-arguments`; `yarn test:compiler-server` |
| `TypeUtil.registerType` / `bootType` | Compiler-owned helper declaration references used by dependency planning. | Haxe 4 initializes them at the proven eager macro point; Haxe 5 fills them in `onAfterInitMacros`, when lookups are legal. They are never indexed by emitted spelling. Stable cold/warm trees prove request correctness; preview's separate post-DCE variance remains advisory. | `yarn test:compiler-server` |
| `CompilerInternal.GENERATOR_ACTIVE_DEFINE` | Compilation-local capability proving that the active JS request installed Genes and can consume compiler-only carriers. | `Generator.use` defines it only in the JS, non-`genes.disable` branch. A disabled or non-JS request must fail at the carrier boundary and publish nothing; it may not inherit capability from an earlier warm request. | `yarn test:compiler-server` |
| `TypeEmitter.emittingCapturedSourceType` | Narrow printer dynamic scope, not a semantic cache. It permits a retained source type to preserve enum-abstract literals while that one type is printed. | `emitCapturedSourceType` saves and restores the previous Boolean on success and on `haxe.Exception`. It carries no declaration key and must never remain enabled for a later type or request. The rollback probe directly proves that the supported stable and preview macro runtimes wrap an intentionally thrown plain Haxe string as `haxe.Exception` at the outer transaction boundary. That runtime behavior also supports this narrow typed catch, although the probe does not inject the throw while this flag is enabled. | `yarn test:types:exports`; `yarn test:compiler-server:rollback`; `yarn test:compiler-server` |
| `Module` lazy plans | Module-local typed facts: dependency/projection, JSX, template literals, TS narrowing, temp, local binding, module-function, naming, and cycle plans. | Each `Module` owns its maps and compiler refs. `Module.addTypes` clears every plan whose inputs can grow when type/declaration reachability materializes more types. `TemplateLiteralPlan` is intentionally retained: late-only types have already lost executable bodies to Haxe DCE, while a retained body is present in the initial generator inventory. No plan or `TypedExpr` object is stored process-wide. | `yarn test:template-literals`; `yarn test:output-quality`; `yarn test:compiler-server` |
| `OutputTransaction`, writers, and source maps | One-generation staging and one-artifact emission state. The ownership manifest is the only filesystem-persistent part. | A transaction key is the exact normalized output basename, including extension, plus a collision-resistant scope. Commit publishes the whole owned set; abort restores the previous public bytes and removes private stages. Writers and mapping buffers are newly constructed and never reused. | `yarn test:output-transaction`; `yarn test:compiler-server` |

Haxe macro callbacks are installed by `Generator.use()` and the owner-specific
`install()` methods for the current compilation. Do not rely on callback
registration itself to clear a process-visible map: replace the map before
registering the callback, as the three pre-DCE owners above do. Conversely, do
not add a reset for generated-program runtime state or immutable lookup tables;
those values do not belong to the compiler lifecycle.

Two executable owners protect this boundary:

- `yarn test:dynamic-import-policy` focuses on runtime import suffixes across
  TS, TSX, classic JS/JSX/MJS, and extensionless profiles;
- `yarn test:compiler-server` exercises the compiler as a whole across profile
  switches, edits, deletion/restoration, metadata, DCE/public surfaces, import
  forms, occurrence-local explicit type witnesses, failure/recovery, disabled
  capabilities, and same-named projects.

Both start the real selected Haxe binary, reserve a loopback port, establish
readiness with a real bounded request, compare warm output to isolated cold
output, and prove their exact child process died. They never attach to an
ambient server. Stable Haxe is blocking; preview uses the same lifecycle as an
advisory compatibility signal.

`yarn test:compiler-server:rollback` is the smaller failure-only owner. It
throws both a `CompilerDiagnostic` and a plain Haxe string after TS or classic
emitters have privately staged implementations, declarations, and maps. The
plain value is intentionally not normalized by Genes: the pinned stable and
preview Haxe macro runtimes wrap it as `haxe.Exception`, so the existing
generator catch retains the original diagnostic while restoring the
transaction. The same wrapping contract is what the narrow type-printer catch
relies on, but this command does not inject a throw inside that printer scope.
If a future supported Haxe lane stops honoring the outer contract, this focused
command fails before a release can leave partial output.

Haxe's native cache context does not use classpath identity as a complete
project boundary. The two-project fixture adds a private define per project so
Haxe does not return another project's same-named typed module before Genes
runs. This does not isolate Genes process-persistent macro state: both projects
still execute inside one server process, which is the lifecycle under test.

Do not add process-persistent typed state without documenting its producer,
lifetime, key identity, reset/rebuild point, failure behavior, and focused
cold/warm proof. Prefer an owner-local reset over a compiler-wide session or
cache manager until several reproduced defects require coordinated lifecycle
ownership.

## Non-negotiable invariants

- Both output modes are first-class. Ordinary Haxe source should compile to TS
  or classic JS without source changes; TS-aware helpers degrade deliberately.
- Haxe's JavaScript target is the runtime semantic baseline. The read-only
  `../genes-vanilla` checkout is a regression and output-quality oracle, not a
  destination for patches and not a byte-for-byte specification.
- Runtime, type-only, and declaration-only edges remain distinct. A type import
  must not introduce a runtime side effect; a declaration-only type must not
  broaden classic DCE.
- TypeScript implementation roots are declarations that independently own an
  emitted program surface: concrete types, interfaces, enums, the main
  expression, and explicit exports. A module containing only typedefs is
  retained through an actual type edge from emitted syntax, not merely because
  Haxe loaded it while resolving an ambient extern. `yarn test:type-roots`
  proves both sides with compiler-owned type identity and no path heuristic.
- Type-only planning also owns type syntax that appears inside executable
  TypeScript. For example, when Genes must print an inferred enum constructor
  argument such as `Yield.Data<Assertion, tink.Error>`, it retains the authored
  `tink.Error` import instead of accidentally resolving the same word to the
  JavaScript global `Error`. The same plan owns a generic enum constructor used
  as a function value: if Haxe checks `map(value, Choice.Left)` against
  `A -> Choice<A, B>`, TypeScript emission may print `Choice.Left<A, B>`.
  Dependency allocation sees `A` and `B` first; the expression emitter never
  rediscovers them from generated text or mutable expected-type state.
- Top-level output visibility is not one boolean. A
  `@:genes.compilerInternal` type remains a typed local implementation after
  full DCE while being omitted from exports, declarations, public runtime
  registries, and source-map positions. Apply this projection only at the
  final emitter boundary so dependency planning can still inspect the complete
  typed member. Ordinary Haxe privacy remains byte-stable for now: real
  libraries can route public signatures through source-private helper types,
  and hiding those declarations without first normalizing the public type
  graph would leave dangling consumer names. That broader privacy correction
  requires separate evidence and is not implied by compiler ownership.
- Runtime module-request order is an explicit immutable array keyed by
  internal/external identity, path, and optional loader attribute. Printers do
  not infer evaluation order from a path-grouped map. Equal requests coalesce
  at first occurrence, and a real binding can satisfy an earlier bare request.
- Import identity is not the generated local word. A module request identifies
  which module is loaded; an export selector distinguishes default, named, and
  namespace values; a local intent records the preferred identifier; and a
  typed Haxe origin tells expressions and annotations which allocated local to
  use. For example, default `Foo` and named `Foo` from one package share module
  evaluation but remain different values and receive different local names.
  Source positions are provenance only and never change these equalities.
- Import-attribute metadata is validated while that dependency plan is built.
  Absence means an ordinary request; presence requires exactly one non-empty
  string literal. Invalid metadata never degrades to absence, because doing so
  would silently remove a host loader contract before either printer sees it.
- Runtime module directives are an explicit pre-DCE plan, emitted as terminated
  statements before every banner and import in both implementation profiles.
  Metadata can affect only a module already selected by ordinary reachability
  and never enters `.d.ts`.
- Public generated TypeScript is closed and precise. Broad `any`, `unknown`, or
  catch-all index signatures require a named, documented foreign boundary.
- A long, valid chain of Haxe type aliases must not weaken the final type. Genes
  still needs to know whether the value is always present, may be `null`, or
  may be JavaScript `undefined`. An internal 64-step safety limit prevents an
  unexpected recursive compiler type from looping forever, but it is not a
  user-facing limit on aliases. `yarn test:deep-nullish-alias` checks a 66-link
  chain in fields, function parameters and results, and map reads across
  standard Haxe, classic Genes, and genes-ts. See
  `tests/deep-nullish-alias/README.md` for the beginner-oriented explanation.
- A finalizer executes exactly once. `FinallyCompletion.run` places only its
  protected callback inside the catchable Haxe `try`; placing the normal-path
  finalizer there would catch a finalizer throw and incorrectly invoke the
  finalizer again. Its one `Any` binding is a host-thrown-value boundary: the
  value is never inspected or converted and is rethrown unchanged when a
  normal finalizer does not replace it.
- Capability and dependency errors that planning can identify are diagnosed
  before committing output. A failed TS, classic JS, declaration, support-file,
  or source-map emission leaves the prior owned tree byte-identical. Successful
  builds remove stale manifest-owned paths and preserve unrelated files.
- Output ownership includes the configured filename extension and is recorded
  exactly inside a versioned manifest. Filesystem-safe punctuation replacement
  is only a readable prefix, never identity: a full digest distinguishes names
  such as `entry@one.ts` and `entry#one.ts`, while `index.ts` and `index.js`
  remain independent owners in one directory. Legacy v1 manifests did not
  carry exact identity and are preserved rather than guessed or used for stale
  deletion.
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
| JSX, React Hook, or React Flight value behavior | `JsxPlan` and the framework-neutral `genes.react` marker/macro/Flight layer | HXX/TSX type negatives, `yarn test:react-hooks`, `yarn test:react-flight`, and TS/classic runtime profiles |
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
| React components, Hooks, semantic state/dependencies, and placement | `tests/react-hooks/` | `yarn test:react-hooks` |
| React 19 Flight value algebra, native identities, and host-proven extension policy | `tests/react-flight/` | `yarn test:react-flight` |
| Local HXX carrier ownership | `tests/hxx-carrier-immutability/` | `yarn test:hxx-carrier-immutability` |
| React event callback variance | `tests/hxx-event-variance/` | `yarn test:hxx-event-variance` |
| Exported-surface rejection | `tests/typing-policy/`, `tests/publicsurface/` | `yarn test:types:exports` |
| Classic `.d.ts` consumer behavior | `tests/classic-dts/` | `yarn test:classic:dts` |
| Static callable generic inference, constraints, and declaration parity | `tests/staticcallable/`, `tests/TestStaticCallableSignature.hx` | `yarn test:genes-ts:full`; `yarn test:classic:dts` |
| Nullish/map/iterator contract | `tests/nullish/`, `tests/deep-nullish-alias/` | Owning genes-ts/full/exported-surface gates and `yarn test:deep-nullish-alias` |
| Type-only reachability and DCE | `tests/typeonly/`, `tests/type-roots/` | Owning genes-ts/full, dual-output, and `yarn test:type-roots` gates |
| Same-source TS/classic parity | `tests/output-modes/` | `yarn test:dual-output` |
| String literal code units and escaping | `tests/string-literals/` | `yarn test:string-literals` |
| Reusable package surface | `tests/library-profile/` | `yarn test:library-profile` |
| Module directive prologues | `tests/module-directives/` | `yarn test:module-directives` |
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

### Enrolling generated public surfaces

`scripts/exported-surface-policy.ts` uses TypeScript's `Program` and
`TypeChecker` to reject weak exported types that a text scan or successful
`tsc` run cannot see. Production profiles must select files through
`ownershipInventories`, using the exact output identity from a Genes v2
manifest. Every compiler-owned `.ts`, `.tsx`, or `.d.ts` module then has one of
two outcomes:

1. it enters the semantic audit automatically; or
2. its exact manifest-relative path has a documented `runtime-boundary`,
   `fixture-boundary`, or `known-gap` classification.

Classifications are deliberately strict. They must name a current owned type
file, carry a useful reason, and disappear when that file disappears. A
`known-gap` also names its Bead, so an exclusion cannot become anonymous debt.
Adding a generated module therefore expands the audit without editing a caller
path list, while renaming or deleting a classified boundary makes the gate fail
until the evidence is reviewed.

The three classifications answer different practical questions:

- `runtime-boundary` means the whole module describes a real value that cannot
  be known completely until JavaScript runs. Examples include Haxe reflection
  registries and hxnodejs option/callback APIs. The reason must name that host
  contract; this is not permission for ordinary user modules to expose weak
  types.
- `fixture-boundary` means the module is present only because a regression test
  deliberately compiles an external or low-level API. For example, the full
  profile compiles Haxe compiler data structures and Tink to pressure-test
  Genes. The test proves that Genes preserves those source APIs; it does not
  claim that Genes owns or should silently redesign them.
- `known-gap` is temporary debt: the generated API is weaker than its intended
  contract and a named Bead owns the correction or a more precise explanation.

A reusable Genes API should normally remain inside the semantic audit even when
it has an intentional boundary. In that case,
`tests/typing-policy/exported-surface-boundaries.json` names the exact export and
finding kinds. This lets `genes.Register`, `genes.ts.JsonCodec`, and
`genes.ts.UnknownNarrow` keep their small documented runtime inputs while the
rest of each generated profile stays automatically enrolled. See also the
nearby Why/What/How comments in those Haxe modules, which explain where the
runtime value comes from, what guard or containment applies, and what typed
value callers receive afterward.

The audit treats each owned module as the root of its own public graph. It
checks imported weak values and generic arguments, but expands declarations
only in the root module; the imported module is audited independently. This is
both the semantic ownership rule and a termination rule: recursively
instantiated generic libraries can create a fresh TypeScript `Type` object at
every level even though they repeat one declaration. A declaration-owner guard
prevents that graph from unfolding forever without hiding an immediate
`any`/`unknown` argument.

Direct `includePaths` remain available only for the policy's small unit
fixtures, where testing one selected graph is the point. New production profile
gates should use compiler ownership rather than hand-maintained enrollment.

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
`yarn test:output-quality` separately reads the raw compiler-owned TS, JS, and
declaration trees and rejects spaces or tabs after visible content. It does not
currently impose a policy on indentation-only blank lines.

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
  -> haxe/source-namespace-plan.ts: validated source/package/output identity
  -> semantic/ir.ts + haxe/emit.ts: supported semantic decisions,
     Haxe translation, provenance, and diagnostics
  -> transactional Haxe output + ts2hx-manifest.json
  -> optional Haxe -> classic JS / genes-ts -> TS differential harnesses
```

| Owner | Responsibility |
|---|---|
| `src/project.ts` | Loads tsconfig through the TS Program/TypeChecker API and sorts source files deterministically. |
| `src/typescript-api.ts` | Isolates the TypeScript 6 compiler-API bridge from tool logic. |
| `src/semantic/effective-module-requests.ts` | Observes final configured TypeScript import elision/lowering in memory and retains original request provenance. |
| `src/semantic/compiler-facts.ts` | Records exact bridge/engine identities and a portable deterministic hash of effective compiler options. |
| `src/semantic/package-extern-plan.ts` | Converts one checker-resolved package value into a closed strong Haxe type plan, or a deterministic rejection reason. It never prints Haxe or executes package code. |
| `src/semantic/ir.ts` | Owns stable semantic feature IDs, support grades, and deliberately small immutable plans, including function-local callback paths, real control targets, and transfer provenance for `try/finally`. |
| `src/haxe/source-namespace-plan.ts` | Assigns every configured source one validated Haxe package, module FQN, and output path before any runtime request, extern, or source text is planned. |
| `src/haxe/emit.ts` | Translates validated constructs, records source provenance, and stages output. It consumes recognized prior `plannedFiles` for no-clean stale removal, preserves unowned paths, and coordinates an optional external manifest with the generated-tree rollback window. Unsupported input must not disappear. |
| `src/haxe/runtime-modules.ts` | Validates hash-pinned external-relative runtime ownership before emission; staged bytes share the Haxe output transaction, while the named build owner copies them beside final JS. |
| `src/cli.ts` | Owns strict/assisted modes, exit codes, human diagnostics, and selection of the optional external-manifest path. |

Strict mode succeeds only for the supported subset and preserves the previous
output tree on failure. Assisted mode may create scaffolding only when every
loss has a stable `TS2HX-*` marker and manifest record. Printers may not turn an
unsupported construct into a silent omission or behavior-changing default.
Source identity is validated even earlier than TypeScript request inspection.
The base package and every source directory must use legal Haxe package
segments, each emitting filename must produce a usable module name, and every
source must remain under the configured root. The plan groups final output
paths case-insensitively so a project is safe on both case-sensitive and
case-insensitive hosts. A collision is an error in strict and assisted modes:
one Haxe module cannot honestly scaffold two TypeScript roots. Namespace
failure returns source-positioned diagnostics and an empty publication plan,
leaving the previous tree byte-for-byte unchanged.

Successful and assisted trees carry their generated-file ownership in the
embedded schema-v3 manifest. A later no-clean run may remove only prior
`plannedFiles` missing from its new immutable namespace/output plan. Missing
ownership evidence preserves every old path; malformed, ambiguous, or escaping
ownership fails before staging can replace the old tree. `--clean` remains the
whole-tree option for a directory dedicated exclusively to ts2hx.

Before Haxe planning, a read-only TypeScript `after` transform classifies every
original static import as a runtime request, type-only request, or elided
declaration under the configured compiler options. A schema-v3 manifest records
the original span, effective runtime order/format/shape, exact TypeScript
bridge and engine, and an effective-options hash. The input project must
type-check; `noEmit` and `emitDeclarationOnly` are disabled only in an in-memory
evidence Program and remain represented by the options hash.

Outer `try/finally` completion ownership is planned before text emission. The
existing direct-control-flow emitter consumes real target identities, and the
supported synchronous completion path also consumes callback paths. Each function
receives readable deterministic IDs local to one source plan; nested functions
start with a fresh emitter state. A
loop/switch/return target records the synthetic callback path where it is
owned, and each transfer records the inner-to-outer callback suffix it would
have to leave. The target path must prefix the source path—control may leave a
callback but cannot jump into one. This distinction is what lets an inner
continue stop at a loop inside an outer protected callback while another
continue propagates through both finalizers to an outside loop.

`test-completion-plan.ts` compares that ownership model with the legacy
callback-escape detector on reduced nested cases and repository fixtures. The
emitter uses target IDs for direct and completion-aware loop increments,
switch breaks, and switch-to-loop continue routing. Every source function
installs its own active-target, increment, and switch-escape state; a nested
arrow or method therefore cannot inherit an enclosing function's control
targets. Local and completion-aware `try/finally` callbacks both enter their
planned callback path without changing source-function ownership.

For a validated synchronous transfer, protected and finalizer callbacks return
`Null<__Ts2hxFinallyAbrupt<T>>`: `null` means normal completion, and the private
enum carries a value/bare return or a stable loop/switch target. After a helper
returns, the target's callback path chooses one of two actions: a target owned
at the current path becomes a real Haxe return/break/continue; a target owned by
a strict prefix propagates unchanged so the next helper runs its finalizer.
This is why an inner continue can stop at a loop inside an outer callback while
a return from the same helper still leaves that callback. Lowered `for`
increments run only at final continue dispatch, after all crossed finalizers;
break never runs the increment. Switch escape flags remain keyed by the real
loop target rather than the synthetic `do/while(false)` used for fallthrough.

Return expressions first enter a strongly typed collision-safe local, which
both evaluates them once and prevents nullable payloads from forcing an unsafe
generic cast in generated TypeScript. A final invariant throw satisfies Haxe's
local value-return analysis without inventing a fallback value; the input
TypeScript checker has already proved that this path cannot be reached.

The supported outer-transfer contract is deliberately narrower than all valid
JavaScript functions: it covers synchronous unlabelled return, break, and
continue in named function declarations and ordinary class methods with an
explicit strongly mapped return type. Break may target `while`, `do`, `for`,
`for...of`, or a source switch; continue may target those loop forms but not a
switch. Async functions, generators, constructors, anonymous forms, labels,
generic or inferred/weak carriers, and unsupported loops retain the stable
outer-transfer diagnostic or their existing statement boundary. Existing
callback-local `TryFinally.run` output remains unchanged.

Every emitting caller chooses an explicit runtime profile. `genes-esm` covers
classic Genes and genes-ts and records `genes.esm-runtime-requests` whenever a
runtime request survives. `standard-haxe-js` is request-free: its first
effective request produces `TS2HX-MODULES-ESM-RUNTIME-TARGET-001`, remains an
error in assisted mode, and cannot modify the prior tree. Compiler-owned
request carriers call `genes.internal.EsmRequestFact`, whose macro repeats the
JS-plus-active-Genes check before expanding to the raw typed marker. There is
no conditional omission or runtime fallback.

Each supported runtime-importing file receives one kept
`@:genes.compilerInternal` carrier whose typed marker calls survive full DCE,
become ordered Genes module requests, and disappear from both final profiles
and declarations. The supported producer set includes binding-free packages,
the closed typed bound-package subset, manifest-owned relative resources, and
acyclic converted imports with empty, immutable named/default/namespace, mixed
type/value, and combined clauses.

Carrier occurrences come from configured TypeScript emit: an unused import
retained by `verbatimModuleSyntax` remains a request, while an import TypeScript
elides does not become one. Haxe value-use order is therefore not allowed to
replace the effective declaration order, even in a module with no bare-import
ancestor. Maps remain lookup structures; neither ts2hx nor a Genes printer may
reconstruct request order from grouped bindings.

Bound packages add a second proof beside request order. The effective request
inventory first says which bindings survived TypeScript's configured emit.
`package-extern-plan.ts` then resolves each retained alias through the checker
and accepts only two ordinary-Haxe shapes: a declaration-file primitive
`const`, or one non-generic, non-overloaded function with required primitive
parameters and a primitive/`Void` result. The plan stores a closed Haxe type
value; `emitExternModuleFile` never parses TypeScript text or invents a weaker
fallback. Default, named, aliased, mixed, duplicate, and statically-read
namespace bindings all use the same literal package identity. The external
request carrier supplies source order, while ordinary `@:jsRequire` value edges
attach to its first request slot. Duplicate declarations therefore become one
final ESM import and one module evaluation.

This boundary deliberately distinguishes an unused source binding from a use
created later by a TypeScript transform. A zero-source-use binding is accepted
only when `verbatimModuleSyntax` explicitly retained it. Classic JSX's
synthetic `React.createElement` use therefore remains fail-closed instead of
being mistaken for a harmless unused namespace. Mutable exports, overloads,
generics, optional/rest/explicit-`this` parameters, object or union types,
namespace-object identity or computed access, attributes on bound packages,
sanitized export names, colliding extern module names, and other declaration
shapes retain the stable package-bound diagnostic. Converted cycles,
converted attributes, configured non-ESM output, and runtime re-exports also
remain explicit strict failures.

An acyclic binding-free request to converted code targets a deterministic
compiler-internal field in the generated Haxe module. That typed anchor makes
the target visible; explicit `@:keep` metadata retains its translated top-level
initializers; Genes then erases both anchor and carrier. Every edge in a
converted runtime-request cycle fails with
`TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001` until ESM cycle/TDZ parity
has separate runtime evidence.

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

### Opaque finally-completion runner

`genes.js.FinallyCompletion.run<C>` is the typed runtime seam for a ts2hx
transfer that has to leave a synthetic `try/finally` callback. The helper
does not know whether `C` means return, break, or continue. It only applies two
small rules:

1. `null` means the callback completed normally; a non-null `C` is an abrupt
   result whose meaning remains owned by the compiler plan.
2. A non-null or throwing finalizer replaces the protected outcome. A normal
   finalizer preserves the protected result or rethrows the exact protected
   value.

Keeping the carrier opaque is important. A private compiler-owned generic enum
can represent `Void`, a nullable return payload, and stable target identifiers
without adding a public completion algebra to the runtime library. The helper
uses ordinary request-free Haxe and is executable under standard Haxe JS,
classic Genes, and genes-ts. `TryFinally.run` remains the smaller established
path when both callbacks complete locally.

The helper remains infrastructure rather than a public completion algebra.
`tests/finally-completion` proves its precedence, typing, identity, and
exactly-once contract. The ts2hx semantic differential separately proves
automatic value/bare returns, nullable carriers, catches, nested propagation,
finalizer override, and an ordinary class method in original TypeScript,
classic Genes, and genes-ts. It also covers body/finalizer break and continue,
mixed return/control carriers, catch control, all supported loop forms, exact
lowered-for increments, switch routing, protected-throw override, and
local-versus-propagated nested targets. The request-free
`finally-completion-return` and `finally-completion-control` snapshots run the
automatic paths under standard Haxe JS and strictly compile them through
genes-ts with TypeScript 5/6/7. These fixtures support the exact synchronous
boundary above; they do not extend it to the excluded function or target forms.

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
