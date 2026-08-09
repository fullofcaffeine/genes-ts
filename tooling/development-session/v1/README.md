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
  -> register the Haxe input graph
  -> assign an input revision
  -> resolve every library HXML and snapshot/check the effective invocation
  -> generate a complete private candidate
  -> ask the host to validate that candidate
  -> reject it if a newer revision is already known
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
and do not overlap. Tooling-owned event fields never expose private candidate
paths. The host remains responsible for mapping its own diagnostic paths to
logical locations and for sanitizing any diagnostic sent outside the process.

One JSON-lines event can therefore be consumed directly by automation:

```json
{"protocol":"genes.tooling.development-session-event","version":1,"sequence":8,"at":1785520800000,"event":{"kind":"generation-accepted","accepted":{"generation":2,"revision":3,"acceptedAt":1785520800000,"manifestDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","compilerMode":"connected","files":{"created":[],"updated":["src-gen/index.tsx"],"deleted":[]},"entryChanged":true}}}
```

The diagnostic inside a validation failure is host-owned JSON. Core tooling
does not rewrite host data. Diagnostics produced by the session itself use
logical subjects and sanitize private candidate/state paths before they enter
an event; a host still decides which diagnostic data is safe to send to a
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

The publication journal and accepted marker are keyed by project/output scope,
not by the caller's private `stateDirectory`. If a process crashes while using
`.genes/state-a` and restarts with `.genes/state-b`, the new process still finds
and resolves the one authoritative journal before inventory or compilation.
That scope uses the artifact protocol's portable path identity (NFC plus
case-folding), not the caller's path spelling. Case aliases therefore share one
lifetime lock, journal, marker, admission identity, and recovery universe even
on a case-sensitive host; non-NFC paths are rejected before startup. The
caller-selected private state directory may not contain or equal the stable
`.genes/tooling` control root.

Library expansion is part of invocation authority. A lower-level HXML inventory
may list `-lib` requests without resolving them, but DevelopmentSession requires
an authoritative resolver for every discovered library. The existing argument
policy then visits each returned HXML, including `extraParams.hxml`, before Haxe
can run. “Resolver returned no effective HXML” is distinct from “no resolver was
provided”; only the former is a complete closure.

Top-level HXML entries retain caller order when the session compares the
inventoried closure with the executable invocation. Entry and resolved-library
paths are checked for symlink components before canonicalization, so an alias
cannot erase the path that must pass the no-follow policy.

The executable invocation must also use the inventory's working directory and
contain only those ordered top-level HXML files. Build options belong in the
inventoried HXML graph. Source class paths reject symbolic links because Haxe
may follow them while the safe watcher does not; accepting both behaviors would
let the compiler read a change that the session could miss.

The accepted marker records both the portable output identity and its original
project-relative spelling. Case aliases still share one lock and recovery
scope. On a case-sensitive filesystem, a later session must reuse the original
spelling instead of looking for prior files in a different physical directory.

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
