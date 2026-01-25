## Summary

<!-- What changed and why? -->

## Checklist

- [ ] `yarn test:ci` passes locally
- [ ] Docs updated (if behavior/flags/output changed)
- [ ] No new `untyped` / `Dynamic` in framework/test code
- [ ] Generated TS typing policy preserved (no `any`/`unknown` leaks)
- [ ] Security scans pass (`yarn test:secrets`, `yarn test:vulns`)
