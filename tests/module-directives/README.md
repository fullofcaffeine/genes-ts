# Module directive prologue evidence

This fixture owns the generic `@:genes.moduleDirective("literal")` contract.
Run it with:

```bash
yarn test:module-directives
```

The same Haxe source is emitted as strict TypeScript and classic ESM, then both
runtimes execute. The harness proves ordered exact de-duplication, placement
before banners and imports, source-map provenance, omission from `.d.ts`, and
stable diagnostics that preserve prior output. Its metadata owner is removed
by full DCE, while an included but unreachable annotated module produces no
file; together those controls show that pre-DCE capture does not change
reachability.
