# `@genes-ts/tooling`

`@genes-ts/tooling` is an optional Node/TypeScript library for programs that
*run* Genes during development. It helps a host CLI notice Haxe input changes,
reuse an owned Haxe compilation server, serialize rebuilds, and publish the
resulting files without exposing a half-written output tree.

It is not the Genes compiler, a compiler runtime, or a framework integration:

- Haxe programs do not import it.
- Generated TypeScript and JavaScript do not depend on it.
- `genes.Generator` and `tools/ts2hx` do not depend on it.
- Framework adapters still own their commands, diagnostics, dev servers, and
  validation policy. The admitted-generation session owns the generic
  mechanics that keep the last validated generation public.

For example, NextJsHx and WordPressHx can share the mechanics of watching Haxe
inputs and safely running `haxe --wait`, while keeping Next.js and WordPress
behavior in their own repositories.

## New here? Start with three actors

You do not need to know the implementation classes before using this package.
The development workflow has three actors:

1. **Haxe and Genes** read authored `.hx` files and generate TypeScript or
   JavaScript.
2. **Genes tooling** notices relevant changes, prevents overlapping builds,
   reuses only a compiler process it owns, and moves complete accepted files
   into place safely.
3. **The host** is your application command or framework adapter. It chooses
   the Haxe command, decides whether generated output is valid, starts any
   application or framework runtime, and presents diagnostics.

A **candidate** is a complete generated tree kept in a private directory. The
host checks it before an application runtime or another consumer can read it.
**Admission** means that check passed. **Publication** means tooling replaced
the public generated tree with the admitted candidate through a recoverable
file transaction.

That separation is why a broken edit does not have to break the running app:

```text
authored edit
  -> private candidate
  -> host validation
       pass: publish and notify the host
       fail: keep the previous public generation
```

An HXML file is Haxe's build-argument file. It names class paths, libraries,
defines, and other inputs. `inventoryHxml` reads that declared graph
so the host does not guess which files affect a build.

If you only run Haxe once in CI, keep doing that; this package is for a
long-lived development process. If you are building such a process today,
`createGenesDevelopmentSession` is the normal starting point. The lower-level
subpaths remain public for hosts with a narrower need and for the session's own
implementation; an application should not rebuild the same lifecycle from
them.

### Pick the reading path that matches your job

- **I maintain an application:** start with “When to use it,” then let your
  framework command own validation and server behavior. You should not need to
  understand watcher or process internals.
- **I am building a host adapter:** read the actor boundary above, then the
  [development-session v1 contract](development-session/v1/README.md). Treat
  its events as facts; do not scrape human terminal output.
- **I am changing Genes tooling:** read [`AGENTS.md`](AGENTS.md), then the
  closest implementation and conformance directories for the responsibility
  you are changing.
- **I am an automation or AI agent:** use stable protocol/version IDs and wait
  methods. Record the accepted `generation`, its source `revision`, and the
  manifest digest; never infer success from elapsed time or a file appearing.

## The development loop it supports

The public session composes the existing primitives like this:

```text
HXML inventory
  -> exact files and source roots to watch
  -> reconciled watch reports an edit
  -> serialized dirty loop schedules one newest-state rebuild
  -> owned Haxe wait server performs a warm or direct compile
  -> host validates staged output
  -> artifact transaction publishes the authorized files recoverably
```

Each arrow is optional. A host can use only the artifact publisher, only the
watch/loop pair, or only the owned Haxe server.

| Public subpath | What it does | What the host still decides |
| --- | --- | --- |
| `@genes-ts/tooling/agents` | Installs or checks one versioned Genes guidance block in root `AGENTS.md` | When to opt in and which narrower project rules to add |
| `@genes-ts/tooling/hxml` | Resolves declared HXML inputs deterministically | Environment values, library resolution, and allowed roots |
| `@genes-ts/tooling/watch` | Reconciles fast native events with authoritative snapshots | Which paths matter and what kind of change each path means |
| `@genes-ts/tooling/loop` | Debounces bursts and prevents overlapping rebuilds | How change causes merge and what one rebuild performs |
| `@genes-ts/tooling/haxe-server` | Owns and safely reuses one compatible `haxe --wait` process | Haxe discovery, compiler arguments, diagnostics, and compatibility identity |
| `@genes-ts/tooling/artifacts` | Publishes an exact authorized file transition with crash recovery | Generation, validation, file ownership, and adoption policy |
| `@genes-ts/tooling/css-modules` | Checks processor-owned export manifests and generates closed Haxe companions plus exact per-file TypeScript declarations | Processor choice, registry policy, framework placement, and runtime loader agreement |
| `@genes-ts/tooling/css-modules/postcss-modules` | Runs one fixed PostCSS Modules profile from measured package bytes and inert CSS inputs | Installing exact peers, choosing the binding, lock policy, watching inputs, and real-loader agreement |
| `@genes-ts/tooling/css-modules/typescript-declaration` | Adapts one exact closed per-file declaration through measured TypeScript | Producing that declaration and proving its keys agree with the real loader |
| `@genes-ts/tooling/lix` | Resolves one ordered library group through a project-installed Lix `haxelib` command | Installing packages, choosing versions, and presenting host-specific errors |
| `@genes-ts/tooling/session` | Runs one admitted-generation lifecycle over the five primitives above | Haxe location/arguments, validation policy, framework lifecycle, diagnostics, and top-level signals |

The `@genes-ts/tooling/session` subpath exports
`createGenesDevelopmentSession`, the public `DevelopmentSession` v1 types, and
the protocol constants. It also exports `readGenesOutput` and
`assertCandidateContainsOnlyOwnedFiles` for hosts that run a one-shot Haxe
build before they start a managed session. These helpers read the compiler's
exact ownership manifest and reject neighboring files that the compiler did
not name. A host can therefore record an honest handoff without learning or
copying the manifest's private text format. Relative output roots are resolved
against the caller's current working directory before the returned inventory
and file paths are frozen. `development-session/v1` publishes the matching
JSON event schema and conformance vectors.

That session contract moves generic last-good mechanics into tooling while the
host keeps the important policy decision:

```text
complete private candidate
  -> host validator accepts or rejects it
  -> tooling rejects a known-superseded candidate
  -> tooling publishes the admitted tree
  -> host reacts to one structured accepted-generation event
```

The event envelope is versioned and JSON-serializable. Monotonic sequence,
revision, and generation numbers plus `firstAccepted`, `waitForIdle()`,
`inspect()`, `reconcile()`, and idempotent `close()` let AI agents and other
automation coordinate the loop without parsing ANSI logs or guessing with
sleeps. See [`development-session/v1/README.md`](development-session/v1/README.md).

A quick mental model for the three counters is:

| Counter | What changes it | What it tells you |
| --- | --- | --- |
| `sequence` | Every emitted event | The exact order in which this session reported facts |
| `revision` | A newly observed input state | Which authored/configuration change the session has seen |
| `generation` | Successful validation and publication | Which complete public tree a host may safely consume |

For example, revision 2 can fail while generation 1 stays public. A repaired
revision 3 can then become generation 2. This is expected recovery, not a
counter mismatch.

An explicitly informational change (`rebuild: false`) still advances the
observed revision and emits `inputs-changed`, but it does not discard a safe
build already in progress. The accepted generation may therefore name the
latest revision that actually required a build while `newestRevision` also
includes later informational changes.

The accepted-generation event deliberately says nothing about how a framework
must react. A browser host can request hot replacement or a reload; a desktop,
mobile, server, or embedded host can refresh its own runtime or restart when
its policy requires it. The generic session remains reusable because it owns
only the validated file transition and structured lifecycle—not any
framework's transport, module graph, device connection, or process policy.

## Install the consumer agent guide

An installed package does not change a project's agent instructions. Run the
installer explicitly from the project root:

```bash
npm exec --no -- genes agents install
```

The command creates `AGENTS.md` when it is absent. Otherwise, it inserts or
updates one clearly marked Genes block. It preserves every existing byte
outside that block. Repeated installation makes no change.

Use check mode in CI or a scaffold:

```bash
npm exec --no -- genes agents check
```

Check mode returns zero only for the current block. It returns one when the
block is missing or stale. Invalid, missing, reversed, or duplicate markers
return two and leave the file unchanged. The package never runs this command
from `preinstall`, `install`, `postinstall`, or `prepare`.

Use `--root <project-root>` when the command runs outside the consumer root.
The programmatic API is available from `@genes-ts/tooling/agents`. The exact
version-one source is also packaged at
`@genes-ts/tooling/agent-guidance/v1/AGENTS.md`.

## When to use it

Use this package when you are building a long-running Node-based host around
Genes and would otherwise need to implement process ownership, missed file
events, rebuild serialization, or crash-safe generated-file publication.

You usually do **not** need it when:

- a project invokes `haxe build.hxml` directly or only in CI;
- a bundler already has a sufficient one-shot Haxe integration;
- you only want to compile Haxe to TypeScript or JavaScript;
- you are translating TypeScript to Haxe with ts2hx.

Start with the direct compiler workflow. Add host tooling only after the project
has a concrete watch, warm-compilation, or publication requirement.

## A first development session

The smallest useful host supplies three project facts:

1. the exact Haxe invocation, whose ordered HXML entries define what to watch;
2. the public Genes output entry;
3. a validator for a complete private candidate.

```ts
import {
  createGenesDevelopmentSession,
  type JsonValue,
} from "@genes-ts/tooling/session";

type Diagnostic = Readonly<Record<string, JsonValue>> & {
  readonly code: string;
  readonly message: string;
};

const session = createGenesDevelopmentSession<Diagnostic>({
  projectRoot: "/workspace/my-app",
  projectIdentity: "my-app/web",
  hxml: {
    allowedRoots: ["/workspace/my-app"],
  },
  publicOutputFile: "src-gen/index.tsx",
  stateDirectory: ".genes/dev",

  resolveInvocation: async ({ signal }) => ({
    // Use the native Haxe executable selected by your package manager. The
    // later `genes watch` CLI owns this discovery for ordinary projects.
    executable: "/absolute/path/to/haxe",
    cwd: "/workspace/my-app",
    args: ["build.hxml"],
    ioPolicy: "haxe-4.3.7-development-js-v1",
    compatibilityFacts: { haxe: "4.3.7", genes: "reviewed-commit" },
  }),

  validate: async (tree, { signal, recovery }) => {
    // Run the application's real policy against `tree.physicalRoot`, while
    // presenting every file at its eventual `logicalPath`. A TypeScript host
    // usually does this with a CompilerHost overlay rather than copying files.
    return await validateCandidate(tree, { signal, recovery });
  },
  validatorPolicyFacts: { typescript: "5.5.4", tsconfig: "strict" },
});

session.subscribe((record) => {
  // The same structured record can feed a friendly terminal, JSON-lines agent
  // mode, Vite adapter, Next.js host, Electron process, or mobile tool.
  report(record);
});

await session.start();
await session.firstAccepted; // safe point for starting a dependent dev server

// A top-level host owns SIGINT/SIGTERM and eventually calls:
await session.close();
```

### Keep an existing generated app during the first session build

A host can move an existing project to `DevelopmentSession` without deleting
its last working generated files. The old host must provide exact evidence
from its own trusted ownership record:

```ts
const session = createGenesDevelopmentSession<Diagnostic>({
  // ...the normal options above...
  existingGeneration: {
    import: {
      // Every compiler-created file named by the old host record. This proves
      // that a person did not edit the generated implementation before the
      // first handoff.
      genesFiles: oldManifest.genesFiles.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mode: file.mode,
      })),

      // Other generated files that belong to the same accepted app, such as
      // framework entry files. Derive these facts from the old host manifest.
      supplementalFiles: oldManifest.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mode: file.mode,
      })),
    },
  },
});
```

Genes reads its own output manifest, while the old host supplies exact facts
for each compiler-created file. The host does not need to know the Genes
manifest's private format. Genes also checks every extra file named by the
host. It does not scan a directory and guess which files are generated. The
host's normal validator must accept the complete live tree. Genes then writes
only its small acceptance record; it does not rewrite the generated application
during the handoff.

`firstAccepted` resolves with `compilerMode: "external"` after this check.
The session then starts a normal build. If that first build fails, the session
enters `degraded` state and keeps the imported app available. A later good
build replaces it through the usual safe publication step.

After the first handoff, later starts can use `existingGeneration: {}`. This
tells Genes to check and reuse the generation already recorded by the session.
Omit `existingGeneration` when a fresh session build must be the only accepted
starting point.

The import fails before it changes any public file when a digest, byte count,
file mode, path, symbolic-link check, or validator result differs. This strict
check prevents an old ownership record from claiming a user-edited file.

This shortest example is library-free. If `build.hxml` contains one distinct
`-lib` request, the host can supply `hxml.resolveLibrary`. If it contains two
or more distinct libraries, use `hxml.resolveLibraries`. Haxe resolves adjacent
libraries as one ordered group, so the second callback receives the complete
group and can preserve that order.

A resolver decides which library files the compiler may trust. It returns the
exact ordered arguments that `haxelib path` contributes and the files that
prove the result. A resolver that discovers an external package folder can
also return that exact folder in `allowedRoots`. The inventory checks the new
root before it accepts any file from it. Empty
`arguments` and `provenanceFiles` arrays mean that the library contributes
nothing. A missing resolver is rejected before Haxe starts. Both callbacks
receive the same frozen environment lookup used for HXML expansion.

Library sources and proof files can be outside `projectRoot`. The host must add
each trusted folder to `hxml.allowedRoots`. The session watches those inputs.
It also uses them when it decides whether a warm compiler can be reused. It
rejects undeclared or linked paths before compilation. Events keep project
paths unchanged. An external path is
reported as `@external/<root-index>` for the root itself. A file below it uses
`@external/<root-index>/<path>`. Machine-local folders do not enter logs or
host messages. The first project path segment `@external` is
reserved for these private event names. A project input or public output must
use a different first segment.

The application validator never receives a half-generated tree. Genes first
finishes its own compiler transaction inside a private candidate directory.
The session then reads the compiler's v2 ownership manifest, asks the host to
validate exactly those files, rejects work known to be superseded, and uses the
existing recoverable artifact publisher to commit the admitted generation.

If validation fails after an earlier success, `state.kind` becomes
`"degraded"` and the prior accepted tree stays public. On a first failure it is
`"blocked"`; the watcher remains alive so a later edit can recover without
restarting the command.

### Files that must exist before Haxe checks the program

Some hosts create exact Haxe input from another tool. A CSS Modules host, for
example, asks its real CSS processor for the exported class names and creates a
closed Haxe companion before Haxe can check `styles.card`.

Use `prepareRevision` for that case. Return the exact bytes instead of writing
into the session's private directories yourself:

```ts
prepareRevision: async ({ signal }) => {
  const companion = await makeClosedCompanion({ signal });
  return {
    ok: true,
    prepared: {
      classPaths: ["generated-haxe"],
      files: [{
        relativePath: "generated-haxe/app/CardStyles.hx",
        content: companion.haxe,
        publishPath: "generated-haxe/app/CardStyles.hx",
      }],
    },
  };
},
```

Tooling writes those bytes into the private candidate, includes their digest in
that Haxe request, and keeps the same compatible Haxe server alive. A changed
companion therefore cannot be mistaken for an older cached type.

`publishPath` is optional. When present, that file joins the same final update
as the Genes output. A generated Haxe source that should remain navigable after
publication should normally use the same `relativePath` and `publishPath`, as
shown above. That gives source maps a stable public path instead of a temporary
build path.

The validator sees these future public files in `tree.extraFiles`. It may
return small evidence files in `artifacts` after its checks pass:

```ts
validate: async (tree, context) => {
  const receipt = await checkWithRealLoader(tree, context);
  return {
    ok: true,
    artifacts: [{
      path: "generated-haxe/css-loader-agreement.json",
      content: receipt,
    }],
  };
},
```

Prepared files, validator evidence, declarations, maps, and generated JS/TS are
then published or rolled back together. A rejected edit leaves the earlier
accepted set unchanged. The host still decides how to parse CSS, which loader
is authoritative, and how its live development server handles an invalid
authored stylesheet.

### Data that a Haxe macro returns to the host

Sometimes Haxe discovers a small data value while it checks the program. For
example, a macro can create a route list or an asset list from typed Haxe
declarations. The host needs those bytes before it decides whether to publish
the complete generation.

Use `compilerData` for this direction of data flow:

```text
Haxe macro -> private named value -> host validation -> optional public file
```

This direction differs from `prepareRevision`. Preparation sends host-created
Haxe input into the compiler. Compiler data sends macro-created bytes back to
the host after Haxe finishes.

First, the host declares every required value and its maximum size:

```ts
const session = createGenesDevelopmentSession<Diagnostic>({
  // The other session options stay the same.
  compilerData: [{ id: "build.note", maxBytes: 1024 }],

  validate: async (tree) => {
    const note = tree.compilerData.find((file) => file.id === "build.note");
    if (note === undefined) {
      return {
        ok: false,
        diagnostic: {
          code: "BUILD_NOTE_MISSING",
          message: "Haxe did not create the required build note",
        },
      };
    }

    console.log(note.digest, note.sizeBytes);
    return {
      ok: true,
      artifacts: [{
        path: "build-note.json",
        content: note.readBytes(),
      }],
    };
  },
  validatorPolicyFacts: { buildNote: 1 },
});
```

Then a Haxe macro writes the declared value:

```haxe
package app.build;

import genes.tooling.CompilerData.writeUtf8;
import haxe.macro.Expr;

/** Records one small fact that the host checks with the generated program. */
macro function recordBuildNote():Expr {
  writeUtf8("build.note", '{"checked":true}\n');
  return macro null;
}
```

The macro receives no public path. The session gives it one private slot for
`build.note`. Haxe rejects an unknown ID, a second write, or a value that is
too large.

The validator receives the exact SHA-256 digest (content checksum) and size.
`readBytes()` returns a new copy during that validation call. The method stops
working after validation returns. Thus, a later build cannot read stale bytes.

Compiler data stays private by default. The example publishes
`build-note.json` only because the validator returns it as an approved output
file through `AdmissionResult.artifacts`. Tooling publishes that file with the
Genes output in one complete update.

If the process stops before the public update is committed, the next session
rolls it back and does a new Haxe build. It does not replay validation with
missing private data. If the public update is already committed, restart keeps
those complete public files and only removes leftover private control files.

The first contract accepts at most 64 values. Each value can be at most 8 MiB,
and their declared total can be at most 16 MiB. IDs use lowercase letters,
numbers, `.`, `_`, or `-` and do not contain file paths.

This API does not sandbox Haxe macros. Macros remain trusted compile-time code.
The session checks only the declared private files that cross into validation.

Current accepted-generation records remember whether each extra file came from
`prepareRevision` or from validation. During restart recovery, every saved
validator file must be returned again with the same path, bytes, size, and file
mode. Omitting an earlier receipt rejects recovery instead of silently keeping
stale evidence.

Older records remain readable. Version 2 did not list extra files. Version 3
listed them but did not say whether preparation or validation created each
one. Version 4 adds that missing source. Recovery keeps the rules that the
saved format could actually prove: version 4 checks every saved validator file;
version 3 checks any saved file that validation returns; version 2 ignores new
validator output until the next normal build. The next accepted build writes a
version 4 record and restores the stricter rule.

When preparation rejects a revision, the session reports
`PREPARATION_REJECTED`. Its `details` field contains the exact host diagnostic
after Genes removes private project and candidate paths. Validation rejections
use the same shape with `VALIDATION_REJECTED`. This keeps one stable session
error code while preserving the host-specific reason for display.

Only one development session can own a project root at a time. This rule also
applies when the main output folders differ. The shared lock prevents two
sessions from claiming the same `publishPath` or validator artifact. A host
that needs several output graphs must coordinate them through one development
session. Startup also looks for unfinished updates belonging to another output
folder. If it finds one, it stops before changing files and asks the host to
restart that original output first. After the original update is recovered or
rolled back, the other output can start normally.

### Rules a host should not have to rediscover

- `publicOutputFile` and `stateDirectory` are project-contained, non-overlapping
  scopes. Private candidates and the owned Haxe-server lease live below
  `stateDirectory`. The publication journal and accepted marker instead live
  in a stable, public-root-scoped control directory, so changing the private
  state directory after a crash cannot hide unfinished recovery. One public
  root has one persistent entry owner in v1: `src-gen/index.ts` and
  `src-gen/other.ts` cannot create separate lock and recovery universes for
  files they may both publish below `src-gen`. The owner record is written as a
  complete private file and then moved into place in one step, so a stopped
  process cannot expose a half-written new record. A leftover private file is
  safe to remove on restart. A damaged final owner still fails closed.
  Projects created by the older entry-scoped session are upgraded before a new
  build starts. The session first recovers the older journal, records the exact
  state being upgraded, replaces the old marker with a stop record that makes
  older writers fail safely, establishes the root owner, and finally writes the
  equivalent root-scoped marker. Each step uses the normal recoverable artifact
  publisher, so a stopped process can resume without changing the last-good
  generated tree. The migration receipt remains historical evidence after
  later v2 generations replace the translated marker.

  This upgrade is one-way. The permanent stop record, called the migration
  fence, makes the released v1 client fail for the migrated entry. The
  supported package or supervisor must not start v1 tooling after migration.
  A manually launched v1 client can select a different entry and calculate a
  different old lock path. V1 does not know the root-scoped protocol, so v2
  cannot force that unsupported client to read the new lock. Do not downgrade
  the tooling package or change the entry while an old client is running.
  Public output may never contain
  or be contained by `.genes/tooling`; output at the project root is therefore
  unsupported.
  Prepared public files and validator receipts also may not use any path below
  `.genes/tooling`. That whole directory is reserved for every session's locks
  and recovery records, not only the current output's records.

  A version 2 accepted marker names the root-owned Genes output tree. Version 3
  also names each prepared or validator-produced file, but cannot distinguish
  which step created it. Version 4 records that source. Restart recovery reads
  all three formats and rebuilds the matching authorization value, so an
  upgrade does not reject valid earlier work merely because a newer format
  learned more. On startup and after an HXML change, the session also checks
  saved paths against the current authored inputs. If a path has become
  authored source, startup or rebuilding stops and leaves the file untouched
  instead of deleting it as old generated output.
- The declared HXML inputs, including resolved library arguments, provenance,
  and class paths, must be inside an explicit `hxml.allowedRoots` folder. They
  must not overlap private state, publication control, or generated output.
  Project inputs keep project-relative event paths. External inputs use the
  root name `@external/<root-index>`. A child adds its path after that name.
  Entry and occurrence order are retained. A linked entry, class path, or
  library proof fails before compilation.
- Authored HXML is deliberately targetless. The session appends exactly one
  private ordinary Haxe `--js` target and one private
  `-D genes.output=<entry>` target. This matters when Genes is missing or
  fails to activate: ordinary Haxe may still generate JavaScript, but those
  bytes remain disposable and cannot touch public output before admission.
  The versioned Haxe 4.3.7 policy classifies every compiler option spelling and
  rejects every authored target selector,
  `--no-output`, display/prompt modes, compiler dump/message-log file outputs,
  caller-provided `--connect`, server-listen, `genes.output`,
  `genes.tooling.prepared`, `genes.tooling.compiler-data`, `--next`, and
  `--each` flags because two lifecycle owners or several output compilations
  would be ambiguous. When
  `prepareRevision` is used, the session owns
  `-D genes.tooling.prepared=<exact digest>` so a warm compiler cannot reuse an
  older generated input. When `compilerData` is used, the session owns the
  request-local private request file. These private defines may not appear in
  the HXML graph. It also rejects `--cmd`, `--run`,
  `--interp`, and `-x`: these options can run a shell command or the compiled
  program inside Haxe, before the host has checked and accepted the candidate.
  It rejects `--xml`, `-xml`, and `--json` too because they write extra files outside
  the private candidate and safe publication plan.
  The host must run any needed follow-up step explicitly after an accepted
  generation. The same check visits entry and nested HXML files and the exact
  argument stream returned for every library. Haxe executes the flattened
  stream, so it never reruns `haxelib path` after the final plan check. If the
  same HXML file is included twice without a cycle, its arguments appear twice
  just as they do in a direct Haxe command. A recursive include fails with a
  clear input error instead of being silently shortened. Haxe preserves
  repeated library names in its ordered group. The compatibility
  `resolveLibrary` callback instead reuses the first result for its one allowed
  identity. The usual `--option=value` spelling is accepted for ordinary
  one-value options
  and checked as the same option and value as `--option value`. Haxe
  handles a small set of options before its normal option table, so the two
  spellings are not always equivalent. For example, `--run Main` runs `Main`,
  while `--run=Main` is rejected by Haxe. DevelopmentSession rejects inline
  spellings for that reviewed set instead of changing the author's input into
  a command with different behavior. Library options are in that set too:
  Haxe 4.3.7 ignores `--library=sample` rather than resolving the library.
  The closed set is `-C`, `--cwd`, `--connect`, `--server-connect`,
  `--server-listen`, `--wait`, `--run`, `-L`, `--library`, `-lib`, `--jvm`,
  `--java`, `-java`, `--cs`, `-cs`, and `--display`. A later Haxe version
  requires a new reviewed table.
  The older `resolveLibrary` callback accepts one distinct library identity
  only. Repeats are resolved once. Use `resolveLibraries` for two or more
  distinct libraries. It receives each adjacent ordered group exactly as Haxe
  4.3.7 sends that group to `haxelib path`. A normal option between two library
  requests starts a new group.
  After recursive flattening, no authored or resolved standalone token ending
  in `.hxml` may reach Haxe. A separate library name is safe because its
  reviewed resolver replaces it; the resolver's resulting arguments must still
  pass the same check. An ordinary inline value may itself end in `.hxml`, for
  example `--define=config=build.hxml`. The session places the checked option
  in a tiny private HXML file and replaces only its value with a private
  environment placeholder. Haxe decides that the placeholder is ordinary data
  before expanding it back to `config=build.hxml`. The session removes the
  private file before publication. This extra step matters because Haxe 4.3.7
  otherwise tries to open any argument ending in `.hxml` as another build
  file, even when that argument is an option's value. The
  standalone `inventoryHxml()` helper cannot safely create that private file,
  so it rejects this one form and returns only arguments a caller may pass
  directly to Haxe.
  Authored environment expansion is rejected where it would change Haxe's
  high-level staging decision, including an HXML filename or library request.
  Every expanded option value is also checked for line breaks and NUL bytes
  before it can become part of the compiler request.
  DevelopmentSession v1 rejects authored `-C`/`--cwd` and resource options
  until their Haxe lookup semantics have a separate reviewed policy.
  A discovered `-lib` with no resolver makes startup fail before compilation.
- `resolveInvocation` is copied whenever the session seals or rechecks the
  effective plan for a revision. Its ordered HXML entries, working directory,
  and environment are the only authority for HXML interpretation and Haxe
  execution; `hxml` configuration cannot supply competing values. Optional
  `env` values override the current Node process environment. The session then
  copies that complete effective environment, expands Haxe's `%NAME%` form,
  includes it in the
  compiler-server identity,
  and passes those same values to Haxe. Changing `PATH`, `HAXELIB_PATH`,
  `HAXE_STD_PATH`, or another ambient value therefore cannot silently reuse a
  server started with older settings. Mutating a retained host array or object
  later cannot change the command. The combined UTF-8 environment names and
  values must not exceed 64 KiB. This limit bounds the trusted handoff before
  it retains or parses target credentials.
- The host invocation contains only ordered top-level HXML files. Put build flags
  inside those HXML files; extra command-line flags are rejected because
  otherwise Haxe could compile files that the development loop did not know to
  watch.
- This is compiler-output and declarative-input authority, not a hostile-code
  sandbox. Haxe macros are compile-time programs and may use filesystem or
  process APIs. DevelopmentSession v1 therefore trusts the selected Haxe
  compiler, standard library, resolved libraries, and project macro code.
  Macro-owned external inputs must be declared as host `extraInputs` when they
  affect rebuild correctness. Preventing arbitrary macros from reading or
  writing outside an operating-system sandbox is a separate architecture.
- An extra input watches one exact path by default. Set `kind: "tree"` when a
  whole directory affects generation. A tree observes edits, additions, and
  removals below that directory. It rejects symbolic links rather than hiding
  files that Haxe or a macro could still read:

  ```ts
  extraInputs: [{
    kind: "tree",
    path: "schema",
    impact: { rebuild: true, restartCompiler: true },
  }]
  ```

  The tree form intentionally has no glob language. Declare a narrower root
  when only one subtree belongs to the build.
- `resolveInvocation().executable` is an absolute native Haxe compiler binary
  that supports `--server-listen` and `--connect`, not a shell command string.
  On POSIX, tooling starts a trusted Node handoff with no inherited environment,
  transfers the bounded Haxe environment over a private input pipe, and
  replaces that same child with Haxe through raw `execve`. A private control
  socket closes during successful replacement, including for a long-lived
  compiler server. A failed replacement reports a bounded error through the
  same socket. An `ENOEXEC` failure is never reinterpreted as a shell script.
  On Windows, tooling starts the canonical `.exe` directly with structured
  arguments and `shell: false`.
- Only files named by the exact compiler ownership manifest can become owned
  or stale. An unrelated file beside generated output is preserved. If a new
  generated path is already occupied by an unowned file, publication fails
  and preserves that file instead of silently adopting it.
- The outer accepted-generation marker records the admitted inventory. Its
  exact bytes and mode are remembered, and the inventory also includes the
  compiler ownership manifest's exact bytes and mode. If an owned generated
  file, manifest, or marker changes outside the session, the next publication
  fails closed instead of silently overwriting the drift. Change Haxe source
  and let the session regenerate it.
- A deterministic project/output-scoped session lock rejects a second live
  writer even when the two callers choose different private state directories.
  The scope uses the same NFC-normalized, case-folded identity as artifact
  publication, so portable aliases such as `src-gen` and `SRC-GEN` cannot
  create separate locks, journals, or accepted markers. Non-NFC paths remain
  invalid portable paths and fail before authority is created. Caller-selected
  private state may not contain or equal `.genes/tooling`, which owns those
  stable locks and recovery records. A case-only spelling difference is
  accepted only when both exact output roots and both exact entry files exist.
  Each path must name a normal object, and both spellings must resolve to the
  same object. A symbolic link never counts as that proof. If a crash leaves
  the entry temporarily absent, restart with the original spelling.
  Haxe server leases and artifact locks are also exact; tooling never adopts
  or kills an unowned process.
- HXML graph replacement is registration-gap safe: tooling confirms the
  inventory after the new watcher exists and rotates the owned compiler when
  compilation identity changes.
- A source class path may not contain symbolic links. Haxe can follow such a
  link, but a safe watcher deliberately does not; rejecting the link prevents
  an outside source change from being missed. The final class-path directory
  may be absent when the session starts. The watcher keeps that checked path so
  creating the directory can trigger a later build. Before every later scan,
  the watcher checks the path again. If a missing parent has become a symbolic
  link, the scan stops instead of reading through it. The same check uses the
  link itself rather than its missing target, so a broken symbolic link is
  rejected instead of being mistaken for a directory that has not been
  created yet.
- `acquirePublishedRead()` protects one generated-file read from overlapping
  physical publication. Framework adapters emit no update until the accepted
  event exists.
- `resolveInvocation`, `validate`, and HXML library resolution receive an
  `AbortSignal`. The HXML inventory races even an uncooperative resolver
  promise against closure, while host callbacks should still stop promptly to
  avoid wasting work.

Here is why nested output flags fail before Haxe runs:

```hxml
# build.hxml
child.hxml
```

```hxml
# child.hxml -- rejected by DevelopmentSession
-D genes.output=src-gen/index.ts
--next
another-build.hxml
```

One session owns one HXML entry closure and one public output contract. The
private output define is appended only after that entire effective closure has
been checked. Multi-compilation HXML remains available to ordinary one-shot
Haxe commands; it is deliberately outside DevelopmentSession v1.

For agents and deterministic tests, subscribe first, call `inspect()` second,
keep only buffered events whose sequence is newer than the snapshot, and use
`firstAccepted`/`waitForIdle()` instead of a guessed delay. Never edit
`src-gen` to repair a failed build; the public tree is the session's last-good
record.

## Availability without npm publication

The package is currently developed and tested inside the Genes repository; it
has not been published to npm. npm publication remains intentionally deferred.
Instead, stable consumers can install an immutable, prebuilt archive from the
Genes GitHub Releases page. This keeps npm out of the current distribution
path while still giving hosts exact, checksum-verified package bytes.

The session runtime is implemented and exercised by its released behavior
examples plus a real cold/warm Haxe integration fixture. Version `0.5.0` gives
one-shot hosts the exact compiler-owned output inventory and a guard against
unowned neighboring files. It also lets a host move an existing generated
application into the shared session without rewriting checked files and watch
a complete extra input directory, including empty folders and later additions
or removals. Symbolic links fail so they cannot hide input from the watcher.
Do not use the archive URL until the `tooling-v0.5.0` GitHub Release exists.
Verify its checksum and receipt before use.

Version `0.2.0` added the compiler-data bridge described above. Compiler data
needs Genes `1.50.0` or later. That compiler release contains the Haxe helper
that writes the private named value. The tooling archive contains the host code
that reads and checks it. Pin both versions because neither package replaces
the other.

### Guidance for agents in consuming repositories

An `AGENTS.md` inside Genes or this npm package does not automatically govern a
different repository. Agent instructions follow the consuming file's parent
directories; they do not follow npm, Lix, or Git dependency edges.

The tooling package therefore ships the explicit, non-destructive
`genes agents install` and `genes agents check` flow documented above. It
creates the file when missing or replaces only its own marked block, preserves
project-authored instructions, fails closed on malformed or duplicate markers,
and never modifies a checkout from npm `postinstall`. Frameworks may add
narrower scoped guidance below the root, but that does not replace the generic
Genes lifecycle rules.

Repository development uses:

```bash
yarn --cwd tooling build
yarn --cwd tooling test
yarn test:tooling-package
```

`yarn test:tooling-package` builds a deterministic tarball, installs it into a
clean temporary project, type-checks every code subpath, imports every runtime
and conformance-data subpath, and verifies the reviewed file inventory.

The required Genes CI repeats the packed-consumer check on Node 26.1.0, which
is the package's oldest supported Node release. The runtime fixture loads JSON
exports through Node's `createRequire` API, while the strict TypeScript
consumer checks the modern static-import form. Both paths resolve the same
public package exports.

Install an exact reviewed GitHub commit from another Node project with npm
11.18.0:

```json
{
  "dependencies": {
    "@genes-ts/tooling": "github:fullofcaffeine/genes-ts#0123456789abcdef0123456789abcdef01234567::path:tooling"
  }
}
```

Replace the illustrative SHA with a full 40-character commit. The
`::path:tooling` selector is essential because the Git repository's root
package is Genes itself. npm installs the tooling subdirectory's pinned
build-only dependencies and runs its `prepare` script, producing `dist/`
without requiring generated JavaScript to be committed. Only use a Git source
dependency from a commit you trust: installation executes that commit's
package build.

The repository verifies this path with npm 11.18.0. npm 10.9.4 parses the
subdirectory attribute but installs the repository root instead, so it is not
a supported Git-install client. Environments that use npm 10 or prohibit
dependency build scripts should use a prebuilt tarball:

```bash
# In the Genes checkout:
yarn --cwd tooling build
TARBALL="$(cd tooling && npm pack --silent)"

# In the consuming Node project:
npm install "/absolute/path/to/genes/tooling/$TARBALL"
```

Use a 40-character Git commit when recording which source produced a tarball.
A plain dependency without `::path:tooling` is **not** equivalent: it selects
the repository-root package.

For npm 10 and other consumers that need a prebuilt package, Genes can publish
the same reviewed `.tgz` through a separate immutable `tooling-vX.Y.Z` GitHub
Release. npm installs that URL normally even though the package is not on the
npm registry:

```json
{
  "dependencies": {
    "@genes-ts/tooling": "https://github.com/fullofcaffeine/genes-ts/releases/download/tooling-v0.5.0/genes-ts-tooling-0.5.0.tgz"
  }
}
```

Use this exact example only after the named Release exists. Check its published
`.sha256` file and `release-receipt.json` before pinning it in a lockfile. The
manual release workflow reruns the complete Genes tests, proves two package
builds have identical bytes, checks a clean npm 10 consumer, and publishes no
npm or Haxelib package. It also checks the receipt against the archive's real
bytes and file list, and it keeps this tooling-only archive from replacing the
compiler as GitHub's “Latest” release. See the release guide for the complete
safety and recovery rules.

The tooling package has independent version metadata so a future distribution
does not create a compiler/Haxelib release. The dormant, explicitly authorized
release contract is documented in
[`docs/RELEASING.md`](https://github.com/fullofcaffeine/genes-ts/blob/main/docs/RELEASING.md).

## How the lower-level pieces compose

This sketch is for tooling maintainers who intentionally need the individual
primitives. Application hosts should prefer the session example above. It is
not a complete framework CLI. Names
such as `startHaxeWait`, `compileConnected`, `authorizePublication`, and
`validateGeneratedTree` are deliberately host-owned:

```ts
import {
  OwnedHaxeWaitServer,
  SerializedDirtyLoop,
  inventoryHxml,
  publishArtifacts,
  recoverArtifacts,
  watchReconciledInputs,
  type PublicationPlan,
} from "@genes-ts/tooling";

type Cause = "source" | "identity";

const mergeCause = (left: Cause, right: Cause): Cause =>
  left === "identity" || right === "identity" ? "identity" : "source";

const inventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot],
  environment: readConfiguredEnvironment,
  resolveLibrary: (request) => ({
    arguments: resolveExactHaxelibArguments(request),
    provenanceFiles: resolveHaxelibProvenance(request),
  }),
});

// Recovery runs before a new build. The host validates the complete state
// recorded by the durable journal; the tooling library never guesses.
await recoverArtifacts({
  projectRoot,
  transactionRoot: ".my-host/transactions",
  projectIdentity,
  admitPlan: (journaledPlan) =>
    savedPathsStillBelongToGeneratedOutput(journaledPlan, inventory),
  admitIntended: validateGeneratedTree,
});

const haxe = new OwnedHaxeWaitServer<CompileResult>({
  projectRoot,
  leasePath: ".my-host/runtime/haxe-server.json",
  projectIdentity,
  ownerPid: process.pid,
  isProcessAlive,
  start: startHaxeWait,
  probe: probeHaxeWait,
  compileConnected,
  compileDirect,
  onEvent: reportCompilerLifecycle,
});

const rebuilds = new SerializedDirtyLoop<Cause>({
  debounceMs: 100,
  merge: mergeCause,
  run: async (cause) => {
    const compatibilityDigest = await computeCompatibilityDigest({
      cause,
      inventory,
    });
    await haxe.ensure(compatibilityDigest);
    const result = await haxe.compile(compatibilityDigest);

    const plan: PublicationPlan = await authorizePublication(result);
    await publishArtifacts({
      projectRoot,
      plan,
      admitIntended: validateGeneratedTree,
    });
  },
  onError: reportBuildFailure,
});

const watched = watchReconciledInputs<Cause>({
  inputs: [
    ...inventory.hxmlFiles.map((path) => ({
      kind: "exact" as const,
      path,
      cause: "identity" as const,
    })),
    ...inventory.classPaths.map((path) => ({
      kind: "tree" as const,
      path,
      cause: "source" as const,
      include: (relative: string) => relative.endsWith(".hx"),
    })),
  ],
  merge: mergeCause,
  onChange: ({ cause }) => rebuilds.request(cause),
  onError: reportWatchFailure,
});

// A real host performs this in signal/finally cleanup.
watched.close();
await rebuilds.close();
await haxe.close();
```

The key boundary is authorization: the tooling library provides mechanisms,
while the host decides what a change means, whether generated output is valid,
and which exact files may become public.

## Artifact transactions

`@genes-ts/tooling/artifacts` is a durable publisher for an already-authorized
exact set of generated-file transitions. It does not decide ownership,
validation, adoption, “last good” behavior, or user-facing diagnostics. Those
remain host policy.

The versioned protocol and conformance corpus live in
[`artifact-transactions/v1`](artifact-transactions/v1/README.md).

`publishArtifacts` receives a closed `PublicationPlan`. Each transition states
the exact bytes, size, and Unix mode expected before and after publication.
Changed files already exist under the private `stageRoot`; the publisher does
not generate or validate application code.

```ts
import {
  publishArtifacts,
  type PublicationPlan,
} from "@genes-ts/tooling/artifacts";

const plan: PublicationPlan = authorizeGeneration();
const outcome = await publishArtifacts({
  projectRoot: "/real/project/root",
  plan,
  admitIntended: async (intendedPlan) =>
    validateLiveGeneratedProject(intendedPlan),
});
```

Before changing a live file, the publisher checks every live and staged state,
takes a project-scoped lock, and writes a canonical durable journal. It moves
the plan's opaque `commitMarker` last, then offers the exact intended live state
to the optional host-owned `admitIntended` callback before committing. It reads
every live file again after that callback, so an outside edit cannot be recorded
as accepted. A rejection, caught filesystem error, or validator error rolls
back immediately without overwriting outside bytes.
If the process exits, a later process calls
`recoverArtifacts`:

```ts
import { recoverArtifacts } from "@genes-ts/tooling/artifacts";

const outcome = await recoverArtifacts({
  projectRoot: "/real/project/root",
  transactionRoot: ".my-host/transactions",
  projectIdentity,
  admitPlan: (journaledPlan) =>
    savedPathsStillBelongToGeneratedOutput(journaledPlan),
  admitIntended: async (journaledPlan) =>
    validateCompleteIntendedGeneration(journaledPlan),
});
```

After it validates the journal and any owner file, recovery calls the optional
`admitPlan` check before restoring, removing, or replacing any public file. A
host uses this to catch policy changes made while the process was stopped, such
as a formerly generated path becoming authored source. The callback receives a
deeply read-only saved plan, so host code cannot accidentally alter
the list that recovery will apply. Returning false leaves the journal and every
public file untouched. If the saved plan is still allowed, recovery finalizes
only when every live file matches the journaled intended state and the host
admits that exact result. Otherwise it restores the exact prior state.
Ambiguous bytes, paths, links, locks, journals, or backups produce an
`ArtifactTransactionError` with a structured framework-neutral `failure.kind`
and `failure.subject`; recovery never guesses.

The host remains responsible for:

- deciding which paths it owns and authorizing the exact transition;
- generating and validating all staged files;
- defining its manifest, adoption, release, and “last good” behavior;
- mapping structured failures to its own diagnostics and recovery commands.

## HXML inventory

`inventoryHxml` resolves the Haxe inputs that are stated by one or more HXML
entry files. It mirrors Haxe 4.3.7 whole-line HXML quoting, full-line comments,
one-space option splitting, and `%NAME%` environment expansion. It understands
nested HXML, class paths, libraries, and defines. The host supplies allowed
roots plus environment and library resolvers. V1 rejects `-C`/`--cwd` and
resource options rather than approximating their process-wide and class-path
lookup semantics.

Both familiar long options and Haxe's documented short forms are classified.
The supported input forms are `--class-path`/`-cp`/`-p` and
`--library`/`-lib`/`-L`.

```ts
import { inventoryHxml } from "@genes-ts/tooling/hxml";

const inventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot, haxeLibraryCache],
  environment: (name) => configuredEnvironment.get(name) ?? null,
  resolveLibraries: (requests) => ({
    arguments: resolveExactHaxelibArguments(requests),
    provenanceFiles: resolveHaxelibProvenance(requests),
    allowedRoots: resolveExactPackageRoots(requests),
  }),
});
```

`resolveLibraries` receives each adjacent group in authored order. This matches
Haxe 4.3.7, which asks `haxelib path` to resolve the complete group. Use the
older `resolveLibrary` callback only when the project has one distinct library.
Do not supply both callbacks. A resolver can return exact `allowedRoots` when
it discovers package folders. The inventory checks and adds those roots before
it checks the returned class paths and proof files.

The result is a deterministic inventory of unique HXML files, occurrences,
library provenance, class paths, library requests, and the exact flattened
argument stream. It also returns the canonical `allowedRoots` that authorized
those inputs. `libraryClosureComplete` distinguishes an authoritative
empty library expansion from request-only inventory performed without a
resolver. It contains no framework config files or watch policy.
Missing values, unsafe paths, links, malformed syntax, resolver failures, and
budgets fail through `HxmlInventoryError`.

Long-lived hosts may pass an `AbortSignal`; library resolvers receive the same
signal and environment lookup, and inventory stops waiting even when a resolver
ignores it. The optional `argumentPolicy` asks this existing traversal to reject
selected options or defines throughout the complete nested closure.
DevelopmentSession requires `libraryClosureComplete`, then uses that same
traversal for its
one-compilation/private-output contract rather than maintaining a second HXML
parser. The lower-level API still permits request-only inventory for hosts that
only need to list library requests.

### Resolve scoped Lix libraries

Use `@genes-ts/tooling/lix` when the project uses Lix scope files in
`haxe_libraries/`. The helper runs one exact `haxelib path` command for each
ordered library group. It does not use a shell, install packages, or choose a
version.

```ts
import { createRequire } from "node:module";
import path from "node:path";
import { inventoryHxml } from "@genes-ts/tooling/hxml";
import { resolveLixLibraryGroup } from "@genes-ts/tooling/lix";

const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
const lixHaxelib = requireFromProject.resolve("lix/bin/haxelibshim.js");

const inventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot],
  resolveLibraries: (requests, { signal }) =>
    resolveLixLibraryGroup({
      projectRoot,
      requests,
      command: {
        executable: process.execPath,
        argsPrefix: [lixHaxelib],
      },
      signal,
    }),
});
```

The example starts the Lix JavaScript entry point with Node. This command works
on Windows and Unix systems. It also keeps `shell: false`, so no shell parses
the library names or paths.

The resolver returns three facts:

- `arguments` is the exact ordered argument list that Haxe receives.
- `provenanceFiles` contains the Lix scope files and package manifests that
  prove where the answer came from.
- `allowedRoots` contains only the package folders found by that answer.

HXML inventory checks those folders before it accepts a class path or proof
file. This lets a host trust the selected packages without trusting the whole
Lix cache.

The host must still record the installed Lix version in its compiler identity.
It must also watch the package lock or other file that selects that version.
The resolver treats every current `haxe_libraries/*.hxml` file as proof because
one scope file can refer to another library. A scope change causes a new
resolution; a changed package folder becomes a new checked root.

The helper accepts the ordinary line-based output from `haxelib path`. A bare
path becomes a checked, full `-cp <path>` pair. Relative paths use the project
folder, which supports a library developed in that same project. A bare
`.hxml` path stays an HXML input. The HXML reader checks that file and replaces
it with its checked arguments before Haxe starts. Inline class paths, such as
`--class-path=src`, receive the same checks. HXML quotes around a path are
removed before the filesystem check. This supports package folders with
spaces without treating the quotes as part of the folder name.

The resolver ignores normal spaces at the start or end of each output line,
as Haxe does for HXML input. An option and its value can be on one line or on
two lines. Both forms keep the same ordered Haxe arguments.

The one spelling change is `-L <path>` from `haxelib path`. Haxe 4.3.7 changes
that option to `--neko-lib-path <path>`, so the resolver makes the same change.
The managed development session accepts this checked path. It does not permit
an application to select a different output target or run a command.

The resolver waits until the command closes its output pipes. This rule keeps
output from a child process complete, even when a process exits before its last
output bytes arrive. It also rejects a linked package folder or a link inside a
returned package path. The later HXML check still rejects commands, alternate
output targets, and other arguments that a managed development session must
not run.
Invalid paths, links, command failures, cancellation, timeouts, oversized
output, and invalid text fail with a `LixLibraryResolverError` and a stable
`code`. An unreadable scope folder, or a proof file that becomes unreadable or
disappears, also returns this stable error. It does not leak a raw filesystem
error to the host.

## Reconciled watching

Native filesystem notifications can be coalesced or lost. A generated-code
host must therefore treat them as a latency hint, not as the record of truth.
`watchReconciledInputs` combines nonrecursive native subscriptions with a
deterministic polling snapshot:

```ts
import { watchReconciledInputs } from "@genes-ts/tooling/watch";

const session = watchReconciledInputs({
  inputs: [
    { kind: "exact", path: hxmlFile, cause: "identity" },
    {
      kind: "tree",
      path: sourceRoot,
      cause: "source",
      include: (relative) => relative.endsWith(".hx"),
    },
  ],
  merge: (left, right) =>
    left === "identity" || right === "identity" ? "identity" : "source",
  onChange: schedule,
  onError: report,
});
```

The initial snapshot is taken before subscriptions; an immediate second
snapshot closes the registration gap. Polling independently detects edits,
new or removed inputs, and directory changes. Tree traversal never follows a
symbolic link. Causes and their merge rule belong to the caller.

## Serialized dirty runs

`SerializedDirtyLoop<Cause>` debounces bursts, permits at most one active run,
and guarantees one newest-state follow-up when requests arrive while that run
is active:

```ts
import { SerializedDirtyLoop } from "@genes-ts/tooling/loop";

const loop = new SerializedDirtyLoop({
  debounceMs: 100,
  merge: mergeHostCauses,
  run: rebuildNewestState,
  onError: report,
});
```

The loop does not define source-versus-identity changes, changed-path sets,
compiler commands, last-good output, services, or diagnostic wording. Those
are host policy.

## Owned Haxe wait server

`OwnedHaxeWaitServer` manages one project-local Haxe `--wait` process through
caller-provided start, probe, connected-compile, and direct-compile operations.
It reserves isolated loopback capacity, authenticates an exact project and
compatibility lease, reuses only its compatible owned process, falls back to
direct compilation when the cache is unavailable, and bounds shutdown through
`SIGTERM` followed by `SIGKILL`.

```ts
import { OwnedHaxeWaitServer } from "@genes-ts/tooling/haxe-server";

const server = new OwnedHaxeWaitServer({
  projectRoot,
  leasePath: ".host/runtime/haxe-server.json",
  projectIdentity,
  ownerPid: process.pid,
  isProcessAlive,
  start: startHaxeWait,
  probe: probeHaxeWait,
  compileConnected,
  compileDirect,
  onEvent: reportHostEvent,
});

await server.ensure(compatibilityDigest);
await server.compile(compatibilityDigest);
```

The host decides how Haxe is located, which inputs form the compatibility
digest, how compiler output is presented, and which non-Haxe services it owns.
The tooling runtime never adopts or stops a foreign process. It removes a
lease only when its project identity is trusted, both recorded processes are
provably stale, or its bytes still exactly match the lease written by this
instance. The host creates the real parent directory for `leasePath`.
