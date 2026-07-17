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
| String literals | Iterates the compiler-time Haxe string and escapes each reported character | Walks `0...input.length` and calls `charCodeAt` | Still uses the original iterator in the shared classic/TS expression emitter | **Supported but under-tested**; Unicode/code-unit evidence is required before copying the indexed walk |
| Runtime globals | Uses an untyped object and bracket access | Uses `DynamicAccess<Object>` and explicit get/create logic | Uses a typed `HxRegistry`, `globalThis`, and narrow registry projections for classes and enums | **Superseded** by the stronger modern registry boundary |
| Iterator runtime | Uses `untyped` array and structural iterator access | Replaces those operations with local `js.Syntax.code` calls | Centralizes the dynamic host boundary, supports arrays, callable/non-callable iterator fields, and map-like `keys/get` iteration | **Superseded**, with a few identity/shape cases still under-tested |
| Bound-method cache | Uses `Dynamic` for receiver and method | Narrows to `Object`, `Function`, and `Null<Function>` while keeping hidden-field access in syntax calls | Preserves the Haxe JS cache protocol behind one documented dynamic runtime boundary | **Supported but under-tested**; do not adopt the narrower signature until it proves every real receiver/callable shape |
| Source-map JSON construction | Builds the JSON object as `Dynamic` | Adds a structural `SourceMap` typedef | Still builds the modern transaction-aware map as `Dynamic` | **Missing and valid** typing improvement; adapt it to the current map contract |
| Writer comparison catch | Uses `catch (e:Dynamic)` around only the unchanged-output comparison | Uses inferred catch typing | Still uses the original explicit `Dynamic` catch; the actual write remains outside it | **Missing and valid** typing cleanup, provided read failure still falls through and write failure still escapes |
| Assignment whitespace | Some multiline assignments end a visible line with ` = ` | Removes the final space at selected class/enum registration sites | Raw classic output still contains those visible trailing spaces, while snapshot comparison normalizes them away | **Formatting-only**; accept only through a raw output-quality invariant, not a three-line transplant |
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

### String literals: prove code units and runtime equality first

**Observed.** The vendor replaced `for (char in input)` with an indexed
`charCodeAt` loop after a downstream Haxe 4.3.7 failure. Modern genes-ts still
uses the original loop, and the full Haxe 4.3.7 gate succeeds for the current
corpus. That proves ordinary compiler compatibility, not Unicode equivalence.

**Observed.** No focused fixture currently covers surrogate pairs, combining
characters, U+2028/U+2029, or exact runtime code-unit sequences. Both genes-ts
and classic Genes call the same expression-emitter string routine, so an error
here affects both profiles.

**Inference.** An indexed loop may be the more explicit contract, but Haxe
string length and `charCodeAt` behavior are target-sensitive. Applying the
vendor patch without measuring the macro/runtime strings could split an emoji,
duplicate bytes, or merely replace one implementation with an equivalent one.

**Decision.** Treat current literal emission as supported but under-tested.
Before changing it, add one reduced fixture covering ASCII, quotes, slashes,
control characters, Latin-1, BMP characters, emoji, combining characters,
U+2028/U+2029, property keys, and source-map metadata. Compare generated parse
success, runtime length, and every UTF-16 code unit in standard Haxe JS,
classic Genes, and genes-ts. Reclassify as **missing and valid** only if that
fixture exposes a real defect. This work belongs to `genes-7be.2`.

### Registry globals and iteration: modern architecture already absorbed the intent

**Observed.** `src/genes/Register.hx` no longer uses the original untyped
global lookup. It owns heterogeneous registry behavior through `HxRegistry`,
returns narrower `HxClasses` and `HxEnums` views for reflection, and keeps
`unknown`/dynamic behavior inside the runtime module rather than generated user
modules.

**Observed.** Its iterator helpers explicitly distinguish arrays, structural
iterator fields, and map-like `keys/get` objects. `tests/TestIterators.hx`
executes array and dynamic iterator behavior, including a non-callable
`iterator` field; full classic and genes-ts runtime gates passed.

**Decision.** The vendor changes are superseded. Do not replace the modern
map-like model with the narrower old fork. `genes-7be.3` should add direct
registry identity/unusual-key checks and an explicit map-like iterator trace so
the existing behavior is proved rather than inferred from broad suite use.

### Bound methods: preserve behavior before narrowing types

**Observed.** Modern `Register.bind` retains the Haxe JS protocol: a stable ID
is stored on the callable, one closure cache is stored on the receiver, null
methods remain null, and repeated reads can return the same bound closure. The
nearby documentation accurately explains why this is a dynamic host boundary.

**Observed.** `tests/TestBind.hx` proves ordinary bound calls and dynamic method
replacement, but it does not directly prove closure identity, receiver/method
cache separation, inheritance overrides, or primitive/structural receiver
limits. Generated runtime declarations currently expose this internal helper
as `any`-shaped.

**Inference.** The vendor's `Object`/`Function` signature looks cleaner, but a
cleaner spelling is not evidence that every Haxe JS call site fits it. In
particular, JavaScript binding permits receiver and callable shapes that Haxe's
nominal `js.lib.Object` surface may not describe precisely.

**Decision.** Keep the contained dynamic boundary until `genes-7be.3` supplies
the complete cache/receiver fixture. Then either introduce a truthful private
runtime shape or document the remaining boundary with exact declaration
evidence. Do not remove `Dynamic` by making the public contract false.

### Source-map JSON: adopt the type, not the old implementation

**Observed.** The current map includes the modern output filename rule,
relative source normalization, optional source content, serialization, and
transactional publication. Only the local JSON record remains typed as
`Dynamic`.

**Decision.** Add a private structural JSON type that describes version,
names, file, source root, nullable sources, mappings, and optional nullable
source content. Keep current bytes and transaction ownership unchanged. The
existing source-map consumers prove mapping behavior; `genes-7be.2` must also
assert the schema and byte stability with source content enabled and disabled.

### Writer catch: narrow the comparison fallback only

**Observed.** The catch surrounds only `exists/getContent/equality` in the
legacy buffered writer. `File.saveContent` remains after the catch, so write
failure is not intentionally swallowed. Transaction-owned compiler output has
its own stronger publication and rollback path.

**Decision.** Prefer inferred catch typing on supported Haxe versions. Add a
focused writer test that proves unchanged output avoids rewriting, read failure
falls through to a write, and write failure propagates. Do not broaden the
catch or turn it into transaction recovery. This is `genes-7be.2`.

### Assignment whitespace: enforce an outcome, not the fork's call sites

**Observed.** Raw current classic files contain visible lines ending in
` = ` for class/enum registration and classic declarations. Snapshot helpers
strip trailing whitespace before comparison, so reviewed goldens cannot detect
this. The vendor fixed only selected implementation-emitter sites.

**Decision.** This is a real output-quality blemish but not a semantic compiler
fix. Add a raw generated-output assertion that forbids whitespace after a
visible character, then correct every owned classic implementation/declaration
site required by that invariant. Indentation-only blank lines are a separate,
larger formatting decision and should not be pulled into this small change.

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

1. Complete the literal/source-map/writer/whitespace evidence in
   `genes-7be.2`, landing each independently meaningful correction.
2. Complete registry and bound-method runtime/type evidence in `genes-7be.3`.
3. Complete the async supersession matrix in `genes-7be.4`; keep the marker
   protocol rejected.
4. Run full `yarn test:ci` after every production slice.
5. Only after Genes is green, use a disposable Reflaxe.Elixir worktree for the
   five client builds, generated ESM/map review, bundler tests, and browser
   evidence (`genes-7be.5`). Do not modify or remove the real downstream vendor.

## Adoption boundary

This audit authorizes focused generic compiler work; it does not authorize a
downstream vendor removal or a release. Reflaxe.Elixir may consider switching
only after `genes-7be.5` records an exact pushed Genes revision and the
downstream task `haxe.elixir.codex-m52` pins and verifies it. Classic ESM is the
first migration target. Enabling `-D genes.ts` remains a separate product
decision.
