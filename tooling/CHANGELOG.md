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
- Derive HXML inventory and execution from one immutable effective invocation;
  mirror Haxe 4.3.7 HXML parsing and `%NAME%` expansion; execute the exact
  flattened library argument stream; include resolved library provenance and
  source roots; reject linked source trees; and keep an
  accepted output tied to its original physical path spelling.
- Own one private ordinary Haxe JavaScript target and one private Genes target
  under a versioned Haxe 4.3.7 I/O policy. Reject authored targets,
  compiler-side dump/message files, alternate execution modes, and inactive
  Genes output before any public mutation.
- Scope locks, journals, markers, and recovery to the portable public output
  root, persist one entry owner for that root, and keep generated output
  structurally disjoint from `.genes/tooling`. Publish that owner atomically
  and repair only a matching older partial write when no accepted generation
  exists.
- Classify every Haxe 4.3.7 option spelling; support class paths and exact
  library contributions while rejecting CWD/resources until their lookup
  semantics have a reviewed policy;
  preserve repeated acyclic HXML arguments, reject recursive HXML includes,
  keep Haxe's resolve-once behavior for repeated libraries, reject inline
  library spellings that Haxe ignores, admit one distinct library identity in
  the v1 single-request resolver, and accept Haxe's ordinary
  `--option=value` spelling for other one-value options;
  reject every residual `.hxml` token after recursive flattening so Haxe cannot
  reinterpret an option value as a second, unreviewed HXML program, while still
  allowing a separate reviewed library request that is removed before execution;
  reject HXML options that execute shell commands or user programs before host
  acceptance; keep informational changes from discarding an active build; and
  report post-inventory compiler errors at the compile stage.
- Copy and hash the complete effective Haxe environment for each revision, and
  stop acceptance cleanly when a lifecycle observer closes the session.
- Remove private candidate, state, and project paths from host validation
  messages even when the host uses the other platform slash style.
- Reject Haxe XML/JSON side outputs from the managed HXML graph, and verify the
  complete live publication again after host admission before committing it.
- Verify every public code and JSON export from the packed package on Node
  20.9.0, the package's declared minimum runtime.
