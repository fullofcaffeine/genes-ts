# Reviewed decision: typed outer completion through `try/finally`

This document records the GPT-5.6 Pro review of
`GPT_5_6_FINALLY_OUTER_COMPLETION_ARCHITECTURE.md` and the repository checks
made while turning that review into production work. It is a design contract,
not proof that ts2hx already supports outer completion through `finally`.

The practical decision is small: keep the existing helper for callbacks that
finish locally, and add a typed completion path only when `return`, `break`, or
`continue` must cross a synthetic callback. The compiler plans ownership before
printing, a private enum carries the pending action, and a pure-Haxe helper
runs the finalizer exactly once before static code dispatches or propagates the
action.

## How to read the evidence

- **Observed** means repository source, a checked generated artifact, or an
  executable fixture establishes the claim.
- **Inference** means the design follows from those observations and the
  stated control-flow rules, but production support still depends on its
  named tests.
- **Experiment required** means the repository does not yet establish the
  behavior. The feature must remain fail-closed for that shape.

Confidence, model output, and a plausible generated snapshot are not evidence
on their own. Every support claim below names the runtime or compiler gate that
must establish it.

## Verdict

Adopt a hybrid of the oracle's first two candidates:

1. `semantic/ir.ts` owns immutable function, callback, control-target, and
   transfer records before Haxe text emission.
2. Each affected generated Haxe module owns one private generic abrupt enum.
   `null` represents normal callback completion; enum values represent pending
   return, break, or continue actions.
3. `genes.js.FinallyCompletion.run<C>` treats `C` as opaque. It applies
   protected/finalizer precedence but never interprets a target or payload.
4. Generated Haxe dispatches a record only where its source target is owned.
   Otherwise it returns the record through the next enclosing completion
   callback so that every crossed finalizer still runs.
5. `genes.js.TryFinally.run` and all callback-local output remain unchanged.

Reject a whole-function state machine for this Bead. The missing behavior is
localized to synthetic callback boundaries; replacing every branch, scope,
loop, and return would create a second control-flow engine and much broader
output risk.

Reject copied or inlined finalizers. Duplication cannot mechanically guarantee
exactly-once effects, especially when the copied finalizer itself throws or
completes abruptly.

Do not advertise a return-only shortcut. Stable target ownership is the hard
part of the design, and a partial record that cannot distinguish a loop inside
an outer callback from one outside all callbacks would encode the known bug
rather than solve it.

## Repository facts checked

**Observed:** current ts2hx has only `direct-catch`, `finally-helper`, and
`unsupported-outer-transfer` plans. A return or an unbound break/continue that
would leave either generated callback receives the stable
`TS2HX-EXCEPTIONS-FINALLY-OUTER-TRANSFER-001` diagnostic.

**Observed:** the existing emitter prints transfers directly. Lowered `for`
continues use a loop-depth stack to execute the increment once, while lowered
switches have a second stack because their synthetic `do/while(false)` changes
where a raw Haxe `break` would land. There is no function-local target identity
or callback ownership plan yet.

**Observed:** `TryFinally.run` is an intentionally narrow raw-JavaScript IIFE.
It is sound for local callback completion and its hxdoc says outer transfers
are rejected. The reviewed architecture keeps it byte-stable.

**Observed:** a pre-production Haxe 4.3.7 spike established that a generic
completion enum works as `Completion<Void>`, a pure-Haxe runner can preserve
throw/finalizer precedence without raw target syntax, and Haxe switch dispatch
can perform real return/break/continue actions. The manual nested transcript
also distinguished a loop target inside an outer callback from a target outside
both callbacks in standard Haxe, classic Genes, and genes-ts.

**Observed after the review:** private Haxe module visibility alone is not an
output-containment boundary in either Genes profile. Stage 1 therefore added a
shared five-fact projection for explicitly `@:genes.compilerInternal` types.
Those types remain local implementations but have no export, declaration,
public runtime registration, or source-map interval.

**Correction to the oracle recommendation:** ordinary Haxe `private` types are
not hidden by that projection. A live classic declaration regression showed
that public tink signatures traverse the private `RegrouperBase` helper to
public result enums. Erasing all source-private helpers left dangling consumer
names. Normalizing ordinary privacy requires a separate public-type
accessibility design; compiler ownership does not prove declaration
inaccessibility.

## Completion semantics

Use this conceptual domain for one source action:

```text
Completion<T> =
  Normal
  | host Throw(value)
  | ReturnValue(T)
  | ReturnVoid
  | Break(TargetId)
  | Continue(TargetId)
```

Throws stay real host throws. They are not enum records. This preserves the
original thrown object and natural stack behavior while keeping host-dynamic
values out of the generated user carrier.

The helper applies this precedence table:

| Protected outcome | Finalizer outcome | Result |
| --- | --- | --- |
| normal, throw, return, break, or continue | normal | preserve protected outcome |
| normal, throw, return, break, or continue | return, break, or continue record | use finalizer record |
| normal, throw, return, break, or continue | host throw | propagate finalizer throw |

Important timing rules:

- A return expression is evaluated once inside the callback, before its record
  is constructed and before the finalizer starts.
- A protected throw is rethrown as the same value only after a normal
  finalizer.
- A finalizer result or throw replaces the protected result or throw.
- A lowered `for` increment is not stored in the record. It runs exactly once
  when `ContinueTo(loopId)` finally reaches that loop's dispatcher.
- A break never runs the increment or trailing body statements.
- The protected callback is invoked once and the finalizer is invoked once.
  No finalizer statement is copied to a transfer site.

## Immutable semantic model

The exact names may evolve, but ownership must be explicit before emission:

```ts
type FunctionId = number & {readonly __functionId: unique symbol};
type CallbackId = number & {readonly __callbackId: unique symbol};
type TargetId = number & {readonly __targetId: unique symbol};
type TransferId = number & {readonly __transferId: unique symbol};

type CallbackPath = readonly CallbackId[];

type ControlTargetPlan = Readonly<{
  id: TargetId;
  functionId: FunctionId;
  kind: "function-return" | "loop" | "switch";
  ownerPath: CallbackPath;
  loopKind?: "while" | "do" | "for" | "for-of";
  continueStep?: ts.Expression;
  source: SourceRef;
}>;

type TransferPlan = Readonly<{
  id: TransferId;
  functionId: FunctionId;
  kind: "return-value" | "return-void" | "break" | "continue";
  targetId: TargetId;
  sourcePath: CallbackPath;
  targetPath: CallbackPath;
  crossedCallbacks: readonly CallbackId[];
  disposition: "direct" | "encode" | "unsupported";
  source: SourceRef;
}>;

type FinallyPlan = Readonly<{
  parentPath: CallbackPath;
  protectedCallback: CompletionCallbackPlan;
  finalizerCallback: CompletionCallbackPlan;
  strategy:
    | "direct-catch"
    | "finally-helper-local"
    | "finally-helper-completion"
    | "unsupported-outer-transfer";
  crossingTransfers: readonly TransferId[];
  source: SourceRef;
}>;

type FunctionCompletionPlan = Readonly<{
  id: FunctionId;
  returnTarget: ControlTargetPlan;
  returnCarrier: ReturnCarrierPlan;
  callbacks: readonly CompletionCallbackPlan[];
  finallyRegions: readonly FinallyPlan[];
  targets: readonly ControlTargetPlan[];
  transfers: readonly TransferPlan[];
  source: SourceRef;
}>;
```

IDs are deterministic ordinals local to one planned source/function, never a
process-global registry. Nested functions and methods begin with fresh target
and callback stacks. A transfer record never crosses a function boundary.

For every valid unlabelled transfer, `targetPath` must be a prefix of
`sourcePath`: source control flow can leave callbacks but cannot jump into one.
Removing the target prefix gives the callbacks crossed from inner to outer.
If that invariant fails, planning failed; the emitter must not guess.

## Typed Haxe contract

An affected generated module owns one carrier, conceptually:

```haxe
@:genes.compilerInternal
private enum __Ts2hxFinallyAbrupt<T> {
  ReturnValue(value:T);
  ReturnVoid;
  BreakTo(target:Int);
  ContinueTo(target:Int);
}
```

`Null<__Ts2hxFinallyAbrupt<T>>` is the callback result. Carrier-level `null`
means normal completion, while `ReturnValue(null)` remains an unambiguous
nullable return payload. `ReturnVoid` avoids inventing a value for `Void`.

The runtime helper is deliberately unaware of that enum:

```haxe
public static function run<C>(
  body:Void->Null<C>,
  finalizer:Void->Null<C>
):Null<C>;
```

Only `body()` belongs inside the helper's catchable `try`. On body success, the
helper calls the finalizer outside that `try`. On body throw, the catch branch
calls the finalizer. A non-null finalizer result is returned; a normal
finalizer rethrows the exact protected value. A finalizer throw escapes both
paths naturally.

This layout is a correctness invariant, not formatting preference. If the
normal finalizer call were inside the protected `try`, its throw would enter
the catch branch and invoke the same finalizer a second time.

The one `catch (bodyError:Any)` is a narrow host boundary. The helper never
reads, converts, or casts that value; it either rethrows it unchanged or lets a
finalizer outcome replace it. Generated carrier and application modules remain
strongly typed.

## Dispatch and nested ownership

After a completion-aware helper returns, emission is at the region's parent
callback path.

```text
target owner path == current path  -> dispatch the real source action here
target owner path prefixes current -> return the record through this callback
anything else                      -> planner invariant failure
```

For a loop declared inside an outer protected callback:

```text
outer callback path       [outer]
loop owner path           [outer]
inner callback path       [outer, inner]
transfer source path      [outer, inner]
```

The inner helper returns at `[outer]`, which owns the loop. It dispatches the
break/continue there, preserving later statements inside the outer protected
callback. The outer finalizer runs only when that outer callback later exits.

For a loop outside both callbacks, its owner is `[]`. The inner helper returns
at `[outer]`, sees that `[]` is only a prefix, and propagates the record out of
the outer protected callback. The outer helper runs its finalizer and returns
at `[]`, where the real loop transfer is finally dispatched.

This is why an integer target by itself is insufficient. The same target kind
can stop at different callback depths; stable identity and owner path are both
required.

## First production boundary

After all named evidence passes, the first support claim may include:

- synchronous named function declarations and ordinary class methods already
  accepted by strict ts2hx;
- an explicit return annotation that maps to a strong Haxe carrier type;
- unlabelled return, break, and continue from protected, catch, or finalizer
  code;
- supported `while`, `do`, lowered `for`, `for...of`, and normalized switch
  targets;
- nested `try/finally`, including targets inside versus outside an enclosing
  callback;
- protected throws, caught throws, rethrows, and finalizer override.

Keep these shapes fail-closed initially:

- async functions and methods;
- generators and `yield`;
- constructors;
- labelled break or continue;
- arrows, anonymous/default function expressions, and object-literal methods
  until every emitter path has an independent function context;
- inferred, weak, or broad return carriers;
- generic function returns until a focused multi-profile type fixture passes;
- loop, switch, or top-level control-flow forms outside the existing strict
  subset.

The stable outer-transfer diagnostic remains the owner of excluded variants.
Strict mode publishes no partial tree; assisted mode records an explicit loss
and makes no runtime-equivalence claim.

## Incremental landing plan

Each stage is independently reversible and must retain the existing support
matrix until the final evidence stage:

1. **Internal type containment.** Add one shared output projection; prove local
   implementation, no export/declaration/registry/map leak. Do not alter
   ordinary private-type behavior without a separate accessibility design.
2. **Opaque runtime runner.** Add `FinallyCompletion.run<C>` with exact
   precedence and exactly-once fixtures. Keep `TryFinally.run` unchanged.
3. **Shadow semantic plan.** Compute function/callback/target/transfer records
   while retaining the current rejection and byte-stable output.
4. **Function-local emitter state.** Replace source-file-wide loop-depth state
   with target identities and reset every nested function context, without
   changing emitted behavior.
5. **Return/catch/nested lowering.** Emit private carriers, callback records,
   root dispatch, and nested propagation for return and throw cases. Keep the
   feature row unsupported.
6. **Break/continue lowering.** Integrate target-aware loop increments and
   switch escape routing; prove local versus propagated targets.
7. **Promotion and evidence.** Run original TypeScript, classic Genes,
   genes-ts, and every retained request-free standard-Haxe claim under full
   DCE. Then update semantic counts, docs, compatibility reports, budgets, and
   full CI.

## Evidence matrix

Before promotion, executable differentials must cover:

- return payload evaluation before a normal finalizer;
- finalizer return over protected return or throw;
- normal finalizer preserving the exact protected thrown value;
- finalizer throw over protected normal, return, or throw;
- body- and finalizer-originated break/continue in every supported loop;
- exactly-once lowered-`for` increments and skipped increments after break;
- target inside an outer protected callback versus outside all callbacks;
- nested return precedence through two and three regions;
- catch binding, omitted binding, return from catch, and rethrow;
- switch break, switch-to-loop continue, nested switches, and fallthrough;
- `Void`, nullable, rejected weak/inferred, and later generic carriers;
- no compiler carrier in exports, declarations, runtime registries, source
  maps, or unrelated imports;
- strict/assisted transaction preservation and deterministic cold/same-process
  trees;
- TypeScript 5/6/7, owned Haxe 4/5 lanes, Node 20/22, and final
  `yarn test:ci`.

## Current evidence status

- Stage 1 landed in `0a6522b` after focused export/declaration/source-map tests
  and full `yarn test:ci` (2,106.38 seconds). Its ordinary-private boundary was
  narrowed based on the concrete tink declaration regression described above.
- Stage 2's focused fixture proves the exact pure-Haxe helper under full DCE in
  standard Haxe, classic Genes, and genes-ts; TypeScript 5, 6, and 7 validate
  both generated implementation and classic consumer declarations. Full
  final-tree `yarn test:ci` passed in 1,397.86 seconds with unchanged baseline
  output-quality hashes, both todoapp browser profiles, and all existing
  supported/fail-closed ts2hx contracts green. That run checks exact identity
  for object, string, native `Error`, and Haxe exception throws rather than
  extrapolating from one exception shape.
- Stage 3 now has focused shadow evidence: deterministic source-local string
  IDs avoid casts and process-global counters; 16 reduced functions prove
  return/catch/finalizer ownership, inner versus outer loop targets, nested
  function isolation, weak/inferred carriers, and labelled failure. The live
  supported and unsupported fixtures agree exactly with current `planTry`.
  Full `yarn test:ci` passed in 1,297.81 seconds with all 48 snapshots and
  current semantic/transaction contracts unchanged.
- Stage 4 now uses the plan's target identities for existing direct loop and
  switch emission. Every source function receives fresh active-target,
  lowered-for-increment, and switch-escape state; synthetic helper callbacks
  remain in their source function. All 48 reviewed snapshots stayed
  byte-stable, and a focused nested-function differential matched original
  TypeScript, classic Genes, and genes-ts. The complete ts2hx gate passed in
  290.30 seconds. Full `yarn test:ci` then passed in 988.32 seconds, including
  security checks, TypeScript 5/6/7, both output profiles, declarations,
  transaction owners, and all six todoapp browser journeys. At that landing
  point, completion callback paths were not yet emitted and the old `planTry`
  rejection still owned production behavior.
- Stage 5 now emits the return-only portion of the reviewed design. One
  collision-safe private generic enum per affected Haxe module carries value
  or bare returns; nested helpers propagate the opaque record and the function
  root dispatches it. A strongly typed temporary evaluates each return value
  once and prevents nullable `null` payloads from producing an unsafe generic
  cast. A final invariant throw represents TypeScript-proved unreachable
  fallthrough without fabricating a value. The three-runtime differential
  covers preserved/overriding returns, protected and finalizer throws, exact
  object identity, nested precedence, bound and omitted catches, rethrow,
  `Void`, nullable values, and a class method. The request-free snapshot also
  runs under standard Haxe JS, strictly checks genes-ts output, and proves
  generated type/local collision avoidance. The planner now has 18 focused
  functions, including explicit anonymous-default and `undefined`-carrier
  exclusions. Full `yarn test:ci` passed in 1,241.35 seconds: the 49 reviewed
  snapshots, 18 exercised/13 fail-closed semantic contracts, TypeScript 5/6/7,
  both Genes profiles, the standard-Haxe request-free fixture, declarations,
  output ownership, transactions, security checks, and all six todoapp browser
  journeys were green. This proves only the documented synchronous-return
  boundary; it does not prove loop-target completion dispatch.
- Stage 6 now spells target-aware break and continue records. Deterministic
  function-local integers are only the final Haxe representation; the planner's
  callback path decides whether each target dispatches here or propagates to an
  outer helper. Focused runtime evidence covers body/finalizer transfers in
  while, do/while, lowered for, for-of, and lowered switch; exact for-step
  timing; protected throws suppressed by finalizer control; finalizer throws;
  catch control; mixed value/control carriers; and a single inner helper that
  dispatches to a loop inside an outer callback while propagating a return from
  another branch. The first executable D-case exposed and fixed one integration
  gap: callback-local outer helpers must still enter their planned path so an
  inner target can stop there. The new request-free control snapshot matches
  standard Haxe and compiles through genes-ts with TypeScript 5/6/7; the larger
  semantic transcript matches original TypeScript, classic Genes, and genes-ts.
  Existing return-only and callback-local snapshots remain byte-stable. Full
  `yarn test:ci` passed in 370.09 seconds, including security and dependency
  gates, TypeScript 5/6/7, classic Genes and genes-ts, declarations, output
  ownership and transactions, all 50 reviewed ts2hx snapshots, the complete
  18-exercised/13-fail-closed semantic suite, and all six todoapp Playwright
  journeys. This proves the staged synchronous target boundary; it does not
  promote the public support row or prove any deferred function/target form.
- Stage 7 promotes only the executable synchronous boundary.
  `exceptions.finally-outer-transfer` is now `supported-with-helper / J1` for
  unlabelled return, break, and continue in named function declarations and
  ordinary class methods with an explicit strongly mapped return type and a
  supported target: break may target while/do/for/for-of/switch, while continue
  may target while/do/for/for-of. The matrix therefore has 18 supported rows and
  1 unsupported row. The same stable outer-transfer
  diagnostic still owns excluded async, generator, constructor, anonymous,
  labeled, unsupported-loop, inferred, generic, and weak-carrier forms, so the
  canonical fail-closed inventory remains 13. The complete ts2hx gate passed
  in 102.76 seconds; full `yarn test:ci` passed in 326.14 seconds with security
  and dependency checks, TypeScript 5/6/7, classic Genes, genes-ts,
  declarations, output ownership and transactions, all 50 reviewed snapshots,
  the three-runtime semantic differential, and all six todoapp Playwright
  journeys. Promotion changed the published contract and derived evidence, not
  the already-proven Stage 6 lowering.

No later stage may cite the oracle response as proof. It may cite this document
for the chosen invariant, then must cite its own fixture and gate for behavior.
