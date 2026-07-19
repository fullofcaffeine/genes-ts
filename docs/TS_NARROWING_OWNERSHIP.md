# TypeScript narrowing ownership inventory

This document records one completed, focused architecture extraction. It does
not propose a second compiler or a replacement for Haxe's typed syntax tree.

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

At v1.36.7, these decisions were made while `TsModuleEmitter` wrote tokens. The
output was often correct, but the proof could not be inspected independently of
printing. The focused baseline probe demonstrated stale proofs. They are now
owned by a bounded TypeScript-only `TsNarrowingPlan` built before printing.

See also:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete compiler ownership map;
- [`ARCHITECTURE_ROADMAP.md`](ARCHITECTURE_ROADMAP.md) for the incremental
  extract-shadow-switch rule;
- `yarn test:ts-narrowing` for the executable reduction and regression gate.

## Evidence boundary

The reviewed baseline is commit `25a5e3015f8b0f0e4447b8fd0590124548f132da`
(`v1.36.7`). The ordinary `yarn test:genes-ts` gate passes on that commit.

The original probe deliberately failed on the baseline after all generated
files successfully compiled with TypeScript 5.5, 6, and 7. It observed:

1. A guard proves `item.name` present. The program then assigns a new empty
   record to `item`. Generated TypeScript still prints `item.name!`, and the
   function returns raw JavaScript `undefined` instead of the declared Haxe
   `null` value.
2. A guard proves `map.get(id)` present. The program then calls
   `map.remove(id)` or `map.clear()`. Generated TypeScript still prints
   `map.get(id)!`, even though the runtime correctly returns `null`.

The passing owner gate now proves that these facts end after mutation and that
the runtime sees Haxe `null`, not raw JavaScript `undefined`. The observations
did not prove every neighboring flow rule wrong, and the fix does not introduce
a general control-flow graph or SSA rewrite.

## Final ownership inventory

The table separates shared language meaning from TypeScript-only proof and
spelling. “Mutable state” means information that changes while the plan builder
walks one function; the emitter only reads the finished decisions.

| Decision | Current input | Current owner/state | Consumers | Profile boundary | Evidence and disposition |
| --- | --- | --- | --- | --- | --- |
| Whether a type means Haxe `null`, JavaScript `undefined`, an omitted property, or a missing map entry | Haxe `Type` and field metadata | `NullishContract` | TS implementation, classic runtime paths, declarations | Shared semantic fact | Keep. The narrowing work must consume this contract and must not recreate nullish policy. |
| Whether Haxe introduced a temporary and what stable local name it receives | Typed expressions and `TVar.id` | `TempPlan` and `NamePlan` | Both implementation profiles | Shared lowering fact | Keep. A narrowing plan may refer to their typed identities but must not allocate names or temporaries. |
| Recognition of `value == null`, `value != null`, boolean `&&`/`||`/`!`, and `Map.exists(key)` | `TypedExpr` condition | `TsNarrowingPlan` condition facts | `if` statements, conditional expressions, and same-block continuation | TypeScript-specific proof | One typed owner. Unsupported conditions introduce no fact. |
| Branch-local and continuing non-null facts | Recognized guard plus selected branch or an exiting statement | Function-local plan state and immutable decisions at stable program points | Local initializers, optional-field reads, and map reads | TypeScript-specific proof | Extracted. The emitter asks a question at the read; it no longer pushes facts while writing braces. |
| Invalidation after assignment | Exact typed assignment receiver | `TsNarrowValueIdentityTools.dependsOn` plus `ValueChanged` | Every later read in the function | TypeScript-specific proof | A receiver change also ends child-field and dependent map/key facts. No rendered-name parsing is involved. |
| Map mutation | Stable typed map/key plus `remove` or `clear` | `MapEntryRemoved` and `MapCleared` invalidations | Later `Map.get` reads | TypeScript-specific proof | `remove` ends one exact entry proof; `clear` ends every fact for that exact map. Nullable map value types never gain presence-as-non-null facts. |
| Stable identity for locals, `this`, constants, field paths, and map reads | `TypedExpr` and Haxe local IDs | Closed `TsNarrowValueIdentity` enum | Guard matching, map presence, and invalidation | TypeScript-specific proof built from shared typed facts | Source positions and generated names are deliberately excluded from equality. |
| `map.keys()` iterator provenance | Iterator and yielded-key locals | Function-local iterator origins in `TsNarrowingPlan` | Direct `map.get(key)` reads during the same loop | TypeScript-specific proof | A nested callback starts with an empty function state, so a key proof cannot leak into delayed work. |
| Loop entry and back-edge safety | Loop kind plus mutations found in the bounded loop body | Exact loop mutation summary applied before the shared body program point | Reads in and after loops | TypeScript-specific proof | A `while` condition can narrow its body, while a `do...while` condition cannot narrow the first body execution. The summary models assignments and map mutation only; it is not a general CFG or alias analysis. |
| Reset at a nested function | A `TFunction` boundary | A fresh function-local builder state | Callback bodies | TypeScript-specific proof | Outer facts and iterator provenance never enter a delayed callback. |
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

The completed design is a small **`TsNarrowingPlan`**. The name is intentionally
target-specific: classic JavaScript remains a runtime differential oracle but
does not need TypeScript's `!` or control-flow type proofs.

## Implemented boundary

The plan models only facts the TypeScript emitter needs:

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

Before authority switched, the legacy path and the new plan ran together across
the generated matrix. The comparison used facts at deterministic function and
expression ordinals, not only final text. Every ordinary existing decision
matched. The reviewed stale cases differed only after the plan recorded the
exact assignment or map mutation that invalidated the legacy fact. The legacy
string keys and emitter proof stack were then removed.

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

## Passing focused evidence

`yarn test:ts-narrowing` now covers:

- mutation inside a narrowed branch, not only after an exiting guard;
- assignment to a nested receiver and reassignment of a map local;
- reassignment of a key local after `Map.exists`;
- callbacks created inside `map.keys()` iteration;
- early `return`, `throw`, `continue`, and `break` at nested depths;
- nullable map value types, which must never become non-null merely because a
  key exists;
- loop-entry and loop-back-edge invalidation;
- `do...while` first-iteration ordering, where the condition has not run yet;
- assignment later in a compound condition ending an earlier guard fact.

These cases define the bounded function-local proof. General alias analysis,
unknown call effects, and richer whole-program flow remain outside this plan;
if a future case requires one of them, the stop condition above still applies.
