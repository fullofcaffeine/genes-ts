# Durable artifact transition protocol v1

This directory is the language-neutral contract for publishing an
already-authorized set of generated files. It is host tooling, not part of the
Genes compiler transaction.

## Boundary

A host first decides exactly which live paths it may change. It validates its
private generation, computes the expected old and new state of every path, and
binds that decision to an opaque `authorizationDigest`. The publisher then:

1. verifies the complete live and staged state without following symbolic
   links;
2. takes an exclusive project lock;
3. persists a canonical journal before the first live mutation;
4. moves old files to private backups and publishes new files;
5. publishes the opaque commit marker last;
6. records enough state for another process to finish or roll back without
   guessing.

The commit marker is just one exact file transition. A framework may use a
manifest for that file, but this protocol never parses or assigns meaning to
its contents.

The protocol deliberately does **not** decide:

- which paths a host owns or may adopt;
- which roots are valid framework output roots;
- how a host validates a generation;
- what a host calls a “last good” generation;
- public diagnostic codes, wording, exit codes, or repair commands.

Those are host policy. This contract starts only after that policy has produced
one complete authorized transition plan.

The runtime receives a real project directory separately from the serialized
plan. `projectIdentity` is a non-secret digest of the runtime's stable project
identity and binds the plan, journal, and lock to that root without serializing
a machine-local absolute path. `stageRoot` names the one private subtree whose
complete inventory must match the plan; `transactionRoot` is a disjoint private
subtree reserved for locks, journals, backups, and recovery work.

## Files

- [`protocol.schema.json`](protocol.schema.json) defines exact file states,
  plans, journals, locks, outcomes, and structured failure facts.
- [`vectors.schema.json`](vectors.schema.json) defines the portable scenario
  language used by every implementation adapter.
- [`vectors.json`](vectors.json) is the v1 conformance corpus.

Run the repository-owned structural and coverage check with:

```sh
yarn test:artifact-transaction-protocol
```

The corpus is intentionally data rather than executable JavaScript, TypeScript,
or Haxe. A consumer can materialize the UTF-8 blobs into a temporary filesystem,
translate a plan into its native API, inject the named logical checkpoints, and
compare the structured result. Framework-only tests remain in their own
repositories.

A mutation without `at` is part of initial setup. `at: "after-preflight"`
means the adapter must first complete its normal authorization/preflight, then
change that entry before the publisher's own exact-state verification. This
distinguishes an ordinary initial collision from a time-of-check/time-of-use
race.

## Exact states

`Absent` and `File` are different states. A file state binds:

- SHA-256 of the exact bytes;
- byte length;
- Unix permission bits from `000` through `777`.

Modes participate in equality even when bytes do not change. Directories,
symbolic links, sockets, devices, and other special entries never satisfy a
file state.

Paths use normalized, NFC, forward-slash relative spelling. An implementation
must reject absolute paths, empty segments, `.` or `..`, backslashes, NUL,
non-NFC text, and portable case-fold collisions before mutation. A real project
root and every existing parent/control component must be inspected without
following symbolic links.

## Recovery rule

Recovery has only three safe choices:

- finalize when the complete intended state exists and the host admits the
  journal-bound authorization;
- roll back to the exact prior state;
- refuse without mutation when live, stage, backup, lock, or journal state is
  ambiguous.

An interrupted rollback is itself journaled and resumable. Repeating recovery
after a terminal outcome is a no-op.

Journals and locks use RFC 8785 JSON Canonicalization Scheme bytes. Their
declared digest is SHA-256 over the same closed object with only its own digest
field omitted. The journal separately binds the canonical plan digest,
`projectIdentity`, and opaque `authorizationDigest`; changing any one of those
facts makes recovery refuse without touching live paths.

## Structured failures

The runtime reports facts; a host turns those facts into its own diagnostics.

| Kind | Operational meaning |
| --- | --- |
| `invalid-plan` | The closed transition set is internally inconsistent. |
| `unexpected-staged-state` | A declared staged file has different bytes, size, mode, or entry type. |
| `undeclared-staged-entry` | The private stage contains an entry that the plan did not declare. |
| `unexpected-live-state` | A live path does not match its authorized prior or already-intended state. |
| `path-escape` | A path is absolute, traversing, non-normalized, or otherwise not portable-relative. |
| `portable-path-collision` | Two spellings can name the same portable filesystem path. |
| `symlink-traversal` | The project root or an existing public/control component is a symbolic link. |
| `active-writer` | A verifiably live same-project writer owns the lock. |
| `untrusted-lock` | Lock identity, host, project, nonce, or transaction binding cannot be trusted. |
| `malformed-journal` | Journal shape, canonical bytes, digest, authorization, or plan binding is invalid. |
| `orphan-control-state` | A lock or journal exists without the exact companion state required to interpret it. |
| `recovery-conflict` | Recovery found bytes or entries matching neither journaled state. |
| `filesystem-unsupported` | Required durable or same-device filesystem semantics are unavailable. |
| `filesystem-permission` | Metadata, synchronization, rename, or cleanup was denied. |
| `control-path-collision` | A reserved private transaction path contains an unexpected entry. |

Logical checkpoints name durable state-machine boundaries rather than
particular syscalls. `after-backup:<path>`, `after-publish:<path>`,
`after-remove-next:<path>`, and `after-restore-prior:<path>` are emitted once
the named exact transition is durable. Phase and cleanup checkpoints use the
names recorded in `vectors.json`. An adapter must not report a checkpoint
before the state it names can survive process termination.

## Compatibility

The protocol and vector schema versions are independent of a future runtime
package version. Implementations must reject an unknown major protocol or
vector version. Additive optional fields are not permitted in v1: every object
is closed so a misspelled or silently ignored security fact cannot weaken
recovery.
