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
- The typed marker order is `First -> Second`, but the legacy path-keyed import
  projection prints `Second -> First` in both profiles. The evidence test
  deliberately expects the pre-fix `second,first` transcript; the ordered
  request task must flip it to `first,second`.

This is not public side-effect-import support. It is the executable prerequisite
for the ordered request model and helper producer.
