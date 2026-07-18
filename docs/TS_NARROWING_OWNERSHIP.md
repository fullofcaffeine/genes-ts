# TypeScript narrowing ownership inventory

This document records one focused architecture experiment. It does not propose
a second compiler or a replacement for Haxe's typed syntax tree.

## The practical problem

TypeScript rejects some nullable Haxe expressions unless the generated source
shows why the value is present. For example:

```haxe
final item = items.get(id);
if (item == null)
  return "missing";
return item.name;
```

After the guard, `item.name` is safe. Genes should emit the direct read instead
of hiding it behind a cast. This process is called **narrowing**: a condition
temporarily gives a broad type, such as `Item | null`, the more precise type
`Item`.

The proof is temporary. If the program later assigns a different object to the
receiver, removes an entry from a map, or enters a callback that runs later,
the old proof may no longer be true. Ending an outdated proof is called
**invalidation**.

At v1.36.7, these decisions are made while `TsModuleEmitter` writes tokens. The
output is often correct, but the proof cannot be inspected independently of
printing. The focused probe in this change demonstrates two stale proofs, so a
bounded TypeScript-only plan is justified.

See also:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete compiler ownership map;
- [`ARCHITECTURE_ROADMAP.md`](ARCHITECTURE_ROADMAP.md) for the incremental
  extract-shadow-switch rule;
- `yarn probe:ts-narrowing-invalidation` for the executable reduction.

## Evidence boundary

The reviewed baseline is commit `25a5e3015f8b0f0e4447b8fd0590124548f132da`
(`v1.36.7`). The ordinary `yarn test:genes-ts` gate passes on that commit.

The new probe deliberately fails on the baseline after all generated files
successfully compile with TypeScript 5.5, 6, and 7. It observes:

1. A guard proves `item.name` present. The program then assigns a new empty
   record to `item`. Generated TypeScript still prints `item.name!`, and the
   function returns raw JavaScript `undefined` instead of the declared Haxe
   `null` value.
2. A guard proves `map.get(id)` present. The program then calls
   `map.remove(id)` or `map.clear()`. Generated TypeScript still prints
   `map.get(id)!`, even though the runtime correctly returns `null`.

These observations prove that the current invalidation model is incomplete.
They do not prove that every neighboring flow rule is wrong, and they do not
authorize a general control-flow graph or SSA rewrite.

## Current ownership inventory

The table separates shared language meaning from TypeScript-only proof and
spelling. “Mutable state” means information that changes as the emitter walks a
function.

| Decision | Current input | Current owner/state | Consumers | Profile boundary | Evidence and disposition |
| --- | --- | --- | --- | --- | --- |
| Whether a type means Haxe `null`, JavaScript `undefined`, an omitted property, or a missing map entry | Haxe `Type` and field metadata | `NullishContract` | TS implementation, classic runtime paths, declarations | Shared semantic fact | Keep. The narrowing work must consume this contract and must not recreate nullish policy. |
| Whether Haxe introduced a temporary and what stable local name it receives | Typed expressions and `TVar.id` | `TempPlan` and `NamePlan` | Both implementation profiles | Shared lowering fact | Keep. A narrowing plan may refer to their typed identities but must not allocate names or temporaries. |
| Recognition of `value == null`, `value != null`, boolean `&&`/`||`/`!`, and `Map.exists(key)` | `TypedExpr` condition | `TsModuleEmitter.nullNarrowCheck` | `if` statements and conditional expressions | TypeScript-specific proof | Extract. Several consumers depend on one decision, but it has no independent typed result today. |
| Branch-local non-null facts | Recognized guard plus selected true/false branch | `narrowedNonNullKeys:Array<String>` and `emitNullNarrowedBranch` | Local initializers, optional-field reads, and map reads | TypeScript-specific proof | Extract. The push/pop stack cannot express mutation that occurs inside an already narrowed branch. |
| Facts that remain after an exiting guard | A guard and `return`, `throw`, `continue`, or `break` | `continuationNonNullKeys`, `definitelyExits`, and block-local `activeKeys` | Statements later in the same block | TypeScript-specific proof | Extract. Existing return/continue evidence is useful, but propagation and invalidation are one combined printer loop. |
| Invalidation after assignment | Assignment expression | `assignedNarrowKeys` removes exact encoded strings | Later statements in a block | TypeScript-specific proof | Correct while extracting. Exact removal misses child fields after receiver assignment, and calls such as `Map.remove`/`clear` are not represented. |
| Stable identity for locals, `this`, constants, field paths, and map reads | `TypedExpr`, local IDs, and printed field names | `stableValueKey`, `optionalFieldNarrowKey`, and `mapGetNarrowKeyFromParts` produce strings | Guard matching, map presence, and invalidation | TypeScript-specific proof built from shared typed facts | Replace with a closed typed identity. Source positions and rendered names must not become identity. |
| `map.keys()` iterator provenance | Iterator locals and loop variables | `mapKeyIteratorOrigins` and `mapKeyLocalOrigins` maps | Direct `map.get(key)` reads inside key iteration | TypeScript-specific proof | Extract with loop scope. Existing fixtures prove the common immediate loop body, not delayed callbacks or mutation. |
| Reset at a nested function | A `TFunction` boundary | The emitter temporarily replaces `narrowedNonNullKeys` with an empty array | Callback bodies | TypeScript-specific proof | Preserve and strengthen. The main fact stack resets, but iterator-origin maps are separate state and need a focused delayed-callback experiment. |
| Final TypeScript syntax (`!`, `?? null`, direct read, or contained runtime assertion) | Nullish contract plus a proven fact | `TsModuleEmitter` | Generated `.ts`/`.tsx` tokens and source maps | TypeScript syntax | Keep in the emitter. The plan answers whether a fact is valid; the emitter chooses the TypeScript spelling. |

## Why extraction is justified now

File size is not the reason. The evidence is:

- the same proof affects local declarations, calls, field reads, map reads,
  conditional expressions, loops, and continuation statements;
- fixes have repeatedly extended printer-local reasoning, including null-guard
  casts, branch propagation, exiting guards, map presence, and map value
  positions;
- the new receiver and map-mutation reductions show that state lifetime is a
  correctness decision, not formatting;
- final source text cannot reveal whether two printer paths reached the same
  result for different or contradictory reasons.

The go decision is therefore to design a small **`TsNarrowingPlan`**. The name
is intentionally target-specific: classic JavaScript remains a runtime
differential oracle but does not need TypeScript's `!` or control-flow type
proofs.

## Boundary for the next phase

The next phase may model only facts the current TypeScript emitter needs:

- a closed typed identity for a local, `this`, a field path, or a map read;
- where a fact starts and where it ends inside one function;
- branch selection and continuation after a definitely exiting statement;
- conservative invalidation for assignment, map removal/clear, loops, and
  delayed function bodies;
- the source position plus a deterministic traversal identity used to explain
  the first shadow mismatch.

The plan must be derived from `TypedExpr`, consume `NullishContract`, and leave
temporary allocation to `TempPlan`. It must carry no TypeScript text fragments.
`TsModuleEmitter` continues to own token layout, source maps, `!`, and
`?? null`.

Before switching authority, the legacy path and the new plan should run
together. Compare semantic facts, not only final text. For fixtures where the
baseline is already demonstrated wrong, record the reviewed correction instead
of forcing the new plan to reproduce the bug.

## Explicit stop conditions

Stop and request a focused architecture review if the design requires any of
the following:

- a general control-flow graph or SSA representation;
- alias analysis across arbitrary objects or function calls;
- a universal plan shared by classic JavaScript and TypeScript despite
  different needs;
- a second tree that mirrors most `TypedExpr` constructors;
- competing program-point or value-identity designs that the reduced fixtures
  cannot distinguish.

Neighboring emitter seams—signatures, private-member lowering, and class/member
declaration projection—remain deferred. This inventory does not pre-authorize
their extraction.

## Evidence still required before authority switches

The focused probe covers receiver reassignment, `Map.remove`, and `Map.clear`.
The next phase still needs passing characterization for:

- mutation inside a narrowed branch, not only after an exiting guard;
- assignment to a nested receiver and reassignment of a map local;
- reassignment of a key local after `Map.exists`;
- callbacks created inside `map.keys()` iteration;
- early `return`, `throw`, `continue`, and `break` at nested depths;
- nullable map value types, which must never become non-null merely because a
  key exists;
- loop-entry and loop-back-edge invalidation.

These cases define a bounded function-local proof. If they instead require
general alias analysis, the stop condition above applies.
