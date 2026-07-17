# Module directive prologue evidence

This fixture owns the generic `@:genes.moduleDirective("literal")` contract.
Run it with:

```bash
yarn test:module-directives
```

The same Haxe source is emitted as strict TypeScript and classic ESM, then both
runtimes execute. The harness proves ordered exact de-duplication, placement
before banners and imports, explicit statement termination, source-map
provenance, omission from `.d.ts`, and stable diagnostics that preserve prior
output. The banner deliberately begins with `(0)`: without a semicolon, that
continuation token would attach to the preceding string literal and throw at
runtime. A removable module-level function and a reachable module-level
variable prove that metadata is captured from Haxe's synthetic
`KModuleFields` representation, not only from named-type `BaseType` metadata.
The unused function is removed by full DCE, while an included but unreachable
annotated module produces no file; together those controls show that pre-DCE
capture does not change reachability. The conflict case deliberately combines
a named class owner with a module-level variable owner so neither typed shape
can bypass single-owner validation.
