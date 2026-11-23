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

## Incremental-generation shadow and replay gates

`yarn test:compiler-server:shadow` runs `scripts/test-compiler-server-shadow.ts`.
It is its own local gate (routing id `compiler-server-shadow`, with no hosted
job); `yarn test:compiler-server` no longer runs it. It
copies `templates/incremental` and applies a fixed list of about 80 scripted
edits: bodies of modules with no, few and many importers, signature and
inline constant changes, the first and last use of a method that dead-code
elimination removes (also of a method with an override in a subclass in a
third module) and of a type used only in type positions, a property whose
setter dead-code elimination removes, the first use of a `@:generic` method,
inference through a third module, a typedef chain, generic instances, types
that a build macro and an expression macro load, import cycles, `@:expose`,
module directives, HXX markup, a props type named by a string in metadata, a
dynamic iterator, the first use of `js.Lib.global` and of `js.Boot.isEnum`
(feature answers that change the output of unedited modules), a late member
of a module that is never clean that closes an import cycle (`inc.CyHub`,
`inc.CyBase`, `inc.CyChild`), another module that extends the generic
structure `inc.Env.Envelope` and so writes the signature fact of its field
(both directions), a macro of another module and an after-typing macro
(`inc.MetaMacro`, `inc.MarkMacro`) that add `@:ts.returnType` to a field of
`inc.MetaTarget`, which Haxe does not type again, and a value of the enum
abstract `inc.Color` that `inc.Env` spells through a fact that
`inc.ColorFacts` writes (only rule 7, the witness, makes `inc.Env` dirty), private types
with one name, enum abstract values, new, edited, deleted and renamed
declarations, type errors, a generation diagnostic, a failure in
`onGenerate` and one after the commit (`inc.FailMacro` and flag files), a
define change, a failure after typing, a changed resource file with no Haxe
source edit, an `@:rtti` class, a new top-level name, a macro that gives a
new class the stamp of the old one (`inc.CloneMacro`), output folders beside
the old one and at another depth, a candidate folder whose sibling holds a
source folder, descriptors that ask for compare or reuse without
afterTyping reuse and for measure with afterTyping measure, and an edit of a
Genes source file. The init macros `inc.LateMacro` and `inc.CloneMacro`
define the classes `inc.Late` and `inc.Clone` after typing in every request;
the gate requires that they are emitted and never clean.

The edit list runs twice (`--modes=compare,reuse`, the default), each time in
a new copy of the template and on new servers. After each edit the same TSX
request (with source maps) runs three times:

- in a new Haxe process: the cold oracle;
- on a warm server without `-D genes.dev_incremental`: **G0**, the warm tree
  equals the cold tree with no cache, and **G2**, `probes/EpochStampProbe.hx`
  finds no epoch stamp;
- on a second warm server with the define and a request descriptor with
  `"afterTyping": "reuse"` and `"generation": "compare"` or `"reuse"`:
  **G1**, the published tree equals the cold tree and the request reports
  the cold build's warnings. With `"compare"`, the report beside the
  descriptor (`<descriptor>.report.json`) also lists 0 mismatches for the
  modules that `"reuse"` would replay: files, warnings, final member list,
  root flags, recorded answers, added features and public entries. With
  `"reuse"`, those modules are not printed; their stored output is staged.
Each log starts with the tested commit (`git rev-parse HEAD`) and
`git status --short`.

For a request with no edit, every emitted module except the root module,
`inc.Late`, `inc.Clone`, `inc.CyHub` (it asks for a feature that emission
adds) and modules that used Haxe's printer must be
replayed (reuse) or replayable (compare), and the checks before emission must
not fall back. The gate prints the replayed modules of each edit and fails
when the reuse pass replayed none. `--only=<a|b>` runs the first request and
the edits whose id contains `a` or `b` (`=a` for an exact id; plain text,
never a regular expression); `--skip-plain` skips the server without the define.
Such runs end with `compiler-server-shadow:partial`.

Before the edits, `probes/CleanRuleProbe.hx` checks the rules that must hold
before stored output may be replayed, each case with made-up inputs:

1. The session key holds no absolute output path, only the way from the
   output folder to the project root and the output file name
   (`GenerationChangeSet.outputKeyLines`). A development session writes each
   build to a new candidate folder; a sibling folder keeps the lines, a
   folder at another depth or another extension changes them. The edits
   "output in a sibling folder" (result `incremental`, nothing typed again)
   and "output in a folder at another depth" (result `full`, "the session
   key changed") show the same on a real server.
2. A module whose epoch list is empty (the after-typing callback saw no
   declaration of it, so no stamp says that Haxe kept it) is never clean,
   also when the stored list is empty too; a module that read it by name is
   not clean either. Haxe 4.3.7 gives every declaration to the after-typing
   callback, also one that a macro defines there (`inc.Late` above), so only
   the probe reaches an empty list.
3. `"generation": "compare"` and `"reuse"` need `"afterTyping": "reuse"`.
   Otherwise the request is refused: the report has the result `off`, the
   refusal code `compare-needs-after-typing-reuse` or
   `reuse-needs-after-typing-reuse` and its reason, the generation cache is
   neither read nor written, and the tree is published in full.
4. The rules of slice S1 (the items of the review of #243): a failed
   same-object test falls back, and a module is clean only when each of its
   declarations has the same same-object proof as when its output was
   printed (item 1); a module with no stamp falls back when it is still in
   the generator list with a changed fingerprint, and is only dirty when it
   left the program (item 3); a module whose stored map names a source inside
   a folder where the stored and the current output paths part is dirty
   (item 4); a module without an output file is in rule 6 too (item 6); a
   module that asked for a feature that emission can add is never clean; and
   compare and reuse do not use a cache that afterTyping `"measure"` wrote
   (item 7).
5. Metadata with its arguments is part of the fingerprint, as a set
   (review of #244, round 2): a new entry or argument on a class, a static
   field, an enum, an enum constructor, an abstract or a typedef changes it;
   a duplicate entry or an excluded name does not. No Genes source outside
   `genes.incremental` reads an excluded name, except `Generator.needsGen`
   for `:genes.generate` on the classic path. Every literal
   `addFeature("...")` of the Genes sources is in `EMISSION_FEATURES`.
   The same holds for a field of an extern-only module and for a field of
   an anonymous structure, in a typedef body or in the type of a class
   field (genes-f8vc.9.24, L1 and L2 of the round-3 review of #244), and
   for a field of an anonymous structure in a type-parameter constraint of a
   method, a class, a typedef, an abstract, an enum or an enum constructor,
   also a constraint that names its own parameter (genes-f8vc.9.26, L5 of
   the review of #245), and for metadata on a type parameter itself (M1 of
   the review of #246). Both hold for the type parameters that a field of
   an anonymous structure declares, as in `{function pick<T>(item: T): T;}`
   (M3 of the cross-model review of #246). Type parameters that only a
   typed body declares, such as those of a local function, are not in a
   fingerprint; item 6 covers them. The final member list (`ModuleFingerprint.members`)
   holds the same text for a member that the walk adds late: the metadata
   of the declaration and of its constructors, and of the anonymous
   structures in its types and constraints (L6). A member in the
   generator's list leaves that text out, because its fingerprint holds it.
6. Body metadata (genes-f8vc.9.27, S3 of the review of #246). The macro
   API of the running Haxe has exactly four kinds of metadata holder
   (`ClassField`, `EnumField`, `BaseType`, `TVar`) and one more writer
   after typing (`BaseType.exclude()`); each has a check (see "Body
   metadata" in `docs/INCREMENTAL_AFTER_TYPING.md`), and a Haxe version
   with another one fails here. No Genes source reads `TVar.extra` (the
   type parameters of a local function) except
   `SignatureCache.localTypeParameters`, which records their metadata for
   the replay. The readers of a local variable's own metadata, which the
   replay cannot ask again, are the listed ones; a new reader fails the
   probe. `ModuleFingerprint.holdsStructure` finds a structure in
   `Null<{...}>` and in a function result, and none in `Array<Int>`. A
   module that recorded an answer that no later request can ask again
   (`GenerationCache.UNKNOWN_ANSWER`) is dirty (rule 11), and the request
   still applies the rules to every other module. Only this probe case
   covers rule 11; no gate row reaches it end to end. Its only known
   trigger was a local generic function in a class initializer, and
   keeping the holders of class initializers (review of genes-ts #258)
   removed it.

Two inputs of a module's output are not visible in Haxe's typing, and the
gate covers both. The request embeds one resource (`-resource`), and the
module `haxe.Resource` prints its bytes: after the resource edit the session
key must differ, so the result is `full`, not `incremental` with stale
bytes. The module `inc.Legacy` holds one `__js__` call, and Genes reports
"__js__ is deprecated" when it prints the call: every request, cold and
warm, must report the same warnings, also when `inc.Legacy` is replayed
(the replay reports its stored warnings), and the shadow report must count
them (`printWarnings`).

The generator and the passes after typing (previous section) use one request
owner. `IncrementalRequest` decides the mode, and `GenerationChangeSet` adds
the stamps, records the same-object proofs and builds the session key once
after typing; the shadow only reads them. A descriptor without `generation`
runs no shadow and writes no shadow report. `"generation": "measure"`
applies the clean rules, stores the files and reports the clean share
without comparing or replaying.

Stage 3, slice S2 (stored edges). A request with a usable cache does not
build the dependency plan of a clean module during the reachability walk.
Each live visit of a module records its steps, keyed by the module's member
list when the visit starts; a clean module takes the steps recorded for its
member list now, and answers import-cycle questions from its stored runtime
requests. The walk with stored edges leaves the recorded path when the record
has no visit with that member list, when a stored step adds a declaration
whose stamp changed, when the declaration of a stored step has other
target facts than the recording request saw (`checkStoredTarget`), or when
a check before emission fails. The live walk reads a target only through
`WalkTarget.inputsOf`, and the step records the text of its result
(`WalkTarget.inputsText`): the kind, the extern flag, the module and the
name, which the walk reads before it takes a step, and the metadata, which
the plan reads. A fact that the walk starts to read is a field of that
result, so the record holds it too. An after-typing macro can change two of
these facts without a new stamp: the metadata (it can add `@:ts.type`) and
the extern flag (it can call `exclude()`, and the walk takes no step to an
extern declaration). Then the request
runs again from the inventory with live edges and no clean module, before any
`api.addFeature`. The report's `walk` object says what happened (`verdict`:
`none`, `on-path`, `left` or `drift`; `drift` always fails the gate).
`--modes=measure` walks live only and reports how often the stored walk would
leave the recorded path (the go/no-go line `walk with stored edges: X of Y`);
in compare, the stored walk and the live walk run in one request and any
difference of their results is a mismatch. The edits whose ids start with
`S2` cover the order-sensitive cases:

- a type-only use (through a typedef field: a local variable type makes
  dead-code elimination keep the class) of a class that dead-code
  elimination removed (`inc.Den.DenNote`), in a module that stays clean,
  first and last; with no edit between them `inc.Den` has two recorded
  member lists, and only the visit with `DenNote` creates `inc.DenDeep`, its
  superclass;
- two sources (`inc.PairWayA`, `inc.PairWayB`) that add late members to one
  clean module (`inc.Pair`), with their visit order flipped and back;
- a typedef (`inc.Tinted.TintAlias`) whose class `inc.Tint` becomes concrete
  and stops being concrete (since genes-ts #249, the request where it
  becomes concrete generates in full, because `inc.Tint` moves from the
  unlisted part of its fingerprint to the listed part);
- the import cycle through a third module (`inc.CyHub` rows) with no edit,
  so that clean modules answer the cycle question from stored requests;
- a module that only the walk creates (`inc.Ghost`), made by a stored step
  of the clean typedef module `inc.GhostHint`;
- an import alias on every request (genes-44h0): `inc.AliasModel` imports
  `inc.AliasShape as AliasedShape`, and `inc.AliasUser` reads a field of
  that type, so its walk takes a step to the alias. Haxe 4.3.7 makes the
  alias a private typedef of `inc.AliasModel` that is in no declaration
  list, so the inventory did not know it: every request left the recorded
  path, and a session that names a type through an alias never replayed a
  module. `TypedModuleInventory.importAlias` finds it now, and its stamp is
  a digest of the epochs of `inc.AliasModel`; the `no edit` row fails
  without it. The `ALIAS` rows then edit the alias target while the
  importer stays untouched, point the alias at `inc.AliasShapeTwin` (same
  shape) and back, do the same for the alias that `inc/aliashx/import.hx`
  gives `inc.aliashx.AliasHxModel`, and make `inc.AliasUser` stop naming
  `AliasedShape` and name it again; after each change a request with no
  edit must replay and stay on the recorded path. The last rows show the
  known miss (genes-cil5): only the inline helper `inc.AliasInline.make`
  names its alias `InlinePt`, dead-code elimination removes `make` but keeps
  the class, and the inferred return type of `inc.AliasUser.made` still
  names `InlinePt`, so no surviving declaration of `inc.AliasInline` shows
  the alias. While that use stays, every request leaves the recorded path
  (`walk: left`, nothing replayed, the tree equal to cold);
- the rows of the review of slice S2 (ids start with `RV6`, modules
  `inc.Rv*`): one late member that two clean typedef modules name, two late
  members of one clean module whose order follows the visit order, a late
  member of a clean module that closes an import cycle through two clean
  modules, a generic instance named in a type position and then used at
  run time, and a late member that is renamed;
- after-typing metadata on a walk target with the same member list and
  stamps: `@:ts.type` on the late class `inc.LateEnum.LateBox` removes the
  edge from the clean module `inc.LateUser`; the stored step records the
  target's metadata, so the walk would leave the recorded path there, but
  since genes-ts #249 the metadata comparison before the passes after
  typing makes the request generate in full first; on the listed class
  `inc.ListedTs.ListedBox` the fingerprint of its module makes the request
  generate in full before any walk;
- the opposite case: an after-typing macro removes `@:ts.type` from the
  late class `inc.LateEnum.LateTyped`, which no stored step names, so the
  clean module `inc.LateUser` gains an edge that its stored steps lack. The
  metadata checks of genes-ts #249 (`GenerationChangeSet.compareMetadata`
  and `ModuleFingerprint.unlisted`) make the request generate in full;
- an after-typing macro calls `exclude()` on an enum of `inc.ExclOwner`
  (`inc.ExcludeMacro`), once before and once after the after-typing passes
  of Genes. The enum becomes extern with no new stamp and no metadata
  change, so the walk takes no step to it from the clean module
  `inc.ExclHintUser`, which names it only in a typedef field. The class
  comes first in `inc.ExclOwner`, and the walk visits `inc.ExclHintUser`
  first, so the member list of the visit of `inc.ExclOwner` still matches
  the record. Only the extern flag in the target facts that
  `checkStoredTarget` compares leaves the recorded path; without it,
  compare reported drift and reuse published a stale tree (must fix of the
  review of genes-ts #247);
- metadata that only a typed body holds (S3 of the review of #246;
  genes-f8vc.9.27): `inc.BodyMetaMacro` writes `@:ts.type("string")` on
  the field of the structure in the constraint of the type parameter of a
  local function of `inc.BodyMeta`, on the type parameter of another local
  function, on the field of the structure in the declared type of a local
  variable, and on the field of the structure in the type of an argument of
  a local function. Haxe does not type `inc.BodyMeta` again, and no
  fingerprint holds these holders. Each row was red on genes-ts eee0d60d in
  reuse (`inc/BodyMeta.tsx` differs from cold); now the recorded answer
  (`bodyParams` or `bodyType`) that `inc.BodyMeta` asked differs, and the
  request generates in full. The request after them replays every clean
  module. Two more rows do the same in class initializers (review of
  genes-ts #258): a structure in a local's type in the initializer of
  `inc.BodyInit`, which reuse replayed stale on genes-ts 56c55b16, and a
  structure in the constraint of a local generic function in the
  initializer of `inc.BodyInitGeneric`, whose missing holder made every
  request with a cache generate in full there;
- an HXX error in the only dirty module (`FB3`: an unknown attribute on an
  intrinsic element; `FB4`: an unknown prop of a component), so that the
  error comes inside a request whose walk takes stored edges: the shadow
  and plain warm requests must print exactly the errors of the cold build
  (`sameErrors`), and the repaired request stays on the recorded path;
- `-D genes.extern_init_warning` on, with an edit that leaves the recorded
  path: Genes warns about each extern class with `__init__` (Haxe's `Math`
  and `String`, and `inc.RvExtInit`) while it reads the type list, and the
  request that generates a second time must still report each warning once.
  Every request compares these generator warnings with the cold build.

The script prints, but does not judge, the clean share, projected generation
time, shadow overhead and cache size of each edit. Times are diagnostic
unless the 1-minute load stays at 2.0 or less.

### Rolling replay audit and cold build (genes-f8vc.9.23)

The clean rules are the first net under reuse, and reviews have found holes
in them more than once. Two runtime checks compare bytes, so they also see a
stale result that no rule reads.

The **rolling replay audit** runs in Genes. After a `"generation": "reuse"`
request has committed its tree, and before the request returns, Genes prints
`audit.modules` of the modules
that it replayed (descriptor field `audit`, default `{"modules": 2, "seed":
0}`) once more into a scratch transaction (`OutputTransaction.scratch`, memory
only) and compares files, maps, print warnings, added features and public
entries with the stored entry (`IncrementalShadow.auditModule`). The module
that waited longest since its last audit goes first; equal waits follow a
digest of the seed and the name (`ReplayAudit.choose`; `yarn test` runs
`tests.replayaudit.ReplayAuditProbe` on the order, the seed and the
descriptor field). A difference warns `[GENES-INCREMENTAL-AUDIT-001]`, is
listed in the `audit` part of the report (format 5), and drops the generation
cache: the stale entry is evicted, and the next request generates in full.
The audit ages stay when the cache is dropped, so the rotation goes on where
it was. Before this check, a replayed module kept its stored entry, so a
stale module stayed stale until Haxe typed it again.

What the audit cannot see: the new print uses the facts of the same request,
so a stale fact that the request itself took from the cache is in both
prints: a member list or module set of the walk with stored edges, a stored
runtime request list, a kept fact of the passes after typing, the Haxe cache.
With `checkStoredTarget` switched off, the row "after-typing macro makes an
enum extern after the Genes passes" publishes stale `inc/ExclHintUser.tsx`
and `inc/ExclOwner.tsx`, and `--audit=all` reports only `inc.ExclHintUser`
(review of genes-ts #259). Only the session's cold build sees that class.

The shadow gate runs the reuse pass with `--audit=all` by default: every
replayed module is printed again in every request, so the pass also proves
that the audit reports no difference on any edit of the list (no false
mismatch). `--audit=<n>` and `--audit=off` change the count (a partial run).
The rows whose ids start with `L3` reach limit L3 of the round-3 review of
genes-ts #244, metadata that only a typed body holds: `inc.ArgMetaMacro`
writes `@:ts.type("string")` on the local variable of the argument `count`
of `inc.ArgMeta.show` from an after-typing callback, and later removes it.
Haxe does not type `inc.ArgMeta` again and no clean rule reads that metadata.
Compare must report `inc.ArgMeta` (the hole is real); in reuse the tree may
differ from cold only in `inc/ArgMeta.tsx` and its map, the audit must report
the module, drop the cache and warn, and the next request must generate in
full and equal the cold tree.

Red, then green (`--modes=reuse --only=L3 --skip-plain --skip-probe`): with
`--audit=off` the gate fails at "L3 no edit after the audit dropped the
cache": that request publishes `inc/ArgMeta.tsx` and its map, which differ
from cold, because the stale entry stayed in the cache. With the audit on,
the same rows pass.

The **cold build** runs in the development session
(`GenerationReuseOptions.coldCheckEvery` in `tooling/README.md`): after every
Nth accepted warm generation, while no edit waits, the session builds the
accepted revision in a new Haxe process without the incremental define and
compares that Genes tree with the published one. `tooling/src/session-test.ts`
checks with a fake compiler the schedule and idle delay, the cancel by an
edit, also by an edit that only a reconciliation finds, the repair after a
difference and its check, the repair stop after a second difference, a cold
failure, and a candidate with an audit difference that is never published; `tooling/src/session-warm-server-test.ts` runs a reuse
session with real Haxe on project A, where the audit prints every replayed
module and both cold builds must equal the published tree.

Cost (fixture, diagnostic: shared machine, 1-minute load 8 to 12). With the
default `audit.modules` 2, the audit took a median of 6.3 ms per request
(mean 15.1 ms, largest 101 ms) over 37 no-edit requests that each replayed 99
modules (`--modes=reuse "--only=no edit" --skip-plain --skip-probe
--audit=2`, the `audit.ms` of each report). Auditing all 98 replayed modules
took about 600 ms per request, about 6 ms per module. The audit runs after
Genes commits, but before the request returns; a development session
publishes after the request, so there the audit time is on the publication
path. Whole request times of runs with and without the audit differed by more than the
audit itself under this load, so they are not a measure of it.

## Module requests (G3)

`yarn test:compiler-server:module` uses the project `templates/module-request`
and one warm server. A full request (`--main mr.Main`) with
`"moduleRecords": true` stores the records of `genes.incremental.ModuleRequest`.
After each scripted edit, a module request names the edited module as the only
root (no `--main`) and writes into its own sibling folder. The gate requires:

- the expected result for each edit: `preview`, or a refusal code such as
  `uses-changed` (the only call of a private helper was removed: an edit
  beyond literal values changes the module's use skeleton) or
  `public-shape-changed` (an inline constant changed, so importing modules
  print another value);
- for a preview, only the module's files in the folder, each byte-identical to
  the same file of a cold build of the edited program; for a refusal, no
  module file in the folder (an earlier preview there is retired);
- after each module request, a full request whose tree equals the cold tree, so
  a module request leaves nothing behind in Haxe's cache.

After the base list, each review scenario of PR #250 runs as its own group
(its own server and copy, with extra source files): types and `Std.string`
that keep a declaration (s02, s03b, s08), edits outside the module's imports
(s05, s12, s14), a feature that only the edited module defined (s10), field
types that another module's use decides (s09), a request that fails after
Genes added its roots (s18), descriptors written for another request (S2,
s14), a stale preview folder (s19), a use that is alive only through the
edited module (r01), a field type that makes another module's class used
(r02), an `@:ifFeature` field (r03) and a deleted `.module-dep` file (r05).

The last groups run a macro (`mr.CopyMacro`) that reads a string literal of
`mr.Probe` and changes another module that Haxe does not type again:

- in an after-typing callback: `@:mrTag` of `mr.Leaf` (m249), `@:ts.type`
  of the class `mr.TsTyped` (f1), `exclude()` of the enum
  `mr.ExclOwner.ExclE` for the literal `ext` (f2), and `@:ts.type` of a
  typedef field of `mr.TsUser` (f3);
- in an after-save callback (`Context.onGenerate(..., false)`): the f1 and
  f2 changes again (a1, a2);
- in an after-typing callback, `Compiler.define('genes.disable_native_accessors',
  '1')` for the literal `ext`, so that cold prints `mr/Acc.ts` without its
  native getter (d1). d1-full runs the same edit with full requests only.

Each case runs twice: with the macro given after
`--macro genes.Generator.use()` and before it. Haxe runs after-typing
callbacks in reverse order of registration, so a macro given after
`Generator.use()` runs before the after-typing passes of Genes, and one given
before it runs after them. The expected refusals are:

- `session-changed`: the metadata comparison or the session key saw the
  change (m249, f1, f3 and d1 with the macro after `Generator.use()`);
- `target-facts-changed`: the declaration facts differ (m249, f1 and f3
  with the macro before `Generator.use()`, f2, a1 and a2 in both orders);
- `defines-changed`: the defines differ from those of the session key (d1
  with the macro before `Generator.use()`; also its second step, because the
  define stays set while the literal is `ext`).

Each group starts with a second full request, because the metadata
comparison compares with the earlier request, and then previews a literal
that the macro does not read.

After each accepted preview the gate also runs the tree check: cold must
differ from the last full tree only in the previewed module's files and
maps. A change of any other file means that a preview left the published
tree stale. The final line counts the previews that passed it.

The `stat-` groups check how Genes knows that the files of the stored
program still hold what Haxe typed (genes-f8vc.14.11). A full request reads
and hashes every file of the program and keeps, with each proven digest, the
file status: size, modification time, change time and inode. Genes reads the
status before and after the bytes and keeps it only when both reads are
equal, so a save during the read leaves no status. A module request does not
read a file again when its status equals the kept status and the kept
modification and change times were older than that read by more than the
grain (2 s). This is git's rule for its index. Every other file is read and
hashed. The report lists the files that were read (`hashedSources`) and
counts the trusted ones (`trustedSources`).

Why the rule holds: the system sets the change time to its clock at every
change of a file (bytes, times, name or rights), and no tool can set it. A
change after the read gives another change time. A change during the read
gives a change time within the grain of the read, and the rule never trusts
such a status. The rule trusts four things:

- the system clock is not set back;
- file times come from this machine's clock (a local file system, not a
  network share with another clock);
- the file system moves the change time at every change (FAT and exFAT may
  not);
- nobody restores a file below the file system.

On Windows the change time is the creation time, so Genes reads every file
there.

The groups (`stat-rule` sends no `server/invalidate`, so that Haxe's own
whole-second check misses its saves):

- `stat-rule`: after the files settle, a Button edit previews with every
  unchanged fixture file trusted. Then three saves of `mr/Theme.hx` that
  Haxe cannot see must be read and refused with `source-changed`: same size,
  modification time and inode (only the change time moves); another file
  (another inode) with the same size and time; and the same kind of save
  when the kept status was read inside the grain (a modification time in
  the future). A status read inside the grain is read even when nothing
  changed.
- `stat-save-and-revert`: `mr.Flip`, an init macro after
  `genes.Generator.use()`, saves `mr/Button.hx` after Genes read it and puts
  the old text back after typing. The digest is the same before and after
  typing, but Haxe typed the other text: the change time makes the file
  unknown (`stale-source`), and the next request previews. This works only
  where the change time is finer than a second (APFS, ext4); on HFS+ or
  ext3 a save and a revert in the same second keep the change time.
- `stat-first-seen`: a new module that the full request types for the first
  time stays unknown, even when it is older than the grain, because Haxe may
  have parsed it outside the reads of Genes (a failed request, or an init
  macro given before `genes.Generator.use()`). The next module request is
  refused once (`source-changed`), and after the next full request it
  previews.
- `stat-deleted-import-hx`: a module request sees a deleted `import.hx` by
  its missing status (`source-changed`), and the full request after the next
  one makes Haxe type nothing again.

The `early-init-` groups check init macros given before
`genes.Generator.use()` (genes-v54c). Haxe runs init macros in the order of
the arguments, so such a macro runs before Genes reads any file. When it
types a project module by name, Haxe types that module from its cached text,
and a save that Haxe's whole-second check missed reaches neither the request
nor Genes. No macro can see what an earlier macro typed, so Genes reads the
arguments: every init macro before `genes.Generator.use()` can type a module,
except calls of a few `haxe.macro.Compiler` functions that type nothing
(`nullSafety`, `addMetadata`, `addGlobalMetadata`, `define`, `keep`,
`addClassPath`, `allowPackage`, and `include` and
`server.setModuleCheckPolicy`, which defer their typing). Metadata that
these calls add, such as `@:build(...)` or `@:using(...)`, runs only when a
type is built, and Genes reads the files before anything is built, also
before it types its own helpers `genes.Register` and `js.Boot`. Macro text
with conditional compilation (`#`) counts as able to type. With such a
macro, a request after a change of a file (digest or file status) is
refused once:
a full request stops with `GENES-MODULE-REQUEST-003`, publishes nothing and
writes a records report with `stored: false`; a module request is refused
with `init-macro-before-genes`. Genes has made Haxe read the changed files
again, so the driver sends the same request again, once, as a client must,
and that request is checked as usual. A client reports a second refusal
instead of sending the request again: it means that a file changed again in
between, for example because an init macro or a tool writes a source file
at every request, which makes every request refuse. No shipping client asks
for module records yet. A step names the refusal that it expects
(`initRefusal`); any other one fails the gate. In the first groups,
`mr.Early` calls `Context.getType('mr.Fresh')` and no `server/invalidate` is
sent:

- `early-init-mtime-kept`: no edit refuses nothing; a save of `mr/Fresh.hx`
  that keeps the modification time refuses the full request once; a text
  edit of `mr/Button.hx` and a second such save of `mr/Fresh.hx` each refuse
  the module request once, and it previews when sent again;
- `early-init-same-second`: a save that moves the modification time inside
  the same whole second;
- `early-init-dependency-changed`: `mr.Fresh` reads `mr.Theme`, and a save
  of `mr/Theme.hx` that Haxe sees comes with the save of `mr/Fresh.hx`, so
  Haxe types `mr.Fresh` again in the init macro from its old text. The
  stamps of `GenerationChangeSet` cannot show this case, because the module
  was typed again;
- `early-init-not-typing`: the init macro before `genes.Generator.use()`
  is `define(...)`, so nothing is refused, and Genes makes Haxe read a save
  that keeps the modification time itself, as before.

The `early-init-global-` groups give only an allowed `addGlobalMetadata`
call before `genes.Generator.use()`, whose metadata loads `mr.Fresh` when a
type is built (review of genes-ts #254), with a save that keeps the
modification time:

- `early-init-global-build-register`: `@:build(mr.EarlyBuild.build())` on
  `genes.Register`, where the build macro calls `Context.getType('mr.Fresh')`.
  Genes reads the files before it types `genes.Register`, so nothing is
  refused and the full request equals cold. A later module request of
  `mr.Fresh` is refused with `other-modules-typed`, because
  `genes.Register` depends on `mr.Fresh`;
- `early-init-global-using`: `@:using(mr.Fresh)` on `genes.Register`;
  nothing is refused;
- `early-init-global-build-all`: the same build macro on every type. In
  the first request it also ran for standard types, so they depend on
  `mr.Fresh`. Haxe loads `StdTypes`, `String`, `Array` and `haxe.EnumTools`
  from its cache with every dependency before any init macro, so `mr.Fresh`
  arrives as the object of the first request, with its old stamp
  (`GenerationChangeSet.keptModules`). The full request stops once with
  `GENES-MODULE-REQUEST-003` before it publishes (`keptStaleModules`), and
  equals cold when sent again;
- `kept-stale-global-build-after-genes`: the same macro given after
  `genes.Generator.use()`, with a save that keeps the modification time and
  one in the same whole second: each full request is refused once the same
  way, because this path does not depend on init macro order.

On Genes before the fix, the full request after each of these saves
(except in `early-init-not-typing`) differs from cold in `mr/Fresh.ts` (run
with `GENES_TEST_SOURCE`). The
groups of `mr.CopyMacro` given before `genes.Generator.use()` are refused
once after each edit too, because Genes cannot prove that `mr.CopyMacro`
types nothing. When sent again, f3 is refused with `session-changed`
instead of `target-facts-changed`: the refused first request already ran
the macro, and its write of the typedef field's metadata stays on the
cached declaration, so the metadata comparison sees it first. Either code
refuses the preview; the other cases keep their code.

The `display-` groups check an editor request between two full requests
(genes-lnrv), with a save of `mr/Fresh.hx` that keeps the modification time
and no `server/invalidate`. The editor request types the whole program and
generates nothing. Without the descriptor define it has other defines, so
Haxe types the macro classes of Genes again for it, and their
`@:persistent` fields start again from their first values in the next full
request, while Haxe keeps the modules of the full requests. Genes therefore
stores what it knows about Haxe's cache beside the descriptor
(`<descriptor>.typed-sources.json`: the content that Haxe last typed for
each file, the files that a module request typed alone, and the modules
whose roots a failed request left) and reads it again in the first request
of a new macro state, if that request has the same defines and runs in the
same Haxe process. The process is named by a token in the process
environment (`GENES_TYPED_SOURCES_<defines key>`), which Haxe does not
reset; a new process starts without it and holds no module, so its first
request knows no file, which is exact. A new macro state that finds no facts
of its own process makes Haxe parse every source file again once. Rule: one
Haxe process per descriptor path; a cold `haxe` run must not pass the
session's descriptor define. The file is written as a temporary file and
renamed.

- `display-cold-run`: a save that keeps the modification time, then a cold
  `haxe` run with the session's descriptor define, which writes the facts
  with its own token, then an editor request. The full request makes Haxe
  parse every file again and is refused once with
  `GENES-MODULE-REQUEST-003` (the standard types that Haxe loaded before
  Genes ran), then equals cold; the next request types no module again. On
  f8627591 (the first version of this fix) every full request published the
  old `mr/Fresh.ts`;
- `display-new-server`: the server is restarted and `mr/Fresh.hx` saved
  while it is down, with an init macro before Genes that types `mr.Fresh`.
  The first request of the new process is not refused and equals cold. On
  f8627591 it read the facts of the old process and was refused by the init
  macro rule;

- `display-cli`: `--display Main.hx@0@diagnostics` before a save, after a
  second save, and once without an edit. Each full request equals cold at
  once, nothing is refused, and Haxe types no module again after the
  request without an edit (`fullTypedAgainModules`), nor in the next one
  (`fullTypedAgain`);
- `display-json`: the JSON-RPC method `display/diagnostics`, before and
  after a save;
- `display-json-session`: `display/diagnostics` with the descriptor define,
  so Genes runs in it and Haxe keeps its typing in the cache of the full
  requests; with saves and saves back. It passed before the fix too; it
  guards that such a request does not count as a published one;
- `display-dependency-changed`: a save of `mr/Theme.hx` that Haxe sees
  makes Haxe type `mr.Fresh` again from the text that it parsed before; no
  stamp can show this case;
- `display-none-no-edit`: five full requests without an edit or an editor
  request. Haxe types no module again; the rows give the time of such a
  request;
- `display-global-build-all`: the global build macro of
  `early-init-global-build-all`, so Haxe loads `mr.Fresh` with the standard
  types before Genes runs. The full request is refused once with
  `GENES-MODULE-REQUEST-003` (`keptStaleModules`), as without the editor
  request, and equals cold when sent again.

On Genes before the fix, the full request after the editor request in each
group except `display-json-session` and `display-none-no-edit` differed
from cold in `mr/Fresh.ts`, and the request after it was right.

The `failed-` groups check a request that fails with a type error
(genes-u8fq). `mr/Fresh.hx` gets a type error, and a request fails. Then
the file is saved back to the text of the last successful request, with the
modification time of the failed save kept, and no `server/invalidate` is
sent. Haxe keeps the parse of a file also when the request fails, and its
whole-second check cannot see the second save. The digest of the file now
equals the one that Genes last proved. So Genes now notes each file that it
makes Haxe parse again as unknown before typing (`unproveParsed`), and only
a request that types the program proves it again. A step with `typeError`
expects the cold build, its module request and its full request to fail;
the warm full request must report each error line of the cold build and
publish nothing.

- `failed-revert-full`: a full request fails; the next full request equals
  cold at once; a request without an edit types no module again; then a
  text edit of `mr.Fresh` previews as usual;
- `failed-revert-module`: the module request and the full request of the
  failed text fail; the next module request previews, and so does one
  without an edit;
- `failed-then-other-edit`: an edit of `mr/Button.hx` while `mr/Fresh.hx`
  still has the error fails again, as cold does; the save back then equals
  cold;
- `failed-display-session`: `display/diagnostics` with the session's
  defines after the failed save and after the save back. It passed before
  the fix too; it guards that the editor request does not hide the old
  parse;
- `failed-display-cli`: `--display ...@diagnostics` without the descriptor
  define after the save back, so the next full request starts Genes with
  new macro state and reads the unknown mark from the stored cache facts.

On Genes before the fix (f3a1a8ed), every group except
`failed-display-session` failed at the step after the save back: the
request failed again with the old error `Float should be String`.

Limits, not covered: a module that Haxe typed in a request whose cache facts
Genes did not keep (a full request without module records in the same
process before the first one with them); a file that Genes does not know
yet (a new module) and that Haxe first parsed in a request that failed,
then saved again in the same whole second without `server/invalidate`; a
request that fails right after Genes lost its cache facts
(`GENES-MODULE-REQUEST-004`), when a file is then saved back the same way; and a process that a macro of the
server starts, which inherits the process token. A program with an `@:rtti` class
adds no stamps and leaves the incremental path, so a module that Haxe keeps
from its cache there is not checked. On APFS a replaced file also gets a new change
time, so the inode check is a second guard there, not the only one. No group
can force a save between the bytes and the status of one read; the two
status reads are checked by review only.

The last lines of the gate give the median `digestMs` of the module
requests and the median load per CPU; they are diagnostic only.

`--only=<text>` runs the groups whose name contains the text;
`GENES_TEST_SOURCE=<folder>` runs them against another Genes source folder
(for example an older commit, where they fail).

How a module request relates to the full incremental path:

- It shares the metadata comparison of `GenerationChangeSet` (a changed
  metadata epoch changes the session key: `session-changed`), the define
  check `GenerationChangeSet.definesChangedAfterTyping` (the full path then
  turns its generation shadow off; a module request is refused with
  `defines-changed`), and the step decision of `genes.WalkTarget`.
- The declaration-facts check is its own. It reuses two texts of other
  owners (`WalkTarget.inputsText` and the metadata text of
  `ModuleFingerprint.addDeclaration`) and reads them in `afterSave`, after
  every after-save callback that was registered before the save phase and
  before dead-code elimination (`target-facts-changed`).
- It never takes stored walk steps (Stage 3, slice S2) and writes nothing
  into the generation cache, so the full request after each step still
  checks the stored walk against a live one.

Not covered (the same list as `ModuleRequest` and docs/ARCHITECTURE.md):
metadata that only a typed body holds; a module that Haxe keeps from its
cache in a program with an `@:rtti` class; a module that Haxe typed in a
request whose cache facts Genes did not keep (see above); a change that a
macro makes by name
to a module outside the request's program; an after-save callback that
another after-save callback registers while the save phase runs, when it is
registered after the callback of Genes; and a file that a macro reads in a
module outside the request, other than `import.hx` and resources. No group
covers a redefined extern module (a `genes.ts.imports` holder); the shadow
gate covers its fingerprint for full requests.

`--keep-control` also roots one module request with `--macro keep(<module>)`
instead and prints whether the next full request differs from cold (it does:
the kept class keeps a field that a cold build drops). That line is an
observation, not a pass condition.

