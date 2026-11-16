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
  DCE/library roots, occurrence-local generic extern witnesses, exact React
  state initialization types through a transparent alias, closed enum locals
  with lowered conditional initializers and inlined callbacks, enum constructor payload domains, and import
  attributes;
- the modules that Haxe types again after a one-file edit: after a complete
  TSX or classic JSX generation, the edit of a module that nothing imports
  makes Haxe type that module only, the same as with `--no-output`
  (`probes/RetypedModulesProbe.hx` reports the list; the case edits two such
  modules in turn, because one of them can hide the defect, and then an
  imported module, whose list must also equal the `--no-output` list);
- two `Generator.use()` calls in one request: the module inventory that
  replaces `Context.getModule` still lists each declaration once
  (`probes/ModuleInventoryProbe.hx`);
- a successful build followed by structured-diagnostic and raw-value
  post-staging failures in TS and classic declaration profiles, then recovery;
- active-Genes then `genes.disable` capability isolation;
- source maps, strict TypeScript consumers, runtime transcripts, manifests,
  staging/sentinel cleanup, bounded clients, unrelated listeners, signal
  cleanup, and exact owned-process death.

The generated `.tmp` directory is disposable and intentionally ignored. Do not
turn it into checked-in expected output; the cold build is the executable
oracle for the warm build.

Each request reports its start and deadline. A completed request also reports
its exit result and elapsed time. These progress records use stderr so stdout
remains available for machine-readable compiler tools. Successful stable
compiles have a three-minute deadline under repository background scheduling
(six minutes on the advisory preview lane). Expected diagnostic requests keep
the prior 60-second stable and 120-second preview limits, and the synthetic
lifecycle timeout remains independently short.

`yarn test:compiler-server:kept-types` is a separate proof, not part of the
complete owner. It answers one question for the incremental work: when is a
typed value that a macro keeps from an earlier request still correct? It uses
the project `templates/kept-types`, `probes/KeptTypeValuesProbe.hx` and
`RetypedModulesProbe`, in two lanes: Haxe alone, and Haxe with the Genes
TypeScript generator. It compares no generated file. See
[`docs/INCREMENTAL_AFTER_TYPING.md`](../../docs/INCREMENTAL_AFTER_TYPING.md)
for the cases and the result.

`yarn test:compiler-server:after-typing` is the gate for the keep rule of the
passes after typing (`-D genes.dev_incremental`, off by default). It runs the
edit lists of project A and of `templates/kept-types`, plus one React audit
error, in a new Haxe process without the define (the cold oracle) and on four
warm servers: `plain` (no define), `measure` (stamps, records and buckets, no
skipped work), `reuse` (a pass skips each declaration whose record or bucket
the keep rule keeps) and `compare` (every pass does its full work; a kept
result that would have been wrong is reported). Each warm tree and each
diagnostic must equal cold. `--modes=reuse,compare` runs only the named warm
modes. The request report is the file `<descriptor>.after-typing.json`
beside the request descriptor; it is never in the output tree.

Two passes keep results. The React audit keeps one plain record for each
clean class (`reactAudit` in the report). `genes.ts.SignatureCache` keeps the
facts of each declaration as one bucket with typed values
(`signatureCache`). The gate cannot pass empty: in each request with no edit,
the kept records and the kept buckets must be above 0; in `reuse` the skipped
audits and captures too; for the buckets also the same-object tests, and in
`compare` the compared answers. The compare failures must be 0.

Rows of the `kept-types` list that only a complete keep rule passes, each
for the `SignatureCache` bucket:

- "E1: first use of a @:generic method": the bucket of `GenericOwner` is
  rejected for `membersChanged`. Haxe did not type the class again.
- "E2: a macro-defined type with a copied stamp": the bucket of `Clone` is
  rejected for `stampNamesOtherDeclaration`.
- "a macro-defined type with its own earlier stamp (Twin)": the build macro
  of `Twinner` defines `Twin` again with the stamp of the earlier `Twin`,
  the same member list and another field type. Only the same-object test
  rejects the bucket (`otherObject`).
- "a type nested deeper than the walk limit (Lone.deep)": the capture of
  `Lone` reaches the depth limit of the enum-abstract walk. `Lone` gets no
  bucket, and each request with reuse on captures every declaration again
  (`fullWork` in the report).

Two more lanes use `templates/kept-types` with other command-line modules:

- `explained`: `Looper` has an inline object with an `Array<Phase>` field.
  Haxe replaces the object after the after-typing callbacks and saves the
  changed body, so each later request reads a local `phases_all` that the
  first request and a cold build do not read. In `compare` the gate requires
  explained differences of `Looper` with "kept none". This also shows a
  difference of today: the plain warm tree prints `("done" | "draft")[]` for
  that local and the cold tree prints `string[]`. The rows require exactly
  that difference in `plain`, `measure` and `compare`, and `reuse` equal to
  cold, because the kept bucket is the first read.
- `late-facts`, case F2: the first use of `GenericOwner.make` with `Phase`
  comes in a request that fails with a type error in `Lone`. That request
  still writes a new bucket for `GenericOwner` (`membersChanged`). The
  repaired request must drop it (`uncommitted` in the report, the commit
  step of `KeptRecords`), and every tree equals cold. Case F1: an edit of
  `HolderUser` fixes the open types of `Holder` from another module. The
  warm build of today prints `any` for them and a cold build prints the
  `Phase` literals; the rows require that difference in `plain` and every
  other mode equal to the plain warm tree, so the bucket adds no
  difference. F1 is the last case of the lane, because the difference stays.

The same gate has a lane `diagnostic-order`, also for builds without the
define. Haxe ends an after-typing callback at its first `Context.error` and
still runs the next callback. The lane requires the errors of both callbacks
in Haxe's order: "@:genes.library does not accept arguments" and then
`GENES-MODULE-DIRECTIVE-ARITY-001` in the usual macro order; the directive
error and then the audit error when `Generator.use()` runs twice or after
the React install. Three single checks follow: `probes/KeepRuleProbe.hx`
(each condition of the keep rule on its own), a program with an `@:rtti`
class (the request leaves the incremental path and equals cold), and a
report file that cannot be written (one warning, never a failed build).
`KeepRuleProbe` also checks the shapes of a compare difference about a
local: only "kept none, new answer" for a first-read bucket is explained;
kept `T1` and new `T2`, a kept answer with no new answer, and a bucket that
is not a first read are failures.

Mutation check, by hand, when the keep rule changes. The gate has no
automatic step for it, because it needs a broken copy of the compiler source.
In `GenerationChangeSet.keep`, remove the rejects for `TypedAgain`,
`StampNamesOtherDeclaration` and `StampDiffers`, then run
`yarn test:compiler-server:after-typing --modes=reuse` and
`--modes=compare`. Expected: `reuse` stops at the step "a Hook call inside a
condition (audit error)" with "did not fail", because the skipped audit hid
the diagnostic; `compare` stops there with `GENES-INCREMENTAL-AUDIT-001`.
Restore the file afterwards. Removing only one of the two stamp rejects
shows nothing in a lane: the other one rejects the same records. That is
why `KeepRuleProbe` exists.

Mutation checks for the buckets, also by hand. Run each with
`--modes=reuse` and with `--modes=compare`, and restore the file afterwards.

- In `KeptBuckets.kept`, return the bucket also when the keep rule rejects
  it (`--lanes=project-a`). Expected: `reuse` stops at the first edit with
  "reuse did not put back exactly the kept buckets"; `compare` stops there
  with "SignatureCache wrote a bucket for a kept declaration, or none for a
  rejected one". The counts stop the gate before a tree differs: that edit
  changes no fact of the leaf module.
- In `GenerationChangeSet.sameObject`, return `true` without reading the
  result of the test (`--lanes=kept-types`). Expected: both modes stop at
  the step "a macro-defined type with its own earlier stamp (Twin)".
  `reuse` reports "the warm tree differs from the cold tree": the stale
  bucket gives `Twin.state` the literal type of the earlier class.
  `compare` reports `GENES-INCREMENTAL-COMPARE-001` with 2 answers.
- In `KeptRecords.beginRequest`, do not remove the pending records
  (`--lanes=late-facts`). Expected: both modes stop at "F2: the type error
  repaired". `reuse` reports "the warm tree differs from the cold tree": the
  local `list` of `GenericOwner.make_kepttypes_Phase` is `string[]`, not
  `("done" | "draft")[]`. `compare` reports `GENES-INCREMENTAL-COMPARE-001`
  with 1 answer.
- In `SignatureComparison.locals`, count every difference of a first-read
  bucket as explained (the rule before this change). Expected: the run
  stops at `KeepRuleProbe` with the case "kept T1, new T2, first read".

`--lanes=project-a,kept-types` runs only the named edit lists (lanes:
`project-a`, `kept-types`, `explained`, `late-facts`, `diagnostic-order`). Such a run
ends with `compiler-server-after-typing:partial`, not with the `ok` line of
the gate.

Run the complete stable owner with `yarn test:compiler-server`. Use
`yarn test:compiler-server:rollback` when changing exception handling,
transaction cleanup, or the Haxe preview lane: it executes only the TS/classic
post-staging failure and recovery contract.

## Macro-state checkpoint

The fixture was extended after the architecture checkpoint because the earlier
generic call used only `@:ts.explicitTypeArguments`. That path derives a type
from the current callee and never consulted the lower-level
`TypeArguments.call(...)` registry that the checkpoint had identified as
suspicious.

The reduced probe now compiles one exact call position as `String`, then `Int`,
then `String` again. Before the correction, the first stable warm request
failed because its cached carrier could not find the witness in the generator's
macro context. The fix removed that static registry: inert typed facts now live
on the exact carrier occurrence and both emitters erase them. Copied source
positions can consequently carry different facts safely, and the server does
not need a compiler-wide session or persistent typed cache.

The checkpoint classifications are:

| Owner | Executable evidence | Result |
|---|---|---|
| `ExplicitTypeArguments` | Same absolute call site with String → Int → String, plus two copied occurrences at one source span | **Defect reproduced and fixed.** Facts are occurrence-local in the typed tree; no mutable macro registry remains. |
| Generator callbacks and `@:genes.generate` membership | Identical repeats, edit/delete/restore, profile changes, a final return to the first tree, and `a-rtti-server` (an `@:rtti` class and a subclass after a priming request) | **No observable stale output in the TypeScript profile.** Current-generation metadata continues to select the correct module inventory. Known limit: in the classic profile, an `@:rtti` class keeps the stamp in its `__rtti` string, so warm and cold output differ for such classes. |
| `CompilerInternal.GENERATOR_ACTIVE_DEFINE` | Active Genes requests followed by `genes.disable`, then a successful request | **Request-scoped in the supported lane.** The disabled request fails at the authored carrier and publishes nothing. |
| `PublicSurface` | Application/library DCE changes and two same-named projects with different public field types | **Explicit reset is effective.** Strict consumers observe only the current project's surface. |
| `SignatureCache` | Same-named projects with String versus Int fields and generic arguments | **Explicit reset is effective.** Generated implementation and classic declarations equal isolated cold builds. |
| `ModuleDirectivePlan` | Edited/restored directives and distinct same-named project prologues | **Explicit reset is effective.** Directive spelling/order follows the current request. |
| `TypeUtil.registerType` / `bootType` | Intrinsic-first and direct-import-first field-level `@:jsRequire` edits in `yarn test:genes-ts:source-inline-server`, plus the complete server matrix | **Defect reproduced and fixed.** The first `Generator.use()` in every request refreshes that compilation's declarations; both edit orders restore byte-identical trees on Haxe 4.3.7. Haxe 5 preview still exposes the separate advisory DCE variance described below. |
| Generator output path and sentinel fields | Changed roots, TS/classic extensions, staged failure/recovery, manifest and sentinel checks | **Current request wins.** Prior owners remain intact and private debris is removed. |
| Raw generation throws | TS and classic declaration builds throw a plain Haxe string after every emitter has staged its files, in cold and warm processes | **Wrapped by the supported Haxe macro runtime.** The same `haxe.Exception` rollback boundary preserves the prior tree and removes the stage/sentinel before a corrected request. |

On Haxe `5.0.0-preview.1`, exact preview output still fails before the longer
matrix: after the compiler's casting stage, cold and warm `genes.Register` are
equivalent, but after DCE the generic `js.lib.Object.defineProperty` monomorph
is unresolved in the cold tree and resolved to `{}` in the warm tree. Genes
therefore prints the warm request's checked `unsafeCast<{}>` and the cold
request prints the direct value. This is a visible preview typed-AST variance,
not a TypeUtil owner mismatch or a relaxed file allowlist. Preview remains
advisory; stable Haxe 4.3.7 remains the blocking lifecycle contract.

`yarn test:compiler-server:rollback` isolates the publication boundary from
that known variance. On preview it compares the corrected cold build with its
own cold baseline and the corrected warm build with its own warm baseline; it
does not pretend those two different typed trees are byte-identical. Stable
Haxe continues to require cold/warm identity in both the focused rollback probe
and the complete server matrix.
