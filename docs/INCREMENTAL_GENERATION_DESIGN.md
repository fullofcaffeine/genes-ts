# Incremental generation on a warm compiler server (design)

Status: **design proposal, not implemented.** It needs a design review and an
owner decision before any compiler change. Owning tasks: `genes-f8vc.9`
(per-edit generation cost) and its floor report `genes-f8vc.9.4`.

## 1. Practical result

A developer saves one Haxe file and waits for the browser. With a TypeScript
project and Vite, that wait is about 0.7 s. With Genes on a production-size
application (about 44,000 Haxe lines, 1,100 compiled modules, 457 generated
files), the same wait was 111 s in the last recorded sample, and 104 s of it
was one Genes request.

The cause is simple. Haxe's compilation server (`haxe --wait`) keeps typed
modules between requests, so Haxe itself does little after a small edit. Genes
keeps nothing. On each request it plans and writes each output file again.

This note proposes that Genes, **only when a development session asks for
it**, keeps the result of each module between requests and repeats its work
only for the modules that an edit can affect. A normal build, a test gate, and
each committed or pinned output keep today's full generation.

What the measurements in section 3 say about the result:

- For an edit to a **small file that no other module imports**, Haxe needs
  about 0.4 s. Estimate for the Genes request: **about 8 to 9 s** with the
  generation cache alone, and **1.1 to 1.7 s** only when two more changes
  also land: the defect of section 3.4 is removed, and the passes of section
  7.8 stop repeating their work. The second change rests on an assumption
  that is not proved yet (H2, section 8.2).
- For an edit to a **large component file**, Haxe needs about 3 s to type the
  file again. Estimate with all three changes: **7 to 10 s** today, about 5 s
  if the per-module cost is cut in half first.
- For an edit to a **file that many modules import**, Haxe types each
  importing module again: 68 to 174 modules and 12 to 15 s in the samples.
  This design cannot go below that. It is a limit of Haxe 4.3.7 and of the
  cost of typing HXX markup, not of Genes generation.

The numbers are diagnostic, because the machine was busy. Section 3 has the
conditions.

One more result was not expected. Four Genes passes that run after typing take
about 7 s on each warm request, also when nothing changed. They are outside
"generation", and they are the largest part of the wait after generation
itself. Section 7.8 covers them.

## 2. Terms

- **Request**: one compile sent to the warm Haxe server.
- **Module**: one Haxe module (usually one `.hx` file). Genes writes one
  output file, and usually one source map, for each module that it emits.
- **Typed again**: Haxe discarded its typed form of a module and built a new
  one. Haxe 4.3.7 does this for a file whose time changed and for each module
  that depends on it, directly or through other modules.
- **Clean module**: a module for which each check in section 8 passes. Genes
  may reuse its stored result.
- **Dirty module**: any other module. Genes plans and emits it as today.
- **Replay**: give the stored bytes of a clean module to the output
  transaction without planning or emitting the module.
- **Full generation**: today's behavior, where each module is dirty.
- **Fallback**: a request that started on the incremental path and switched
  to full generation before it published anything.
- **Cold**: a new compiler process. **Warm**: a server that already answered
  one request.
- **Member**: one declaration (class, enum or typedef) that Genes emits in a
  module's file.
- **Plan**: the data that Genes computes for one module before it prints it.
  The dependency plan is the list of the module's **edges**.
- **Edge**: one reference from a module to a declaration, with its kind
  (needed at run time, needed only for types, needed only for declaration
  files).
- **Walk**: the reachability step. It starts at the root modules, follows
  edges, and decides which modules are emitted.
- **Late addition**: a declaration that the walk adds to a module because
  another module refers to it. Haxe's dead-code elimination removed it from
  the list that the generator receives, but TypeScript types still name it.
- **Member state**: the ordered list of a module's members at one moment of
  the walk.
- **Root module**: the module named by the `-js` file. It holds `main` and
  the exports of the program.
- **Feature flag**: a name that Haxe's JavaScript back end sets when the
  program uses some runtime helper. Printed code can ask for a flag.
- **Classic profile**: Genes output as JavaScript. The other profile is
  TypeScript.
- **Epoch**: a mark that says when Genes first saw one typed declaration
  (section 7.1).

## 3. The measured floor

"The floor" is the time that Haxe needs when Genes does almost nothing. No
Genes design can be faster than the floor.

Method. `scripts/measure-warm-edit-floor.mjs` starts one private server for
each mode, sends one cold request, then changes one string in one file and
sends the request again, five times. The project was a source-only copy of
the application's web target at one commit. Genes was `main` at `a6f8a9d4`.
The compiler was the native Haxe 4.3.7 binary. The host was an Apple M2 Pro
with 12 cores. The server ran at `nice 10`.

**All numbers are diagnostic, not proof.** The 1-minute load was 8.6 to 27.9
during the runs, and the proof rule asks for 2.0 or less. Wall times are
therefore too high by an unknown amount. Server CPU time depends less on load
and is the better number to compare.

Modes:

- `typing`: `--no-output`. Haxe finds changed files, types, runs its filters
  and dead-code elimination. The generator is not called.
- `callback`: the Genes generator is called and returns immediately
  (`GenerationFloorProbe`, mode `callback-noop`).
- "passes off": the same, with the four Genes passes of section 7.8 switched
  off in a scratch copy of the Genes sources. The scratch copy is not in this
  branch. To repeat these rows, add an early return behind a private define
  to the four `onAfterTyping` callbacks named in section 3.2, and pass the
  copy as the Genes class path. It shows what Haxe costs alone. Its output
  would be wrong, so it is for `typing`, `callback` and `scan` modes only.

### 3.1 Haxe alone (passes off)

| Edit | Modules typed again (of 1,100) | Mode | Wall, median | Server CPU, median |
|---|---|---|---|---|
| None | 0 | `typing` | 0.41 to 0.53 s | 0.18 to 0.22 s |
| Small file, no importer (41 lines) | 1 | `typing` | 0.41 s | 0.16 s |
| Small file, no importer | 1 | `callback` | 0.42 s | 0.18 s |
| Large HXX component (2,258 lines) | 3 | `typing` | 3.32 s | 2.70 s |
| Shared UI primitive | 68 | `typing` | 11.84 s | 11.51 s |
| Shared domain module (66 importers) | 174 | `typing` | 14.99 s | 13.61 s |
| Shared domain module | 174 | `callback` | 12.74 s | 12.25 s |
| Cold request | 1,100 | `typing` | 15.7 to 19.5 s | 15.3 to 17.8 s |

Reading:

- The generator callback itself is free. `typing` and `callback` are equal
  within noise.
- An empty `haxe --connect` round trip costs about 0.07 s.
- The floor is not one number. It is the cost of typing each module that Haxe
  types again. For the shared domain module, Haxe's own timers split the
  request into 53% typing and 44% macro execution, and 39% of the request is
  the `genes.react.JSX` markup macro (893 calls). The timer shares are valid
  on this host. The timer seconds are not (`genes-f8vc.9`).

### 3.2 Genes work outside generation

| Request on unchanged Genes `main` | Wall | Server CPU |
|---|---|---|
| Warm `typing`, no edit | 9.2 s | 8.5 s |
| Warm `typing`, small-file edit, median of 5 | 8.66 s | 7.98 s |
| Warm `callback`, small-file edit, median of 5 | 8.19 s | 7.66 s |
| Cold `typing` | 25.6 s | 24.2 s |

The same warm request takes 0.41 s with the four passes off. So 7 to 8 s of
each warm request is Genes work that runs before generation. A first run with
three samples gave 7.75 s wall and 7.32 s CPU. One profiled
request, with a clock around each pass:

| Pass (`Context.onAfterTyping`) | Time on a warm request |
|---|---|
| `genes.ts.SignatureCache` (`SignatureCache.hx:453-502`) | 3.9 to 5.6 s |
| `genes.react.ReactDiagnosticsMacro.audit` (`ReactDiagnosticsMacro.hx:622-630`) | 1.8 to 2.5 s |
| `PublicSurface.captureTypes` (`PublicSurface.hx:395`, called at `:519`) | 1.0 to 1.2 s |
| `PublicSurface` retention loops (`PublicSurface.hx:520-528`) | 0.01 s |
| `ModuleDirectivePlan.capture` (`ModuleDirectivePlan.hx:80`) | not separated, small |

### 3.3 Fixed costs that the design adds

One probe read, for each of 2,082 class, enum and typedef declarations, the
name, kind and visibility of each field (10,844 fields), and compared the
result with the previous request. It took **0.06 to 0.09 s**. The probe ran in
`Context.onGenerate`, which is before dead-code elimination, and it read less
than the fingerprint of section 9 lists (no metadata names). The probe is not
in this branch. So this number shows the order of the cost of the "shallow
fingerprint". It is not a measurement of the final fingerprint.

One visit of each typed declaration and expression of the program
(`GenerationFloorProbe`, mode `structure-scan`, passes off) took 2.61 s wall
and 2.26 s CPU for a warm small-file edit, against 0.41 s and 0.16 s without
the visit. So one deep visit of the whole typed program costs about 2.1 s of
CPU. This is the upper limit for any check that must read expressions, such
as the "early cutoff" of section 7.7.

### 3.4 Full generation today, and one defect that it shows

Unchanged Genes `main`, ordinary generation, two runs. The load was 19.9 to
43.9, so these are the weakest numbers of this note.

| Request | Modules typed again | Wall | Server CPU |
|---|---|---|---|
| Cold | 1,100 | 107.7 s, 130.1 s | 99.9 s, 111.3 s |
| Warm, no edit | 0 | 104.9 s, 118.4 s | 91.5 s, 98.8 s |
| Warm, small-file edit (3 samples) | **566** | 113.9 s, 159.3 s, 160.0 s | 104.3 s, 125.4 s, 127.2 s |

Two readings:

- A warm request with no edit costs as much as a cold one. This repeats the
  earlier records.
- **After a full generation, the same small-file edit makes Haxe type 566
  modules again, not 1.** The 566 include 138 `js.html` modules and other
  modules that have no relation to the edited file. With generation off
  (`typing`, `callback` and `structure-scan` modes) the count is 1. So
  something that Genes does during planning or emission makes Haxe record
  module dependencies that the source does not have. Haxe then invalidates
  through them on the next edit.

The cause is **not proved**. The design reviewer read the Haxe 4.3.7 source
and gives this likely mechanism. Nobody ran it yet.

1. A lookup of a module or type by name from a macro
   (`Context.getModule`, `Context.getType`) makes Haxe record a dependency
   from its "current module" to the module that was looked up.
2. During generation, the "current module" is not a neutral value. Haxe's
   filter step sets it to the module of each class in turn and does not set
   it back. So it is the module of the last class that was filtered. Call it
   `L`.
3. Genes looks up nearly every emitted module by name during generation.
   `TypeUtil.baseTypeName` calls `Context.getModule(base.module)`
   (`TypeUtil.hx:680-681`), and it is reached from `Module.addTypes`
   (`Module.hx:483`) and from the member check of the walk
   (`Generator.hx:310-311`). Other lookups: `TypeUtil.hx:77,647`,
   `BindingIdentity.hx:165`, `Dependencies.hx:438`,
   `JsxTypeChecker.hx:603,999`, `ts/Imports.hx:457`,
   `dts/TypeEmitter.hx:184-187`.
4. So after one full generation, `L` depends on almost every emitted module.
   The dependency lives on Haxe's cached module and stays for later
   requests.
5. On the next edit of any emitted file, `L` is invalid, and so is each
   module that depends on `L`. If `L` is inside the `js.html` type graph,
   that explains the 138 `js.html` modules.

This fits each control: 0 with no edit, and 1 in the modes that make no
lookup by name. Step 0 must confirm it by experiment: look up one unrelated
module from the generator, edit that module, and count. A request with
Haxe's verbose server output also names the chain of invalid dependencies.
The likely fix is that generation makes no lookup by name. For example,
`baseTypeName` can read a map that is built once for each request from the
types that the generator receives.

This matters more than any other number here. While it exists, the Haxe
floor of section 3.1 does not apply to a session that generates: each edit
pays for the typing of about half of the program, and the passes of 3.2 and
the clean check of 7.1 see 566 changed modules. Step 0 of section 16 removes
it first.

### 3.5 Server memory

The server used 650 to 960 MB after typing-only requests for the small-file
edit, and up to 1,390 MB after five edits of the shared domain module. Earlier
records show 1.3 to 1.8 GB with generation.

## 4. What Genes does on each request today

`Generator.use()` (`src/genes/Generator.hx:666-706`) installs the passes and
the generator. One request then runs:

1. **After typing, before dead-code elimination**: the four passes of section
   3.2 visit each declaration of the program.
2. **`Context.onGenerate`** (`Generator.hx:684-701`): increase the request
   number `generation` (`Generator.hx:62`) and add a `:genes.generate` stamp
   with that number to each declaration.
3. **`Generator.generate`** (`Generator.hx:69-107`) opens one
   `OutputTransaction` and calls `generateTransactional`
   (`Generator.hx:120-469`):
   1. Inventory (`:122-218`): group types by module (`typesPerModule`,
      `:586-616`), collect `@:expose` exports, create one `Module` for each
      module.
   2. Reachability (`:236-365`): `expandReachability` walks each module's
      dependency edges (`Module.dependencyPlan`, built by
      `DependencyPlanBuilder.build`, `DependencyPlanBuilder.hx:55`). It can
      add declarations to a target module (`Module.addTypes`,
      `Module.hx:477-549`) and visit that module again.
   3. Validation (`:367-404`): one loop for JSX capability, one loop for
      public direct bindings.
   4. Emission (`:406-449`): one loop over the sorted module names calls
      `generateImplementation` (`:618-647`). With `-D dts`, a second
      reachability pass and a declaration loop follow.
   5. Publication (`:466-468`): `OutputTransaction.commit`
      (`OutputTransaction.hx:148-255`).

On the application of section 1, earlier profiles give reachability 56%,
emission 22%, direct-binding validation 6% and Haxe typing 4% of a cold
compile.

## 5. The design in one paragraph

Do not make the whole-program steps incremental. Keep inventory, the
reachability walk, the validation loops, the emission loop and the
transaction as they are. Make the **per-module steps** skippable: for a clean
module, the walk reads stored edges and not a new `DependencyPlan`, the
validation loops skip it, and the emission loop replays its stored bytes. A
module is clean only when Genes can show, from plain recorded data, that each
input of its last result is unchanged. When Genes cannot show that for some
reason that it does not handle exactly, the request does a full generation.
There is one code path. Full generation is the same path with no clean
module.

This is why the design is safe to build in small steps: each step may turn
one fallback reason into exact handling, and before that step the answer is
slow but correct.

## 6. What the output of one module depends on

This list is the core of the review. Each entry is an input that can change
the bytes of module `M`, with the place in the code that reads it and the
check that guards it.

| # | Input | Where it is read | Guard |
|---|---|---|---|
| 1 | The typed declarations of `M` (types, expressions, metadata, positions), **including declarations that reach output only as late additions** | everywhere | No declaration of `M` was typed again (7.1) |
| 2 | Typed facts of other declarations that `M` refers to (fields of a parent class, a typedef body, a callee's signature and metadata) | planners and emitters, through compiler refs | Assumption H1 (8.2): Haxe types `M` again when it types the other module again. Fingerprint of the other module (9) for changes without typing |
| 3 | Which fields survive dead-code elimination in `M` | `Module.fieldsOf` (`Module.hx:712`) | Shallow fingerprint (9) |
| 4 | Which declarations of `M` reach the generator | `api.types`, `typesPerModule` (`Generator.hx:586`) | Declaration list in the fingerprint (9) |
| 5 | Declarations that reachability adds to `M` because **another** module refers to them, and their order | `expandReachability` (`Generator.hx:299-308`), `Module.addTypes` (`Module.hx:477`) | Replay of the walk with exact member states (7.3) |
| 6 | The set of concrete type names of the program | `context.concrete` (`Module.hx:488-501`, filled at `Generator.hx:188-193`) | Recorded answers (7.4) |
| 7 | Import cycles through other modules | `Module.isCyclic`/`testCycles` (`Module.hx:555-590`), used at `TsModuleEmitter.hx:324,329,1144` and `ModuleEmitter.hx:121,126,290,450` | Recorded answers, checked on the stored import graph (7.4) |
| 8 | Compiler feature flags, including flags that the emission of an **earlier** module adds | `Module.hasFeature` (`Module.hx:164`), `ctx.hasFeature`/`addFeature` (`ExprEmitter.hx:535,947-956,1630-1637`, `TsModuleEmitter.hx:300,4579,4747`, `ModuleEmitter.hx:98,709`, `DependencyPlanBuilder.hx:540`) | Recorded answers and recorded additions (7.4) |
| 9 | Module-function entries of the module that owns a called function | `Module.resolveModuleFunction` (`Module.hx:378-398`) | H1, and a live read-only `Module` for a clean target (7.3) |
| 10 | Facts captured before dead-code elimination | `PublicSurface.forClass`/`forTypedef` (`PublicSurface.hx:533-553`), `SignatureCache` getters (`SignatureCache.hx:504-570`) | Captured again on each request today. Section 7.8 changes that under its own checks |
| 11 | Module directives | `ModuleDirectivePlan.forModule` (`ModuleDirectivePlan.hx:208`) | Part of the fingerprint (9) |
| 12 | Exports of all modules, for the root module only | `Generator.hx:131-194,387-402` | The root module is always dirty |
| 13 | Defines, output extension, import-extension policy, JSX policy | `Context.defined` in many places, `Genes.outExtension` | Session key (10) |
| 14 | The location of the output folder relative to the sources (source-map paths) | `SourceMapGenerator.sourceIdentities` (`SourceMapGenerator.hx:280-327`) | Session key (10) |
| 15 | Whether a called function's owner module already exists in the module map at that moment of the walk | `Module.resolveModuleFunction` (`Module.hx:384-387`) | Recorded answer (7.4) |
| 16 | Feature flags that Haxe's own printer adds when Genes hands it an expression | `ctx.expr`/`ctx.value` = `api.generateStatement`/`generateValue` (`Module.hx:983-984`; used at `ExprEmitter.hx:725,728,933,1439,1442`) | A module that uses this path is never clean (7.4) |
| 17 | Compiler inputs that are neither defines nor class paths: `-resource` files (printed through `haxe.Resource`), `--macro` start-up calls such as `keep` and `include` | Haxe | Session input digest (10) |
| 18 | Source file text, with `-D source_map_content` | `SourceMapGenerator.toJSON` (`SourceMapGenerator.hx:337-344`) | The incremental path is off with this define (10) |
| 19 | The shared HXX provider schema catalog | `ModuleContext.jsxProviderSchemas` (`Module.hx:83-96`) | None needed: it stores validation answers only, and a new one is made for each request |

Entries 5 to 8, 15 and 16 are the reason that "emit only retyped modules" alone is not
correct.

## 7. Seams

### 7.1 Knowing which modules Haxe typed again

Haxe gives the generator no list of changed modules. But metadata that a
macro adds to a cached declaration stays on it, and a declaration that Haxe
typed again arrives without it. The existing stamp shows this:
`Generator.hx:684-701` adds `:genes.generate(N)` on each request, and the
documentation of `needsGen` (`Generator.hx:471-506`) records that old stamps
stay.

Proposal. In the same `onGenerate` callback, when a declaration has no
`:genes.typedEpoch` entry, add `:genes.typedEpoch(nonce, N)`. `N` is the
current request number. `nonce` is a random value that Genes makes once for
each life of the macro interpreter. Never add a second entry. The pair says in
which request, of which interpreter, Genes first saw this exact typed
declaration.

Why the nonce: `Generator.generation` is `@:persistent`, but Haxe discards
the macro interpreter after some macro errors and under `-D no-macro-cache`,
and a new interpreter counts from 0 again. The metadata stays on cached
declarations across that reset. Without the nonce, a declaration that Haxe
types again could get a number that an older declaration already had. A stamp
with a foreign nonce counts as "typed again", and the cache starts empty with
its interpreter anyway. The nonce itself must be a `@:persistent` static.
Haxe sets an ordinary static up again for each request, and then each stamp
would look foreign: safe, but no module would ever be clean.

Why `onGenerate`: this callback receives **every** declaration of the
program, before dead-code elimination. The generator's own list (`api.types`)
is after dead-code elimination and misses, for example, a class that is used
only in type positions. Such a class still reaches TypeScript output as a
late addition (`Generator.hx:301-308`, `Module.hx:460-461`), so its module
must be checked too. The design depends on the default of `onGenerate`
(`persistent = true`, which runs before Haxe saves class state). With
`false`, Haxe would drop each class stamp on the next request.

The measurement script uses the same idea and counted 0, 1, 3, 68 and 174
modules for the edits of section 3.1, which matches how Haxe invalidates.

Rules:

- The cache stores, for each Haxe module of the program, the list of
  `(declaration key, nonce, N)` from the `onGenerate` list. This includes
  modules that are not emitted. The declaration key is
  `DependencyPlan.moduleTypeKey` (`DependencyPlan.hx:464`). The key is a
  name. It is never used to find a compiler object, and it is not the proof
  of identity. The epoch is.
- A module is "typed again" when that list differs in any way: a new epoch, a
  new declaration, a missing declaration.
- Each stored edge also holds the epoch of its target declaration. When a
  dirty module's new edge adds a late declaration to a clean module, the
  epoch read from the compiler ref must equal the stored one.
- Because the cache stores the epoch, a request that fails after `onGenerate`
  cannot make a module look clean later: the declaration carries the new
  epoch and the cache still holds the old one.
- Haxe's module check policies can break this rule. With the `Retype` policy
  Haxe types a module again in place and then restores the saved metadata, so
  the old stamp stays. With `NoCheckDependencies` Haxe does not invalidate
  dependents. The incremental path is not supported with any policy other
  than the default (section 10).

Side fix in the same change. The `:genes.generate` stamp adds one entry on
each request. Haxe restores the metadata of a cached class to its saved form
on each request, so a class holds at most two entries, but an enum or a
typedef keeps each entry, and `needsGen` reads all of them. In a long session
that is a slow leak. Replace the entry (remove, then add) so that each
declaration holds one.

### 7.2 What Genes keeps

One `@:persistent` static holds at most one cache, beside
`Generator.generation` (`Generator.hx:62`). The cache holds **plain data
only**: strings, integers, booleans, arrays and maps of them. It holds no
`Type`, `TypedExpr`, `Ref`, `Position`, `Module`, plan or emitter. This keeps
the rule of `docs/ARCHITECTURE.md` ("No plan or `TypedExpr` object is stored
process-wide") and the retained advice on `genes-f8vc.9` ("do not persist
typed compiler objects").

Header:

- the session key (section 10);
- the request number of the last successful generation.

For each emitted module:

| Field | Content | Use |
|---|---|---|
| `declarations` | list of `(declaration key, epoch)`, also for modules that are not emitted | 7.1 |
| `fingerprint` | the shallow fingerprint string (9) | 8.1 |
| `memberStates` | for each visit of the module in each walk (the implementation walk, and the declaration walk with `-D dts`): the ordered list of member keys at that visit, and the edges of the plan built for that list | 7.3 |
| `finalMembers` | the ordered member keys when emission ran, one list for the implementation file and one for the declaration file | 7.3 |
| `runtimeRequests` | ordered internal runtime import paths | cycle checks (7.4) |
| `answers` | recorded global questions and their answers, each with the phase that asked (planning or emission): feature flags, cycle tests, concrete-name tests, module-exists tests | 7.4 |
| `usedHaxePrinter` | true when emission handed an expression to Haxe's own printer. Such a module is never clean | 7.4 |
| `featuresAdded` | features that emitting this module added | 7.4 |
| `publicEntries` | root public bindings: name, module, and position as file, min, max | validation loop (7.5) |
| `warnings` | generation warnings as text plus file, min, max | shown again on replay |
| `files` | for each output path: the exact staged text | replay (7.6) |

A stored edge is the part of `DependencyEdge` (`DependencyPlan.hx:179-193`)
that `expandReachability` reads, turned into plain data: the edge kind,
whether the import is external, the target module, the target declaration
key, epoch and base name, the three "skip" decisions of `Generator.hx:281-292`, and
the provenance rule name for diagnostics.

### 7.3 Reachability with stored edges

`expandReachability` stays. For a dirty module it reads
`sourceModule.dependencyPlan.edges` as today (`Generator.hx:260`). For a clean
module it reads stored edges.

The walk is order sensitive. It can add a declaration to a target module
(`Generator.hx:302-308`), which appends to `members` (`Module.hx:490,496`),
clears the target's plans (`Module.hx:524-546`) and visits the target again
(`Generator.hx:320-321`). So the edges of a module depend on its member list
at that moment, and the order of members in the output file depends on the
order of the walk.

To keep the walk exact, a clean module is not given its final edges at once.
The cache holds one edge list for each member state that the last walk saw
(`memberStates`). The replay keeps a simulated member-key list for each clean
module:

- An edge into a clean target with a declaration key that is not in its
  simulated list appends the key and marks the target "changed", as
  `addTypes` does.
- When the walk visits a clean module, it looks up the edges for the current
  simulated list. **No stored entry means that the walk left the recorded
  path. The request falls back.**
- At the end, the simulated list of each clean module must equal
  `finalMembers`. If not, fallback.

The function "edges of module `M` for member list `L`" depends only on inputs
1 to 4, 6 to 11 and 15 of section 6, and the clean checks cover those. So a
stored answer for the same `L` is the answer that a new plan would give.
Shadow mode (section 13) tests exactly this sentence: it compares each stored
edge list with the edges of the new plan.

With `-D dts` there are two walks (`Generator.hx:355` and `:437`). Each walk
has its own stored states and its own final list.

How often the walk leaves the recorded path is **not known**. One ordinary
TypeScript edit does it: the first use, in a type position, of a class that
dead-code elimination removes. Shadow mode measures the rate before the
replay is built (risk 4).

Two more cases:

- **An edge from a clean module into a dirty module.** Under H1 this cannot
  happen after a source edit, because the clean module depends on the dirty
  one and Haxe would have typed it again. It can happen when the target is
  dirty for another reason (fingerprint). The dirty target needs the compiler
  ref of the declaration, and a clean module has none. First version:
  fallback, and count it. See 7.7 for the later step.
- **A dirty module calls a module function owned by a clean module**
  (`Module.resolveModuleFunction`, `Module.hx:384-396`). The generator builds
  a normal `Module` for the clean owner from `api.types` and uses it for this
  read only. If the clean owner has stored members that reachability added
  (they are not in `api.types`), fallback.

### 7.4 Recorded answers

Some inputs are global questions that a module asks while Genes plans or
emits it. The design records each question and its answer, and asks again
before a replay.

- **Feature flags.** `Module.createContext` (`Module.hx:975-992`) is the one
  place that builds the emitter context, and `ModuleContext.hasFeature` is
  set at `Generator.hx:198`. Wrap both: record `(feature, answer, phase)` for
  each `hasFeature` call and each feature for each `addFeature` call. Flags
  are only added during a request, never removed. Two phases ask:
  - Planning asks during the walk (`DependencyPlanBuilder.hx:540`), before
    any emission. These answers are checked before the walk starts.
  - Emission asks inside the emission loop. When the loop reaches a clean
    module, compare each recorded emission answer with `api.hasFeature` at
    that moment. Then call `api.addFeature` for each recorded addition, so
    that later modules see the same flags as in a full generation. The loop
    order is the sorted module names in both cases.

  A different answer means fallback.

  One path cannot be recorded. When Genes hands an expression to Haxe's own
  printer (`ctx.expr` and `ctx.value`), that printer can add flags itself
  (`use.$bind`, `use.$iterator` and others), and the wrapper does not see it.
  A module whose emission used this path is marked `usedHaxePrinter` and is
  never clean. Step 1 counts how many modules that is.
- **Cycle tests.** `isCyclic(test)` is true when `test` reaches the asking
  module through internal runtime imports (`Module.hx:568-590`). The cache
  holds each module's `runtimeRequests`. `testCycles` reads stored lists for
  clean modules. If the `runtimeRequests` list of every dirty module equals
  its stored list, the graph is unchanged and each recorded answer holds.
  Otherwise the generator computes reachability once on the plain graph and
  checks each recorded answer of each clean module. A different answer means
  fallback. The module cannot become dirty at that point, because its live
  `Module` does not hold the late additions that the walk only simulated.
- **Module exists.** `Module.resolveModuleFunction` takes another branch when
  the owner module is not in the module map yet (`Module.hx:384-387`). Record
  `(module, answer)` and compare it in the simulated walk.
- **Concrete names.** `Module.addTypes` keeps a typedef member only when the
  followed type's name is in `context.concrete` (`Module.hx:499-504`). Record
  `(name, answer)`. Before the walk, `context.concrete` holds the names from
  `api.types` (`Generator.hx:188-193`). The names that late additions push
  (`Module.hx:488-495`) come from the simulated walk for clean modules.

### 7.5 The validation loops

- JSX capability (`Generator.hx:372-379`): skip clean modules. The result for
  a module depends on its own plan and on defines.
- Public direct bindings (`Generator.hx:387-402`): for a clean module, replay
  `publicEntries` into `export()` and `outputModule.expose`. A stored position
  becomes a `Position` again through `Context.makePosition`.

A module that failed validation never enters the cache, because the request
failed.

### 7.6 Emission and publication

In the emission loop (`Generator.hx:407-417`), a clean module does not reach
`generateImplementation`. The loop registers its stored files through
`OutputTransaction.writeContent` (`OutputTransaction.hx:118-120`). The stored
text is the text after `canonicalSourceEof` (`OutputTransaction.hx:113,506`),
so a replay stages the same bytes as the writer did. The same holds for the
`-D dts` loop (`Generator.hx:446-447`) and for source maps
(`Generator.hx:643-645`).

The transaction then publishes the complete set as today. Each generation
still stages each owned file, so the manifest, stale-file removal and
rollback of `OutputTransaction.commit` do not change. This costs one file
write for each owned file on each request. Section 13 measures it, and a
later step (7.7) may avoid it.

The cache is updated only **after** `outputTransaction.commit()` returns
(`Generator.hx:467`). A failed request leaves the cache of the last
successful generation. That is correct, because the epochs of 7.1 still mark
each module that changed since then.

### 7.7 Fallbacks, and how they become exact later

The first version falls back to full generation in these cases. Each one is
counted in the session report (section 12).

| Reason | Expected frequency | Later exact handling |
|---|---|---|
| The fingerprint of a module that was not typed again changed (for example an edit uses a method that dead-code elimination removed before) | Sometimes | Make that module dirty, and each module with a stored edge into it, to the fixed point |
| The walk left the recorded path (7.3) | Not known. Measured in step 1 | A canonical order for late additions (risk 4) |
| A clean module has an edge into a dirty module (7.3) | Should not occur under H1 | Treat as an H1 defect and report it |
| A feature, cycle or module-exists answer changed (7.4) | Not known. Measured in step 1 | Decided from the measured rate |
| More than half of the emitted modules are dirty | On edits of shared modules | Not a correctness case. Full generation is cheaper than bookkeeping |

A later step may also skip a module that Haxe typed again but whose typed
content is equal to the stored one ("early cutoff"). An edit inside one
function of a shared module makes Haxe type 174 modules again, and for most
of them the typed content is the same. This needs a deep fingerprint of the
typed declarations of a module, with local variable numbers normalized,
because Haxe gives new numbers when it types a module again. It is not part
of the first version, and it cannot remove Haxe's own 12 to 15 s.

### 7.8 The passes after typing

The four passes of section 3.2 cost about 7 s on each warm request. They are
not generation, and section 7.2 does not cover them: `PublicSurface` and
`SignatureCache` hold compiler-owned `Type` values (`SignatureCache.hx:51-62`,
`PublicSurface.hx:232`), and they are replaced on each request by design
(`docs/ARCHITECTURE.md`, state-owner ledger).

To reach the estimate of section 14, these passes must also do work only for
modules that Haxe typed again. That keeps typed values across requests, which
is a different and larger decision than a plain-data cache. This note
proposes it as a **separate change with its own review**, in this order:

1. `ReactDiagnosticsMacro.audit`: keeps nothing. It can skip a declaration
   that carries a `:genes.typedEpoch`-style mark from an earlier request,
   because a diagnostic pass over unchanged typed code gives the same result.
   Cost: warnings for unchanged modules are not shown again. An earlier
   record for another project says that Haxe's own warnings behave so on a
   warm server. This note did not verify that.
2. `PublicSurface.captureTypes` and `SignatureCache`: store captures in one
   bucket for each module, drop the bucket when the module is typed again or
   leaves the program, and capture only modules without a bucket. This needs
   proof for one more assumption, H2: a `Type` value captured for a module
   stays valid while Haxe does not type that module again. The cheap
   retention loops (`PublicSurface.hx:520-528`, 0.01 s) keep running for each
   declaration.

Until that change exists, the best warm request is about 7 s plus the rest.

## 8. Invariants

### 8.1 When a module is clean

A module is clean when all of these hold. All other modules are dirty.

1. The session key equals the stored key (section 10).
2. The module has a cache entry from the last successful generation.
3. Its `(declaration key, epoch)` list, taken from the `onGenerate` list,
   equals the stored list (7.1).
4. Its shallow fingerprint equals the stored fingerprint (9).
5. It is not the root module, and its last emission did not use Haxe's own
   printer (7.4).
6. In the first version: no module that was not typed again has a changed
   fingerprint. Otherwise the request falls back (7.7).

During the request, the checks of 7.3 and 7.4 can still turn the request into
a fallback.

### 8.2 Assumptions that the proof must test

- **H1, dependency soundness.** If the generated output of module `A` can
  read any typed fact of a declaration in module `B`, then Haxe types `A`
  again whenever it types `B` again. Haxe invalidates the modules that depend
  on a changed module, through other modules too, so this holds for ordinary
  references. Known places to test, all in the edit list of section 13: types
  that reach `A` only by inference through a third module, inlined statics,
  typedef chains, types that a build macro or an expression macro loads, and
  generic instances. One more class needs care: Genes looks up some types
  **by name during generation** (`JsxTypeChecker.hx:603,999`,
  `TypeUtil.hx:77,647,681`, `BindingIdentity.hx:165`, `Dependencies.hx:438`,
  `dts/TypeEmitter.hx:184`). Today such a lookup records a dependency from an unrelated
  module (section 3.4), which is the wrong one. After step 0 removes these
  lookups, or makes them record nothing, H1 holds only if typing already
  recorded the right dependency, for example for a provider path that is
  written as a string in metadata. H1
  does not hold with a non-default module check policy (7.1).
- **H2** (only for 7.8): a captured `Type` of a module that Haxe did not type
  again stays valid in later requests.
- **H3, pure steps.** For fixed inputs 1 to 14 of section 6, planning and
  emission of one module give the same bytes. The existing
  `yarn test:compiler-server` is evidence for this on one fixture: it shows
  that a warm full generation equals a cold one there. It is not proof for
  other programs.

### 8.3 Properties that must hold in every request

1. **Equal output.** After a successful request, the published tree is
   byte-for-byte the tree that a cold full generation gives for the same
   sources and arguments.
2. **No partial state.** The cache changes only after a successful commit.
   An error in any phase leaves both the public tree and the cache as they
   were.
3. **Diagnostics first.** A request that would fail in full generation fails
   on the incremental path with the same diagnostic. A dirty module runs each
   validation. A clean module passed each validation with the same inputs.
4. **One path.** There is no second generator. The skip decisions sit at four
   places: the edge read, the two validation loops and the emission loop.
5. **Off by default.** Without the define of section 11, no cache is read or
   written and the code path is today's.

## 9. The shallow fingerprint

Purpose: see a change in a module that Haxe did **not** type again. Such a
change comes from whole-program steps of Haxe, mostly dead-code elimination:
an edit in module `A` starts to use `B.helper`, so `B.helper` now survives,
and `B`'s output must change although `B` was not typed again.

It is computed in the generator for each declaration in `api.types`, after
dead-code elimination, without a visit of any expression. A similar pass took
0.06 to 0.09 s for the whole program (section 3.3). A module with no
declaration in `api.types` has an empty fingerprint, and the epoch list of
7.1 guards it.

Content, for each declaration of the module, in `api.types` order:

- declaration key and kind;
- for a class: the names of the parent class and interfaces; `isExtern`,
  `isInterface`; whether `init` and the constructor exist; for each kept
  instance and static field its name, kind index, `isPublic`, and whether it
  has an expression;
- for an enum: the constructor names in order;
- for a typedef or abstract: the key only;
- the names of the declaration's metadata entries, without the two Genes
  stamps and without the marks that dead-code elimination itself adds
  (`:used`, `:directlyUsed`, `:maybeUsed`). Genes does not read those marks,
  and they change when other modules change;
- the module's directive values (`ModuleDirectivePlan.forModule`,
  `ModuleDirectivePlan.hx:208`);
- the module's part of the `expose` list (`Generator.hx:131-194`).

Not in the fingerprint, with the reason:

- Field types and expressions: they change only when Haxe types the module
  again (7.1), or through a cached expression that a Haxe filter changed
  between requests. The second case is hazard 1 of section 15, and the proof
  harness tests it.
- Import aliases and feature flags: the earlier outline put them here. They
  are results of planning and of global questions, so sections 7.3 and 7.4
  guard them where they are read.
- Positions: they move only when the file changes.

## 10. Invalidation

The session key is one string made from:

- **the session's input digest.** The development session owns the complete
  Haxe argument list. It computes a digest of the normalized argument list
  with each nested HXML file expanded (so also each `--macro` start-up call
  and each `-resource` argument), and of the bytes of each resource file. It
  writes the digest into a small file, and the define names that file:
  `-D genes.dev_incremental=<path>`. The path stays the same for the whole
  session. The digest is not the define's value on purpose: Haxe's own cache
  is keyed by the defines, so a new value would make Haxe type the whole
  program again and keep a second copy of each module in memory. The
  session's existing compiler-data descriptor uses the same file pattern. A
  different digest drops the Genes cache;
- each define and its value (`Context.getDefines()`). This includes the
  library version defines, `dce`, `debug`, `js-source-map`, `genes.ts` and
  each Genes option;
- the class paths in order (`Context.getClassPath()`);
- the path, size and modification time of each file under the Genes class
  path. Genes finds that path from the resolved location of its own
  `genes/Generator.hx` (`Context.resolvePath`). This is about 250 file
  status calls for each request. The cost is not measured, and step 1
  reports it. Haxe keeps the macro interpreter and its persistent statics when one
  Genes source file changes, so the key must see such a change. This matters
  for anybody who works on Genes with a linked checkout;
- the Haxe version and the main class;
- the output file name, and the path from the output folder to the working
  folder. The second part is what source-map paths depend on. A session that
  writes each candidate into a new sibling folder keeps the same key;
- a cache format number.

The incremental path is **off** (full generation, no cache) when:

- the define names no readable digest file;
- `-D source_map_content` is set, because maps then hold source text that
  Genes reads from disk;
- `-D no-macro-cache` is set;
- the session's arguments configure a module check policy
  (`CompilationServer.setModuleCheckPolicy`). The session checks this in the
  expanded argument list. A policy that a macro sets later cannot be seen, and
  neither can a policy in the `extraParams.hxml` of a haxelib library, which
  Haxe reads itself. (A Lix `haxe_libraries/*.hxml` file is a nested HXML
  file, so the session does see it.) Those cases are not supported, and the
  comparison of section 11 is their only guard.

The five cases that the plan asks for, and what happens:

| Change | What Genes sees | Result |
|---|---|---|
| **Source**: a file is edited | Haxe types the module and its dependents again. New epochs (7.1) | Those modules are dirty. The rest is replayed, unless a check of 7.3 or 7.4 falls back |
| **Define**: a `-D` value is added, removed or changed | The session key differs | The cache is dropped. Full generation |
| **Library**: a pinned library moves to another commit | Its class path and version define differ, so the session key differs. A host can also tell the session to restart the server for such a change (`ExternalChange.impact.restartCompiler`, `tooling/src/session/runtime.ts`) | Full generation |
| **Type set**: a module is added or removed, or a declaration is added to or removed from a module | A new module has no entry. A changed declaration list fails check 3 or 4. A removed module is not visited | The module is dirty. Entries that the request did not visit are removed after commit. The walk decides reachability as today |
| **Genes version**: the compiler sources change | A new pin changes the class path and the version define. An edit in place changes a file time under the Genes class path. Both change the key. Haxe may or may not build a new macro interpreter, so the design does not depend on that | Full generation |

Also:

- A file of a library edited in place is a source change.
- A resource file edit changes the session's input digest.
- A failed request does not change the cache (8.3).
- A server restart starts with no cache.
- Two projects in one server have different keys. The cache holds one key,
  so they would replace each other's cache on each request. That is slow and
  correct. A session owns its server, so this does not occur in practice.

## 11. Rollout

- One define, **`genes.dev_incremental=<path of the digest file>`**, turns
  the behavior on.
  Only the host development session (`@genes-ts/tooling/session`) is meant to
  set it. The session already reserves `genes.output` for itself and rejects
  it in its direct arguments (`tooling/src/session/haxe-driver.ts:135-158`).
  The new define joins that list. That check does not look inside a nested
  HXML file or a `--macro define(...)` call, so it is a guard against
  accidents, not a lock. A build that sets the define by hand without a
  digest file gets full generation (section 10).
- Without the define: no cache, no epoch stamp, today's bytes and today's
  time. `pnpm build`-style commands, test gates and each pinned output never
  use `--connect`, so they cannot see a cache at all.
- The session sends a full-generation request to a second private folder
  after each 20th accepted edit, and compares the two trees. A difference
  stops the incremental path for the rest of the session, publishes the full
  tree, and writes a report with the paths that differ. The comparison runs
  after the edit is shown, so it does not delay feedback.
- A second private define, `genes.dev_incremental_shadow`, is for the proof
  only (section 13).
- Steps (section 16): shadow proof first, then replay, then the passes of
  7.8, then the narrower fallbacks.

## 12. State ledger and memory

Ledger entry, in the form that `docs/ARCHITECTURE.md` asks for:

| Owner | Producer | Role and key | Reset or rebuild point | Failure behavior | Proof |
|---|---|---|---|---|---|
| `GenerationCache` (new, one `@:persistent` static owned by `Generator`) | `Generator.generateTransactional`, after a successful commit | Plain-data result of the last successful generation for one session key. Module entries use the Haxe module name. Declarations use `DependencyPlan.moduleTypeKey` **plus the typed epoch**. The name is only a map key. The epoch is the identity proof, so two declarations that share a name cannot be confused across a retype | Dropped when the session key differs, when the define is absent, and on a comparison mismatch | A failed request does not write it. A failed check falls back to full generation in the same request | The harness of section 13, and new cold/warm cases in `yarn test:compiler-server` |
| `:genes.typedEpoch` metadata (new) | The `onGenerate` callback of `Generator.use` | Interpreter nonce and request number in which Genes first saw one typed declaration. Lives on the declaration in Haxe's cache | Gone when Haxe types the declaration again. A foreign nonce counts as gone | A missing or foreign stamp makes the module dirty | Same |
| `Generator.generation` (existing) | Same callback | Request number. It grows inside one macro interpreter, and starts again in a new interpreter. The existing ledger row calls it monotonic, and the implementation change must correct that row | As today | As today | As today |

The architecture guide asks for compiler-owned identity, not generated
names, and prefers an owner-local reset to a compiler-wide cache manager.
This design follows both: the cache has one owner (`Generator`), one reset
rule (the key), and it never turns a name back into a compiler object.

Memory budget:

- Generated text: the application has 457 TypeScript files and about 91,000
  lines, an estimated 4 to 6 MB. Source maps are of a similar order. Not
  measured: the first step records the real sizes.
- Edges, member states and answers: not measured. Step 1 counts them.
  The budget is that all of it is less than the text.
- **Budget: 64 MB of plain data, which is below 5% of the 1.3 to 1.8 GB that
  the server already uses.** The cache counts the string lengths that it
  stores. Above the budget it drops itself and the session reports it.
- The `:genes.generate` fix of 7.1 removes a leak that exists today.

The session report has, for each request: the number of modules typed again,
dirty, replayed; the fallback reason if any; the time of each phase; the
cache size.

## 13. Proof harness

Three layers.

**Shadow mode** (`genes.dev_incremental_shadow`, step 1). The request does a
full generation. Beside it, it runs every decision and every simulation of
the incremental path, and compares them with what the full generation really
did. For each module that the incremental path would call clean, it checks:

- the stored edge list equals the edges of the new plan, at each member state
  that the real walk visited;
- the simulated member lists equal the real member lists, in order, for each
  walk;
- each recorded answer (feature, cycle, concrete name, module exists) equals
  the live answer at the same phase;
- the stored runtime requests and public entries equal the new ones;
- the stored files equal the files that the full generation just staged.

A difference fails the request with the module name and the first differing
item. Shadow mode cannot publish a wrong tree, because it publishes the full
generation. It tests H1, H3 and the replay of 7.3 and 7.4 on a real project
before any skip exists. It also reports how many requests would have fallen
back, and why.

**Scripted edits** (extends the lifecycle of `scripts/test-compiler-server.ts`
and its fixture `tests/compiler-server`). One hundred edits against one warm
server. After each edit, the warm tree is compared byte for byte
(`hashTree` in `scripts/compiler-server-lifecycle.ts`) with a cold full
generation of the same sources. The edit list is fixed in the repository and
covers at least:

1. a function body in a module without importers;
2. a function body in a module with many importers;
3. a public signature change;
4. a new import and a removed import, including one that creates and one that
   removes an import cycle;
5. the first use and the last use of a method that dead-code elimination
   removes otherwise, in another module;
6. the first use and the last use of a type that reaches output only through
   a type position;
7. a new module, a deleted module, a renamed declaration;
8. an `@:expose` added and removed; a module directive added and removed;
9. HXX markup changes, and a change of an inline constant that other modules
   use;
10. the first use of a feature-flagged runtime helper (dynamic iterator);
11. a type error, then its repair; a generation diagnostic, then its repair;
12. a define change and a change back;
13. two edits within one second, with file times set as the session sets
    them (Haxe 4.3.7 compares file times at one-second precision);
14. an edit of a class that is used only in type positions and lives in its
    own module, so that it reaches output only as a late addition;
15. the H1 cases of section 8.2: a type that reaches a module only by
    inference through a third module, an inlined static, a typedef chain, a
    type that a build macro loads, a type that an expression macro loads, a
    generic instance, and a provider type that is named by a string in
    metadata;
16. an edit of a `-resource` file, and an edit of a Genes compiler source
    file. Both must give full generation;
17. a request that fails after `onGenerate`, followed by a request with no
    further edit.

The 17 kinds give about 40 distinct edits. The list reaches 100 by running
each of them in sequence against one server, with a fixed order that puts
each kind after each other kind at least once, and by repeating the body
edits on different modules.

Each case runs in the TypeScript profile and the classic profile, with and
without source maps. The fixture stays free of any downstream project name.

**Session guard** (section 11): the comparison after each 20th edit in real
use.

Acceptance for "equal": 100 of 100 scripted edits give trees equal to cold
output, and the shadow run over the same edits reports no difference. Timing acceptance
follows the repository rule: paired samples on a quiet machine, a recorded
load, and no CI time limit before variance is known.

## 14. Estimate

All numbers are for the Genes request only (`haxe --connect` to answer), for
the application of section 1. They assume that step 0 of section 16 has
removed the defect of section 3.4. "Measured" values come from section 3 and carry
its diagnostic label. Other parts are estimates.

Small file without importers:

| Part | Time | Basis |
|---|---|---|
| Haxe: find the change, type one module, filters, dead-code elimination | 0.4 s | measured |
| Passes after typing | 7.3 s today, about 0.1 s after 7.8 | measured, then estimated |
| Fingerprint and declaration lists | 0.1 s | estimate from a smaller probe (3.3) |
| Inventory, walk over stored edges, checks | 0.2 to 0.4 s | estimate, not measured. Inventory still builds the field list of each class on each request |
| Plan and emit the root module and the edited module | 0.2 to 0.4 s | estimate |
| Stage about 900 files and commit | 0.1 to 0.3 s | estimate. An earlier record on `genes-f8vc.9.4` gives 0.17 s for the repository's smaller scale fixture |
| **Total** | **1.1 to 1.7 s with 7.8**, about 8 to 9 s without | |

Other edits:

| Edit | Haxe floor | Estimate with this design |
|---|---|---|
| Large HXX component, 2,258 lines, 3 modules typed again | 3.3 s | 7 to 10 s. The component's own planning and emission is 3 to 6.5 s if the cost is in proportion to lines. That is a rough estimate: earlier profiles put about 84% of a cold compile of roughly 150 s into planning, validation and emission, for about 44,000 lines, which is about 2.9 ms for each line |
| Shared UI primitive, 68 modules typed again | 11.8 s | 30 to 70 s, or a fallback |
| Shared domain module, 174 modules typed again | 12.7 to 15.0 s | 60 to 100 s, or a fallback. About 15 s with the early cutoff of 7.7 |

What this means for the targets:

- The stage target of 5 s median for a one-file UI edit is reachable for
  small and medium files that few modules import, and only with step 0 and
  the change of 7.8. The second one depends on H2, which is not proved.
- The time of a direct TypeScript edit (0.7 s) is not reachable with Haxe
  4.3.7 for any edit: the Haxe floor alone is 0.4 s, and the session adds its
  TypeScript check and publication after the Genes request.
- For shared modules, the limit is Haxe's typing of dependents, and
  `genes.react.JSX` is 39% of that request. Work on the cost of that macro,
  and a decision on the Haxe version, matter more there than any generation
  cache.

## 15. Risks

0. **Generation changes what Haxe types again** (section 3.4). Until step 0
   lands, the estimates of section 14 do not hold, and the count of modules
   that are "typed again" is far larger than the edit explains.
1. **Cached typed expressions that Haxe changed between requests.** On a warm
   server, Haxe 4.3.7 can hand over an expression of a cached module in its
   already filtered form. A downstream project saw the order of classes in
   plain JavaScript output change for that reason. Genes sorts by module
   name, so that exact effect does not apply, but a cached module can still
   look different on the second request. Replay removes this difference for
   clean modules, because it reuses the bytes of the request in which the
   module was last typed. The scripted proof compares against cold output, so
   it shows either direction.
2. **H1 has a hole.** A macro could read a type without a dependency that
   Haxe records. Guards: shadow mode on real projects, the list of 8.2 in the
   fixture, the comparison after each 20th edit.
3. **Dead-code elimination changes many modules at once.** The first version
   falls back. The session report shows how often.
4. **The walk leaves the recorded path often.** Then most edits fall back and
   the design gives little. Shadow mode measures this before the replay is
   built. If the rate is high, the member order of late additions needs a
   canonical form first, which changes cold output and is its own change.
5. **Whole-program validation.** Module-name collisions
   (`Generator.hx:211-215`) and duplicate exports (`Generator.hx:131-152`)
   stay in the inventory, which runs in full on each request.
6. **Memory.** Section 12.
7. **One-second file times.** Not changed by this design. The session already
   owns the file-time rule.
8. **Earlier lesson, `genes-gvwv.2.1`.** A cache keyed by declaration kind,
   module and name was wrong because two declarations shared one native name.
   This design never looks up a compiler object by name. Names are keys of
   plain data only, and a clean module needs equal epochs for its own
   declarations.
9. **Earlier direction, `genes-f8vc.9`.** That task says "do not add an opaque
   cache or skip generation for changed inputs" and deferred cross-request
   caches until the floors were measured. This note gives the floors and a
   cache whose key, lifetime and invalidation can be reviewed. It needs the
   owner's decision to lift that deferral.
10. **`genes-6h21`** (stale output after a source change, open). The cause is
    not known. Any cross-request state makes such a defect harder to see, so
    the shadow step should run with that task's reduced case when it exists.

## 16. Steps

Each step is one reviewed change with one contract.

0. **Generation adds no Haxe dependencies** (section 3.4). Find the call that
   makes Haxe type 566 modules again after a small-file edit, and remove or
   replace it. No cache is involved, and each warm session gains at once.
   Acceptance:
   - after a full generation, `scripts/measure-warm-edit-floor.mjs` reports
     the same number of modules typed again in `full` mode as in `typing`
     mode, for a small-file edit on the repository's scale fixture and on one
     real project;
   - a focused case in `yarn test:compiler-server` fails on today's `main`
     and passes with the fix;
   - cold output is byte-for-byte unchanged;
   - the same count is confirmed on the real application that step 1 uses
     for its go or no-go, because the fallback rate means nothing while the
     count of modules typed again is inflated.
1. **Shadow proof.** Epoch stamp, plain-data cache, recording of edges,
   member states and answers, the clean and fallback decisions, the simulated
   walk, and the comparisons of section 13. No module is skipped. Output and
   time without the define do not change. Acceptance:
   - 100 of 100 scripted edits, in both profiles: shadow mode reports no
     difference in edges, member lists, answers or files for any module that
     it calls clean, and each published tree equals cold output;
   - one shadow run of at least 20 edits on one real application, with the
     same result;
   - the report gives, for each edit, the modules typed again, dirty and
     clean, the fallback reason, the number of modules that used Haxe's own
     printer, the cache size and the edge count;
   - **go or no-go for step 2:** on the real application, at most 1 of 10
     edits of a file with no importer would fall back. A higher rate stops
     the work until the main fallback reason has exact handling;
   - with the define absent, the repository's output snapshots and
     `yarn test:compiler-server` pass unchanged;
   - shadow overhead on a warm request is reported.
2. **Replay.** The four skip points of section 5 and the session guard.
   Acceptance: 100 of 100 scripted edits equal to cold output; the Genes
   phases of a small-file edit take 1 s or less in paired quiet samples on
   the fixture; each fallback publishes the full tree.
3. **Passes after typing** (7.8), with its own review.
4. **Fallback reasons become exact**, in the order of their measured
   frequency, and the early cutoff.

## Appendix. How to repeat the measurements

```bash
node scripts/measure-warm-edit-floor.mjs \
  --project <source-only copy of a project> \
  --haxe <native Haxe 4.3.7 binary> \
  --edit <file> --from '<text that occurs once>' --to '<replacement>' \
  --modes typing,callback,scan,full --samples 5 --out floor.json \
  -- <HXML arguments with library paths already resolved>
```

The script labels a run `diagnostic` when the 1-minute load is above 2.0 at
any sample. It records the load, the server CPU time and the number of
modules that Haxe typed again for each sample. It needs a quiet machine for a
run that counts as proof.
