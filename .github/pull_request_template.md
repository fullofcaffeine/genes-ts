## Summary

<!--
Explain the ordinary user workflow first: what failed or was missing, who
encountered it, and what becomes better after this PR. A newcomer should not
need the issue history or internal compiler vocabulary to understand it.
-->

## Behavior contract and product surface

<!--
State one concrete scenario: preconditions/input, action or compilation path,
observable result, important error/negative case, owning product surface, and
the exact claim protected. List important non-goals.
-->

## Red state and independent oracle

<!--
For changed behavior, give the smallest pre-fix command and concise failure
that went red for the intended reason. A separate red commit is optional.
Explain where the expected result comes from: Haxe/JS/TS semantics, a manually
reviewed expectation, a pinned differential, an invariant, or real consumer
behavior. Do not use the implementation under test to generate its oracle.
-->

## Evidence path

<!--
Name the lowest faithful focused owner and the broader vertical proof. For a
new capability, show the tracer bullet from authored input through Genes,
target check/build, package/framework boundary, and real runtime/system
observer. If a high-level failure found a compiler bug, name the focused
regression retained as the second lock.

Separate surfaces affected by this change from surfaces merely covered by a
broad selected gate. Include `yarn test:ci:explain -- --changed <path>` output
or its report when selection is relevant.
-->

## High-risk review

<!--
For compiler representation/runtime/ABI, package publication, security,
migration, or public-claim changes, record the distinct review pass: findings
about sensitivity, oracle independence, negative cases, mocked boundaries,
selector omissions, scorecard laundering, or over-broad claims, and how each
was resolved. Otherwise explain briefly why this review is not applicable.
-->

## Performance

<!--
Which cost surfaces can this change affect: compiler latency/memory, generated
output size/shape, or generated runtime work? Give the focused benchmark or
budget command and before/after result. If none apply, explain why the changed
path is not performance-sensitive. Do not write only "N/A".
-->

## Checklist

- [ ] `yarn test:ci` passes locally
- [ ] Docs updated (if behavior/flags/output changed)
- [ ] Performance impact is measured, budget-gated, or explained as neutral
- [ ] Changed behavior includes the exact pre-fix command/failure and an independent oracle
- [ ] Affected product surfaces are not inferred from broad gate coverage
- [ ] New capabilities have one vertical tracer bullet before fixture expansion
- [ ] High-risk changes received a distinct test-sensitivity/claim review
- [ ] No new `untyped` / `Dynamic` in framework/test code
- [ ] Generated TS typing policy preserved (no `any`/`unknown` leaks)
- [ ] Security scans pass (`yarn test:secrets`, `yarn test:vulns`)
- [ ] Pre-commit contract passes (`yarn test:precommit-hook`)
