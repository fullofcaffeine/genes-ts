# The passes after typing on a warm compiler server (design and proof)

Status: design note and proof for step 3 of task `genes-d5uv`. An
independent design review accepted the direction with changes. Section 10
says what is implemented: the keep rule and the plain record of the React
audit, off by default. Nothing in `src/genes` keeps a typed value between
requests.

## 1. Practical result

Three Genes passes run after Haxe typed the program and before generation:
`genes.ts.SignatureCache`, `genes.PublicSurface` and the React audit
(`genes.react.ReactDiagnosticsMacro`). On a warm Haxe compilation server each
of them reads every declaration again on every request, also the declarations
that Haxe did not type again. One real application with 1,100 modules spent 7
to 8 s there on each request (task `genes-d5uv`, diagnostic numbers).

The plan is to do that work only for the modules that Haxe typed again, and to
keep the results of the other modules from the request that made them. Two of
the passes then keep compiler-owned values (`Type`, typed field bodies, local
variable ids) across requests. Today the architecture forbids that
(`docs/ARCHITECTURE.md`, state-owner ledger: both owners are replaced on each
request).

This note answers the question that must be settled first:

> **H2.** A value that a macro read from a declaration stays correct in later
> requests while Haxe does not type that declaration again.

Result on Haxe 4.3.7: **H2 holds** in every case of the probe, in the pipeline
of Haxe alone and with the Genes TypeScript generator. The probe also shows
when the values must be dropped, and that one simple test decides it. The
recommendation is **go**, under the rules of section 4.

## 2. Terms

- **Request**: one compilation that a client sends to a running Haxe server.
- **Declaration**: one class, interface, enum, typedef or abstract.
- **Typed again**: Haxe built a new typed declaration in this request. Haxe
  does that for an edited module and for each module that depends on it. All
  other declarations are the same compiler objects as in the earlier request.
- **Stamp**: one private metadata entry on a declaration. It names the macro
  interpreter and the request that first saw this declaration object. A
  declaration that Haxe typed again arrives without a stamp. The owner is
  `genes.incremental.GenerationChangeSet` (`@:genes.typedEpoch`, section 10).
  The probe uses its own entry.
- **Bucket**: what one pass keeps for one declaration, with the stamp that
  the declaration had when the pass made the bucket.
- **Kept**: a bucket whose stamp equals the stamp on the declaration now.
- **Session key**: the digest of the inputs that change what a pass computes
  but not always what Haxe types, such as `-D` values and `--macro`
  arguments. The incremental-generation
  design defines it (`docs/INCREMENTAL_GENERATION_DESIGN.md` section 10,
  branch `loop/stage3-design`).
- **H1**: when the result for module `A` reads a typed fact of module `B`,
  Haxe types `A` again whenever it types `B` again. H1 is an assumption of the
  incremental-generation design. The passes here need it too.

## 3. What the probe proved

Run it with `yarn test:compiler-server:kept-types`. The owner is
`scripts/test-compiler-server-kept-types.ts`; the macro is
`tests/compiler-server/probes/KeptTypeValuesProbe.hx`; the project is
`tests/compiler-server/templates/kept-types`.

The probe keeps one bucket for each declaration of the program, including the
standard library (119 declarations with Haxe alone, 126 with Genes). A bucket
holds the kinds of values that the two passes hold: the type of each field,
constructor, parameter, typedef body and enum constructor (1,364 and 1,432
types), each typed field body, and the id and type of each local variable (647
and 677 ids). It sends 36 requests for each lane through one server. In three
stages of each request (after typing; in `onGenerate`; after generation, which
is after dead-code elimination) it checks each kept bucket:

1. **Same object.** It writes one metadata entry through the kept declaration
   value and reads it through the declaration that Haxe gives now.
2. **Same text.** Each kept type and body prints the same text as in the same
   stage of the request that made the bucket. A type is printed through the
   macro values, through Haxe's own printer and after `Context.follow`, and
   the declaration that it names is read one level deep.
3. **Same as a new read.** Each kept type prints the same text as the type
   that a new read of the same place gives in this request.
4. **Same local ids.** A new read of each body gives the local ids of the
   request that made the bucket, and no id belongs to two declarations.

`RetypedModulesProbe` runs beside it. In every successful request the modules
without a stamp are exactly the modules that it reports.

| Case | Kept values | Evidence |
| --- | --- | --- |
| No edit | hold | All declarations kept. 365 (397 with Genes) kept types equal a new read after generation. 557 of 647 (587 of 677) kept local ids are in the bodies that generation reads, the same ids as in the first request. |
| Edit of another module | hold | All other declarations kept, same objects. Only the edited module is typed again. |
| The edited module | do not hold | The old bucket holds another object. None of its local ids is used again. New ids are above every earlier id. |
| A dependency edited | do not hold | Haxe types the reader again. The kept type of `Dependent.value` says `Int`; the current type is `String`. |
| Typed again because of a macro: the build macro reads a file, or looks a class up by name | do not hold | The source file is not edited. Haxe types the module again. The kept type of the generated field is wrong. |
| A module leaves the program and returns | hold | The buckets from before the absence hold the same objects. |
| Another `-D` value | do not hold | Every declaration is a new object. The `@:persistent` macro state also starts again, so no bucket exists. |
| The first `-D` values again | do not hold | Haxe types nothing again and every declaration has its old mark, but the macro state started again. Every declaration gets a new bucket. |
| A define that an init macro sets | do not hold for 19 declarations | The macro state continues. Haxe reads those modules from another cache. Their old buckets hold other objects. The other 100 (107) buckets hold the same objects, in a request with other defines. |
| That define removed | do not hold for the same 19 | `RetypedModulesProbe` reports nothing: every mark is present. The stamp comparison rejects the 19 buckets; each holds an object of the other cache. |
| A request that fails in typing | hold for other modules | The after-typing callbacks run in the failed request. The module with the error is typed again there and in the repaired request. |
| A request that fails after typing, in `onGenerate`, or after generation | do not hold for the modules that it typed | Haxe keeps no module of a failed request. The next request has no edit, but the module is typed again, and the bucket made in the failed request holds another object. Buckets of other modules hold. |
| A class first typed by a request that added no stamp | hold, but not seen | Haxe restores the saved metadata of a kept class in each request, so a later stamp is lost. The class counts as typed again on every request until its module is edited. Safe, not fast. |

Mutation check, run once by hand: with "a mark is enough" in place of the
stamp comparison, the run fails at "that define removed", because buckets of
the other cache count as kept and hold other objects.

Three findings are allowed, because the kept values are correct in them:

- **A new read after typing differs between requests.** Haxe changes each
  body after the after-typing callbacks (it lowers loops, renames locals,
  removes inlined objects) and saves the changed state. A kept declaration
  comes back in that saved state (`filters.ml:833-893` at tag 4.3.7). So a new
  read after typing in a later request gives other text and other local ids
  than the first read did. The kept bucket still holds the first read, which
  is what a cold build reads. In `onGenerate` and after generation, new reads
  are equal in all requests.
- **A kept body prints new local names.** A kept typed body addresses the live
  variable objects, so it prints the names that Haxe gave them later. Its
  structure does not change.
- **Open monomorphs.** An open monomorph is a type that Haxe has not decided
  yet. 5 (12) kept types held one when the bucket was made. Haxe decides them
  later in the same request, some of them after `onGenerate`. A kept value
  reads the decided type from then on, as a new read does. After generation,
  where Genes reads the values, no kept value differs in any request. No type
  held a lazy type when the first buckets were made.

The probe can fail. On the Python target (run once by hand, not part of the
test) Haxe's generator renames locals after Haxe saved the class state, and
the probe reported 10 changed kept bodies in `onGenerate` of the next request.
Haxe's JavaScript generator and the Genes generator change nothing there.

Facts of Haxe 4.3.7 that explain the results (read in the source at tag
`4.3.7`; the probe is the evidence, the source is the explanation):

- A local variable id comes from one counter of the process that is never set
  back (`tFunctions.ml:61-69`).
- Haxe keeps a typed module only when the request had no error
  (`server.ml:813-815`).
- A kept class returns to its saved fields, bodies and metadata in each
  request. An enum, typedef or abstract keeps metadata that a macro added
  later (`filters.ml:880-918`, `server.ml:744-764`).
- A `ClassType` or `ClassField` macro value is a copy. Its `meta` is a copy
  of the metadata list at that moment; a write through it replaces the live
  list with that copy plus the change (`macroApi.ml:981-993`).
- A `@:generic` instance copies only a fixed list of metadata from its base
  class, so it does not copy a stamp (`generic.ml:248-263`).

## 4. Rules for every pass

1. **One owner decides.** The change set stamps each unstamped declaration in
   the first after-typing callback and gives each pass the stamp of each
   declaration. It must run before the passes (an earlier draft filled it in
   the callback of `TypedModuleInventory`, which Haxe runs after them).
2. **A pass keeps a bucket only when the stamps are equal.** The bucket's
   stamp must equal the stamp on the declaration now, and the pass itself must
   have made the bucket. "The mark is present" and "the module is not in the
   typed-again list" are not sufficient (table: a define that an init macro
   sets). A stamp of an earlier macro interpreter stays valid as a name of
   that object; do not replace it.
3. **One session key for the whole store.** When the key differs, drop every
   bucket. A stamp says that the object is the same. It does not say that the
   defines are the same (table: 100 kept buckets in a request with other
   defines), and the passes read defines, for example
   `genes.ts.no_null_union`.
4. **Drop the bucket of a declaration that is not in this request.** This is
   needed for correctness, not only for memory: some entries are found by
   source position or by local id, and a stale entry could answer for a new
   declaration at the same position.
5. **No commit step.** A pass may replace a bucket in a request that fails
   later. Rule 2 rejects that bucket in the next request (table: failed
   requests).
6. **Kept values are read-only.** Never write metadata through a kept value;
   read a new copy of the declaration first. A read through a kept `meta`
   gives the metadata of the request that made the bucket.
7. **Effects stay in each request.** `PublicSurface` adds `@:keep` for
   interface contracts and `LibraryProfile.retain` adds `@:keep` for library
   roots. Haxe drops metadata that was added to a kept class, so these loops
   must run for every declaration on every request, as today. They may read
   kept buckets.
8. **One key, one bucket.** When two buckets write the same key of a shared
   map (possible for source-position keys of macro-made declarations), the
   pass does a full capture in that request and reports it. The last writer
   in a cold build is the last declaration in Haxe's order, not the last
   bucket that was made.
9. **A capture after dead-code elimination is never kept.**
   `PublicSurface.forClass` makes such a fallback for a class without a
   bucket. It belongs to that request only.
10. **Off by default**, behind the define of the incremental path, with its
    limits: TypeScript and TSX profile first, no `@:rtti` class, the default
    module check policy, a private server for one session.

## 5. What each pass keeps

| Pass | Kept between requests | Key | Dropped when | Probe coverage |
| --- | --- | --- | --- | --- |
| React audit | One plain record for each class: "audited with stamp S, no error". No typed value. | Class owner key. | Rules 2 to 4. | Needs no H2. Failed-request rows: a class with an error is never kept, because Haxe keeps no module of a failed request. Dependency rows: H1. |
| `SignatureCache`, text and flags | Literal-union text (`fieldTsTypes`, `anonFieldTsTypes`, `enumAbstractTsTypes`, `tsType` and `retTsType` of a signature) and the three flags of each argument (`opt`, `allowsNull`, `preservesUndefined`). | Owner key and field; source position; abstract key. | Rules 2 to 4. | Dependency and macro rows: the kept text of a reader is wrong after an edit, and the stamp test drops it. |
| `SignatureCache`, typed values | `sourceType` of each argument and return, `fieldSourceTypes`, `anonFieldSourceTypes`, `typedefSourceTypes`, `enumConstructorSourceTypes`, `localSourceTypes`, `directEnumLocalSourceTypes`. | Owner key and field; source position; typedef key; enum constructor key; `TVar.id`. | Rules 2 to 4. | Checks 1 to 3 for field, argument, typedef and enum-constructor types. Check 4 for local ids. |
| `PublicSurface` | One record for each class, interface and typedef: for each public member its type, kind, parameters, overloads, typed body, a copy of its metadata, position and documentation; the superclass and interface uses; the alias type. | Declaration owner key. | Rules 2 to 4; rule 9. | Checks 1 to 3 for member types, parameters, superclass, interfaces and typedef bodies; check 2 for typed bodies. |

`SignatureCache.declarationAnswers` stays request-local. It holds answers for
declarations of any module, and it is cheap to fill for the modules that are
captured.

The shared maps can stay flat, as today. Each bucket lists the keys that it
wrote, so that dropping a bucket removes exactly its entries.

`localSourceTypes` can keep `TVar.id` as its key. The probe shows the three
facts that it needs: the ids of a kept declaration are the same in every
request at the stages where generation reads them; a new id is above every
earlier id; and no id belongs to two declarations, also after an inline call
copies a body into another class.

What changes in the result: for a kept declaration the passes now hold the
capture of the request that typed it. That is the body before Haxe changed
it, the same view as in a cold build. Today a warm request captures the
changed body. The row "the first `-D` values again" shows the size of that
difference in the fixture: a capture of the kept declarations reads 585 local
variables, where the first capture read 647 (615 and 677 with Genes). So the
reuse can move warm output toward cold output; it cannot be checked against
today's warm output byte for byte.

Order of work: the React audit first, because it keeps no typed value; then
`SignatureCache`; then `PublicSurface`.

## 6. Fallback: keep only text

If the review does not accept kept typed values, keep only the two rows above
that hold no compiler object: the React audit record and the `SignatureCache`
text and flags. Every typed value is captured again on each request.

- It needs rules 1 to 5 and H1, but not H2 and not rule 6.
- It saves less. The walk of every class, the copies of the field lists and
  bodies, the enum-abstract walk of each type and all of `PublicSurface`
  stay. After step 1 of `genes-d5uv` the literal-union text is already asked
  only where an enum abstract was found, so the remaining gain is small. This
  note did not measure it.

## 7. Proof plan for the implementation

1. `yarn test:compiler-server:kept-types` stays green. It is the proof of H2
   and of rule 2 on each supported Haxe version.
2. A compare mode before any skip: with the define on, each pass still
   captures every declaration, and compares each kept bucket with the new
   capture after generation. It reports differences and skips nothing. This
   is check 3 of the probe inside Genes, on real applications.
3. `yarn test:compiler-server` with the reuse on: warm output stays equal to
   cold output byte for byte, including the edit, delete and restore, profile
   and failure cases.
4. The warm no-edit cost of the three passes, before and after, on the scale
   fixture and on one real application (acceptance criterion 3 of the task).
5. The same change updates the state-owner ledger of `docs/ARCHITECTURE.md`
   and the rule of `src/genes/AGENTS.md` that typed compiler objects are not
   kept between requests. Both must name the stamp rule as the explicit
   rebuild rule.

## 8. Limits and open questions

- The probe is evidence for one fixture on Haxe 4.3.7. It was not run on the
  Haxe 5 preview lane. Haxe 5 stores cached modules in another form; H2 must
  be proved again there before the reuse is on for it.
- The probe does not run inside the full `yarn test:compiler-server` matrix
  and has no CI job or routing-manifest entry yet.
- Not in the fixture: a type that a macro defines (`Context.defineType`), a
  `@:genericBuild` type, an edit of a macro source file during the session,
  and a module that Haxe first types during generation. Rule 2 decides for
  each declaration object, so no case-specific rule is expected, but none of
  these was run.
- A request of another client on the same server (an editor's display
  request, a build without Genes) can type a class without a stamp. That
  class then counts as typed again on every request (table, last row). The
  design assumes a private server for one session.
- H1 is assumed, not proved here. The dependency and macro rows are examples
  of it. The incremental-generation proof owns the full edit list.
- A non-default module check policy is not covered. With `Retype`, Haxe types
  a module again in place and restores its saved metadata, so the stamp
  stays.
- The memo `declarationAnswers` is filled in another order when only some
  modules are captured. Its answers are exact except at the depth limit of 64
  levels (`SignatureCache.hx`, the comment of `declarationAnswers`). The
  implementation needs the test of that limit in both orders.
- Not verified here: `@:keep` that a pass adds in the request that types a
  class is saved with the class. If the reason for it disappears later
  without a new typing of that class, a warm build keeps a field that a cold
  build removes. That would be a difference of today's code, not of the
  reuse.
- Open question for the compiler-server fixture: its README says that two
  projects with different private `-D` values share the `@:persistent` macro
  state. The probe saw that state start again on each change of a `-D` value
  (request counter back to 1), in both directions. The cause was not
  examined. If it is general, the two-project case does not test what the
  README says.
- Open question: the session key of the incremental-generation design must
  cover defines that an init macro sets. The probe's `definesDigest` reads
  `Context.getDefines()` in the after-typing callback and saw the change.

## 9. Recommendation

**Go**: keep typed values, under the rules of section 4 and the proof plan of
section 7, starting with the React audit. Keep the text-only variant of
section 6 as the fallback if the review rejects kept typed values or if the
compare mode finds a difference on a real application.

## 10. Slice 1: what is implemented

The design review of this note required a stricter keep rule than section 4,
rule 2. Slice 1 implements that rule and uses it for the pass that keeps no
typed value, the React audit. Everything is off unless the request has
`-D genes.dev_incremental=<descriptor path>`.

Owners (all in `src/genes/incremental`, see their comments for the exact
contracts):

- `IncrementalRequest` reads the define and the descriptor and says whether
  the request is eligible: Haxe 4.3.7, no display request, the TypeScript or
  TSX profile, no `@:rtti` class.
- `GenerationChangeSet` stamps each declaration with
  `@:genes.typedEpoch(nonce, N, key)`, computes the session key once in the
  first after-typing callback, and owns the keep rule.
- `KeptRecords` holds the plain records of each pass: the stamp, the member
  list of a class, and the request that wrote the record.
- `AfterTypingPasses.run`, the callback of the three passes, calls the
  change set first, so every stamp exists before the first pass.
  `ModuleDirectivePlan` and `TypedModuleInventory` keep callbacks of their
  own, as before. Haxe ends a callback at its first `Context.error` and
  still runs the next one, so one shared callback would hide an error of the
  module-directive capture behind an error of a pass.

The keep rule has six conditions. This slice enforces five from plain text:

| Condition | Where | Rejects |
| --- | --- | --- |
| 1. The request is eligible. | `IncrementalRequest` | Other Haxe versions, display requests, `@:rtti` programs. No stamp is added and no record is read or written. |
| 2. The session key is the same. | `GenerationChangeSet` | Other defines (also one that an init macro sets), another program digest from the session, other class paths, an edited Genes source file. Every record is dropped. |
| 3. The stamp names this declaration. | `GenerationChangeSet` | A type that a macro defined with the metadata of another class (probe row E2). |
| 4. The stamp equals the stamp of the record, and the same pass wrote the record. | `GenerationChangeSet.keep`, `KeptRecords` | A declaration that Haxe typed again; a declaration of another Haxe cache. |
| 5. The record's typed values address the same declaration object. | Not in `src/genes`. | See below. |
| 6. For a class, the member list is the same. | `GenerationChangeSet.keep` | The first use of a `@:generic` method from another module (probe row E1). |

Condition 5 needs a kept reference to the declaration: the test writes one
metadata entry through the old reference and reads it through the new one. A
record of this slice is plain text, so it has nothing to test and nothing
that can address a wrong object. The probe runs the test on its own kept
values in every request (125 tests took about 3.7 ms on a loaded host). A
pass that will keep typed values must hold such a reference and run the test
before it reads them. That is also the point where the rule "never persist
typed compiler objects" must change; this slice does not change it.

A case that five conditions cannot reject: a macro defines a type again with
the same key and with the stamp that its own earlier object carried, and the
member list is equal. The record of the earlier object would then be kept. A
macro can do this only when it stores the metadata of its typed result
between requests. The emitted files of each module would not differ, but
the build as a whole can: an audit diagnostic is fatal, so a cold build
refuses to publish the tree, and the warm build with the wrongly kept record
publishes it. Any wrongly kept record has that effect, whatever its cause:
a missed fatal diagnostic, and so a published tree that a cold build does
not publish. The `compare` mode exists to find such a record. The
same-object condition stays unenforced in this slice; whether a later slice
holds a declaration reference for it is an owner decision.

The React audit (`genes.react.ReactDiagnosticsMacro`) writes one record for a
class only after `auditMembers` returned `Clean` in this request. The
descriptor field `afterTyping` selects what a kept record does:

- `measure` (default): every class is audited; the decisions are counted.
- `reuse`: the audit of a class with a kept record is skipped.
- `compare`: every class is audited; when a class with a kept record fails,
  Genes reports `GENES-INCREMENTAL-AUDIT-001` before the audit diagnostic.

Each request writes `<descriptor>.after-typing.json`: the declarations, the
ones typed again, the records that passed the keep rule, the rejects by
reason, and the time of the stamps, the session key, the member lists and
the decisions. `passTimes` gives the time of each pass (`publicSurface`,
`signatureCache`, `reactAudit`), for its class function and its declaration
function.

Proof: `yarn test:compiler-server:after-typing` (see
`tests/compiler-server/README.md`), and rows E1 to E3 of
`yarn test:compiler-server:kept-types`. Conditions 3 and 4 reject the same
records in a real request sequence: every input that gives a kept
declaration another stamp than its record also changes the session key,
which drops the record first. `tests/compiler-server/probes/KeepRuleProbe.hx`
therefore proves each condition on its own, with made-up inputs.

The report is evidence, not output: when its file cannot be written, the
request gets the warning `GENES-INCREMENTAL-REPORT-001` and goes on.

Not supported, by contract: the `Retype` and `NoCheckDependencies` module
check policies, and a server that other clients share. With `Retype` Haxe
types a module again in place; probe row E3 asserts that no stamp shows it.

One owner with the generation shadow. The byte-stability shadow of
incremental generation (`IncrementalShadow`, `GenerationCache`; selected with
the descriptor field `"generation": "shadow"`) reads the same three things as
the passes and owns none of them: the request mode of `IncrementalRequest`,
and the stamps and the session key of `GenerationChangeSet`. The change set
also gives it the epoch list of each module (its sorted
`declaration key@stamp` entries) and the modules typed again. The session
key holds the output path too, because a source map names its sources
relative to the output folder, and the name and a digest of the content of
each embedded resource, because `haxe.Resource` prints them and a changed
resource file makes Haxe type no module again. `yarn test:compiler-server:shadow` is its
gate.

Not in this slice: `SignatureCache` and `PublicSurface` still read every
class on every request. A changed argument list drops the records but does
not ask for a compiler restart. Records of classes that left the program
have no age limit.
