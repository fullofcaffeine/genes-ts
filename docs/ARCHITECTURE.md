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
   renderer. Enum-constructor nullability bridges use that same captured
   signature for their assertion target after the lowered call establishes the
   conversion. This preserves closed payload types without treating an opaque
   throwing helper as flow evidence. When inlining assigns a new local ID,
   a surviving typed enum declaration also supplies an exact local witness.
   This does not infer a domain from the variable name or its initializer;
   a declared String remains broad. Directive capture adds no roots or dependency edges.
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
   Before staging non-empty implementation, declaration, and support source,
   its shared emitter-writer boundary removes trailing ASCII line-ending
   whitespace and appends one LF. Maps and manifests keep their exact bytes.
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
| Compiler timing attribution | `src/genes/util/Timer.hx`, `src/genes/Generator.hx`, `src/genes/DependencyPlanBuilder.hx`, `src/genes/ts/TsModuleEmitter.hx` | Uses Haxe's `--times` tree for parsing, typing, DCE, macros, and the custom generator. Request-local Genes timers identify planning, validation, emission, and publication. The benchmark-only profile divides reachability into roots, expansion, runtime edges, type edges, and declaration edges. It also divides TypeScript class emission into finite owners. Ordinary builds compile without these fine timers. |
| Generation diagnostics | `src/genes/CompilerDiagnostic.hx` | Throws source-positioned Haxe macro errors through normal stack unwinding so staged output is cleaned before diagnostics escape. |
| Module/member inventory | `src/genes/Module.hx` | Presents one emitter-facing module view and materializes declaration-only members without changing the runtime graph. |
| Top-level output projection | `Module.memberProjection`, `src/genes/CompilerInternal.hx` | Separates local implementation presence, ESM export, consumer declarations, Haxe runtime registration, and source provenance. Printers consume these facts instead of treating one visibility flag as every policy. |
| Public API facts | `src/genes/PublicSurface.hx` | Captures visibility, inheritance, generics, overload identity, and complete closed interface members before DCE. |
| Callable generic scope | `src/genes/CallableSignaturePlan.hx`, `Module.fieldsOf` | Declares every type parameter named by a static callable's final Haxe signature, including parameters retained through inference, while preserving ordinary method parameters, constraints, and collision-safe identity across implementation and declaration output. |
| Module directive prologues | `src/genes/ModuleDirectivePlan.hx` | Captures literal module intent before DCE, validates single-owner source order, and exposes one immutable plan without changing reachability. |
| Null, undefined, and optionality | `src/genes/NullishContract.hx` | Keeps Haxe `Null<T>`, native `undefined`, optional fields, absent parameters, and unknown boundaries distinct. |
| Dependency graphs and module-request order | `src/genes/DependencyPlan.hx`, `DependencyPlanBuilder.hx` | Records runtime-value, runtime-side-effect, type-only, and declaration-only edges with provenance; projects runtime requests by external/path/attribute identity into one ordered plan. |
| Import bindings, aliases, and host globals | `src/genes/BindingIdentity.hx`, `TypeAccessor.hx`, `Dependencies.hx` | Keeps the requested module, selected export, requested local, and typed Haxe origin as separate facts; then allocates collision-safe locals. Exact compiler-owned JavaScript globals retain semantic identity and TypeScript renders them through `globalThis`. A binding-free request never invents a dependency name. `@:native` alone may identify a direct host value, while a declaration that also has `@:jsRequire` always resolves through its package binding and any normalized member path. |
| Closed CSS Module imports | `src/genes/css/CssModule.hx`, `src/genes/ts/Imports.hx`, `tooling/src/css-modules/**` | A host-selected processor owns exact runtime keys. Tooling validates its versioned manifest and generates a closed Haxe companion plus an exact per-file TypeScript declaration; the compiler checks owner/request metadata and reuses the ordinary default-import plan. Genes never parses CSS or decides framework placement. |
| Dynamic-import runtime requests | `src/genes/Genes.hx`, `src/genes/internal/DynamicImportMarker.hx`, `DynamicBindingDeclarationMarker.hx`, `ExprEmitter.hx` | Carries an extension-free typed request from the macro to the shared emitter, which applies the current build's runtime suffix. The declaration marker ties each generated callback local to that exact request. Both emitters erase the declaration marker. Cached typing never owns `.ts`/`.tsx`/`.mjs` policy. |
| Explicit generic-call witnesses | `src/genes/ExplicitTypeArguments.hx`, `src/genes/ts/ExplicitTypeArgumentCallSite.hx` | Keeps a pre-erasure type fact on the exact typed call occurrence. The carrier uses inert typed-null placeholders, both emitters erase it, and cached compiler-server trees never depend on a macro static registry or source position as identity. |
| React state initialization types | `src/genes/react/ReactStateInitializationPlan.hx` | Records the closed value type from an exact local `State<T>` and its exact compiler-owned `useState` call. Dependency planning reserves each type before imports freeze. TS and TSX print the witness, while classic JS and JSX keep the same call and evaluation order without type syntax. |
| JSX intent, carrier ownership, accounting, and capability | `src/genes/JsxPlan.hx` | Represents markup before choosing TSX, `createElement`, classic lowering, or an unsupported diagnostic. A local linked-record carrier may preserve one-time evaluation, but no other read, write, or escape may change the compiler-owned structure after it is recognized. A forgeable HXX root candidate never grants representation authority: complete request-local local-use inventory, exact inline carrier grammar, and per-emitter consumer accounting permit only one declaration plus one static HXX element consumer—root or retained nested element—to project as ordinary props. Direct nested elements/fragments use a separate exact declaration/use relation for optional source inlining; positions remain mapping facts rather than ownership. |
| React State projection | `src/genes/react/ReactStateProjectionPlan.hx` | Authenticates exact compiler-owned `State<T>` and `useState` declarations, then inventories every typed local use through nested closures. Only current-value and dispatcher operations can become native destructured bindings. Whole-State observations, writes, custom Hooks, and opaque target syntax visible from the State binding's lexical scope keep the indexed representation. |
| Names, local mutability, and required temporaries | `src/genes/LexicalBindingUsePlan.hx`, `NamePlan.hx`, `LocalBindingPlan.hx`, `TempPlan.hx` | `LexicalBindingUsePlan` records the exact runtime names visible to a compiler-created declaration and its uses. It also records fixed dynamic-import locals and raw-syntax barriers. `NamePlan` allocates names from those facts. The other plans preserve evaluation order and select `const` only for initialized bindings with no typed writes. |
| Reusable-library retention | `src/genes/LibraryProfile.hx` | Opts public package APIs into matched TS/classic/declaration surfaces without making every build library-shaped. |
| Imported constructor instance/type identity | `src/genes/ExternTypeContract.hx` | Models value-derived constructor instances without downstream-specific import rules. Explicit metadata also keeps package-backed native `String`/`RegExp` values from being mistaken for host built-ins in public types. |
| Type-reference projection and retention | `src/genes/TypeReferenceCollector.hx`, `src/genes/dts/TypeEmitter.hx`, `TypeUtil.enumConstructorApplication` | Keeps named Haxe declarations keyed by compiler-owned module/type identity, never by an unqualified spelling. The collector mirrors every type the printers may name, including destination-applied enum payloads, so an emitter cannot invent an unplanned import or weaken a missing declaration to `any`. |
| TypeScript null-narrowing proof | `src/genes/ts/TsNarrowingPlan.hx` | Derives function-local null and map-presence facts from `TypedExpr`, then ends them after exact receiver/key assignment, `Map.remove`/`clear`, loop mutation, or a nested function boundary. It carries typed identities and no output text; the [ownership inventory](TS_NARROWING_OWNERSHIP.md) records the bounded design and evidence. |
| TypeScript value-boundary projection | `src/genes/ts/TsBoundaryPlan.hx` | Records the exceptional returns, initializers, assignments, call arguments, constructor arguments, enum-constructor arguments and payload reads left by erased matches, native-host callbacks, and typed bindings after opaque Haxe runtime guards that strict TypeScript needs stated explicitly. It also exposes every assertion target to dependency planning before import aliases are allocated. |
| TypeScript indexed-access projection | `src/genes/ts/TsIndexedAccessPlan.hx` | Inventories each exact typed array read and indexed write/update role before printing. Receiver presence, missing-slot presence, primitive operator coercion, writable-target compatibility, transparent target wrappers, and consumed-versus-discarded operation results are separate immutable decisions. Haxe 4.3 cannot carry retained logical/nullish indexed assignments or transparent target wrappers into the generated program, so those forms remain classifier-only and production admission fails closed until an emission-level fixture exists. Narrow Haxe-runtime exceptions use the exact registry-root grammar or standard-library argument identity; they never authorize a general unresolved target. The TypeScript emitter consumes admitted decisions as syntax and does not reclassify indexed expressions while printing. Classic JavaScript never requests the plan. |
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

### JavaScript stdlib overlays

Genes normally consumes the standard library from the pinned Haxe
distribution. When a JavaScript-specific implementation erases type evidence
needed for honest Genes output, the compiler distribution may carry a
platform-specific module under `src/**/<Module>.js.hx`.

The `.js.hx` suffix is intentional: TypeScript-readable and classic Genes
output are profiles of Haxe's JavaScript target, not a separate Haxe `ts`
target. Genes' `src/` classpath precedes Haxe's stdlib when consumers use
`-lib genes-ts`, so Haxe's normal platform lookup selects the overlay in both
profiles.

This adopts the same ownership principle used by Reflaxe compilers—target
stdlib corrections belong to the compiler distribution—without Reflaxe's
`_std` to `.cross.hx` packaging. Genes remains on Haxe's native `js` target and
does not need a custom bootstrap layer.

Haxe's default `-dce std` also uses the stdlib source path to decide which
classes receive field-level dead-code elimination. A copied class under
`genes-ts/src/` loses that path-based classification. Reviewed overlays restore
it with Haxe's class-level `@:dce` metadata, recorded as an exact manifest
edit. Tests must use `-dce std` and prove that used members survive while
unused members do not leak into generated TypeScript. `-dce full` is useful as
a separate complete-module parity control, but it cannot stand in for the
consumer's default behavior.

Because classpath replacement owns a whole Haxe module,
`config/stdlib-overrides.json` pins the upstream Haxe revision, source hash,
formatter-canonical hash, local hash, and every allowed exact replacement.
Each module also needs a semantic fixture, fail-closed controls, both output
profiles, standard-Haxe runtime parity, source maps, compiler-server isolation,
and packaged Haxelib/Lix selection. See
[`STDLIB_OVERRIDES.md`](STDLIB_OVERRIDES.md) for the complete model and
[`tests/stdlib-overrides/README.md`](../tests/stdlib-overrides/README.md) for
the `haxe.io.Bytes` example.

`UnicodeString.js.hx` uses the same mechanism for Haxe's shared UTF-8 validator.
It replaces raw optional-cache reads with typed `Bytes.get` calls while keeping
the validation algorithm. The manifest admits only the exact module path in
`std/` or `std/js/_std/`; both sources are checked against the pinned Haxe tree.
This does not relax the unsafe-buffer controls described below.

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
the original untyped property access plus compiler-owned evidence for the
runtime convention:

- the exact `haxe.io.Bytes.Bytes.ofData` implementation may turn its nullable
  `hxBytes` lookup into `?? null` followed by an exact `Bytes | null` identity
  assertion; and
- a `bufferValue` read from the exact private storage field of a typed
  `haxe.io.Bytes` instance receives a presence assertion plus the exact
  compiler-known `ArrayBuffer` destination.

The optional `bytes` cache is declared so Haxe and hxnodejs runtime writes are
legal TypeScript, but reads are not asserted. `Bytes.fastGet` is normally
inlined before Genes sees the typed AST, erasing the API identity that would
prove initialization. A spelling-only rule would incorrectly bless
`new ArrayBuffer(1).bytes[0]`, whose cache is genuinely absent.

When `Bytes.fastGet` is unused, the Genes stdlib overlay's `@:dce` marker lets
default `-dce std` prune it just as Haxe does for the official std-path module.
When a program explicitly calls the inline helper, its raw read still survives
at the call site and remains fail-closed. DCE parity does not create new typed
evidence for an assertion.

The same plan models the exact hxnodejs
`js.node.buffer.Buffer.Helper.bytesOfBuffer` implementation of
`Object.create(Bytes.prototype)`. It asserts the returned local as `Bytes` only
when the exact prototype class matches the declared return type and the local
has not been reassigned. A different prototype, reassigned local, unrelated
dynamic receiver, or same-named user field receives no decision. Every
assertion type is collected before import projection, classic JavaScript
remains unchanged, and the complete beginner-facing examples and negative
controls live in
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

Inline expansion can expose the same principle at a single local-variable
read. For example, Haxe may preserve evaluation order for an inline receiver
call by introducing a nullable temporary:

```haxe
receiver.push(build(value));

// Conceptual typed lowering:
var temporary:Null<Receiver> = receiver;
var built = build(value);
temporary.push(built);
```

The temporary declaration remains nullable, but Haxe can retag the exact later
read as `Receiver`. `TsBoundaryPlan` records that original read node only, and
TypeScript emission preserves the distinction:

```ts
const temporary: Receiver | null = this.receiver;
const built: number = this.build(value);
temporary!.values.push(built);
```

Here `!` is TypeScript's compile-time-only non-null assertion. It emits no
JavaScript and does not make the binding globally non-null. Genes requires
exact type identity after removing only the declaration's outer Haxe `Null`;
dynamic, unknown, undefinable, unresolved, unrelated, and ordinary nullable
reads receive no decision. The executable examples and negative controls live
in
[`tests/nullable-temp-receivers/README.md`](../tests/nullable-temp-receivers/README.md).

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

A declared method or module-function return may retain a closed enum-abstract
argument that full DCE erases from the executable tree. The boundary planner
binds the existing captured return signature to that exact function expression.
It carries this source destination through returns and their conditional,
switch, block, try, and transparent-wrapper result slots. A constructor of the
same enum can then print the captured generic parameters. The lowered call
still owns argument/nullability conversions; source spelling is not new flow
proof. Entering a nested function resets the return context, so an outer
method cannot specialize an unrelated callback. This does not recover source
signatures for arbitrary anonymous callbacks or invent new inference facts.

### Enum payload reads after Haxe erases a match

Haxe can also prove that generic parameters make every enum constructor except
one impossible. It may then erase an authored one-case match:

```haxe
static function result(
    value:Reduction<Int, Never, Never, String>):String {
  return switch value {
    case Reduced(result): result;
  };
}
```

The final typed Haxe tree keeps an exact `TEnumParameter` payload-read node, but
the emitted TypeScript enum remains the complete public union. A direct read
therefore fails with `TS2339` because the other variants have no `result`
property:

```ts
// Before: strict TypeScript still sees every Reduction variant.
return value.result;
```

`TsBoundaryPlan` records the constructor view before dependency projection,
and the TypeScript emitter consumes that immutable decision:

```ts
return Register.unsafeCast<
  Reduction.Reduced<number, Never, Never, string>
>(value).result;
```

`unsafeCast` evaluates `value` once and returns the same runtime value. It
neither converts nor validates the payload; the generic argument carries only
the constructor fact Haxe already proved. If Haxe retains a visible
`switch (value._hx_index)`, native TypeScript control-flow narrowing owns the
read and Genes emits no assertion.

Authorization comes from the final typed expression, exact constructor slot,
applied receiver/result types, and the constructor's checked enum owner.
Declaration correlation uses Haxe's compiler-owned fully qualified
module/type coordinates. The shared exact-type comparison may use its
documented request-local source-range fallback only when Haxe re-encodes one
type parameter through multiple wrapper objects. Generated property text,
unqualified names, framework types, and TypeScript diagnostics provide no
authority. Dynamic or unresolved receivers, invalid payload slots,
constructor-local generic parameters, and same-named constructors from another
enum fail closed.

Every type printed by the constructor view is collected before import aliases
are allocated, including a type named nowhere else in the consuming module.
The dependency-free fixture verifies that import, single evaluation,
TypeScript 5/6/7, runtime parity, unchanged classic JavaScript, source maps,
ordinary switch narrowing, and the fail-closed cases:

```sh
yarn test:enum-payload-narrowing
```

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
- **module state** includes dependency, JSX, template, native-async, narrowing,
  TypeScript value-boundary, lexical-binding, temporary, naming, and projection
  plans.
  `Module.addTypes` invalidates plans whose typed inputs can expand through
  declaration reachability;
- **emitter state** includes writers, source-map buffers, and syntax-local
  stacks. It is constructed for one artifact and never cached across requests;
- **filesystem state** includes public output and ownership manifests.
  `OutputTransaction` is request-local, while the manifest deliberately
  survives as exact evidence for later stale-file cleanup.

Concrete rules follow from those lifetimes:

- typed carriers may survive Haxe typing caches only when they contain stable,
  profile-independent facts; `DynamicImportMarker` carries an extension-free
  path and authored position, while `ExplicitTypeArgumentCallSite` carries
  inert occurrence-local witness types. `NativeAsyncMarker` carries one exact
  anonymous function or return payload, and `NativeAsyncPlan` validates its
  function context for the current module. The active emitter chooses `.js`,
  `.mjs`, or no dynamic-import suffix from the current generation;
- a typed carrier must be self-contained when Haxe can reuse it. An ordinary
  macro static map is not a valid companion store: the generator may execute
  in a different macro context, and a persistent map would retain typed
  objects without a safe eviction boundary;
- `@:genes.generate` metadata is a request-membership stamp. Cached declarations
  may retain older stamps, so generation checks for the current stamp instead
  of requiring the metadata list to contain exactly one entry. Only the classic
  profile reads it (`needsGen`); the TypeScript profile does not stamp a class
  that gets `__rtti` (the class or a parent has `@:rtti`), because Haxe prints
  class metadata into `__rtti` and the request number would differ between a
  cold and a warm build;
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
| `Generator.generation` and `@:genes.generate` | Process-visible request stamp (it grows within one macro interpreter and starts again in a new one) used only to decide which typed modules participated in the current generation. | The request's `onGenerate` callback increments the stamp and adds it to each current type, except, in the TypeScript profile, to classes that get `__rtti`. Only the classic profile reads the stamp (`needsGen`). A module matches when **any** metadata entry has the current number; older entries on a Haxe-cached declaration are ignored. A failed request cannot make an old stamp current again. | `yarn test:compiler-server` |
| `Generator.configuredOutputFile` and `compilerSentinelFile` | Installation-time paths that isolate Haxe's own `-js` cleanup from Genes' public output transaction. | `Generator.use` calls `isolateCompilerOutput` for the current request. The request-local `genes.output` define may replace the HXML destination before capture; no process registry carries the choice. Genes snapshots both that value and the `genes.ts` profile because together they select legal syntax and suffixes, then rejects later macro mutation before opening a writer. The selected destination owns the output, while a SHA-256 of its absolute path identifies Haxe's private sentinel. Normal completion, generator failure, and the after-generate hook remove the sentinel. Public publication still belongs only to `OutputTransaction`. | `yarn test:output-transaction`; `yarn test:compiler-server` |
| `ModuleDirectivePlan` | Request-local ordered module-prologue facts stored in `@:persistent` maps because capture happens before generation. | Every `install()` replaces all maps and the finalized flag, then registers the current request's `onAfterTyping` capture. Full typed module/field owner keys establish identity; source positions only order directives. Validation fails before emitters open. | `yarn test:module-directives`; `yarn test:compiler-server` |
| `TypedModuleInventory` | Request-local list of every typed declaration, grouped by Haxe module. It answers "which declarations does this module contain?" during generation, so that Genes does not look a module up by name. A lookup by name (`Context.getModule`, `Context.getType`) makes Haxe record a module dependency that stays in the compilation server; the next one-file edit then makes Haxe type unrelated modules again. | `Generator.use()` calls `install()` once in a request, also when the macro runs twice, so each declaration is collected once. `install()` replaces the arrays before registering `onAfterTyping`. The Haxe module path is the key, and the order is Haxe's own module order, so an answer equals `Context.getModule`. A module that is not in the inventory is looked up by name, which keeps the answer correct. Only a request that defines `CompilerInternal.GENERATOR_ACTIVE_DEFINE` reads the arrays, so a request without Genes cannot receive declarations of an earlier request. | `yarn test:compiler-server` (retyped-module case) |
| `PublicSurface` | Request-local pre-DCE public API records, including compiler-owned `Type` values needed by TS and declarations. | Every `install()` replaces the map before it adds its capture to the shared `AfterTypingPasses` walk. Full Haxe module/type identity is the key; consumers substitute current type parameters. Post-DCE fallback capture is confined to the current map. | `yarn test:library-profile`; `yarn test:compiler-server` |
| `genes.ts.SignatureCache` | Request-local pre-DCE signature and enum-abstract facts used when later JS-oriented typing has erased a precise TS surface. It contains compiler-owned `Type` values. The maps (`SignatureFacts`) are a result of each request. Only with `-D genes.dev_incremental`, the facts of each declaration are also kept as one bucket in `KeptBuckets` (row below), and the capture also keeps the metadata holders of each typed body (the constructor, fields and the class initializer): the type parameters of each local function and each declared type of a local variable or argument that holds an anonymous structure (`LocalTypeParameters`, `LocalDeclaredType`; genes-f8vc.9.27). `localTypeParameters` (the only reader of `TVar.extra`) and `localDeclaredType` record their metadata text as answers of the generation replay, and `factAnswer` gives it again. | Every `install()` replaces the set of maps before it adds its capture to the shared `AfterTypingPasses` walk. The capture of one declaration is a list of `SignatureFact` values, and `SignatureFacts.put` is the only writer. With reuse on (`afterTyping: "reuse"`), a declaration whose bucket passes the keep rule is not read: its facts are put back at its place in the declaration order, so the maps equal the maps of a capture of every declaration, also when two declarations write one key. A capture that reaches the depth limit of 64 writes no bucket, and a request that put buckets back then captures every declaration again. In compare mode the getters compare each answer of the kept buckets with the new capture (`SignatureComparison`) and the output uses the new capture. Named declarations use full owner identity; anonymous/local entries use source positions or `TVar.id`. Without the define these keys live only inside that reset boundary; with it, a kept bucket carries them to a later request, and the keep rule plus the commit step of `KeptRecords` decide when they are still valid (a declaration that Haxe typed again has new ids and loses its bucket). A cached source type is printed through the normal type emitter, not a second renderer. The same reset replaces `declarationAnswers`, a map of strings and integers that answers once per request whether the own body of an abstract or typedef contains an enum abstract. Type arguments are checked for every use and are never part of an answer. A "no" is stored only after a complete outermost walk that found nothing; a "yes" only for a declaration without type parameters. The answers are exact except near the depth limit of 64, where a cached "yes" can answer a lookup that the old walk cut off (reproducer: a 31-typedef chain that puts a generic typedef at depth 63; the emitted TypeScript was byte-identical). The capture asks for the literal spelling of a type (`"a" | "b"`) only when that walk found an enum abstract in it or stopped at the depth limit; every other type has no literal spelling. | `yarn test:types:exports`; `yarn test` (`tests.signaturecache.EnumAbstractAnswersProbe`); `yarn test:compiler-server`; `yarn test:compiler-server:after-typing` (reuse and compare) |
| `AfterTypingPasses` and `AfterTypingClass` | One `onAfterTyping` walk that `PublicSurface`, `SignatureCache` and `ReactDiagnosticsMacro` share, so that the macro interpreter copies the field list and each typed field body of a class once per request instead of once per pass. `AfterTypingClass` holds compiler-owned `ClassField` and `TypedExpr` values for one class, and the stamp and the declaration reference of the class when the request uses the incremental path. | The pass lists are ordinary statics, so Haxe replaces them at the start of each compilation and each `install()` adds its functions again. The walk first calls `GenerationChangeSet.observe` (it does nothing without `-D genes.dev_incremental`), so every stamp exists before the first pass. On that path it also reads one clock for each pass, by the name that the pass gave to `add`, for the `passTimes` of the after-typing report; without the define no clock is read. Then it makes one `AfterTypingClass` for a class, gives it to every pass, and drops it before the next class; nothing is kept after the callback returns. `ModuleDirectivePlan` and `TypedModuleInventory` keep `onAfterTyping` callbacks of their own: `Context.error` ends only the callback that calls it, so an error of a pass must not stop their capture, and their errors keep Haxe's callback order. Inside one class the key of a body is the static flag and the field name; overload signatures share a name and are never read through it. A post-DCE `PublicSurface` fallback capture reads the class directly. | `yarn test:react-hooks`; `yarn test:library-profile`; `yarn test:compiler-server`; `yarn test:compiler-server:after-typing` (lane `diagnostic-order`) |
| `HaxePrinterUse` | The one record of the modules that reached Haxe's own JavaScript printer in one request. Two readers share it: the opt-in report file and the incremental shadow (`IncrementalShadow`, which calls `record()` and has no counter of its own). It holds the report path, a flag for the shadow and two sets of module names; it holds no typed compiler value. | The fields are ordinary statics, so Haxe replaces them at the start of each compilation; the init macro `HaxePrinterUse.report(file)` also replaces them and registers the after-generation callback of its own request. The Haxe module path is the key. A request without the init macro and without the shadow records nothing; only the init macro writes a file. The file is written only after a successful generation, outside the output transaction. | `yarn test:syntax-code-forms` (cold and two warm requests) |
| `genes.react.ReactDiagnosticsMacro` and `ReactAnalyzerFunctionMacro` | Compilation-local callback installation for typed React placement/purity diagnostics and analyzer-visible function metadata. They keep no typed value between requests. Only with `-D genes.dev_incremental`, the audit keeps one plain record for each clean class in `KeptRecords` (next rows). | Haxe resets the ordinary module `installed` guards per compilation; each request installs its global build metadata and adds its audit to the shared `AfterTypingPasses` walk exactly once. The whole-server sequence installs both passes on every cold and warm request so callback lifecycle errors change the output or diagnostics rather than remaining hidden behind a one-shot React fixture. | `yarn test:react-hooks`; `yarn test:compiler-server` |
| Explicit type-argument carriers | Occurrence-local typed facts for `TypeArguments.call` and `@:ts.explicitTypeArguments`; deliberately **no** process registry exists. | The exact typed call occurrence carries inert witness types. Emitters revalidate the declaration and erase the carrier. Neither copied positions nor same-named projects can retrieve another occurrence's fact, and a cached typed tree remains self-contained. | `yarn test:explicit-type-arguments`; `yarn test:compiler-server` |
| `TypeUtil.registerType` / `bootType` | Request-local compiler-owned helper declaration references used by dependency planning. | The first `Generator.use()` in every compilation replaces both references; the request-local active-generator define prevents duplicate refreshes when the macro is invoked again in that same compilation. Haxe 4 resolves them immediately at that proven macro point; Haxe 5 schedules the same refresh in the current request's `onAfterInitMacros`, when lookups are legal. They are never indexed by emitted spelling or retained as immutable process-lifetime typed objects. Intrinsic-first and direct-import-first warm HXX sequences prove that a field-level `@:jsRequire` request cannot poison the next request; the whole-server matrix and preview's separate advisory post-DCE variance remain visible. | `yarn test:genes-ts:source-inline-server`; `yarn test:compiler-server` |
| `TypeUtil.generationBaseTypeNames` | Answers of `TypeUtil.baseTypeName` for one generation: Haxe module path, then declaration name, then the name that Genes prints. Text only; it holds no compiler-owned value. Without it, each call reads every declaration of the module again (110,000 calls and about 3 seconds in each generation of one application with 1,100 modules). | `Generator.generateTransactional` starts a new empty map with `TypeUtil.startGenerationNames()`, when typing and Haxe's filters are complete; before that call the function searches on every call, because Haxe's filter step still renames a `@:native` class. The map then stays set until the next request that installs Genes: its first `Generator.use()` calls `TypeUtil.refreshCompilerTypes`, which sets the map to `null`, also after a failed generation. A request that does not install Genes does not run this code. The module path and the name are the complete key: during generation Genes changes no declaration name, kind, or `@:native` metadata, and the declaration list of a module is fixed. Two renamed `@:native` classes of one module can share a name; the search compares only the module and the name, so both already get the same answer. | `yarn test` (`tests.generationcaches.GenerationCachesProbe`); `yarn test:compiler-server` |
| `ExplicitTypeArgumentDeclarations` | For one generation: the fields of a class that carry `@:ts.explicitTypeArguments` and declare type parameters, in declaration order, for each side (static or instance). It holds compiler-owned `ClassField` values. Without it, `ExplicitTypeArguments.forCall` reads the complete field list of the owner class for every direct call (15,000 calls and 1.8 seconds in each generation of one application). | Nothing is static. `Generator.generateTransactional` creates one catalog for one `generate` call and gives it to its modules through `ModuleContext`, like `JsxProviderSchemaCatalog`; a warm server starts every request with an empty one. The key is the side and a text that names exactly one class. For a class without `@:native` the text is the Haxe module and the class name. Haxe renames a class with `@:native("Lib")` to `Lib` before generation, so two such classes of one module then share a module and a name; for them the text is the declared path that Haxe records in `@:realPath`. A `@:native` class without a readable `@:realPath`, and a type parameter (two can share a module and a name), never use the catalog. During generation the fields of a class and their metadata do not change. A caller without a catalog, or a class without a text, reads the field list on every call. | `yarn test:explicit-type-arguments` (native twins, both orders); `yarn test` (`tests.generationcaches.GenerationCachesProbe`); `yarn test:compiler-server` |
| `CompilerInternal.GENERATOR_ACTIVE_DEFINE` | Compilation-local capability proving that the active JS request installed Genes and can consume compiler-only carriers. | `Generator.use` defines it only in the JS, non-`genes.disable` branch. A disabled or non-JS request must fail at the carrier boundary and publish nothing; it may not inherit capability from an earlier warm request. | `yarn test:compiler-server` |
| `TypeEmitter.emittingCapturedSourceType` | Narrow printer dynamic scope, not a semantic cache. It permits a retained source type to preserve enum-abstract literals while that one type is printed. | `emitCapturedSourceType` saves and restores the previous Boolean on success and on `haxe.Exception`. It carries no declaration key and must never remain enabled for a later type or request. The rollback probe directly proves that the supported stable and preview macro runtimes wrap an intentionally thrown plain Haxe string as `haxe.Exception` at the outer transaction boundary. That runtime behavior also supports this narrow typed catch, although the probe does not inject the throw while this flag is enabled. | `yarn test:types:exports`; `yarn test:compiler-server:rollback`; `yarn test:compiler-server` |
| `JsonTypeSupport.JsonTypeQuery` and `JsonTypeDefinitionAnswers` | JSON reachability query of one module inventory. The query keeps its search path; `JsonTypeDefinitionAnswers` keeps the completed answers for abstracts and typedefs (text and Booleans only, no compiler-owned value) for one generation, so that the next module does not read and search the same declaration again (about 100,000 declaration copies in each generation of one application with 1,100 modules). | Nothing is static. `Generator.generateTransactional` creates one `JsonTypeDefinitionAnswers` for one `generate` call and gives it to its modules through `ModuleContext`, like `JsxProviderSchemaCatalog`; a warm server starts every request with empty maps. The key is the kind (one map for abstracts, one for typedefs) and the dotted path of the declaration (`ref.toString()`): Haxe allows one declaration for each path and does not rename abstracts or typedefs. Every application scans its actual type arguments before the lookup. A true answer can enter the maps at any depth. A false answer enters them only after a search that started at that declaration, so it does not depend on the module that asked. An active cycle returns an uncached false answer. During generation the underlying type of a declaration does not change. A query without shared answers (a context without them, or a public one-off type query) keeps them for itself only. | `yarn test` (`tests.generationcaches.GenerationCachesProbe`, a typedef cycle in both orders); `yarn test:genes-ts:snapshots`; `yarn test:classic:dts`; `yarn test:compiler-server` |
| `Module` lazy plans | Module-local typed facts: dependency/projection, JSON-support presence, JSX, React State projection, template literals, TS narrowing, TS indexed access, lexical bindings, temp, local binding, module-function, closed module-value, naming, and cycle plans. | Each `Module` owns its maps and compiler refs. `Module.addTypes` clears every plan whose inputs can grow when type/declaration reachability materializes more types, including the cached JSON-support Boolean. A stale negative must not suppress aliases required by a same-module declaration-only type. `LexicalBindingUsePlan` stays unbuilt until a synthetic-name consumer requests it. One scope walk records exact typed-expression identities, profile projections, and opaque syntax. Direct-binding plans first scan retained metadata; a module with neither direct-binding marker receives empty request-local plans without building collision, name, or temporary inventories. Any marker, including malformed metadata, keeps complete validation. React State projection remains lazy and request-local. `ModuleValuePlan` accepts only closed literal data and exact earlier-value references, so it needs no process cache or call analysis. `TemplateLiteralPlan` is intentionally retained: late-only types have already lost executable bodies to Haxe DCE, while a retained body is present in the initial generator inventory. No plan or `TypedExpr` object is stored process-wide. | `yarn test:lexical-binding-use-plan`; `yarn test:module-functions`; `yarn test:classic:dts`; `yarn test:template-literals`; `yarn test:react-hooks`; `yarn test:array-index-strict`; `yarn test:output-quality`; `yarn test:compiler-server` |
| `genes.incremental.IncrementalRequest` | Request-local answer to "may this request use the incremental path?" for `-D genes.dev_incremental=<descriptor path>`, and the one descriptor that every consumer reads. Off by default. | An ordinary static, so Haxe replaces it at the start of each compilation; the descriptor (`{"format": 1, "programDigest", "kind": "full", "afterTyping": "measure" \| "reuse" \| "compare", "generation": "measure" \| "compare" \| "reuse", "moduleRecords": true}`; the last three optional; a module request has `"kind": "module", "module": "<module path>"`, see `ModuleRequest`) is read at most once per request. `"generation": "compare"` and `"reuse"` need `"afterTyping": "reuse"`; otherwise `generationRefusal` gives the typed reason `NeedsAfterTypingReuse` (code `<generation>-needs-after-typing-reuse`), the generator keeps, compares and replays nothing, and the passes after typing keep their mode. Without the define the answer is `Absent` and no other incremental owner runs. A Haxe version other than 4.3.7, a display request, a request without the Genes generator, a profile other than TS/TSX, `-D dts`, `-D source_map_content`, `-D no-macro-cache`, an unreadable descriptor, an unknown format, kind, `afterTyping` or `generation` value, or an `@:rtti` class gives `Off`: full work, no stamp, every kept record and the generation cache left as they are. The mode is one answer for all consumers: the passes after typing read `afterTyping`, the generation shadow reads `generation`, and neither decides eligibility. `-xml` and module check policies are invisible to a macro; the session must not combine them with the define. | `yarn test:compiler-server:after-typing`; `yarn test:compiler-server:shadow` |
| `genes.incremental.GenerationChangeSet` and `@:genes.typedEpoch` | The one owner of the stamps, the session key and the change set of a request (design review R5). For one request: how each declaration arrived (typed again, kept, or with a stamp of another declaration), the epoch list of each module, the modules typed again, the session key, and the keep rule that every record must pass. The stamp `@:genes.typedEpoch(nonce, N, key)` lives on the declaration in Haxe's cache. Process state: the nonce, the request counter, the last session key, the metadata digest of each module and the metadata epoch, all plain text or numbers. It holds no typed value after the callback returns. | Filled at the start of `AfterTypingPasses.run`, the callback of the passes, before any pass and before generation; the walk gives each pass the stamp of every declaration. Its readers are the passes after typing (`KeptRecords`, `KeptBuckets`) and the generation shadow (`IncrementalShadow`, `GenerationCache`); no reader adds a stamp or builds a key. `nonce` names one life of the macro interpreter; a stamp of an earlier interpreter stays valid as the name of that object. A stamp counts only on the declaration that `key` names; a copied or unreadable stamp is replaced. The session key (format, Haxe version, every define at the first after-typing callback, the session's program digest, the output file name and the way from the output folder to the project root (`outputKeyLines`; never the absolute output path, which changes with each candidate folder of a development session), class paths in order, working folder, the name and a digest of the content of each embedded resource, status of each `.hx` file under the Genes class path, and the metadata epoch) is computed once per request, after the first declaration list is stamped. The metadata epoch grows when a declaration that kept its stamp has other metadata than in the earlier request (`compareMetadata`: the metadata of every declaration, field, constructor, enum constructor and type parameter, and of the structures of declared types, before dead-code elimination, compared line by line for each declaration, so that a declaration that Haxe adds to a kept module does not hide a change of the others; `:keep` is left out, because Genes adds it later in the same callback; metadata that something else adds after the callback, such as an `onGenerate` macro or `-D analyzer-optimize`, makes one request fall back each time Haxe types the module). Example: a macro writes `@:value` on a static of an enum abstract that dead-code elimination removes; `SignatureCache` keeps the literal union that it read from it (genes-f8vc.9.27, M2b). When the key differs, every record of every pass is dropped and the generation cache does not use its stored output. The digest of the names that Haxe's local-rename filter reserves is collected only when the descriptor has a `generation` value. The same-object test of the keep rule (`sameObject`) runs for each bucket of `KeptBuckets` whose stamp agrees: it adds one metadata entry through the kept declaration reference, reads it through the reference of this request, and removes it. A plain record has no reference and no such test. Each test answer and each new bucket is recorded per declaration for this request (`recordSameObject`, `recordBucketWritten`); the generation cache reads them as same-object proofs (`declarationProofs`, `sameObjectFailures`) to close the copied-stamp hole. Without the define nothing is stamped. | `yarn test:compiler-server:after-typing` (also `KeepRuleProbe`: each condition on its own; an `@:rtti` program leaves the path; step "a macro-defined type with its own earlier stamp": only the same-object test rejects the bucket); `yarn test:compiler-server:kept-types` (rows E1 to E3); `yarn test:compiler-server:shadow` (G2 probe: no stamp without the define; `CleanRuleProbe`: output lines of the key; edits "output in a sibling folder" and "at another depth") |
| `genes.incremental.KeptRecords` | `@:persistent` plain records of the passes after typing, one store for each pass. A record is two texts and one number: the stamp of the declaration, the member list of a class, and the request that wrote it. No `Type`, no typed expression, no declaration reference. The React audit has a store of its own (`reactAudit`); each store of `KeptBuckets` keeps its records here (`signatureCache`). | A pass asks `decide` before it skips a class and calls `write` only after its work for that class returned an explicit clean result in this request. A changed session key drops every store. A record is replaced by the next write for its key; a record of a class that left the program stays and can be kept again only for the same class object with the same stamp. Commit step: a changed record (and every record of a bucket) waits on a pending list until the `onAfterGenerate` callback of its request; at the start of the next request a record that is still pending is removed (`uncommitted` in the report), because a failed request can write a record for a declaration that it did not type (case F2 of `docs/INCREMENTAL_AFTER_TYPING.md`). The counters belong to one request. | `yarn test:compiler-server:after-typing` (warm equals cold in `measure`, `reuse` and `compare`; kept and skipped above 0; zero compare failures) |
| `genes.incremental.KeptBuckets` | The only owner that keeps compiler-owned typed values between requests, and only with `-D genes.dev_incremental`. One store for each pass; today `genes.ts.SignatureCache` (`signatureCache`). A bucket holds the values that the pass read from one declaration (for `SignatureCache`: its `SignatureFact` list, with `Type` values and local variable ids) and the declaration reference of the request that made it. The pass keeps its store in one `@:persistent` field. | `kept` returns a bucket only when the whole keep rule of `GenerationChangeSet` holds: eligible request, same session key, one stamp that names the declaration, stamp equal to the bucket's stamp, the same-object test, and for a class the same member list. Else the pass reads the declaration and writes a new bucket. Kept values are read-only; only the same-object test writes metadata, and it removes its entry again. A changed session key drops every bucket. A bucket of a declaration that is absent from the program is never returned and is removed after 8 requests. Commit step: a bucket counts only when its request reached the end of generation. A failed request can replace the bucket of a declaration that it did not type (the first use of a `@:generic` method adds a member to a kept class, case F2); the next request finds no record for it, rejects the bucket (`noRecord`) and removes it. A request that is not eligible reads and writes nothing. | `yarn test:compiler-server:after-typing` (every warm tree equals cold in `measure`, `reuse` and `compare`; kept buckets, skipped captures, same-object tests and compared answers above 0; zero compare failures; rejects for the member list, a copied stamp and another object; lane `late-facts`: case F2 drops the bucket of a failed request) |
| `genes.incremental.GenerationCache` | `@:persistent` plain-data result of the last successful generation for one session key: per emitted module the epoch list, the shallow fingerprint (declarations, kept fields and their kinds, and the metadata of declarations, fields, constructors, overloads and enum constructors with its arguments, as a set; also the metadata of each field of an anonymous structure that a typedef body, a declaration type or a type-parameter constraint writes inline, and the metadata of each type parameter that a declaration or a field of such a structure declares (not one that only a typed body declares, such as a local function's: the recorded answers below check those); for a module of extern classes only, the class metadata and a digest of the field metadata; for the declarations that are in no generator list, such as a class that dead-code elimination removed, one digest of the same text for each module, so that a module whose declarations were all removed also has a fingerprint (`ModuleFingerprint.unlisted`, genes-f8vc.9.27); `ModuleFingerprint.EXCLUDED_META` lists the names left out and why), the modules it read by name with their epochs, the "used Haxe's printer" flag, the exact staged text of its files, the warnings that the printer reported for it (text and position as numbers), the same-object proofs of its declarations, its final member list (with the fingerprint text of each member that the walk added although dead-code elimination removed it) and root flags, the answers that it asked (feature flags, module-function owners in the module map, import cycles through `Module.isCyclic`, position-keyed `SignatureCache` facts of anonymous-structure fields, which the capture of another module's declaration can write, and the metadata text of each holder that only one of its typed bodies declares or names: the type parameters of a local function and the structures of the declared type of a local variable or argument, keyed by class and variable id, genes-f8vc.9.27) with the features that it added, its public entries, the sources that its maps name by a relative path, the visits of the reachability walk to it (for each member list at the start of a visit, the steps as plain `WalkStep` text with the stamp and the target facts of each target declaration, from `WalkTarget.inputsText`) and its internal runtime requests (slice S2); the epochs and fingerprint of each module without an output file; the absolute output folder; and whether `afterTyping` was `"reuse"`. No typed value. | Written only after `OutputTransaction.commit` returned, and only by a request whose descriptor has a `generation` value that is not refused, with no lookup by name during generation. A module whose epoch list is empty (no declaration stamp observed after typing), or that read such a module by name, is never clean; two empty lists are equal text but prove nothing. It compares the session key of `GenerationChangeSet` with the key of the stored result; with a different key every module is dirty, and the next successful shadow request replaces the stored result; a changed digest of the names that Haxe's local-rename filter reserves is reported (`reservedNamesChanged`); the fixture showed no warm/cold difference for it, so it triggers no `restart-required` result yet. Above 64 MB it is dropped. A changed resource file changes the session key, because `haxe.Resource` prints the resource bytes and Haxe types no module again. A request in which a macro changes the resources after typing neither reads nor writes the cache. Clean also needs: equal same-object proofs (a failed test anywhere falls back), no stored map source inside a folder where the stored and current output paths part, no answer about a feature that emission adds (`EMISSION_FEATURES`), and no answer that no later request can ask again (`UNKNOWN_ANSWER`, rule 11; such a module is only dirty). Rule 6 also reads the modules without an output file, and decides "left the program" from this request. Compare and reuse use only a cache written with afterTyping `"reuse"`. A replayed module keeps its stored entry, except after a difference of the rolling replay audit (`IncrementalShadow.auditModule`): that request stores nothing and drops the whole cache, so a stale entry cannot stay until Haxe types its module again. | `yarn test:compiler-server:shadow` (G1 in compare and reuse; `CleanRuleProbe`; the L3 rows for the audit) |
| `genes.incremental.IncrementalShadow` | One request's incremental generator: per-module clocks for each generator stage (inventory, reachability, validation, emit, replay), the recorded steps of each live visit of the reachability walk and the stored steps that clean modules take instead (slice S2), staged text recorded through `OutputTransaction.onRegister`, printer use, the warnings that the printer reports (`printWarning`, called by `ExprEmitter.warnLegacyJs`), the feature, module-exists and import-cycle answers and feature additions of each module (`Module.hasFeature`, `Module.createContext`, `Module.resolveModuleFunction`, `Module.isCyclic`), the recorded `SignatureCache` facts that it read (`recordFact`: facts of anonymous-structure fields, and the metadata of body holders through `SignatureCache.localTypeParameters` and `localDeclaredType`), map sources (`SourceMapGenerator`), member lists, the keys of the declarations in the generator's list (text; `listed`, read by `ModuleFingerprint.members`), root flags and public entries, the replay plan, and the report beside the descriptor. | Created by `Generator.generate` only when the request descriptor has a `generation` value (`"measure"`: clean rules and stored files; `"compare"`: also the comparison of every module that reuse would replay; `"reuse"`: such modules skip both validation loops and emission, and their stored files, warnings, public entries and feature additions are staged in sorted order; compare and reuse need `"afterTyping": "reuse"`); an ordinary static, cleared when the request commits or fails. With `"compare"` or `"reuse"` and a clean set, the walk first takes the stored steps of each clean module for its member list at that visit (the queue and `Module.addTypes` are the live walk's code; a stored step that adds a declaration finds it by key in `TypedModuleInventory.declarationByKey` after an equal-stamp check, and every stored step first checks that its target declaration still has the recorded target facts (kind, extern flag, module, name and metadata, from `WalkTarget`), because an after-typing macro can change them without a new stamp, for example `exclude()` on an enum), and clean modules answer import-cycle questions from stored runtime requests (`Module.replayRuntimeRequests`). A visit whose member list the record lacks, a changed stamp or changed target facts, a missing member, any error, or a fallback of `planReplay` makes `Generator` run the request again from the inventory with new `Module` values, live edges and no clean module; `"compare"` always runs both walks and fails on any difference, and `"measure"` walks live and reports how often the stored walk would leave the recorded path (`walk` in the report). Every replay fallback is decided after the walk and before the first `api.addFeature` (`planReplay`): the final member list of every stored module that Haxe did not type again (also a dirty one), the answers asked outside any module, and for each clean module its root flags and every recorded answer, each asked again now (`SignatureCache.factAnswer` for the facts; a body holder is read through its kept reference, so a macro write after typing shows). It reads the mode, the epochs and the session key from `IncrementalRequest` and `GenerationChangeSet` and decides none of them. With `"reuse"`, after `OutputTransaction.commit` and before `committed`, the rolling replay audit (genes-f8vc.9.23) prints `audit.modules` replayed modules again into an `OutputTransaction.scratch` (memory only, never committed) with a feature function that adds nothing; while it prints, the per-module maps that printing records are new maps that are put back afterwards, and `auditing()` keeps `ExprEmitter.warnLegacyJs` from reporting a warning twice. A difference of files, warnings, added features or public entries warns `GENES-INCREMENTAL-AUDIT-001`, is reported in `audit`, and makes `committed` drop the cache. The new print uses this request's `Module` values, so it cannot see a stale fact that the request took from the cache (member lists, the module set and stored runtime requests of the walk with stored edges, kept after-typing facts); only the session's cold build sees those. A failed request writes a `failed` report and leaves the cache. The report is never inside the output tree. | `yarn test:compiler-server:shadow` (`--audit=all` by default; `--audit=off` shows the sticky stale entry) |
| `genes.incremental.ReplayAudit` | `@:persistent` plain data for one compiler server: for each module, the request number of its last audit by the rolling replay audit. `choose` is the pure rule: the module that waited longest first, a never-audited module before any other, equal waits ordered by a SHA-1 digest of the seed and the name, then the name. No typed value. | `select` records the request number of each chosen module. The map stays when the audit drops the generation cache, so the rotation goes on instead of starting again at the same first modules; only the probe calls `forget`. A module that left the program keeps its number; it is never chosen again unless it is replayed. | `yarn test` (`tests.replayaudit.ReplayAuditProbe`: order, seed, count, a full round within `ceil(R / k)` requests, and the descriptor field `audit`) |
| `genes.incremental.ModuleRequest` | Module requests (G3, genes-f8vc.14.2): a request whose descriptor has `"kind": "module", "module": "<path>"` is rooted at that module only (no `--main`), and Genes prints only that module and publishes its files only when they equal the files of a full build. Process state: plain-text records of the last full request with `"moduleRecords": true` (per emitted module: epochs, kept declarations and fields after DCE, uses of other modules with `__define_feature__` names, a digest of its use skeleton, and the shape before DCE), the proven content of every source file of that program and of the `import.hx` files that can apply to them, and of each file when Haxe last typed its module (`SourceContent`: the digest with the file status, that is size, modification time, change time and inode, kept only when the reads before and after the bytes are equal; kept only when the digest and the status read before typing equal the ones after typing, so a save and a revert in one second count as a change where the change time is finer than a second (APFS, ext4; not HFS+ or ext3); otherwise `unknown`, which refuses module requests and makes the next full request parse the file again; a changed `import.hx` makes it parse its folder again; a deleted file keeps `missing`, so a full request makes Haxe parse it only once; a file that Genes did not read before typing, such as a new module, is `unknown`; a file that Genes makes Haxe parse again before typing is `unknown` until that request proves it after typing (`unproveParsed`, genes-u8fq), because Haxe keeps the parse also when the request fails with a type error, so the next request makes Haxe parse it again, also when it was saved back to its proven text with the modification time of the failed save), the epochs of every module it saw, a digest of the declaration facts of each of those modules, read after the after-typing macros and the after-save callbacks registered before the save phase, and before dead-code elimination (`afterSave`, which a first after-save callback registers, `targetFactsOf`: `WalkTarget.inputsText` and the metadata text of `ModuleFingerprint.addDeclaration`), its `--main` class, the private fields that other modules use or reach by inheritance, a shape cache by epochs, and the modules whose roots a failed request left. Per record also the source positions that other modules' maps name (`importedPositions`, with `-debug` or `-D js_source_map`: every declaration, private ones included, and every module-level field). In every profile also a digest of the facts that the walk reads of each module's declarations (`declarationFactsOf`; only the `-dce std` rule compares it). Under `-dce std` (genes-f8vc.14.7; Haxe's default when a build names no `-dce`) also, per module and read before dead-code elimination (`afterSave`, cached by epochs): the `DceStdUses` use lines of a module that Haxe keeps whole (a port of the marking of Haxe 4.3.7's `dce.ml`: kept standard-library and `@:dce` lines, features, value uses of abstracts, `@:multiType` abstracts, first marks of extern fields, and an `unknown` line when the port reaches its nesting limit), the modules that it makes Haxe load (typed references and import lines), the fields that listen to each feature (`@:ifFeature`), whether it has a macro function that is not Genes' own or the standard library's, and the extern parents of its classes that dead-code elimination may change, and the static calls that a `using` line can make (`DceStdUses.extensionCallsOf`). The port also marks the field types of extern classes, which `collect_entry_points` marks when `keep_field` keeps them. No typed value. The cache facts (what Haxe last typed for each file, the files that a module request typed alone, and the modules with leftover roots) say what Haxe's module cache holds, which Haxe keeps while the server runs; Haxe sets the `@:persistent` fields back to their first values when it types the macro classes of Genes again (after a request with other defines, such as an editor's `--display ...@diagnostics` or `display/diagnostics` request without the descriptor define, when a macro module changes, or after a macro error). So Genes also writes them beside the descriptor when they change (`<descriptor>.typed-sources.json`, `storeCacheFacts`, a temporary file then a rename, with a digest of the defines and a process token), and the first request of a new macro state with the same defines in the same process reads them before it compares any file (`readCacheFacts`, genes-lnrv). The process token lives in the process environment (`GENES_TYPED_SOURCES_<key>`, `claimProcessToken`), which Haxe does not reset: a new process starts without it and holds no module, so its first request knows no file, which is exact; a new macro state that finds no facts of its own process (missing, damaged, or written by another process such as a cold `haxe` run with the session's descriptor define) makes Haxe parse every source file again once (`GENES-MODULE-REQUEST-004`) and can be refused once (`GENES-MODULE-REQUEST-003`). Rule: one Haxe process per descriptor path. Only module records and module requests use the facts. | A full request writes the records after its commit (`programCommitted`); a full request with `"moduleRecords": true` and no `--main` stops before writing anything (`GENES-MODULE-REQUEST-001`). A module request, after Haxe saved the class state (`Context.onGenerate(..., false)`): removes roots left by a failed request, marks every module that it typed again for a new typing in the next full request (dependencies on `<descriptor>.module-dep`, which appears, and `<descriptor>.module-dep-gone`, which disappears; a type that another module's use decides would otherwise stay as typed alone), and roots dead-code elimination at the stored kept lines (`@:keep("genes.moduleRequest")`, removed before printing, so nothing reaches Haxe's cache, unlike `--macro keep(...)`). It prints the module with a one-step walk of its edges and runs the checks of `decide`. The admission rule is strict: the module's signature (every declaration and field, private ones included, with types, type-parameter constraints and metadata) and the use skeleton of its kept bodies (Haxe's printed code without literal values, positions and local variable numbers, plus the declarations that dead-code elimination marks for the types of its nodes, type-parameter constraints included) must equal the stored ones, so only literal and position edits are admitted, and a module with an `@:ifFeature` field is refused; with every other module unchanged (epochs, and the content digest of every other source file and `import.hx`, also of loaded modules, since Haxe compares file times in whole seconds; a module request reads such a file again only when the status rule cannot trust it: git's index rule, `holdsContent`, skips a file whose status equals the status kept with its digest when the kept modification and change times were older than that read by more than the grain, and `readSource` keeps a status only when the reads before and after the bytes are equal; it trusts that the system clock is not set back, that file times come from this machine's clock, that the file system moves the change time at every change (FAT and exFAT may not), and that nobody restores a file below the file system; on Windows, where the change time is the creation time, every file is read), the requested module typed from its current file content (Genes makes Haxe parse again, before typing, each file whose content differs from what Haxe last typed; `stale-source` otherwise), dead-code elimination then has the same input in every place that a kept field reaches, so the full build keeps exactly the stored lines. Further checks: same session key and records, only this module typed, the visible public shape (with inline and macro bodies and positions) unchanged, the same kept lines, member list, root flags and uses of other modules, answers as a full build (`featureAnswer`, `wrongAnswer`), no Haxe printer use, no lookup by name, no `--main` (`has-main`), and an output folder other than the program's. The session sends Haxe's `server/invalidate` for each saved file before each request; if Genes cannot mark the modules that a module request typed alone, the request is refused (`retype-mark-failed`) and the next request makes Haxe parse those files again. A refused request empties its folder only when Genes marked it as a preview folder (`.genes-output-module-preview`). A module of extern classes that a macro defines again (a `genes.ts.imports` holder) counts as unchanged when its fingerprint, made as the shadow makes the stored one (`ofExtern` plus the `unlisted` part, `IncrementalShadow.previewExternFingerprint`), is the stored one. The preview's member list uses the generator's list of the request (`IncrementalShadow.listPreview`), so `ModuleFingerprint.members` marks the same members ` late` as the full request did. With main's other incremental features: the request goes through the same metadata comparison as every request (`GenerationChangeSet.compareMetadata`); a changed metadata epoch changes the session key, so the request is refused with `session-changed`. That comparison runs in the after-typing callback of Genes, so it misses a macro whose callback runs after it, and no metadata shows an `exclude()`. So `decide` also recomputes the declaration facts of every module of the request at the same point (`afterSave`), and refuses any difference with `target-facts-changed` (for example a macro that copies a literal of the requested module into `@:ts.type` of another class, or excludes an enum that another module names, also from an after-save callback). A define that a macro sets after the session key was read (`GenerationChangeSet.definesChangedAfterTyping`, the check that also turns the generation shadow of a full request off) refuses the request with `defines-changed`. It never walks with stored edges (S2) and never reads or writes the stored visits and their `targets`; its one-step walk decides each step with `WalkTarget.inputsOf` and `takesStep`, like the full walk. It writes nothing into the generation cache and keeps no record of its own; the after-typing walk skips `publicSurface` and `reactAudit` for kept classes outside the module and its parents. The report (`result`: `preview`, `refused` with a stable code, or `off`; `digestMs`, `hashedSources` and `trustedSources` for the source check) is written beside the descriptor. Init macros given before `genes.Generator.use()` and modules that Haxe keeps from its cache (genes-v54c): Haxe runs init macros in argument order, so such a macro can make Haxe type a project module from its cached text before Genes reads the module's file, and no macro can see what an earlier macro typed. Genes reads the files first in `Generator.use()` (`ModuleRequest.begin`, before Genes types its own helpers `genes.Register` and `js.Boot`), and reads the arguments (`Compiler.getConfiguration().args`, `typingMacrosBeforeGenes`): every init macro before `genes.Generator.use()` can type a module, except a call of `INIT_ONLY_CALLS` (`nullSafety`, `addMetadata`, `addGlobalMetadata`, `define`, `keep`, `addClassPath`, `allowPackage`, and `include` and `server.setModuleCheckPolicy`, which defer their typing); metadata that these add, such as `@:build` or `@:using`, runs only when a type is built, which happens after Genes read the files; macro text with conditional compilation (`#`) counts as able to type, because Genes parses it with later defines. When there is such a macro and a file differs from what Haxe last read (digest or file status, `sameSinceRead`, also a file that a module request typed alone), Genes makes Haxe parse the changed files again, keeps their current content as what Haxe will read, and refuses the request once: a full request stops before typing the program with `GENES-MODULE-REQUEST-003`, publishes nothing and writes a records report with `stored: false`; a module request is refused with `init-macro-before-genes`. Haxe also loads `StdTypes`, `String`, `Array` and `haxe.EnumTools` from its cache with every dependency before any init macro, and a project module can be such a dependency (for example after a global `@:build` macro typed it by name while Haxe built a standard type); Haxe then keeps that module object, so after typing a full request whose changed file has a module with a declaration stamped in an earlier request (`GenerationChangeSet.keptModules`, `keptStaleModules`) stops with `GENES-MODULE-REQUEST-003` too, before it publishes or notes a digest; a module request already refuses such a module (`stale-source`, `source-changed`). The same request sent again equals cold; a client sends it again once and reports a second refusal (a file changed again in between, for example an init macro that writes a source file at every request). No shipping client asks for module records yet. Giving `--macro genes.Generator.use()` before every other init macro avoids the init macro refusal. Not covered: metadata that only a typed body holds; a module that Haxe keeps from its cache before Genes reads the files in a program with an `@:rtti` class (no stamps); a file that Genes does not know yet (a new module) and that Haxe first parsed in a request that failed, then saved again in the same whole second without `server/invalidate`; a request that fails right after Genes lost its cache facts (`GENES-MODULE-REQUEST-004`), when a file is then saved back the same way; a module that Haxe typed in a request whose cache facts Genes did not keep (a full request without module records in the same process before the first one with them); a process that a macro of the server starts, which inherits the process token; a change that a macro makes by name to a module outside the request's program; an after-save callback that another after-save callback registers while the save phase runs, when it is registered after the callback of Genes; and a file that a macro reads in a module outside the request, other than `import.hx` and resources. Refused by design under `-dce full` and `-dce no`: a class kept only as another module's type, and any structural edit (a new or removed field, call, local type or class use). Under `-dce std` (genes-f8vc.14.7), Haxe keeps every project class whole, so a structural edit of a module that Haxe keeps whole is admitted when `structuralRefusal` proves that a full build changes no other output file: it keeps every check above except the signature, skeleton, kept-line, member-list and foreign-reference checks, and adds `opaque-macro` (a foreign build macro or imported macro module), `dce-uses-unknown` (the port reached its nesting limit), `shadowed-extension` (a new instance field has the name of a static function that another module calls on its class, which `using` can make; Haxe takes the field first), `walk-target-added` and `walk-target-removed` (a declaration that the walk reaches gains or loses an emitted member), `import-cycle` (the module was or becomes part of a runtime import cycle), `dce-use-added`, `dce-use-removed` and `feature-changed` (a use line whose effect the stored build did not have or might lose: a standard-library or `@:dce` field that it did not keep, a use that no other kept module has, a feature that a field listens to or a module asked for), and `kept-changed` (Haxe did not keep every field). Every `-dce std` request, a literal edit included, also refuses when a module with an output file may leave the program (`module-may-leave`, `modulesThatMayLeave`), and every request with source maps refuses when a position that other modules' maps name moved (`position-changed`). In every profile the visible shape keeps every private field of a class that another module names (or whose package it names) in `@:access`, and every field of an abstract's implementation class, private ones included, because Haxe resolves its `@:op`, `@:arrayAccess`, `@:resolve`, `@:from` and `@:to` fields from any module. | `yarn test:compiler-server:module` (base list and the review scenarios: previews byte-identical to cold, refusals by code, every full request after a step equal to cold; the `stat-` groups for the status rule, a save and a revert during typing, a file first seen (unknown once), and a deleted `import.hx`; the `early-init-` groups for an init macro before `genes.Generator.use()` that types `mr.Fresh`, with a save that keeps the modification time, a save in the same whole second, and a dependency save that makes Haxe type the module again from its old text: each refused once and equal to cold when sent again, and an init macro that types nothing refuses nothing; the `early-init-global-` groups for `addGlobalMetadata` with `@:build` on `genes.Register` or on every type and with `@:using` on `genes.Register`, and `kept-stale-global-build-after-genes` for the global build macro given after Genes, where Haxe keeps `mr.Fresh` as a dependency of the standard types; the `display-` groups for an editor diagnostics request (CLI, JSON-RPC, and JSON-RPC with the session's defines) before or after a save that keeps the modification time: every full request equals cold at once, also when a dependency save makes Haxe type `mr.Fresh` again from its old parse, and with the global build macro it is refused once as without the editor request; `display-cold-run` for a cold `haxe` run with the session's descriptor define: refused once, then equal to cold; `display-new-server` for a restarted server whose first request is not refused; the `failed-` groups for a full request, a module request, an edit of another file and editor requests (CLI, and JSON-RPC with the session's defines) after a request that failed with a type error, where `mr/Fresh.hx` is then saved back with the modification time of the failed save: the next request equals cold at once, and a request without an edit types no module again; the `std-` groups for structural edits under `-dce std`: previews byte-identical to cold for a new private function with a call, a first use of an unused function, a new use of another module, a removed call, a standard-library field that another module keeps and an enum use, refusals for each new code, and `std-profile-full` for the same edit under `-dce full` (`signature-changed`); `yarn test:compiler-server:module --sweep` for 100 structural edits of 20 generated UI modules) |
| `genes.WalkTarget` | The one place where the reachability walk reads facts about a step's target declaration: `inputsOf(type)` returns its kind, extern flag, module, name and metadata; `takesStep(inputs)` is the walk's only decision before a step (no step to an extern target or to `StdTypes`); `inputsText(inputs)` is the text that each stored step records. | Pure functions with no state. `Generator.expandReachability` reads target facts only through `inputsOf`, and `IncrementalShadow.checkStoredTarget` compares `inputsText` with the recorded text, so a fact that the walk starts to read must be a field of the inputs and is then recorded automatically. The step's second member name stays outside: the walk reads it only while it takes the step, under the stamp check. | `yarn test:compiler-server:shadow` (the extern rows; `CleanRuleProbe.checkStepInputs`) |
| `OutputTransaction`, writers, and source maps | One-generation staging and one-artifact emission state. The ownership manifest is the only filesystem-persistent part. | A transaction key is the exact normalized output basename, including extension, plus a collision-resistant scope. Commit publishes the whole owned set; abort restores the previous public bytes and removes private stages. Writers and mapping buffers are newly constructed and never reused. | `yarn test:output-transaction`; `yarn test:compiler-server` |

Haxe macro callbacks are installed by `Generator.use()` and the owner-specific
`install()` methods for the current compilation. Do not rely on callback
registration itself to clear a process-visible map: replace the map before
registering the callback or adding a pass to the shared walk, as the three
pre-DCE owners above (`TypedModuleInventory`, `PublicSurface`, and
`SignatureCache`) do. Conversely, do
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
cold/warm proof. A typed compiler object may pass from one request to a later
one only as a bucket of `genes.incremental.KeptBuckets`, under the keep rule
in the ledger above; every other owner replaces its typed state at the start
of each request. Prefer an owner-local reset over a compiler-wide session or
cache manager until several reproduced defects require coordinated lifecycle
ownership.

### Host-side admitted development generations

`@genes-ts/tooling/session` lives outside the compiler state ledger above. It
owns one long-running host lifecycle, but it never retains Haxe typed objects
or changes compiler semantics. Its positive contract is:

```text
observed input revision
  -> immutable effective Haxe invocation
  -> exact nested-HXML + flattened library-argument closure derived from it
  -> optional exact host-prepared Haxe inputs
  -> session-owned private Haxe JS target + request-local `genes.output`
  -> optional declared compiler data created by Haxe macros
  -> exact Genes v2 ownership inventory
  -> exact path-free compiler-data snapshot
  -> host-owned validation
  -> supersession check
  -> recoverable public artifact transaction
  -> accepted generation event
```

There are intentionally two transaction boundaries. `OutputTransaction`
guarantees that Genes produced one complete private candidate. The tooling
artifact transaction guarantees that only a host-admitted candidate replaces
the previous public tree. Strict TypeScript or framework policy runs between
them; it is not inferred by the compiler and is never postponed until after
public mutation.

The session composes the existing HXML inventory, reconciled watcher,
serialized dirty loop, owned Haxe server, and artifact publisher. It does not
reimplement those mechanisms. The compiler's v2 manifest is the sole generated
file inventory, including the manifest file's own exact bytes and mode, while a
separate session generation record is the outer commit marker. Both publication
authorities live in one stable project/public-root-scoped control root so selecting a
different private candidate directory cannot bypass crash recovery. Its output
identity uses the artifact layer's portable NFC/case-folded path model, so a
case alias cannot acquire a second lock or recovery universe. One persistent
entry owner is admitted per public root in v1, preventing two entry-specific
sessions from publishing overlapping sibling modules through separate
journals. The owner is written privately and moved into place only after its
complete bytes are durable. An uncommitted private owner can be removed after
a stopped write, while a damaged final owner fails closed. Public output and
`.genes/tooling` cannot contain one another.

With `generationReuse` (genes-f8vc.9.23), the session asks Genes to replay
unchanged modules (`afterTyping` and `generation` `"reuse"` in the fixed
incremental descriptor) and owns the two output checks that make a reuse
defect visible. It reads the `audit` part of the Genes generation report
after each build: a candidate with a replay-audit difference is never
validated or published; it becomes an `output-check` event and an immediate
rebuild of the same revision (a repeated module turns reuse off). After every
`coldCheckEvery` accepted warm generations, once the loop has been idle for
`coldCheckIdleMs`, it builds the accepted revision with
`SessionCompiler.compileCold` (a new Haxe process, no incremental define)
into a private folder at the depth of a candidate folder, reconciles the
inputs under a read lease before it starts and before the result counts, and
compares that Genes tree with the published one. An edit that needs a build
aborts it; `close` aborts and waits for it. A difference, or a cold failure
while the warm build passed, starts a new server, rebuilds, and checks that
generation at once; a difference that survives stops further cold repairs.
The cold build never publishes anything itself.

The root-scoped design has an explicit upgrade path from the earlier
entry-scoped session. While holding both lock identities, tooling recovers the
old journal. It then publishes four small, durable steps:

1. a receipt that describes the exact old marker and live generated manifest
2. a replacement marker that causes older writers to stop
3. the root owner
4. an equivalent root-scoped accepted marker

The ordinary artifact transaction owns every step, so process
loss can be recovered without exposing half-written control data or changing
the last-good generated tree. Scanning the stable control directory also
rejects two older entry markers that claim the same output root. The upgrade
never guesses which marker must win.

This transition is a one-way tooling upgrade. The replacement v1 marker stops
the released v1 client for the selected entry. Supported installations must
not downgrade after migration. A manually started v1 client with another entry
does not know the v2 root lock and remains outside the compatibility contract.
The migration receipt remains historical after later root-scoped generations.

One immutable effective-invocation plan owns the executable, working directory,
environment, ordered HXML entries and occurrences, exact resolved-library
arguments/provenance, source roots, and versioned Haxe 4.3.7 compiler-I/O
policy. Repeated acyclic HXML occurrences keep their repeated argument
semantics, recursive includes fail rather than disappearing, ordered library
groups preserve repeated values, and `--option=value` is normalized
before the same option policy runs. Inline library spellings are rejected
because Haxe 4.3.7 ignores them rather than resolving a library. The v1
`resolveLibrary` callback admits one distinct library identity. The
`resolveLibraries` callback admits several and receives each adjacent ordered
group exactly as Haxe 4.3.7 sends it to one `haxelib path` call. A non-library
option ends the current group. The compatibility callback reuses its first
single-library result. Authored or resolved standalone option values ending in
`.hxml` fail closed when they would remain in the final stream: Haxe's
high-level argument pass would otherwise interpret that
value as another HXML program before normal option arity is applied. An ordinary
inline option such as `--define=config=build.hxml` keeps its exact meaning
through a private one-line HXML input whose value is carried by an environment
placeholder. Haxe expands that placeholder only after its high-level HXML-file
decision, and the private input is removed before publication. A
standalone HXML inventory rejects that form because it does not own the private
input needed to make the flattened command safe. A separate resolved library
request may use that suffix because its name is
removed before execution; its resolver output still passes the final-stream
check. Environment expansion cannot change a high-level HXML or library
decision. Authored HXML is targetless. The bound compiler request
appends one ordinary private Haxe JS target and one private Genes target, so an
inactive Genes generator still cannot write public output before admission. The
HXML closure is complete only after every discovered library has been passed
through a host-owned authoritative resolver. Haxe executes that flattened
stream without a live `-lib` re-resolution; unresolved libraries fail before
Haxe executes. Library sources and proof files may live outside the project
only under explicit allowed roots. These inputs are watched and join the
compiler identity, while event records use private logical external paths.
Undeclared and linked paths fail before compilation. The separate marker
matters when two successful revisions generate identical bytes:
generation still advances, the file delta stays empty, and a host correctly
performs no reload.

Haxe's early argument pass also treats several inline spellings differently
from their separate-value forms. The inventory accepts `--name=value` only for
ordinary one-value options. It rejects inline forms for the reviewed early
options—such as `--run=Main`, `--library=sample`, compiler-server flags, and
working-directory flags—rather than normalizing rejected or ignored Haxe input
into an executable command with different behavior. The reviewed set is
closed and versioned for Haxe 4.3.7.

Class paths are checked against the project roots, and every existing path
component must be a normal directory rather than a symbolic link. The last
directory may be absent. Keeping that missing path in the input list lets the
reconciled watcher notice when generated sources first appear. The watcher
checks every live path component again before each scan, so a newly created
symbolic-link parent is rejected before any outside tree is read. It inspects
the link itself, so a broken symbolic link cannot masquerade as an absent path.

This is not a hostile-macro sandbox. Haxe macros are trusted compile-time code
and may use filesystem or process APIs; hosts declare macro-owned external
inputs when they affect rebuild correctness. Preventing arbitrary macro reads
or writes requires an operating-system sandbox and is outside this bounded
development-session contract.

Host-prepared Haxe inputs solve a timing problem rather than changing compiler
ownership. A closed declaration such as a CSS Module companion must exist
before Haxe types authored field access, so it cannot be an ordinary Genes
output. The session accepts exact bytes, stages them inside the private
candidate, adds only their declared class paths to that request, and includes a
content digest in `genes.tooling.prepared`. That define changes the Haxe request
cache identity without changing the compatible wait-server identity. No typed
Haxe object or class-name registry survives in the Node process.

Prepared files with public destinations and validator-produced receipts are
supplemental owned files. The outer transaction publishes them with the Genes
manifest and target output, records their exact file states in the accepted
marker, deletes only their previously recorded stale paths, and checks them
again during recovery. Current version-4 markers also record whether
preparation or validation produced each file. Restart recovery then requires
validation to return every saved validator artifact again with exactly the
saved bytes. A missing receipt is old evidence and cannot be kept. Version-2
and version-3 records remain readable with the smaller set of facts they
originally saved; the next accepted build upgrades them to version 4. A
generated companion can use the same candidate and public relative path so its
source-map name remains stable after publication. The host still owns how
those prepared bytes were discovered and whether a real framework loader
agrees with them.

Declared compiler data moves in the other direction. A Haxe macro can create
a small plan or manifest while Haxe checks typed source. The session declares
each logical ID and size limit before compilation, then gives Haxe an opaque
private file for that ID. The macro never receives a public destination.

After Haxe finishes, tooling checks the complete private directory and copies
each stable file into a path-free validation value. The host can inspect its
digest, size, and exact bytes. The private value does not join the Genes
compiler transaction and does not become a runtime module.

The host can return approved output files through `AdmissionResult.artifacts`.
Those files then join the existing outer transaction with generated JS or TS.
This keeps one public update and avoids a second publisher for macro-created
data.

An unfinished update that used compiler data requires a new build after a stop.
The stopped process owned the private values. Thus, restart cannot reproduce
the old validation result safely. Recovery rolls back before the durable
commit and builds the newest source state. If commit already finished,
recovery keeps the complete public result and removes only private control
files that remain.

Recovery registers the reconciled input watch around a fresh read of the HXML
input graph before replaying an interrupted update. Every saved public
transition is checked against those current inputs, followed by one final
filesystem comparison. If a formerly generated path became authored source
while the process was stopped—or while startup was checking it—recovery refuses
before it restores, removes, or replaces that file. An already complete result
is checked again after host validation and before acceptance. The journal
remains available for a safe resolution. The saved plan passed to host policy
is deeply read-only, so that policy cannot accidentally change which files
recovery uses.

A small owner file, called the project lifetime lock, admits one development
session for the project root. Output-root and older entry locks remain for safe
upgrades. Those narrower locks cannot protect extra files because two output
roots can choose the same project-relative path. The project lock gives those
files one writer without forcing hosts to place them under the Genes output
folder. While holding that lock, startup also checks every other output scope
for unfinished publication files. It refuses to start a different output until
the original output has recovered or rolled back its update. This prevents an
older journal from later undoing newer shared-file bytes.

Framework policy remains above this boundary. Vite, Next.js, Electron, Expo,
WordPress, browser transports, device transports, and application servers may
consume structured accepted-generation and failure facts, but none of them
changes session input discovery, compiler ownership, admission ordering,
publication, or recovery. See
[`../tooling/development-session/v1/README.md`](../tooling/development-session/v1/README.md)
for the public state/event contract and [`../tooling/README.md`](../tooling/README.md)
for a newcomer-oriented host example.

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
| Enum payload reads after Haxe erases a proven match | `tests/enum-payload-narrowing/` | `yarn test:enum-payload-narrowing` |
| Exported-surface rejection | `tests/typing-policy/`, `tests/publicsurface/` | `yarn test:types:exports` |
| Classic `.d.ts` consumer behavior | `tests/classic-dts/` | `yarn test:classic:dts` |
| Static callable generic inference, constraints, and declaration parity | `tests/staticcallable/`, `tests/TestStaticCallableSignature.hx` | `yarn test:genes-ts:full`; `yarn test:classic:dts` |
| Nullish/map/iterator contract | `tests/nullish/`, `tests/deep-nullish-alias/` | Owning genes-ts/full/exported-surface gates and `yarn test:deep-nullish-alias` |
| Type-only reachability and DCE | `tests/typeonly/`, `tests/type-roots/` | Owning genes-ts/full, dual-output, and `yarn test:type-roots` gates |
| Same-source TS/classic parity | `tests/output-modes/` | `yarn test:dual-output` |
| String literal code units and escaping | `tests/string-literals/` | `yarn test:string-literals` |
| Reusable package surface | `tests/library-profile/` | `yarn test:library-profile` |
| Module directive prologues | `tests/module-directives/` | `yarn test:module-directives` |
| React Fast Refresh module split | `tests/react-refresh-modules/` | `yarn test:react-refresh-modules` |
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
