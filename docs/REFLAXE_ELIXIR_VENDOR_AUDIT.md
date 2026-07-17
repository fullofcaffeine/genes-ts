# Reflaxe.Elixir vendored Genes consolidation audit

This document records the three-way review of the Genes copy vendored by
Reflaxe.Elixir. Its purpose is practical: preserve useful generic compiler
lessons without copying an old fork into the modern compiler or teaching
genes-ts anything about Phoenix-specific application behavior.

This is a decision ledger, not an adoption announcement. Reflaxe.Elixir must
keep its vendor until its own migration task pins a green genes-ts revision and
passes the downstream builds described at the end of this document.

## Review identity

- genes-ts starting revision: `89894654f61a86d882b55306e5ec726b27a337a8`
- Reflaxe.Elixir evidence snapshot:
  `1ce84dcfef6c1633e56cbc8e266984519181d84f`
- vendored library identity: Genes `0.4.14`
- upstream annotated tag object:
  `a5dccf2797a829ea0a186944b0a8601ed6823ed4`
- upstream source commit peeled from that tag:
  `9394b7eddb39ff392379125999c9d4e0c6dda251`
- local evidence toolchain: Haxe 4.3.7, Node 20.19.3, Yarn 1.22.22

The distinction between the tag object and peeled commit matters. The original
handoff called `a5dccf2` a commit, but Git identifies it as the annotated tag
object whose source commit is `9394b7e`. All source comparisons in this audit
use the peeled commit. The downstream checkout has moved beyond the requested
snapshot, but `vendor/genes` and `haxe_libraries/genes.hxml` are byte-unchanged
between that snapshot and the inspected checkout. Existing unrelated
downstream worktree changes were not modified.

## Evidence language

- **Observed** means the source, generated output, Git history, or an executed
  repository gate directly establishes the claim.
- **Inference** means the conclusion follows from observed facts but still
  needs a focused regression before it becomes a support promise.
- **Experiment required** means the current repositories do not settle the
  behavior. The named experiment must run before adopting the downstream
  mechanism.

The baseline full `yarn test:ci` gate passed in 336.64 seconds at `8989465`,
including classic Genes, genes-ts, strict declarations, TypeScript 5/6/7,
both todoapp Playwright profiles, and the complete ts2hx suite. That is broad
regression evidence; it is not a substitute for the missing focused cases
called out below.

## Three-way disposition ledger

| Delta | Original v0.4.14 | Reflaxe.Elixir vendor | Modern genes-ts | Disposition |
| --- | --- | --- | --- | --- |
| Native async/await | No typed public async authoring layer | Detects `__async_marker__`, filters it during printing, recognizes one raw `await {0}` spelling, and reads method metadata in the classic printer | `genes.js.Async` types and validates the authoring API, marks typed functions with private `:jsAsync` semantics, and both profiles emit native async/await | **Superseded**, with missing focused regressions tracked by `genes-7be.4` |
| String literals | Iterates the compiler-time Haxe string and escapes each reported character | Walks `0...input.length` and calls `charCodeAt` | Retains the iterator and now has an exact code-unit differential | **Already supported**; both mechanisms match standard Haxe, original Genes, and the vendored fork, so no production port is justified |
| Runtime globals | Uses an untyped object and bracket access | Uses `DynamicAccess<Object>` and explicit get/create logic | Uses a typed, null-prototype `DynamicAccess<HxRegistry>`, `globalThis`, and narrow registry projections for classes and enums | **Superseded and hardened**; the audit exposed prototype-name collisions that neither older implementation handled |
| Iterator runtime | Uses `untyped` array and structural iterator access | Replaces those operations with local `js.Syntax.code` calls | Centralizes the dynamic host boundary and proves arrays, callable/non-callable iterator fields, receiver binding, and map-like `keys/get` iteration | **Superseded**, with direct runtime evidence in both profiles |
| Bound-method cache | Uses `Dynamic` for receiver and method | Narrows to `Object`, `Function`, and `Null<Function>` while keeping hidden-field access in syntax calls | Preserves the Haxe JS cache protocol behind one documented dynamic runtime boundary while user-module callable types remain precise | **Already supported and now directly proved**; the fork's nominal narrowing does not model hidden mutation or preserve callable signatures |
| Source-map JSON construction | Builds the JSON object as `Dynamic` | Adds a structural `SourceMap` typedef | Uses a private exact `SourceMapJson` record while retaining modern path normalization and transactional publication | **Absorbed generically** in `f99c824`; schema, optional source content, relative paths, and byte determinism have focused evidence |
| Writer comparison catch | Uses `catch (e:Dynamic)` around only the unchanged-output comparison | Uses inferred catch typing | Infers the comparison exception type; the actual write remains outside the catch | **Absorbed generically**; direct evidence covers create/change/unchanged output, comparison-read fallback, and escaping write failure |
| Assignment whitespace | Some multiline assignments end a visible line with ` = ` | Removes the final space at selected class/enum registration sites | Raw output quality now rejects whitespace after visible content across owned TS, classic JS, and classic declarations | **Absorbed generically**; all current multiline class/enum/declaration producers satisfy the central invariant |
| `Genes.hx` comment | Dynamic fallback has no nearby explanation | Adds a comment explaining the macro fallback | Modern contributor guidance already requires documented unsafe boundaries, but this old macro path is no longer the vendor decision seam | **Comment-only**; document current boundaries where they exist instead of copying historical narration |
| `TypeUtil.hx` and repository churn | Baseline contents | Line-ending or packaging churn only | Modern implementation has independently evolved | **Formatting-only or obsolete** |
| Lix descriptor, removed upstream files, Phoenix build conventions | Upstream package layout | Hermetic downstream vendor and explicit activation flags | genes-ts has its own package identity, `extraParams.hxml`, CI, and release workflow | **Downstream-only** |

## Detailed decisions

### Native async/await: keep the typed modern protocol

**Observed.** The vendor printer recognizes a local variable named
`__async_marker__`, removes it from anonymous-function blocks, handles exactly
the raw syntax string `await {0}`, and independently checks `@:async` or
`@:jsAsync` on methods. This makes source spelling and printer heuristics share
semantic ownership.

**Observed.** Modern `src/genes/js/Async.hx` owns validation and lowering. It
requires declared Promise return types, rejects constructors, handles both the
`await(...)` macro and metadata spelling, preserves generic method parameters,
and attaches the private `:jsAsync` fact consumed by both implementation
profiles. `src/genes/es/ExprEmitter.hx` and
`src/genes/es/ModuleEmitter.hx` print that typed fact rather than searching for
a magic local name.

Existing executable evidence includes instance methods, an anonymous async
function, value and `Void` promises, both await spellings, local-scope typing,
generic returns, property access after await, and a cross-module function call
inside await (`tests/TestAsyncAwait.hx`). The basic snapshot also exercises a
private static async method (`tests/genes-ts/snapshot/basic/src/foo/AsyncFoo.hx`).
The full classic and genes-ts runtime gates passed at the review baseline.

**Decision.** Do not import `__async_marker__`. The typed modern mechanism is
the single semantic owner and supersedes the fork.

**Experiment required before closing the equivalence claim.** Add nested
anonymous async functions, static and instance cases in one paired fixture,
index access after await, exception propagation, single evaluation, source-map
lookup at the await token, await misuse outside async context, and constructor
misuse. This is `genes-7be.4`.

### String literals: retain the current walk after exact comparison

**Observed.** The vendor replaced `for (char in input)` with an indexed
`charCodeAt` loop after a downstream Haxe 4.3.7 failure. Modern genes-ts and
original Genes retain the iterator. Because these operations run inside the
compiler, their behavior could have depended on the macro host's string model;
source resemblance alone was not enough to choose between them.

**Executed experiment.** `tests/string-literals` now compares runtime UTF-16
length and every ordered code unit for ASCII, quotes and slashes, newline/tab/
carriage-return, NUL and another control byte, Latin-1, BMP Unicode, emoji,
combining marks, U+2028/U+2029, a property key, and an import-like value. It
also checks Unicode module-directive spelling and maps both metadata and an
expression literal back to their Haxe source lines. Standard Haxe JS is the
primary oracle; classic Genes and genes-ts TS 5/6/7 match it. On the reviewed
machine, live original Genes and the live Reflaxe.Elixir vendor match the same
transcript exactly.

**Decision.** The fork's indexed walk is behaviorally equivalent for the
proved Haxe 4.3.7 boundary, not a missing compiler fix. Keep the current
iterator, preserve the differential, and revisit the mechanism only if a
future supported Haxe toolchain produces a failing code-unit case. This avoids
production churn while retaining stronger evidence than either implementation
previously had.

### Registry globals and iteration: keep the modern model and close inherited keys

**Observed.** `src/genes/Register.hx` no longer uses the original untyped
global lookup. It owns heterogeneous registry behavior through `HxRegistry`,
returns narrower `HxClasses` and `HxEnums` views for reflection, and keeps
`unknown`/dynamic behavior inside the runtime module rather than generated user
modules.

**Observed fail-first result.** The modern and vendored implementations both
created their registry dictionaries with `{}`. A reduced fixture then exposed
four wrong baseline lookups: `constructor` resolved to a function, while
`toString` and `__proto__` registries inherited built-in members instead of
behaving like empty string dictionaries.

**Implemented.** The private registry index is now a
`DynamicAccess<HxRegistry>`, and both that index and every named registry are
created with `Object.create(null)`. A narrowly documented helper contains the
construction policy, while a private typed extern fills Haxe 4.3.7's missing
null-capable `Object.create` signature without a cast or raw syntax escape.
`tests/TestRuntimeRegistry.hx` proves same-name identity, different-name
separation, prototype-name isolation, and stable writes. Generated user
TypeScript contains neither `any` nor `unknown`;
classic declarations retain `HxRegistry` as an unknown-valued boundary, and
the private construction helper is absent from `.d.ts`.

**Executed iterator evidence.** `tests/TestIterators.hx` now exercises both
`iterator(...)` and `getIterator(...)` over an explicit ordered `keys/get`
object. A second structural object mutates its own call counter, proving that a
dynamically discovered iterator method remains bound to its receiver. Existing
array and non-callable-field cases remain green.

**Decision.** The vendor's narrower iterator implementation remains
superseded. Retain the modern array/structural/map-like model and the new
prototype-free registry correction. The focused classic runtime,
genes-ts TypeScript 5/6/7 runtime/type gate, and classic declaration gate own
this boundary.

### Bound methods: preserve behavior before narrowing types

**Observed.** Modern `Register.bind` retains the Haxe JS protocol: a stable ID
is stored on the callable, one closure cache is stored on the receiver, null
methods remain null, and repeated reads can return the same bound closure. The
nearby documentation accurately explains why this is a dynamic host boundary.

**Executed evidence.** `tests/TestBind.hx` now proves repeated closure identity,
separation by receiver, separation by method, correct receiver values,
inherited methods, overridden methods, and the existing null/replacement
behavior. Both implementation profiles execute the same assertions. Generated
genes-ts user locals retain their exact function signatures and contain no
`any` or `unknown` even though the internal runtime declaration remains the
documented `any`-shaped host boundary.

**Inference.** The vendor's `Object`/`Function` signature looks cleaner, but a
cleaner spelling is not evidence that every Haxe JS call site fits it. In
particular, JavaScript binding permits receiver and callable shapes that Haxe's
nominal `js.lib.Object` surface may not describe precisely.

**Decision.** Keep the contained dynamic boundary. Its hidden properties are
not part of the nominal receiver/callable types, and using `Function` would
also erase the actual parameter and return signature. The helper documentation
now states its real input boundary: compiler-generated method extraction on a
mutable, extensible object receiver. Primitive and frozen-object direct calls
are not an advertised API. Any future narrowing may replace this only with a
type that models the hidden mutation and preserves callable shape;
do not remove `Dynamic` by making the contract false.

### Source-map JSON: adopt the type, not the old implementation

**Observed at the audit baseline.** The modern map already included output
filename rules, relative source normalization, optional source content,
serialization, and transactional publication. Only its local JSON record was
still typed as `Dynamic`; the fork's smaller typedef therefore identified a
real typing gap without supplying the modern implementation.

**Implemented.** `SourceMapGenerator` now builds a private exact
`SourceMapJson` record describing version, names, file, source root, nullable
sources, mappings, and optional nullable source content. The change kept the
serialized bytes and transaction ownership unchanged. The focused source-map
gate checks the exact schema, optional-source-content alignment, relative
paths, and deterministic default bytes; transaction and dual-output gates
continue to cover publication and both profiles. This landed in `f99c824`.

### Writer catch: narrow the comparison fallback only

**Observed.** The catch surrounds only `exists/getContent/equality` in the
legacy buffered writer. `File.saveContent` remains after the catch, so write
failure is not intentionally swallowed. Transaction-owned compiler output has
its own stronger publication and rollback path.

**Implemented.** The comparison catch now uses Haxe's inferred exception type,
and the streamed writer's delayed file handle has an explicit nullable type.
The focused filesystem harness proves that missing and changed files are
written, identical output preserves its modification time, a real POSIX
comparison-read failure falls through to publication, and a real publication
failure exits nonzero without changing the blocking user file. The catch was
not broadened and remains separate from transaction recovery.

### Assignment whitespace: enforce an outcome, not the fork's call sites

**Observed.** Raw current classic files contain visible lines ending in
` = ` for class/enum registration and classic declarations. Snapshot helpers
strip trailing whitespace before comparison, so reviewed goldens cannot detect
this. The vendor fixed only selected implementation-emitter sites.

**Implemented.** This is an output-quality correction, not a language-semantic
change. The raw-tree gate now rejects spaces or tabs after visible content in
every owned TS, classic JS, and classic declaration artifact. That assertion
failed on 31 generated files before the fix. The current class-registration,
enum-registration, and multiline declaration-union producers now end the line
at `=`, while inline assignments retain their conventional surrounding spaces.
Indentation-only blank lines remain a separate, intentionally deferred
formatting policy.

### Downstream packaging stays downstream

The vendored `haxe_libraries/genes.hxml`, compatibility define, removed
upstream tests/editor files, Phoenix watcher paths, and target-name conventions
exist to make Reflaxe.Elixir hermetic. They do not belong in compiler source.
Modern genes-ts also activates the generator, async macros, and inline React
markup through `extraParams.hxml`; the downstream HXML files currently activate
part of that stack manually. Duplicate activation and output differences must
be tested in a disposable downstream worktree, not guessed or hidden in a
compiler special case.

## Safe implementation order

1. Complete the async supersession matrix in `genes-7be.4`; keep the marker
   protocol rejected.
2. Run full `yarn test:ci` after every production slice.
3. Only after Genes is green, use a disposable Reflaxe.Elixir worktree for the
   five client builds, generated ESM/map review, bundler tests, and browser
   evidence (`genes-7be.5`). Do not modify or remove the real downstream vendor.

## Adoption boundary

This audit authorizes focused generic compiler work; it does not authorize a
downstream vendor removal or a release. Reflaxe.Elixir may consider switching
only after `genes-7be.5` records an exact pushed Genes revision and the
downstream task `haxe.elixir.codex-m52` pins and verifies it. Classic ESM is the
first migration target. Enabling `-D genes.ts` remains a separate product
decision.
