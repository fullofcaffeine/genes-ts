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
  exclusion, exact stale deletion, output-scoped recovery, immutable effective
  invocation checks, authoritative reconciliation, exact drift detection, and
  bounded reentrant owned cleanup.
- Require the executed Haxe command to match the inventoried working directory
  and ordered top-level HXML files, reject linked source trees, and keep an
  accepted output tied to its original physical path spelling.
- Recognize Haxe's documented short class-path, library, and resource options;
  reject HXML options that execute shell commands or user programs before host
  acceptance; keep informational changes from discarding an active build; and
  report post-inventory compiler errors at the compile stage.
- Copy and hash the complete effective Haxe environment for each revision, and
  stop acceptance cleanly when a lifecycle observer closes the session.
- Verify every public code and JSON export from the packed package on Node
  20.9.0, the package's declared minimum runtime.
