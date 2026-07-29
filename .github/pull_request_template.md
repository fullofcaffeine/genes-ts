## Summary

<!-- What changed and why? -->

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
- [ ] No new `untyped` / `Dynamic` in framework/test code
- [ ] Generated TS typing policy preserved (no `any`/`unknown` leaks)
- [ ] Security scans pass (`yarn test:secrets`, `yarn test:vulns`)
- [ ] Pre-commit contract passes (`yarn test:precommit-hook`)
