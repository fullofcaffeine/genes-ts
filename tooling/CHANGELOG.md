# Changelog

All notable changes to `@genes-ts/tooling` are recorded here. This package has
its own version and release lifecycle; compiler/Haxelib releases do not publish
it.

## Unreleased

- Measurements that stay valid on a busy host (genes-f8vc.14.33): with
  `processCounters: true` the development session reads the counters of its
  Haxe server before and after each program request and module request and
  emits `request-measured` (`request`, `module`, and `process`: retired
  instructions, CPU milliseconds, or the reason why instructions are
  unavailable). `readProcessCounters` and `processCounterDelta` are exported.
  On macOS they use `proc_pid_rusage` through `node:ffi` (in this process
  with `--experimental-ffi`, else in a short helper process); no root and no
  native build step. On Linux only the CPU time is read. Protocol: version 1
  gains this opt-in event kind; a host must ignore a kind that it does not
  know.
- The development session can show the edited module first
  (`modulePreview`, G3, genes-f8vc.14.3; needs `generationReuse`). For a
  save of one `.hx` module it sends a module request on the warm server
  (the program's arguments without `--main`, class-name roots and
  `--macro include(...)`, the module as the only root, an output folder of
  its own, and a request descriptor with `"kind": "module"`), keeps the
  files that Genes admits in memory, and emits `preview-generated`. The
  program request follows after the quiet time (`modulePreview.quietMs`,
  default `debounceMs`) and stays the only writer of the public tree; a
  refusal (`preview-refused`, with a Genes or session code) starts it at
  once. At acceptance the session compares each preview file with the
  candidate and emits `preview-confirmed` or `preview-corrected`; a
  difference of a preview whose sources did not move since (each later
  change proven by an admitted preview), or an accepted generation of such
  sources that changes another Genes file, is counted
  (`inspect().modulePreview`), its files are kept in
  `<stateDirectory>/preview-evidence/`, and that module gets no more
  previews. A save while the module request runs shows no late preview.
  With the option, while generation reuse is active and the newest revision
  is accepted, a save that leaves every changed `.hx` file with the bytes of
  the last accepted build starts no build. Protocol:
  version 1 gains the four opt-in event kinds and the optional snapshot
  field `modulePreview` (schema and three vectors); a host without the
  option sees no change. New API: `ModulePreviewOptions`,
  `DevelopmentSession.readPreviewFile`, `summarizePreviewTimings` (time to
  the preview against time to the accepted generation),
  `SessionCompiler.compileModule` (optional; runs only on the warm server)
  and `SerializedDirtyLoopOptions.followUpDelayMs`. On a fixture of UI-like
  modules, 30 of 30 scripted edits were shown as previews, each equal to
  the program result.
- The development session talks to its owned Haxe server through one pipe
  that stays open (`haxe --wait stdio`), not through a Node helper and a
  `haxe --connect` client process for each request (parity stage 0,
  genes-19wt). A request that compiles nothing now takes well under 1 ms;
  before, each request cost a new process plus Haxe 4.3.7's 50 ms TCP wait.
  The output is unchanged. When bytes arrive outside a frame (for example a
  macro writes to `Sys.stderr()` directly), the session builds again on a new
  server, and after two failures in a row it builds without a server
  (`direct`). Breaking for hosts that read the server's address:
  - the lease (`haxe-server.json`) of the session's server now has the
    schema `genes.tooling.haxe-wait-server-lease.stdio.v1` and no `host` or
    `port`;
  - the `started` compiler event has the endpoint
    `{"transport":"stdio","argument":"stdio"}`; the v1 protocol schema
    accepts both endpoint shapes;
  - `HaxeWaitEndpoint` is now `HaxeWaitLoopbackEndpoint |
    HaxeWaitStdioEndpoint`; `OwnedHaxeWaitServer` gains `transport`
    (default `loopback`, unchanged) and `sendHaxeServerRequest` takes a
    loopback endpoint.
  `DevelopmentSession.queryCompilerServer("server/contexts")` replaces a
  direct TCP request to the session's server.
- Haxe's periodic full collection moves off the edit path (genes-0emi).
  Haxe 4.3.7 runs it after every tenth request of any kind. When the server
  has been idle for 250 ms and fewer than four requests remain before the
  next tenth one, the session sends requests that compile nothing up to it,
  so the collection runs then, never between the requests of a build. Haxe
  collects after every 7th build at one request per build (without idle
  requests: every 10th) and after every 4th at two (without: every 5th).
  `compilerServerIdleCollection` (new) sets the idle time or turns it off.
- A broken pipe is reported as the new `compiler-lifecycle` event kind
  `transport-failed` (`reason`, `firstBytes`: the first 64 bytes after the
  session replaced its private paths); the v1 schema gains it. A planned
  server stop is not reported.
- A save after an idle period starts its build 10 ms after the file event
  (`startDelayMs`, new; `SerializedDirtyLoopOptions.startDelayMs`, new).
  Saves during a build still wait the quiet time (`debounceMs`, 100 ms)
  before their follow-up build.
- The trusted launch helper no longer prints Node's `process.execve`
  ExperimentalWarning to Haxe's standard error.

- Add `generationReuse`, which asks Genes to replay the stored output of
  modules that its clean rules call unchanged (Stage 3 generation reuse,
  genes-f8vc.9.23). Two checks come with it and are on by default:
  - the rolling replay audit (`auditModules`, default 2): Genes prints
    replayed modules again and compares the bytes; the session never
    publishes a candidate with a difference and rebuilds the revision at
    once; a module that differs again turns reuse off (`AUDIT_REPEATED`);
  - the cold build (`coldCheckEvery`, default 20; `coldCheckIdleMs`, default
    5,000): after every Nth accepted warm generation and an idle time, the
    session builds the accepted revision in a new Haxe process and compares
    that tree with the published one; an edit cancels it, also one that only
    a reconciliation finds; a difference or a cold failure starts a new
    server, rebuilds and checks again; a difference that survives stops
    further repairs (`COLD_DIFFERS_AFTER_REPAIR`).
  `DevelopmentEventBody` gains the `output-check` member (`OutputCheck`,
  `ReplayAuditCheck`, `ColdBuildCheck`), and the v1 protocol schema and
  vectors gain the same kind. A TypeScript host with an exhaustive `switch`
  over event kinds needs a case for it; every host must ignore unknown kinds.
  Without the option, builds and events are unchanged.
  `SessionCompiler.compileCold` is the new optional adapter method for the
  cold build.
- Add `impact.keepCache` for an extra input that Haxe and its macros never
  read directly. A change to such an input keeps the owned Haxe server and
  its cache. Before, every change to an extra input that is not a class-path
  `.hx` module started a new server with an empty cache, so a warm CSS Module
  session started one server for each stylesheet edit instead of one for the
  whole session. A stylesheet that reaches Haxe only as a `prepareRevision`
  companion can declare it safely: the digest of the prepared files is part
  of the request, so a new companion already selects a separate Haxe cache.
  Inputs without the flag keep the old behavior, because a macro may read
  them. `keepCache` never covers a `.hx` file (Haxe always searches its
  working directory as a class path, so such a file can be a module),
  anything but a regular file (a directory or a link), or a path that a host
  invalidation names and that no longer exists. A declaration with both `keepCache` and `restartCompiler` is
  rejected. If a macro does read a `keepCache` input, later builds keep the
  macro's old result. With `prepareRevision`, each new prepared digest still
  types the whole program again and adds about three Haxe caches that stay
  until the server stops (20 caches and a server of 450 to 870 MB after six
  digests on the small fixture, two runs); genes-f8vc.23 tracks a bound.
- Keep one warm Haxe compiler-server cache for the whole development session.
  Haxe 4.3.7 selects its cache by the values of all defines, and the session
  used to name each new private candidate folder in `-D genes.output`. So
  every build started a new cache: Haxe typed the whole program again, the
  kept state of Genes started again, and server memory grew. Now each define
  has the same value in every build. The session writes small request files
  at fixed paths in `<stateDirectory>/haxe-request/` before each request:
  the output descriptor (`-D genes.output_descriptor`), the incremental
  descriptor (`-D genes.dev_incremental`, mode `measure`, so Genes keeps its
  plain records but still does all work), and the compiler-data descriptor.
  Only a content edit of an existing `.hx` file on a class path keeps the warm
  cache; when its whole-second file time may equal the one Haxe recorded
  (the session tracks the end of each request and the second it saw for each
  changed file, and treats a time ahead of the clock as unsafe), the session
  first sends `server/invalidate`, so two saves within one second are both
  built. A `.hx` file in another declared input is an ordinary input. A macro
  that reads the source text of a class-path `.hx` file is not supported.
  A created or removed `.hx` file (which can change a name lookup in an
  unchanged module, for example a new `import.hx`) and a change of any other
  watched input (a file that a macro may read without telling Haxe) restart
  the owned server, so that request types everything from an empty cache, as
  a cold build does. An invalidation that fails or waits more than two
  minutes replaces the server instead of failing the build. Watch changes now
  report `existence`: `created`, `deleted`, or `modified`. It
  resolves the invocation plan (host callback plus HXML and library
  inventory) only at startup and when a plan input changes, not twice per
  build. A plan input is an HXML or library provenance file, an extra input
  with `reinventory` or `restartCompiler`, or the process environment; before
  each build and again just before Haxe starts, the session compares the
  environment and the bytes of the HXML and provenance files, which takes
  about a millisecond. A change that only the host callback can see now needs
  a declared extra input. A server that the session starts
  gets `OCAMLRUNPARAM=s=4M` unless the environment sets it. Requires the
  Genes library at the same commit or later, because older Genes does not
  read `-D genes.output_descriptor`. `session-warm-server-test` drives the
  real session over the compiler-server fixture and fails when a build adds
  a cache signature, keeps no record, misses a same-second save, differs
  from a cold build, grows server memory, or keeps the server across a new
  `import.hx` or a new module that shadows a top-level name.
- Add explicit development-session admission for a complete generated tree
  installed while the session is stopped. The host supplies the exact prior
  acceptance digest and replacement file inventory. Genes validates the tree
  and commits only its acceptance record under the existing writer lock.
  Ordinary restart still rejects an unexpected replacement. The new read-only
  digest helper avoids exposing private control paths to host adapters.
  Version-5 accepted markers retain the exact replacement request's identity,
  so retrying after a crash revalidates and reuses an already committed result.
  Ordinary publication clears this identity; changed or older requests fail.
- Launch every Haxe compiler child through one internal no-shell authority.
  On POSIX, a trusted Node child replaces itself with the absolute Haxe target
  through raw `execve`; Windows starts the canonical native `.exe` directly.
  Immediately before every spawn, the launch authority checks a bounded
  current-platform native image header. Replacing an admitted pathname with an
  executable shebang script therefore fails before its interpreter can run.
  Unsupported platforms, special files, and existing unreadable targets fail
  closed; missing paths retain the normal launch diagnostic. The trusted
  toolchain owner must prevent both pathname and in-place content mutation
  during the bounded check-to-exec interval.
  A successful Haxe process keeps the owned PID and exact environment. An
  executable text file can no longer trigger Node's `ENOEXEC` shell fallback.
  Before it reads the Haxe environment, the handoff proves this exact runtime
  reports a failed system exec as a normal error. This raises the package
  runtime contract from Node 20.9 to Node 26.1+, where Node fixes failed raw
  process replacement without a process abort. Deep configured temporary paths
  use a private length-bounded POSIX socket directory.
- Add an explicit `genes agents install` command and a read-only check mode.
  The command installs one versioned managed block in a consumer's root
  `AGENTS.md`. It preserves all project-authored bytes outside that block,
  upgrades only valid marker pairs, and fails without writes for malformed or
  duplicate markers. The package has no install lifecycle hook.
- Add optional PostCSS Modules and TypeScript declaration providers for the
  version-one CSS Module manifest. Both run fixed adapters from measured copied
  package bytes in fresh children. The PostCSS provider discovers bounded
  relative composition inputs from inert file maps and uses a processor probe
  for exact local or global source ownership. The declaration provider accepts
  only one closed readonly string object and uses no-emit TypeScript
  diagnostics. Optional processor packages never load in the host process.
- Add an internal execution-admission step for fixed processor adapters. It
  copies the second verified package capture into a private graph, runs the
  adapter in a fresh permission-limited child, and returns final
  `processorIntegrity` only after CommonJS and ESM loads stay inside the copied
  measured files. Undeclared, outside, custom-scheme, and native-addon loads
  fail without a result. Network built-ins, direct built-in lookup, private
  native bindings, and network globals are also denied because Node's
  permission model does not restrict sockets. Private underscore and internal
  built-ins are denied as one class so their lower-level socket entry points
  cannot bypass that rule. The optional operation supports the reviewed Node
  26.1+ package runtime.
- Add internal bounded installed package closure measurement for CSS Modules
  tooling. It records deterministic evidence for installed package bytes. A
  separate execution-admission step must establish final processor identity.
  Request values are copied once. Chunked file reads, package metadata, map
  work, resolution work, and retained path state have fixed whole-capture
  limits. Resolver-directory aliases follow the host filesystem's case
  behavior. Node's ordered lookup paths now prevent ambient global packages
  from becoming false absence. The local-only profile rejects effective global
  winners, built-ins, legacy package files, root package self-references,
  declared self-edges, policy flags, and unsupported lookup shapes. Root
  package metadata aliases require filesystem-identity proof. Root, alias,
  dependency, peer, and metadata names use one position-sensitive, historical
  npm-compatible ASCII grammar.

## 0.5.0

- Export the exact Genes output inventory reader and unowned-file guard from
  `@genes-ts/tooling/session`. One-shot hosts can now derive handoff records
  from compiler ownership instead of guessing from a directory scan.
- Let hosts declare a whole extra input directory for `DevelopmentSession`.
  Descendant edits, additions, and removals now request the declared rebuild,
  while symbolic links fail instead of hiding input from the watcher.
- Let a host import one exact generated application when it moves to
  `DevelopmentSession`. Genes checks the old ownership facts and the live
  files, runs the normal host validator, and records the handoff without
  rewriting the application. A broken first rebuild keeps that checked output
  available until a later build succeeds.

## 0.4.0

- Add a safe Lix resolver for an ordered Haxe library group. It uses one
  shell-free `haxelib path` call and returns the exact Haxe arguments, package
  folders, and proof files that a development session needs.
- Let a trusted library resolver return the exact external package folders
  found by its answer. HXML inventory checks those folders before it accepts
  any returned class path or proof file, so a host does not need to trust a
  whole package cache in advance.
- Wait for the Lix command to close its output pipes before parsing it. Keep a
  bare HXML result as checked HXML input, and reject links inside returned
  package paths.
- Accept inline and split HXML options, quoted paths, and normal surrounding
  spaces from Lix output. Keep unreadable scope folders and unreadable or
  removed proof files inside the resolver's stable error types. Admit checked
  Neko library paths into a managed development session.

## 0.3.0

- Resolve adjacent Haxe libraries as ordered groups, matching Haxe 4.3.7's
  `haxelib path` behavior. A development session can now compile and watch
  several trusted libraries outside the project folder when the host declares
  their allowed roots. Undeclared and linked paths still fail before Haxe runs.
  Public events hide machine-local library folders behind the reserved
  `@external/<root-index>` root name. A child adds its path after that name.

## 0.2.0

- Let a trusted Haxe macro write a small, named value during a build. The host
  receives a copy of the bytes, not the path to an internal file. The value
  becomes public only when the host approves it as an output file. If the build
  stops early, Genes restores the previous result and rebuilds. If cleanup is
  interrupted after publication, Genes keeps the complete new result and
  finishes the cleanup after restart.

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
