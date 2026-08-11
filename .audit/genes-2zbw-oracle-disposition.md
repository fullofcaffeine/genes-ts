# Oracle disposition: compiler-created data files

## Local baseline

The local Genes revision is `19c9fb7197b38b5035ef286786dec71f74fabb2c`.
The Oracle bundle used this same Genes revision.

`DevelopmentSession` can prepare private files before Haxe runs. It can also
publish host-approved files after validation. It cannot receive a declared
private file that a Haxe macro creates during the same compilation.

The existing artifact publisher already restores the prior public files when
recovery rejects an interrupted intended result. This behavior supports a
safe rollback-and-rebuild policy for compiler-created data.

No implementation tests ran during this planning review. Source inspection
confirmed the ownership and recovery seams. The implementation must add the
focused and real Haxe tests described below.

## Oracle claim decisions

| Oracle claim | Decision | Local reason |
| --- | --- | --- |
| `DevelopmentSession` owns the declared data slots and their lifetime. | Retained | The session already owns each private revision and the outer publication. |
| Compiler-created data stays outside the Genes output manifest. | Retained | That manifest describes generated TS or JS files. Private host input has a different role. |
| Haxe receives a request-local descriptor for exact opaque slots. | Retained | This permits one compilation and avoids a public writable path. |
| The validator receives immutable byte copies with no filesystem paths. | Retained | The host needs the data, but it does not need a writable candidate path. |
| The host promotes selected bytes through existing approved output files. | Retained | This keeps public paths and framework meaning under host control. |
| Recovery marks data-dependent publication as rebuild-required. | Retained | A restarted process cannot recreate the private validation input from public files. |
| Recovery mode can join the existing admission digest. | Retained, with tests | Current recovery receives the saved authorization digest and rolls back when admission returns false. Crash tests must prove every checkpoint. |
| Add an all-static Haxe `CompilerData` class. | Rejected | Genes supports module functions. A static shell class adds no useful identity. |
| Add optional data slots in version 1. | Deferred | Required slots give one clear missing-file rule. |
| Change `Generator`, `OutputTransaction`, or the Genes output reader. | Rejected for this change | These parts own generated target files, not private host data. |
| Migrate all NextJsHx one-shot commands now. | Deferred | The first downstream proof will migrate `dev`. One-shot commands can keep their current private temporary files. |
| Publish an accepted-generation digest for all private data. | Deferred | The existing admission digest can bind recovery behavior without exposing private details. |

## Integrated conclusion

This change adds a closed list of required compiler-data declarations to
`DevelopmentSession`. Each declaration has a logical ID and a byte limit.

For each revision, tooling creates private slots that do not expose public
paths. A versioned request file maps each logical ID to one slot. Haxe module
functions write UTF-8 text or bytes to a declared slot. They do not return a
path.

After Haxe succeeds, tooling will inspect the complete slot directory. It will
reject missing, extra, linked, special, oversized, or changing files. It will
copy accepted bytes into path-free snapshots before host validation.

The first limits are 64 slots, 8 MiB for one slot, and 16 MiB in total. These
limits are generous for plan files but still bound memory and disk use. Later
evidence can justify a compatible increase.

The validator can return a public copy or derived files as approved outputs.
The existing outer publisher will publish all approved files together.

If an interrupted publication used compiler data, recovery will roll back to
the prior public tree and start a fresh build. It will not validate incomplete
public bytes without the original private data.

## Verification and open gaps

The proof for this change includes:

- two independent slots in one Haxe compilation;
- exact missing, extra, duplicate, size, and link failures, plus file-stability checks;
- path-free, read-only snapshots with fresh byte copies;
- one warm Haxe server across source-only edits;
- warm output equal to isolated cold output;
- TypeScript and classic JavaScript profiles;
- exact prior-file retention for validation errors and every crash checkpoint;
- no private candidate path in diagnostics;
- no runtime module or second compilation for this data;
- package exports and beginner documentation.

The Oracle bundle contained an older NextJsHx code revision than the prompt
named. The generic Genes decision remains valid. The later NextJsHx change
must inspect and test the current downstream revision before it claims support.
