# Side-effect import DCE evidence

This fixture freezes the Haxe/compiler facts needed before Genes can expose a
binding-free import producer. Run it with:

```bash
yarn test:side-effect-import:evidence
```

Both HXML files use Haxe 4.3.7 with `-dce full`. A compile-time `onGenerate`
probe inspects the same post-DCE typed graph consumed by Genes, while the Node
stage executes classic ESM and generated strict TypeScript.

## Proven facts

- Effectful typed marker calls in a direct `static function __init__()` block
  survive full DCE and reach `cl.init` in exact source order.
- A minimal kept target token gives an importer a typed identity and causes an
  otherwise unreferenced converted module to enter the post-DCE graph.
- A completely unreferenced target stays untyped even when its source field has
  `@:keep`; Haxe metadata in an untyped file cannot create reachability.
- Observable initialized fields in a marker-targeted module need targeted
  `@:keep`. A pure `{ initialized; true; }` anchor read is optimized away before
  Genes runs and does not retain the initializer.
- `@:genes.compilerInternal` fields remain available to dependency planning but
  are absent from TS, classic JS, `.d.ts`, and source-map artifacts. Typed marker
  calls are erased by the shared expression boundary.
- The typed marker order is `First -> Second`, and the shared ordered request
  projection preserves the `first,second` runtime transcript in both profiles.
- Internal marker tokens produce binding-free imports; neither the token nor a
  fake named/default/namespace binding appears in generated artifacts.
- Repeated A/B/A requests coalesce by first occurrence, and a later real A
  binding satisfies its first request slot without adding a redundant bare
  import.
- External A(json)/B/A(file)/B requests preserve all three distinct slots in
  that order, proving attributes are part of request identity while the equal B
  request is deduplicated. Classic declarations contain none of those requests.
- A later `String` binding satisfies an earlier gamma request and retains the
  allocator's collision-safe `String__1` alias in both printers.

This is not public side-effect-import support. It is the executable prerequisite
for the ordered request model and helper producer.
