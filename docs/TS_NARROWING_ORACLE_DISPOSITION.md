# TypeScript narrowing Oracle review disposition

This document answers a practical maintenance question: which parts of the
2026-07-19 Oracle implementation brief still applied to the released compiler,
and which parts had already landed?

The short answer is that the brief's central architecture had already shipped
in `v1.36.8`. The review was still useful, however, because checking its claims
against small programs exposed two narrower gaps. We fixed those gaps without
rebuilding the completed architecture.

See also:

- [`TS_NARROWING_OWNERSHIP.md`](TS_NARROWING_OWNERSHIP.md) for an introduction
  to narrowing and the current owner of each decision;
- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the compiler-wide ownership map;
- Bead `genes-3wl` for the completed extraction and its original evidence;
- Bead `genes-8qg` and its children for the work selected from this review.

## How this review was checked

The live-code baseline was `v1.36.8` (`7fc5aa2`), not the older implementation
described by most of the brief. Each recommendation was compared with:

1. the current plan in `src/genes/ts/TsNarrowingPlan.hx`;
2. its only syntax consumer in `src/genes/ts/TsModuleEmitter.hx`;
3. plan construction and invalidation in `src/genes/Module.hx`;
4. the generated-source and runtime owner `yarn test:ts-narrowing`;
5. the implementation history in `e4d118b` and the post-test ordering fix in
   `62897e0`.

“Already completed” below means that current source and executable evidence
both establish the behavior. “Modified” means the goal is sound but the exact
suggested representation is unnecessary or less accurate for Genes. “Deferred”
means no wrong-code case has been demonstrated yet, so a lower-priority
experiment owns the uncertainty. “Rejected” means the proposal would duplicate
an owner or broaden the compiler without evidence.

## What was already completed

| Review request | Evidence in `v1.36.8` | Disposition |
| --- | --- | --- |
| Keep Haxe `TypedExpr` authoritative and add only a narrow TypeScript plan | `TsNarrowingPlan` stores facts about the original typed expressions; it does not clone the tree or contain output text. | **Already completed.** Keep this boundary. |
| Use function-local typed identities instead of emitter-built strings | `TsNarrowValueIdentity` uses Haxe local IDs plus structural receiver/key identities. `TsNarrowProgramPoint` records deterministic function and expression ordinals. | **Already completed.** |
| Compute facts before printing and make the emitter read-only | `Module.tsNarrowingPlan` builds the plan lazily. `TsModuleEmitter.isNarrowedNonNull` only queries it. The old proof stacks and map-origin tables are absent. | **Already completed.** |
| Keep nested functions and delayed callbacks isolated | Every `TFunction` starts `analyzeFunctionScope` with a new empty state. The focused delayed-map-key fixture is passing. | **Already completed.** |
| Invalidate receiver, nested-field, map-receiver, and map-key facts after assignment | `ValueChanged` uses structural dependency checks, and the focused fixture covers each listed mutation. | **Already completed.** |
| Handle exact `Map.remove`, `Map.clear`, nullable map values, and key iteration | Exact removal and clear have separate invalidations. A presence proof is created only when the map value type cannot be Haxe-nullable. Iterator origins are function-local. | **Already completed.** |
| Distinguish pre-test and post-test loop order and summarize back-edge mutations | `analyzeWhile` treats `while` and `do...while` separately, and `collectEffects` removes facts changed by any direct loop-body mutation. | **Already completed, with the early-exit gap fixed below.** |
| Rebuild after module membership changes | `Module.addTypes` clears `tsNarrowingPlan` with the dependency, JSX, projection, and cycle caches. | **Already completed.** A second cache/session manager is not needed. |
| Characterize in shadow before switching authority, then delete the legacy owner | Bead `genes-3wl` and commit `e4d118b` record the shadow comparison and final removal. | **Already completed.** Reintroducing a permanent shadow would create two semantic owners. |

These are not conclusions based on similar names alone. The current emitter has
one plan lookup and no legacy narrowing fields, the module explicitly resets the
plan, and the focused test exercises the mutation and callback boundaries.

## What the review newly exposed and we integrated

### P1: a post-test loop could export a skipped guard

An early `break` in a `do...while` body could leave before a later null guard.
The old post-loop state came only from the path that reached the condition, so
it incorrectly treated the skipped guard as true on every exit. Generated
TypeScript used `item.name!`, and runtime returned raw JavaScript `undefined`
instead of Haxe `null`.

Bead `genes-8qg.1` added a fail-first early-break case, a continue-shaped
sibling, and a control proving an unchanged incoming fact stays concise. The
bounded correction exports only facts that were true before the loop and
survive every direct body/condition mutation. It deliberately does not build a
general control-flow graph.

### P2: `Map.remove(computedKey())` kept every entry proof

When the map receiver was stable but the removal key was a call or another
unrecognized expression, the plan emitted no invalidation. The call could still
return a previously proved key.

Bead `genes-8qg.2` introduced `MapEntryPossiblyRemoved`. It ends every entry
proof for that exact map, while exact-key removal still keeps facts for other
keys and an unknown-key removal still keeps facts for other maps. This is a
local conservative rule, not alias analysis or broad call-effect tracking.

### P2: new Haxe expression variants must receive an explicit decision

The main flow transfer and loop-effect inventory formerly ended in broad
`default` cases. They now list every `TypedExprDef` variant in the supported
Haxe API: special control/mutation forms use dedicated handlers, while ordinary
forms use the ordered child walk. A future enum addition therefore fails to
compile until its flow behavior is reviewed.

Recognition helpers still use a conservative default on purpose. For example,
an unfamiliar condition or unstable value means “do not create a proof.” That
is a safe feature boundary, not a missing control-flow classification.

## Recommendations adopted in a different form

| Suggested shape | Genes decision | Why |
| --- | --- | --- |
| Return target-aware `FlowTransfer` values for every `break` and `continue` | **Use the bounded post-test exit rule now.** Stop for another focused review if a future reduction needs a fact first established inside a post-test body to flow after targeted exits. | The demonstrated wrong-code path can be closed without a general transfer graph, and existing concise output is preserved. |
| Build the plan immediately inside `TsModuleEmitter` | **Keep the lazy module-owned plan.** | `Module.addTypes` already invalidates it when typed membership changes. This gives one plan to any TypeScript consumer without caching across stale inputs. |
| Key fields by compiler declaration objects | **Keep receiver plus runtime field-slot name.** | Narrowing tracks the value reached at runtime. An override/hide with the same emitted slot must invalidate the same place; distinct receivers already remain distinct. Generated local names and source positions are still excluded. |
| Split map presence into a general `MapContains` fact | **Keep the existing non-null map-read fact.** | The only current consumer asks whether `Map.get` is non-null. The plan creates that fact only for non-nullable value types, so `Map<K, Null<V>>` stays conservative. Add a separate presence fact only if a future consumer needs presence independently of value nullability. |

## Follow-up experiments resolved

Bead `genes-da0` checked the two lower-priority questions separately instead of
assuming the Oracle brief was still correct.

### Narrowing queries use source expressions

The emitter does create default-argument wrappers, but the executable inventory
found that no current narrowing query receives one. In the focused compilation,
all 365 observed queries mapped to original typed expressions and planned
program points; zero were synthesized lookups and zero original expressions
were missing.

The inventory is compiled only by the focused test. It independently records
the typed source tree, including function-argument default values, and compares
that set with the plan at each real emitter query. Normal compiler builds pay no
extra traversal or storage cost. A missing production lookup now fails closed
with `GTS-NARROW-PLAN-002`. A future emitter-created wrapper must carry explicit
source provenance instead of silently receiving a conservative answer.

### Short-circuit right operands had a measurable precision gap

Three fail-first cases showed redundant runtime identity casts in generated
TypeScript:

```haxe
value != null && consume(value)
value == null || consume(value)
map.exists(key) && consume(map.get(key))
```

The bounded fix analyzes the left operand first and gives the right operand only
the facts guaranteed by its execution path: true facts for `&&`, false facts for
`||`. Facts introduced solely for that path are removed after the right operand,
while direct mutations from either operand still invalidate them. Existing
condition-reassignment evidence proves an earlier guard is not revived after a
later assignment. This is structured expression order, not a control-flow graph
or alias analysis.

## Recommendations intentionally not implemented

- No universal semantic IR, cloned `TypedExpr` tree, TypeScript target AST,
  general CFG, SSA conversion, pass manager, or arbitrary alias analysis.
- No shared classic/TypeScript narrowing pipeline. Classic JavaScript remains
  a runtime differential; it does not need TypeScript control-flow assertions.
- No permanent legacy shadow implementation. Historical parity evidence is
  recorded, and the plan is the sole current owner.
- No `Dynamic`, `untyped`, `Any`, generated `any`, broad `unknown`, unchecked
  cast, or target-string rewrite was added for these fixes.
- No source-specific allowlist or downstream-project branch was added.

## Prioritized Beads

| Priority | Bead | Result |
| --- | --- | --- |
| P1 | `genes-8qg` | Parent release/evidence gate for this review. |
| P1 | `genes-8qg.1` | Post-test early-exit soundness fix; completed. |
| P2 | `genes-8qg.2` | Unknown-key map removal invalidation; completed. |
| P2 | `genes-8qg.3` | This disposition plus exhaustive flow classification. |
| P3 | `genes-da0` | Strict lookup provenance and short-circuit precision experiment; completed with executable evidence. |

## Verification contract

The focused owner is `yarn test:ts-narrowing`. It checks generated TypeScript,
TypeScript 5/6/7, and runtime transcripts. Before `genes-8qg` closes, the branch
must also pass both output profiles, source maps, deterministic output,
transaction rollback, the generated matrix, supported Haxe 4.3.7, the advisory
Haxe 5 preview compile, and complete `yarn test:ci`.

The final Bead/PR records the exact commands and results. A green focused test
alone does not authorize downstream adoption.
