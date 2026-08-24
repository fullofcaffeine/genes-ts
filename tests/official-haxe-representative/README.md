# Official Haxe representative lane

This lane runs five reviewed methods from the official Haxe 4.3.7 test suite.
It uses the same pinned source revisions as the six-test quick smoke.

Each method runs in a separate compilation for each Genes profile. A problem
in one method cannot hide the outcome of another method.

Run the lane with:

```bash
yarn test:official-haxe-representative
```

The command packages the current Genes checkout. Then it generates output,
checks the target, and runs Node for each method and profile.

The manifest records one required outcome for each cell. A passing cell has an
exact assertion count. A known problem has an exact phase, diagnostic text,
and Bead owner. The command fails when a cell changes in either direction.
Each identity and source must also occur in both reviewed registration files.

The current selection contains these outcome types:

| Family | Official method | Classic ESM | TypeScript |
| --- | --- | --- | --- |
| Language | `unit.TestArrowFunctions.testSyntax` | 10 assertions | Known target-check problem, `genes-brxy.11` |
| Standard library | `unit.spec.TestEvaluationOrder.test` | 16 assertions | 16 assertions |
| Standard library | `unit.spec.TestMap.test` | 191 assertions | 191 assertions |
| Standard library | `unit.spec.TestStringTools.test` | 109 assertions | 109 assertions |
| Issue regression | `unit.issues.Issue10007.test` | 1 assertion | 1 assertion |

The quick scope continues to use `yarn test:smoke`. It does not run this lane.
The daily scheduled workflow and every release-eligible push to `main` run the
representative command. Pull requests and manual workflow dispatches do not.
Compiler publication depends on the representative job from the same workflow
run and exact commit.

The report keeps the two profiles and all method outcomes separate:

```text
.tmp/test-evidence/official-haxe-representative/report.json
```

On GitHub, the report also records the scheduled or release scope, exact source
commit, run ID and attempt, and the artifact identity. CI uploads the complete
evidence tree as
`official-haxe-<scope>-<40-character-sha>-run-<run-id>-attempt-<attempt>`.
The run and attempt make rerun artifacts unambiguous. The manifest and report
reconcile the five selected methods against all 1,373 reviewed active
registrations, and name the deferred capability shards and claims.

This lane does not calculate a compatibility percentage. It does not claim
support for all 1,373 registered methods or for capability-specific shards.
