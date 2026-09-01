# Oracle disposition: final bounded owner convergence

## Request identity

- Request: `orq_20260901T161916Z_1220db7e`
- Purpose: non-convergence planning for PR #194
- Reviewed head: `d68c622f52718e86920e9d956b6ad31e685dfe48`
- Captured response: complete, attachment-complete, and valid Pro model proof
- Completion digest: `b9452291ad11f72fa7779962bfabcc3ff91b675669706eb48c3c4f635f04034f`
- Reconciliation model and level: `gpt-5.6-sol`, `xhigh`

## Local disposition

Adopt the Oracle's bounded-refactor recommendation as advisory design evidence.
Do not replace the complete supervisor or remove live console output.

The governing rule is:

> Logical settlement is not resource settlement. Terminal publication can start only after every non-signal fact and its callback authority are fixed.

The final barrier is:

1. Fix the stop trigger.
2. Remove the process group, or detach the exact child and record cleanup failure.
3. Quiesce both output pumps, including pending destination writes.
4. Fix the log-publication result.
5. Settle the budgeted terminal marker.
6. Freeze all non-signal fact authorities.
7. Publish terminal state once.
8. Publish once more only if the first signal arrived during publication.
9. Close signal authority synchronously.

## Local evidence check

The response found one new P1 issue and several related completion gaps. Local inspection confirms them:

- `scripts/acceptance-process-owner.ts` uses synchronous `ps` in `processGroupAlive()`.
- `scripts/test-acceptance-process-owner.ts` uses synchronous `ps` in `isRunning()`.
- Node documents that a synchronous child timeout does not guarantee immediate return after the timeout signal.
- Aggregate and cleanup control deadlines use `Date.now()`.
- `OutputPump.done` does not join its final destination write.
- Cleanup failure records an error but leaves child and pipe references authoritative.
- Drain timeout calls `stop()` without joining the stopped pumps.
- The terminal marker bypasses the shared console budget.
- Child and readable callbacks can remain live after their facts should be frozen.

These findings are contract violations. PR #194 promises bounded completion and trustworthy terminal evidence.

## Accepted implementation boundary

Make one bounded refactor before the next review cycle:

1. Replace synchronous process probing with one killable no-stdio Node helper.
2. Use process-relative monotonic deadlines for control and wall time only for timestamps.
3. Give each output pump explicit readable and in-flight-write states.
4. Freeze child callbacks and detach child handles after cleanup failure.
5. Route all per-gate console writes through one accounting function.
6. Cancel losing deadline timers.
7. Tighten the documentation claims for publication failure and submitted console bytes.

The probe helper will use `/proc` on Linux. On systems without `/proc`, it can own the platform probe inside the killable helper.
The parent must never use synchronous process discovery. A timed-out helper is killed, detached, and treated as degraded.
After the first degraded helper, use the kernel group check conservatively and do not spawn more probe helpers in that cleanup phase.

## Required proof

Add deterministic probes for these cases:

- the final child chunk reaches readable end while its destination write stalls;
- drain timeout occurs before the final write timeout;
- cleanup failure leaves the child alive but cannot keep the wrapper alive;
- a late root exit cannot change detached facts;
- the process-probe helper stalls;
- wall time moves backward while monotonic control deadlines still expire;
- the terminal marker does not fit the remaining console budget;
- signals arrive during pending output, cleanup detachment, probing, and publication;
- a writer publishes complete-new state and then reports failure;
- repeated ordering probes remain finite under an independent asynchronous watchdog.

Run focused red evidence against the reviewed behavior before implementation. Then run the focused owner and structural suites locally.
After exact-head review, run the hosted focused owner and complete required CI at normal priority.

## Contract precision

Adopt these wording corrections:

- `consoleBytes` counts bytes submitted to the destination. It cannot prove bytes consumed by CI.
- A failed state publication preserves one complete old or new document. It cannot always durably record its own failure.
- Cleanup failure means removal was not proved. It does not claim that the process is known alive.
- The observed-byte limit is a stop threshold unless implementation reserves an exact chunk boundary.
- Terminal markers are advisory. Successfully published `state.json` is authoritative.
- Bare process-group ownership assumes no adversarial PGID reuse after observed disappearance.

## Non-goals

- no second gate supervisor;
- no whole-owner rewrite;
- no artifact-only output;
- no forced `process.exit()`;
- no stronger Linux ownership primitive in this PR;
- no guarantee for a hostile custom `Writable` that retains native resources after `destroy()`.

## Stop condition

Stop another incremental patch cycle if implementation reveals a new synchronous wait, referenced handle, mutable callback after terminal freeze, or reconciliation category.
Return to the scope checkpoint instead of adding another local exception.
