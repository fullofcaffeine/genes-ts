# GPT-5.6 Pro review: typed outer completion through `try/finally`

Use this prompt with GPT-5.6 Pro after uploading the focused Repomix XML
listed at the end. This is a narrow compiler architecture review. Do not write
a broad patch until completion ownership, target dispatch, and finalizer
override semantics are mechanically explicit.

---

You are reviewing a real TypeScript-to-Haxe migration tool inside a
Haxe-to-TypeScript/JavaScript compiler. Work evidence-first from the uploaded
repository files. Label important claims as **observed**, **inference**, or
**experiment required**. Cite uploaded paths and line ranges. If the supplied
files cannot establish a Haxe, TypeScript, or ECMAScript fact, name the
smallest fixture and command that would establish it.

## Decision requested

Design the smallest typed completion-record lowering that lets ts2hx preserve
an unlabelled `return`, `break`, or `continue` crossing a TypeScript
`try/finally` region.

The answer must preserve JavaScript completion precedence exactly:

1. a normally completing finalizer preserves the protected region's normal,
   thrown, return, break, or continue completion;
2. an abrupt finalizer completion overrides the protected completion;
3. return expressions, loop increments, conditions, calls, and finalizer
   effects execute exactly once and in source order;
4. nested `try/finally` regions propagate a completion only across the callback
   boundaries it truly leaves; and
5. the same translated Haxe must run equivalently through classic Genes JS and
   Genes TypeScript output, with request-free standard Haxe JS retained only if
   a focused runtime differential proves it.

Do not solve this with `Dynamic`, `untyped`, generated `any`, a raw emitted
target-language control-flow string, duplicated finalizer side effects, or a
process-global macro registry. A narrower fail-closed first subset is better
than a lowering that happens to pass one return example.

The review baseline is production commit
`8d5813c013391ea5ed4a949e906d8a3e9e1155cc`. The uploaded tree may additionally
contain this prompt and repository-agent guidance; those do not change compiler
behavior. Bead `genes-2w9` owns the work.

## Why this review exists

ts2hx already preserves bounded `try/catch` and `try/finally` behavior. Haxe
has no source-level `finally`, so current translated Haxe calls the typed
`genes.js.TryFinally.run(body, finalizer)` boundary. The helper uses one narrow
inline JavaScript IIFE to run the finalizer after normal or thrown body
completion. This is sound only while both callbacks complete locally.

A source `return` inside the protected region cannot remain a Haxe `return`
inside `body`: it would return from the synthetic callback instead of the
original function. The same problem applies to an unlabelled `break` or
`continue` whose target is outside the callback. `planTry` therefore selects
`unsupported-outer-transfer`, and strict mode emits
`TS2HX-EXCEPTIONS-FINALLY-OUTER-TRANSFER-001` transactionally.

This is one of only two unsupported semantic rows. It is core control-flow
semantics, unlike the other remaining row for dynamic prototype mutation, so
it is the next generic compiler gap. The implementation is nevertheless risky:
a completion record that knows only `Break` or `Continue` is insufficient when
one target is inside an enclosing protected callback and another target is
outside it.

## Current implementation facts to verify

- `tools/ts2hx/src/semantic/ir.ts` defines `TryPlan` with
  `direct-catch | finally-helper | unsupported-outer-transfer`.
  `hasTransferEscapingCallback` stops at function/class boundaries, treats any
  return as escaping, and treats break/continue as escaping only when no nested
  loop/breakable target exists inside the proposed callback.
- `tools/ts2hx/src/haxe/emit.ts` prints returns and breaks directly. It owns a
  `continueSteps` stack so a lowered TypeScript `for` executes its increment
  exactly once before continue. It separately owns `switchContinueTransfers`
  because a source switch is lowered through a synthetic `do/while(false)`.
- The emitter has no explicit stack of source break targets, completion
  regions, or current function return types. `emitFunctionLike` and
  `emitAnonFunctionLike` recursively reuse one `EmitContext`.
- Current finally lowering wraps the protected statements (or a direct Haxe
  `try/catch`) in the helper's first callback and the finalizer statements in
  its second callback. Neither callback returns a semantic completion value.
- `src/genes/js/TryFinally.hx` is the intentional JavaScript boundary. Its
  hxdoc says outer transfers are rejected. The current generic helper returns
  the body value, runs a `Void->Void` finalizer, preserves the original throw
  when the finalizer completes, and naturally lets a finalizer throw override
  it.
- The semantic differential runs original TypeScript, translated classic
  Genes, and translated genes-ts. It exercises ordinary catch/finally behavior
  and owns the canonical outer-transfer diagnostic at
  `finallyTransfer.ts:2:3`.
- The catalog currently has 19 rows: 17 supported, 2 unsupported, and 13
  canonical fail-closed variants. Promoting this row changes those counts only
  after every claimed transfer shape has executable evidence.
- Standard Haxe is an explicit capability failure for files with effective ESM
  requests, but request-free generated Haxe still has independent standard-JS
  snapshot/runtime coverage. A completion helper may therefore remain J1 while
  still being genuinely executable without the Genes generator.
- Labeled continue is already a separately rejected `switch.continue` variant.
  General labeled break/continue, async-finally transfer, and arbitrary
  top-level executable statements do not have broad support claims.

Correct any claim that the uploaded files disprove.

## Required semantic cases

The architecture must explain all of these, even if some remain explicitly
fail-closed in the first increment.

### A. Return value preserved through a normal finalizer

```ts
function preserved(events: string[]): number {
  try {
    events.push("body");
    return events.push("return-value");
  } finally {
    events.push("finally");
  }
}
```

The return expression is evaluated before the finalizer, once. The returned
number is preserved after the finalizer completes normally.

### B. Finalizer return and throw override

```ts
function overridden(events: string[]): number {
  try {
    events.push("body");
    return 1;
  } finally {
    events.push("finally");
    return 2;
  }
}

function throwOverride(events: string[]): number {
  try {
    throw new Error("body");
  } finally {
    events.push("finally");
    throw new Error("finalizer");
  }
}
```

The first returns `2`; the second exposes only the finalizer error. Also cover
a finalizer return overriding a protected throw, and a normal finalizer
preserving a protected throw.

### C. Break and continue through a finalizer

```ts
function loop(events: string[]): string {
  for (let i = 0; i < 3; i++) {
    try {
      events.push(`body:${i}`);
      if (i === 0) continue;
      if (i === 1) break;
    } finally {
      events.push(`finally:${i}`);
    }
    events.push(`after:${i}`);
  }
  return events.join(",");
}
```

The `continue` must run the finalizer and then the lowered `for` increment once.
The `break` must run the finalizer and skip the increment and trailing body.

### D. Target inside versus outside an enclosing completion callback

```ts
function nestedTarget(events: string[]): void {
  try {
    for (let i = 0; i < 2; i++) {
      try {
        if (i === 0) continue;
        break;
      } finally {
        events.push(`inner:${i}`);
      }
    }
    events.push("after-loop");
  } finally {
    events.push("outer");
  }
}
```

The inner completion crosses the inner callback but targets a loop *inside*
the outer protected callback. It must dispatch there, not propagate out of the
outer callback and skip `after-loop`. Contrast this with a break/continue from
a `try/finally` whose loop target encloses both finalizers.

### E. Nested return precedence

```ts
function nestedReturn(events: string[]): number {
  try {
    try {
      return 1;
    } finally {
      events.push("inner");
    }
  } finally {
    events.push("outer");
    return 3;
  }
}
```

The inner return must cross both regions, both finalizers run in order, and the
outer finalizer's return wins.

### F. Catch plus finally

Cover protected throws caught inside the region, return from catch, throw from
catch, catch binding/omitted binding, and an abrupt finalizer overriding every
one of those outcomes.

## Candidate directions to evaluate

These are hypotheses, not instructions. Adopt, reject, or combine them.

### Candidate 1: typed generic completion enum plus helper

Introduce a compiler/runtime-owned algebra such as:

```haxe
enum FinallyCompletion<T> {
  Normal;
  ReturnValue(value:T);
  ReturnVoid;
  Break(target:Int);
  Continue(target:Int);
}
```

and a helper whose body/finalizer callbacks return completions. The helper runs
the finalizer once; a non-normal finalizer result overrides the body result;
body throws are rethrown only when the finalizer completes normally; finalizer
throws propagate naturally.

Evaluate whether Haxe permits the required generic/Void shapes, how return
types are supplied without `Dynamic`, how enum allocation affects emitted JS,
and whether a narrow host-thrown-value catch boundary needs `Any` or another
documented representation. Specify exact hxdoc and declaration visibility.

Most importantly, do not assume an integer target alone solves dispatch.
Define stable target identities and the completion-region depth/ownership that
decides whether a record is dispatched after the inner helper or propagated
through an enclosing helper.

### Candidate 2: compiler-only completion records and static dispatch

Keep completion records as a ts2hx normalized plan, but print local typed flags,
enums, or result variables rather than exposing a broad public helper API.
At each finally boundary, statically emit only the return/break/continue cases
that can reach it. Evaluate determinism, type inference, source maps, code size,
duplicated dispatch, nested propagation, and whether both Genes printers see
the same ordinary typed Haxe semantics.

### Candidate 3: transform the enclosing function into a control-flow state
machine

Normalize the whole function so no source transfer crosses a callback. This
could make target ownership explicit, but risks a universal IR, substantial
output churn, altered scopes, and poor source maps. Recommend it only if the
small local seam cannot be sound, and define the smallest bounded node rather
than a second compiler engine.

### Candidate 4: inline or duplicate finalizers before every abrupt transfer

Insert finalizer statements before return/break/continue and separately on
normal/throw paths. Analyze double execution when an inlined finalizer throws,
scope/capture differences, declarations, target precedence, code growth, and
nested finalizers. Reject this if it cannot preserve the language semantics
mechanically.

### Candidate 5: staged support boundary

First support return only, or return plus transfers to one directly enclosing
loop, while retaining stable failures for nested targets, async bodies,
generators, labeled transfers, or finalizer-originated transfer. If this is the
safest route, define source-positioned variants and explain why the advertised
semantic row is not broader than its evidence.

## Questions the decision must resolve

1. What immutable completion-region and control-target records should
   `semantic/ir.ts` own before Haxe text emission?
2. How is each source return/break/continue assigned to a function, loop,
   switch, or labeled target, and how is callback-crossing depth computed?
3. At an inner finally boundary, when is a completion dispatched locally and
   when is it propagated through an outer completion callback?
4. How does a lowered `for` continue retain its exactly-once increment, and how
   does switch's synthetic `do/while(false)` retain source break/continue
   meaning?
5. What typed Haxe representation handles value returns, bare returns, and
   functions returning `Void` without weak types or fabricated defaults?
6. How does the helper preserve body throws while allowing a finalizer return
   or throw to override them? Is raw `js.Syntax.code` still needed?
7. Can the helper be ordinary request-free standard Haxe JS, or is it a Genes
   capability? What exact runtime lanes prove the claim?
8. How are nested functions/classes excluded so their transfers remain owned by
   their own function contexts?
9. What is the first sound boundary for constructors, async functions,
   generators, labeled control flow, switch clauses, and nested finalizers?
10. Which semantic row owns excluded variants, and how do strict and assisted
    transactions report them without implying executable parity?
11. What generated output and source-map budget is acceptable, and how are
    compiler/runtime internals kept out of user declarations and public API?
12. Can existing `TryFinally.run` remain byte-stable for local-completion cases
    while the completion-aware path is added separately?

## Non-negotiable repository rules

1. genes-ts remains one general-purpose Haxe-to-TS and Haxe-to-modern-JS
   compiler. Classic Genes and genes-ts are first-class output profiles and
   share semantic facts.
2. The TypeScript Compiler API and typed Haxe AST remain authoritative. Do not
   port to Reflaxe, create a second compiler engine, or build a universal IR.
3. No downstream paths, names, schemas, DTOs, or product behavior may enter
   compiler code.
4. No `untyped`, `Dynamic`, emitted `any`, broad `unknown`, unchecked casts, raw
   target control-flow strings, or process-global registries.
5. A narrow documented host exception boundary is acceptable only if the
   thrown value is inherently dynamic, operations remain guarded, and both
   generated profiles keep user modules strongly typed.
6. Unsupported input remains deterministic, source-positioned,
   transactional, and fail-closed. Assisted output carries an explicit loss
   and no runtime/parity claim.
7. Evaluate every expression and finalizer exactly once. Do not change scopes,
   closures, catch behavior, loop increments, switch fallthrough, or async
   scheduling accidentally.
8. Compiler/runtime helper types must not leak into translated public APIs,
   `.d.ts`, source maps, or unrelated module dependency graphs.
9. Advanced Haxe enums, generics, macros, metadata, and JS interop require
   didactic Why/What/How hxdoc explaining typing and codegen pitfalls.
10. Preserve deterministic output, exact provenance, clean-tree ownership, and
    the full transaction boundary.
11. Land incrementally with rollback points, focused differentials, then full
    `yarn test:ci`, including both todoapp profiles and security gates.
12. Every non-trivial commit needs a beginner-readable body that explains the
    old behavior, new behavior, verification, and intentionally deferred scope.

## Required answer

Return a decision document with these sections:

1. **Verdict and exact first boundary** — adopt/reject/modify every candidate;
   distinguish what is supported now, in the first increment, and later.
2. **Completion semantics** — specify normal/throw/return/break/continue
   precedence, expression timing, finalizer override, and nesting.
3. **Semantic model** — immutable TypeScript plans for functions, regions,
   control targets, transfer ownership, and provenance. Include concise typed
   TypeScript pseudocode.
4. **Typed Haxe/runtime contract** — exact enum/abstract/helper APIs, generic
   behavior, Void returns, exception boundary, DCE, visibility, and Why/What/How
   hxdoc obligations. Include concise Haxe pseudocode.
5. **Emitter algorithm** — walk planning, callback emission, propagation, and
   local dispatch for return, direct loop break/continue, lowered `for`, and
   lowered switch.
6. **Proof for cases A-F** — trace each through TypeScript semantics, generated
   Haxe, both Genes profiles, standard Haxe if retained, and runtime execution.
7. **Nested-target proof** — explicitly show why a completion aimed at a loop
   inside an outer callback dispatches there while an outer target propagates.
8. **Failure modes and threat model** — include finalizer double execution,
   throw override, generic/Void typing, target aliasing, nested functions,
   async/generators, switch state, for increments, source maps, declarations,
   code growth, and compile-server state.
9. **Incremental implementation plan** — separate reversible commits/Beads,
   shadow checks, rollback points, and the smallest production file changes.
10. **Test matrix** — original TypeScript, classic Genes, genes-ts, and every
    retained standard-Haxe claim; `-dce full`; cases A-F; nested regions;
    return/break/continue overrides; throw/catch; for/switch; no helper leakage;
    transaction preservation; deterministic trees; pinned TS/Haxe lanes; and
    full CI.
11. **Exact semantic/docs/compatibility changes** — support grades, canonical
    failure variants, counts, limitations/usage wording, fixture inventory, and
    compatibility evidence. Do not guess measured output budgets.
12. **Open experiments** — only facts not provable from the upload, each with
    the smallest fixture and exact command that resolves it.

Do not return a generic essay about JavaScript `finally`. Prefer a narrow,
typed, mechanically provable local normalization. If target identity or Haxe
generic behavior is uncertain, mark it experimental until the proposed fixture
proves it.

## Focused files to upload

Upload the companion Repomix XML containing at least:

- `AGENTS.md`, `package.json`, `haxelib.json`, `extraParams.hxml`, and
  `config/toolchains.json`;
- `src/genes/js/TryFinally.hx` and the async/control helpers it interacts with;
- `tools/ts2hx/src/semantic/ir.ts`;
- `tools/ts2hx/src/haxe/emit.ts`;
- the transaction planner/commit section in `tools/ts2hx/src/haxe/emit.ts`;
- `tools/ts2hx/src/test-semantic-diff.ts`, `test-snapshots.ts`, and
  `test-roundtrip.ts`;
- the complete semantic-diff and semantic-unsupported fixtures;
- representative generated Haxe snapshots containing try/catch/finally,
  loops, switches, async functions, and nested functions;
- `docs/ARCHITECTURE.md`, `ARCHITECTURE_ROADMAP.md`, `OUTPUT_MODES.md`, and
  `COMPATIBILITY_REPORT.{md,json}`;
- `docs/ts2hx/LIMITATIONS.md`, `PLAN.md`, `PORTABILITY.md`, `USAGE.md`, and
  `WORKFLOWS.md`;
- `tests/compatibility/evidence.json`;
- this prompt.

Do not include `node_modules`, generated build/output trees beyond the named
reviewed Haxe snapshots, `.tmp`, unrelated archives, secrets, or machine-local
paths.

---
