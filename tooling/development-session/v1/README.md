# Development-session protocol v1

This protocol describes the long-lived unit that turns changing Haxe inputs
into a complete, validated, public Genes output tree. It exists so a command,
framework adapter, human, or AI agent can observe the same lifecycle without
rebuilding process, watcher, and publication rules from terminal text.

`createGenesDevelopmentSession` now implements this contract by composing the
repository's existing HXML inventory, reconciled watcher, serialized loop,
owned Haxe server, and recoverable artifact publisher. The protocol remains
framework-neutral: the implementation does not run Vite, Next.js, Electron,
Expo, WordPress, a browser, or any other application service.

## Who should read what

If you are new to the tooling, read “The practical problem” and “States a host
presents” first. Those two sections explain the user-visible behavior without
requiring implementation knowledge.

If you are writing a host adapter or automation client, also read “Event and
ordering contract” and “Agent and automation use.” The event schema is your
machine interface; terminal sentences are not.

If you are implementing the session, read this entire file, then:

1. [`../../src/session/types.ts`](../../src/session/types.ts) for the public
   TypeScript surface;
2. [`vectors.json`](vectors.json) for required scenarios and outcomes;
3. [`../../src/session/runtime.ts`](../../src/session/runtime.ts) for the
   composition layer;
4. the existing HXML, watch, loop, Haxe-server, and artifact implementations
   named in [`../../README.md`](../../README.md).

The vectors are executable acceptance requirements. The focused runtime suite
drives every vector through the real state machine with controlled compiler,
watch, validator, and fault boundaries; they are not illustrative examples an
implementation may ignore.

## The practical problem

A simple development script often starts two unrelated watchers: one invokes
Haxe and another serves generated TypeScript. That arrangement can expose a
half-written tree, serve code that strict TypeScript would reject, start a
second compile while the first is active, or kill a compiler process it did
not create.

The session contract makes the safe order explicit:

```text
recover an interrupted publication
  -> resolve and freeze the exact Haxe invocation
  -> inventory that invocation's exact HXML and library argument closure
  -> register the Haxe input graph
  -> assign an input revision
  -> bind one private ordinary Haxe JS target and one private Genes target
  -> generate a complete private candidate
  -> ask the host to validate that candidate
  -> reject it if a newer build-requiring revision is already known
  -> publish all admitted files as one recoverable transaction
  -> announce an accepted generation
```

An **input revision** counts observed source/configuration states. An
**accepted generation** counts candidates that passed validation and became
the public tree. Failed or superseded revisions therefore do not consume a
generation number.

For example, revision 2 may fail strict TypeScript while generation 1 remains
public. After the developer repairs the source, revision 3 can become
generation 2.

A host may mark an extra input change as `rebuild: false` when that file cannot
affect generated output or validation. The session reports this informational
change and advances `newestRevision`, but it does not discard a valid compile
already in progress. This is why an accepted generation's `revision` may be
lower than `newestRevision` until another build-requiring change occurs.

## States a host presents

- `opening`: recovery and input registration have not completed.
- `building`: one revision is generating, validating, or publishing.
- `blocked`: this session has no accepted generation yet and the latest
  attempt failed. Inspect `failure.recoverable`: a recoverable failure can be
  repaired in the same command, while a fatal failure also rejects
  `firstAccepted`.
- `ready`: the recorded accepted generation is public.
- `degraded`: a newer revision failed, but the recorded accepted generation
  remains public and usable.
- `closing`: the session is refusing new work and releasing owned resources.
- `closed`: cleanup completed. Calling `close()` again changes nothing.

`firstAccepted` deliberately stays pending after a recoverable initial error.
That lets one development command remain alive while the author fixes the
source. It rejects if a fatal startup failure or closure makes a first
generation impossible.

Here is the distinction a newcomer usually needs most:

| State | What the developer sees | Is a usable public generation available? |
| --- | --- | --- |
| `blocked` | No build is public; repair in place only when `failure.recoverable` is true | No |
| `ready` | The latest accepted generation is public | Yes |
| `degraded` | A newer attempt failed, so tooling kept the last good output | Yes |

“Degraded” is therefore a recovery feature. It does not mean that tooling
published the broken candidate.

## Event and ordering contract

Every event is a self-describing JSON record with protocol
`genes.tooling.development-session-event`, version `1`, a session-local
strictly increasing `sequence`, and an epoch-millisecond `at` value.

State changes update `session.state` first, then emit a `state` event. A
specific outcome event such as `failed` or `generation-accepted` follows it,
so a listener handling that outcome can already read the new state. An
accepted event is never emitted before the artifact transaction has committed.
`firstAccepted` resolves after that event is delivered.

Tooling-owned paths in events and file deltas are project-relative and use `/`
on every platform. Lists are sorted by UTF-8 byte order, contain no duplicates,
and do not overlap. Events never expose private candidate, state, or project
paths. This includes host validation messages and JSON keys that spell a path
with either `/` or `\\`. A host should still prefer useful logical paths in its
diagnostics, because replacing a private path can hide the location rather than
explain it.

One JSON-lines event can therefore be consumed directly by automation:

```json
{"protocol":"genes.tooling.development-session-event","version":1,"sequence":8,"at":1785520800000,"event":{"kind":"generation-accepted","accepted":{"generation":2,"revision":3,"acceptedAt":1785520800000,"manifestDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","compilerMode":"connected","files":{"created":[],"updated":["src-gen/index.tsx"],"deleted":[]},"entryChanged":true}}}
```

The diagnostic inside a validation failure is host-owned JSON. Before it enters
an event, tooling removes private candidate, state, and project paths from
every string and object key. It otherwise preserves the host's values. The
host still decides which remaining application data is safe to send to a
browser.

## Private validation and last-good output

The host validates a complete private `ValidationTree`. For a TypeScript
application, the validator can expose candidate bytes at their eventual
logical paths through the TypeScript Compiler API. A rejection leaves the
public tree byte-for-byte unchanged.

Validation happens before publication. The artifact transaction still owns
failure-atomic publication and recovery. These are separate guarantees:

```text
Genes compiler transaction -> complete candidate
host admission             -> candidate is acceptable for this project
tooling transaction        -> admitted candidate replaces public output
```

An admitted candidate whose bytes are unchanged still advances the accepted
generation and revision, but reports an empty `FileDelta`. Hosts perform no
reload for that empty delta.

The outer accepted-generation marker binds the last admitted compiler
inventory. The session remembers the marker's exact file state, and the
inventory includes the compiler ownership manifest's raw digest, size, and
mode. A later build refuses to publish over any of those exact authorities when
they changed outside the session. Unowned neighboring files are preserved;
an unowned file occupying a newly generated path is a collision, not something
the session adopts. Generated files are outputs—not a second editable source
tree.

The publication journal and accepted marker are keyed by project/public-root scope,
not by the caller's private `stateDirectory`. If a process crashes while using
`.genes/state-a` and restarts with `.genes/state-b`, the new process still finds
and resolves the one authoritative journal before inventory or compilation.
That scope uses the artifact protocol's portable path identity (NFC plus
case-folding), not the caller's path spelling. Case aliases therefore derive
one lifetime lock, journal, marker, admission identity, and recovery universe;
on a case-sensitive host, original-spelling protection prevents an alias from
becoming a second physical tree. Non-NFC paths are rejected before startup. The
caller-selected private state directory may not contain or equal the stable
`.genes/tooling` control root. The public output root cannot contain or be
contained by that control root either. V1 persistently binds one public root to
one entry file, because two entry files may both claim the same generated
sibling modules. A second entry for that root fails before recovery or Haxe
execution, even after the first process exits. The entry-owner record becomes
visible only after all of its bytes are safely written. For compatibility with
an interrupted write, a restart removes an uncommitted private owner file. A
damaged final owner, non-canonical owner, or linked owner still fails closed.

### Upgrading older session state

Earlier DevelopmentSession builds stored their lock, journal, and accepted
marker beside one output entry instead of beside the whole output directory.
The current session upgrades that state before it reads source files or starts
Haxe:

1. hold the old entry lock and the new output-directory lock.
2. finish or roll back any old journal.
3. record exactly which old marker and generated manifest are being upgraded.
4. replace the old marker with a stop record, so an older Genes process fails
   instead of publishing after the upgrade.
5. write the one-entry owner for the output directory.
6. write a root-scoped marker with the same accepted generation facts.

The receipt, stop record, owner, and new marker are each published through the
recoverable artifact writer. A process may stop after any step. The next start
checks the exact bytes and continues safely. Until the final marker exists, the
previous generated files remain the accepted files. If two older entries claim
the same output directory, startup refuses to choose between them. The project
must move one entry to a separate output directory before it can upgrade.

The old marker and the live Genes ownership manifest must contain the same
manifest digest. This comparison proves that the marker describes the current
generated tree. Migration stops before it writes a receipt if they differ.

The upgrade is one-way. The stop record is a permanent migration fence. The
released v1 client cannot parse this fence, so it stops when it uses the same
entry. Supported installations must not downgrade the tooling package after
migration. An old client started manually with another entry uses another old
lock path and does not know the root-scoped protocol. V2 cannot force that
unsupported client to read the new lock.

The migration receipt records history. Later v2 builds can publish new
generations without comparing the current generated manifest with the old v1
manifest in that receipt.

Library expansion is part of invocation authority. A lower-level HXML inventory
may list `-lib` requests without resolving them, but DevelopmentSession requires
an authoritative resolver for every discovered library. That resolver returns
the exact ordered arguments that Haxe would receive from `haxelib path` plus
the files that prove that resolution. The plan flattens those arguments and
does not pass `-lib` to Haxe again. It receives the same frozen environment
lookup used by HXML expansion. “Resolver returned empty argument and provenance lists” is distinct from
“no resolver was provided”; only the former is a complete closure.

The frozen invocation is the authority for the working directory, environment,
and ordered top-level HXML entries. The `hxml` option cannot supply competing
copies of those values. HXML uses Haxe 4.3.7 whole-line parsing and `%NAME%`
expansion. V1 rejects authored CWD and resource options rather than claiming a
partial model. Entry, occurrence, and resolved-library paths are checked for
symlink components before canonicalization, so an alias cannot erase the path
that must pass the no-follow policy.

The host invocation contains only ordered top-level HXML files. The executable
invocation instead receives the sealed flattened arguments from those files
and library resolutions. Source class paths reject symbolic links because Haxe
may follow them while the safe watcher does not; accepting both behaviors would
let the compiler read a change that the session could miss.

Authored HXML selects no target. Under the reviewed Haxe 4.3.7 policy, the
session rejects JavaScript and every alternate target selector, then appends
one private `--js` target and one private `genes.output` target itself. If Genes
does not activate, ordinary Haxe output remains inside the disposable candidate
stage and a missing Genes ownership manifest prevents publication.

The session rejects HXML `--cmd`, `--run`, `--interp`, and `-x`. Those Haxe
options can run a shell command or the compiled program before the private
candidate has passed the host's checks. It also rejects `--xml` and `--json`
because they write extra files, and rejects dump/message-log defines plus
display, prompt, no-output, compiler-server, and multi-compilation modes. A host
that needs a follow-up command or side output must own it explicitly and run it
only after an accepted generation. A later supported Haxe version needs a new
reviewed compiler-I/O policy rather than silently inheriting this table.

For ordinary one-value options, `--name=value` and `--name value` are checked
as the same input. Haxe 4.3.7 also has a small group of options that it handles
before that ordinary parsing step. Their inline spelling can mean something
different: `--run Main` runs a program, but `--run=Main` is rejected. The HXML
inventory therefore rejects inline spellings for this reviewed group instead
of changing the author's input into a different Haxe command. The same rule
explains why inline library forms such as `--library=sample` are rejected.

The complete Haxe 4.3.7 group is:

```text
-C --cwd --connect --server-connect --server-listen --wait --run
-L --library -lib --jvm --java -java --cs -cs --display
```

Some inline forms fail in Haxe. Other inline forms do nothing. The inventory
rejects both outcomes because neither one has the separate-value meaning.

The host may supply environment overrides with the Haxe invocation. For each
revision, the session combines them with the current Node process environment,
copies the complete result, includes it in the compiler-server identity, and
passes those exact values to Haxe. An ambient `PATH`, `HAXELIB_PATH`, or
`HAXE_STD_PATH` change therefore starts a compatible server instead of silently
reusing one created with older settings.

This boundary does not sandbox hostile Haxe macros. Macros are compile-time
programs and can use filesystem and process APIs. V1 trusts the selected Haxe
toolchain, resolved libraries, and project macro code; macro-owned external
inputs must be declared as `extraInputs` when they affect rebuild correctness.
Confining arbitrary macro reads and writes requires an operating-system sandbox
and is intentionally outside this protocol.

If an HXML edit is read successfully but Haxe then reports a source error, the
failure is reported as a compile failure. “HXML inventory failed” is reserved
for errors that actually prevented the session from understanding the HXML
input graph.

The accepted marker records both the portable output identity and its original
project-relative spelling. Case aliases still share one lock and recovery
scope. On a case-sensitive filesystem, a later session must reuse the original
spelling instead of looking for prior files in a different physical directory.
Only the two exact output roots and entry files can prove that two spellings
name the same object. All four paths must exist as normal files or directories.
A symbolic link cannot provide this proof. If a crash leaves the entry absent,
restart with its original spelling.

## Publication and reads

Filesystem publication moves more than one file. A request that reads a
generated file during those moves could otherwise observe mixed generations.

`acquirePublishedRead()` gives a host one read lease. Publication takes the
write side of the same writer-priority gate. Candidate generation and
validation stay outside the gate; only physical public commit waits. No
accepted event is emitted until the commit completes.

This protects one generated-file read from overlapping commit. It does not
promise a page-wide snapshot across several HTTP requests; versioned browser
URLs would be required for that stronger model.

## Agent and automation use

The protocol is intentionally friendly to unattended tools:

- stable protocol versions and vector IDs replace prose matching;
- sequence, revision, and generation numbers make causality explicit;
- `inspect()` gives a late-attaching client one complete current snapshot;
- structured failure phases distinguish compiler, validator, publication,
  and shutdown errors;
- `waitForIdle()` gives tests a real barrier instead of a timing-only sleep;
- `reconcile()` asks the existing watcher for an authoritative comparison and
  reports whether it succeeded. The two pre-publication comparisons are
  admission gates: an unknown input state never counts as “no changes.”
- Publication reads the complete live result again after host admission. If an
  outside writer changes a file during that callback, the session stops and
  does not announce an accepted generation or overwrite the outside bytes.
- `firstAccepted` gates a dependent service without polling files;
- `close()` and read-lease release are idempotent;
- human terminal formatting is an adapter over the same event records.

The later `genes watch` command will expose these records as a JSON-lines mode.
Its human mode may be friendlier, but agents will not need to strip ANSI or
guess whether a log sentence means success.

An in-process client closes the attachment race by subscribing first and then
calling synchronous `inspect()`. It keeps buffered events with a sequence
greater than the snapshot's `lastSequence`; older buffered events describe
current facts already represented by `state`, `newestRevision`, `accepted`, or
`lastCompilerEvent`. Input paths, build starts, generated candidates, and
superseded candidates at or below the cutoff are intentionally historical; a
late client does not need to replay them to act on the current session. The
snapshot's compiler event is historical evidence, not a liveness guarantee.

For example, if a compiler fallback is delivered to the subscription while
`inspect()` is running, either it has a sequence greater than the snapshot and
is kept, or its sequence is covered by `lastSequence` and the same fallback is
present in `lastCompilerEvent`. The conformance corpus includes this race.

An automation client should follow this pattern once the runtime and CLI are
implemented:

```text
start the session
  -> wait for firstAccepted before starting a dependent server
  -> remember the last accepted generation and manifest digest
  -> react only to structured generation-accepted events
  -> on failed, inspect phase/recoverable/retained instead of exiting blindly
  -> use waitForIdle in tests, never a guessed sleep
  -> close once; repeated close calls are safe
```

External `invalidate()` calls are accepted only after recovery, inventory, and
watch registration complete. This keeps revision 1 the first build and prevents
startup-time events from racing recovery. The registered watcher already
reconciles the input graph before that first revision, so callers do not need to
inject a synthetic startup change.

An agent must not modify the public generated tree to “help” recovery. The
session owns publication and the host owns admission; bypassing either one
would invalidate the last-good guarantee.

## What remains host-owned

The session owns deterministic generation mechanics. The caller still owns:

- locating Haxe and constructing its arguments;
- the application validator and typed diagnostic model;
- framework-server startup, reload, restart, and browser behavior;
- top-level signal handlers and user-facing command names;
- which additional non-Haxe files should invalidate which policy.

The public output entry and its module contract are fixed for one session.
Changing the output root, entry, module format, or framework configuration is
therefore a host lifecycle operation: close the old session, create one with
the new options, and restart the host when its own policy requires it. V1 does
not emit a guessed `host-restart-required` event or compare opaque framework
facts. That keeps browser, desktop, mobile, server, and embedded restart rules
where their authoritative configuration lives.

Genes therefore does not start a framework server or an arbitrary shell
command. Browser, desktop, mobile, server, device, and future framework
adapters consume the same accepted file deltas and lifecycle facts, then
choose their own reload or restart behavior. The generic protocol contains no
framework names and does not assume a browser.

## Conformance files

- [`protocol.schema.json`](protocol.schema.json) defines the serializable v1
  event record and current-snapshot shape.
- [`vectors.schema.json`](vectors.schema.json) defines the portable scenario
  corpus.
- [`vectors.json`](vectors.json) records startup, admission, scheduling,
  compiler, publication, read-barrier, and shutdown expectations.

The scenario scripts name deterministic harness stimuli, not public methods.
The implementation PR must execute every released vector through controlled
dependencies and keep each vector ID paired with a real runtime assertion.
