# Oracle disposition: acceptance process fixture timing

## Local baseline

Oracle request `orq_20260904T061243Z_12fe1860` reviewed the repeated
`test:acceptance-process-owner` failures that block PR #191 at exact head
`47a4c67a4899f535a2fd702dc9326f8c89e1f306`. The current checkout confirms
three independent short-deadline failures: the zombie-only control can spend
its complete 100 ms grace on one spawned probe, the drain-order control waits
for a child-created file inside a 100 ms console deadline, and the ordinary
escalation control treats a spawned Node probe completing within 50 ms as a
required non-degraded result. Production limits and process-owner code have not
changed. The two uncommitted timeout increases are diagnostic only.

My provisional conclusion before reading Oracle was that the semantic rules
remain valid but their witnesses depend on process startup and scheduler time.
The safest repair was a typed in-process probe seam for semantic tests while
retaining real spawned-probe integration coverage. The current source confirms
that `waitForProcessGroupExit` owns the two-scan rule, the public termination
path owns the spawned probe, and `evidenceOperation` has one exact dispatch
point immediately before the writer spawn.

## Oracle claim matrix

| Classification | Oracle claim | Local evidence and consequence |
| --- | --- | --- |
| Retained | The failure is budget-domain conflation, not a demonstrated production cleanup regression. | `scripts/acceptance-process-owner.ts` lets one probe consume the remaining grace and sleeps between scans; the chronological failures move from 100 ms to 100 ms to 50 ms startup assumptions. Production defaults remain unchanged. |
| Retained | Extract a typed observation state machine and virtual monotonic runtime. | A fake observer with real `performance.now()` can still lose its deadline while backgrounded. Scripted observations plus virtual time directly prove the two-scan, reset, absence, and degraded-fallback laws. |
| Retained | Keep the spawned probe as the only production observer. | Cleanup success is a safety boundary. `AcceptanceProcessOwnerOptions.processProbe` remains command-shaped, and public `terminateAcceptanceProcessTree` must construct the real adapter. Tests may reach the parameterized loop only through a narrowly named test-only export. |
| Retained | Replace the writer-created drain marker and elapsed lower bound with a synchronous publication-dispatch observation. | `evidenceOperation` has one authoritative point immediately before writer spawn. An ordered trace from the stalled sink's write and destroy callbacks to `publish-log` dispatch proves the intended ordering without depending on writer startup. |
| Retained | Keep representative real POSIX integration controls and add one readiness-budgeted successful adapter check. | The existing `hung-tree` test proves a SIGTERM-resistant process is removed and the bystander survives. Other controls cover descendants, root exit, degraded fallback, and truthful cleanup failure. A direct real-probe check against the already-running bystander proves protocol decoding without a 50 ms latency claim. |
| Retained | Classify remaining short external-helper budgets once. | `isRunning` currently starts Node with a 1,000 ms timeout and `waitUntilStopped` uses a 2,000 ms outer window. Successful fresh helper execution will use the shared 15,000 ms readiness budget; intentional fault deadlines stay short. |
| Rejected | Keep either timeout-only edit as the final repair. | The 1,000/250 zombie values and 1,000 ms drain value only move scheduler dependence and make the focused gate slower. They will be replaced, not merged. |
| Rejected | Replace the bounded subprocess with direct `/proc` scanning or a persistent helper. | Neither is required by current evidence. Direct synchronous scanning weakens the finite-operation boundary; a resident helper adds an IPC lifecycle and another owned process. |
| Deferred | Optimize the production probe implementation. | There is no measured product failure at the 250 ms production default. Native probes or a long-lived helper need a separate performance reproduction before they are justified. |
| Owner decision resolved | Treat `probeDegraded === false` as telemetry, not a blocking latency SLO. | Cleanup success remains blocking. A non-degraded adapter result is tested with the shared readiness budget; no absolute 50 or 250 ms startup promise is introduced. |
| Owner decision resolved | Use a test-only export in the existing owner module. | This keeps one state-machine implementation and avoids a new module while preventing `AcceptanceProcessOwnerOptions` callers from injecting arbitrary in-process truth. |
| Owner decision resolved | Remove the redundant ordinary escalation fixture. | The earlier `hung-tree` path already uses a SIGTERM-resistant process, requires cleanup success, checks the target is absent, and proves the unrelated bystander remains alive. The removed fixture adds only the unsupported 50 ms non-degradation assertion. |
| Owner decision resolved | Use 100 virtual-time iterations and 20 unchanged background-priority focused runs. | Virtual iterations cheaply qualify semantics; repeated real runs qualify only the remaining OS/process integration. Exact hosted and full CI remain authoritative before PR #191 merges. |

## Integrated conclusion

Implement this as the separate Beads prerequisite owned by `genes-f8vc.9.5`
and `genes-f8vc.9.6`, based directly on current `main`. Replace the Boolean
probe result with a discriminated process-group observation, parameterize only
the internal wait loop over a typed observer and monotonic runtime, and keep
the public termination signature and command-shaped probe seam unchanged.
Expose the wait loop and real adapter through one explicitly test-only object.

Replace the live fake-zombie process with deterministic virtual-time sequences
that prove provisional one-scan behavior, two consecutive scans, live reset,
conclusive absence, and degraded fallback. Add a synchronous observation-only
evidence-operation hook and assert the stalled-write settlement occurs before
`publish-log` dispatch. Restore the 100 ms in-process console fault deadline
and remove the elapsed lower bound. Remove the redundant 50 ms ordinary
escalation control, retain all real cleanup controls, and add one successful
real probe against an explicitly ready process using the shared readiness
budget.

Stop if production limits, signal order, fallback policy, Windows behavior, or
compiler output would need to change. After the prerequisite merges, rebase PR
#191 and rerun full CI on the exact combined revision.

## Verification and unresolved gaps

No implementation or post-change test has run yet; this is a planning
disposition. Required proof is: TypeScript build, 100 deterministic monitor
iterations, 20 unchanged `test:acceptance-process-owner` runs under repository
background scheduling, no surviving fixture processes, the exact Linux hosted
job, and full Genes CI after PR #191 is rebased. Oracle returned no attachments.
The response was reconciled by `gpt-5.6-sol` at `xhigh` reasoning against the
current checkout; Oracle did not run repository commands.
