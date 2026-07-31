# Changelog

All notable changes to `@genes-ts/tooling` are recorded here. This package has
its own version and release lifecycle; compiler/Haxelib releases do not publish
it.

## 0.1.0

- Add framework-neutral durable artifact publication and recovery.
- Add deterministic HXML input inventory.
- Add reconciled filesystem watching and serialized dirty-run orchestration.
- Add owned Haxe `--wait` server lifecycle management.
- Add versioned CSS Module export-manifest validation and deterministic closed
  Haxe companion generation without parsing CSS in tooling.
- Publish versioned conformance vectors for host implementations.
- Define the versioned, automation-friendly DevelopmentSession lifecycle,
  event schema, and conformance scenarios.
- Implement `createGenesDevelopmentSession` over the existing HXML, watch,
  serialized-loop, owned-server, compiler-manifest, and artifact-transaction
  primitives, including last-good admission, supersession, read/publication
  exclusion, exact stale deletion, recovery, and bounded owned cleanup.
- Verify every public code and JSON export from the packed package on Node
  20.9.0, the package's declared minimum runtime.
