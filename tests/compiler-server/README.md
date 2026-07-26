# Compilation-server equivalence fixture

This fixture is copied into disposable project roots by
`yarn test:compiler-server`. The test sends both projects and every profile
transition through one repository-owned Haxe server, while an isolated Haxe
process builds the same request into a sibling `cold` tree.

The two projects deliberately reuse the same Haxe module and field names. Their
types, directives, runtime markers, and public surfaces differ, so a
process-persistent cache keyed only by a short name or source span becomes an
exact cold/warm tree mismatch.

The harness gives each project a private, behavior-neutral define. Haxe 4.3.7
selects its own typed-module cache by compilation signature rather than
classpath identity, so without that define Haxe can return Project A's
same-named typed tree before Genes executes Project B's generator. The define
separates only Haxe's native project caches; both projects still share the same
server process and therefore the same Genes `@:persistent` macro lifetime.

The focused owner covers:

- TypeScript, TSX, classic MJS, and classic declarations;
- repeated requests and changed output roots;
- source edits, deleted/restored modules, module directives, module functions,
  DCE/library roots, generic extern witnesses, and import attributes;
- a successful build followed by a private post-staging failure and recovery;
- active-Genes then `genes.disable` capability isolation;
- source maps, strict TypeScript consumers, runtime transcripts, manifests,
  staging/sentinel cleanup, bounded clients, unrelated listeners, signal
  cleanup, and exact owned-process death.

The generated `.tmp` directory is disposable and intentionally ignored. Do not
turn it into checked-in expected output; the cold build is the executable
oracle for the warm build.
