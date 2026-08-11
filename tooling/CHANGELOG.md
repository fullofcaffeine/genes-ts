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
- Let a development session prepare exact Haxe inputs before typing, include
  their bytes in the warm request identity, and publish selected companions
  plus validator evidence with the same accepted Genes generation. The marker
  records these extra files for exact recovery and stale removal.
- Let Haxe macros write small declared data values into private session slots.
  Give validation byte copies without filesystem paths. Publish a value only
  when the host returns it as an approved output file. A stopped update rolls
  back and rebuilds before commit. After commit, restart keeps the complete
  public result and finishes only private cleanup.
- Keep restart recovery compatible with accepted markers written before extra
  files existed, and reserve the complete `.genes/tooling` control directory
  so generated or host-provided files cannot overwrite any session's locks or
  recovery records.
- Keep the earlier version-3 supplemental marker and admission digest readable;
  write source ownership under version 4, and block a different output folder
  while the original folder still has unfinished recovery work.
- Register and reconcile the current Haxe input watch before replaying an
  interrupted publication, so an older generated file cannot be restored into
  a path that becomes authored before or during restart. Saved plans exposed to
  host policy are deeply read-only.
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
  structurally disjoint from `.genes/tooling`. Publish that owner atomically,
  discard only an uncommitted private owner file, and reject damage to the
  final owner. Upgrade released entry-scoped state through an authenticated,
  recoverable receipt, migration fence, root owner, and translated marker.
  Keep the upgrade one-way and preserve every accepted-generation fact.
- Classify every Haxe 4.3.7 option spelling; support class paths and exact
  library contributions while rejecting CWD/resources until their lookup
  semantics have a reviewed policy;
  preserve repeated acyclic HXML arguments, reject recursive HXML includes,
  keep Haxe's resolve-once behavior for repeated libraries, reject inline
  spellings for Haxe 4.3.7's complete early-option set, admit one distinct
  library identity in the v1 single-request resolver, and accept Haxe's ordinary
  `--option=value` spelling for other one-value options;
  reject standalone residual `.hxml` tokens after recursive flattening so Haxe
  cannot reinterpret an option value as a second, unreviewed HXML program,
  preserve ordinary inline `.hxml` values through a private checked HXML input
  and a post-classification environment placeholder,
  allow a not-yet-created class-path directory to enter the watch set, and still
  allow a separate reviewed library request that is removed before execution;
  direct HXML inventory stays safe to execute by rejecting the private-bridge
  form, reject control characters in expanded separate option values, and use
  link-aware path checks before every scan so neither a broken link nor a later
  symbolic-link parent can redirect the watcher;
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
