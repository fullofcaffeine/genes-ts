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
| `@genes-ts/tooling/hxml` | Resolves declared HXML inputs deterministically | Environment values, library resolution, and allowed roots |
| `@genes-ts/tooling/watch` | Reconciles fast native events with authoritative snapshots | Which paths matter and what kind of change each path means |
| `@genes-ts/tooling/loop` | Debounces bursts and prevents overlapping rebuilds | How change causes merge and what one rebuild performs |
| `@genes-ts/tooling/haxe-server` | Owns and safely reuses one compatible `haxe --wait` process | Haxe discovery, compiler arguments, diagnostics, and compatibility identity |
| `@genes-ts/tooling/artifacts` | Publishes an exact authorized file transition with crash recovery | Generation, validation, file ownership, and adoption policy |
| `@genes-ts/tooling/css-modules` | Checks processor-owned export manifests and generates closed Haxe companions plus exact per-file TypeScript declarations | CSS parsing, processor choice, framework placement, and runtime loader agreement |
| `@genes-ts/tooling/session` | Runs one admitted-generation lifecycle over the five primitives above | Haxe location/arguments, validation policy, framework lifecycle, diagnostics, and top-level signals |

The `@genes-ts/tooling/session` subpath exports
`createGenesDevelopmentSession`, the public `DevelopmentSession` v1 types, and
the protocol constants. `development-session/v1` publishes the matching JSON
event schema and conformance vectors.

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

This shortest example is library-free. If `build.hxml` contains a
project-contained development `-lib`, the host must also supply
`hxml.resolveLibrary`. The resolver is an authority boundary: it returns the
exact ordered Haxe arguments that `haxelib path` contributes and the files that
prove that resolution. Empty `arguments` and `provenanceFiles` arrays mean the
library genuinely contributes nothing. A missing resolver is
deliberately rejected before Haxe starts. The resolver receives the same frozen
environment lookup used for HXML expansion. DevelopmentSession v1 still
requires all returned provenance files and argument-owned inputs to stay under `projectRoot`,
preserving its project-relative watch and event contract; the lower-level
inventory API may use broader `allowedRoots` when a host owns a different path
model.

The application validator never receives a half-generated tree. Genes first
finishes its own compiler transaction inside a private candidate directory.
The session then reads the compiler's v2 ownership manifest, asks the host to
validate exactly those files, rejects work known to be superseded, and uses the
existing recoverable artifact publisher to commit the admitted generation.

If validation fails after an earlier success, `state.kind` becomes
`"degraded"` and the prior accepted tree stays public. On a first failure it is
`"blocked"`; the watcher remains alive so a later edit can recover without
restarting the command.

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
  process cannot expose a half-written new record. A restart can repair the
  exact prefix left by the older writer only when no accepted generation exists.
  Public output may never contain
  or be contained by `.genes/tooling`; output at the project root is therefore
  unsupported.
- The declared HXML inputs, including resolved library arguments, provenance,
  and class paths,
  must be inside `projectRoot` and must not contain private state,
  publication-control, or generated-output scopes. This keeps watch/event
  paths project-relative in v1. The lower-level inventory API may use broader
  `allowedRoots` independently. Entry and occurrence order are retained, and
  symlinked entry or library-provenance path components fail before
  canonicalization.
- Authored HXML is deliberately targetless. The session appends exactly one
  private ordinary Haxe `--js` target and one private
  `-D genes.output=<entry>` target. This matters when Genes is missing or
  fails to activate: ordinary Haxe may still generate JavaScript, but those
  bytes remain disposable and cannot touch public output before admission.
  The versioned Haxe 4.3.7 policy classifies every compiler option spelling and
  rejects every authored target selector,
  `--no-output`, display/prompt modes, compiler dump/message-log file outputs,
  caller-provided `--connect`, server-listen, `genes.output`,
  `--next`, and `--each` flags because two lifecycle owners or several output
  compilations would be ambiguous. It also rejects `--cmd`, `--run`,
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
  clear input error instead of being silently shortened. The usual
  `--option=value` spelling is accepted for one-value options and normalized to
  the same checked argument pair as `--option value`.
  After recursive flattening, no raw token ending in `.hxml` may remain. Haxe
  4.3.7 otherwise treats that token as another argument file even when Genes
  saw it in the position of an ordinary option value.
  Environment expansion is rejected where it would change Haxe's high-level
  staging decision, including an HXML filename or library request.
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
  later cannot change the command.
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
- `resolveInvocation().executable` is the native Haxe compiler binary that
  supports `--server-listen` and `--connect`, not a shell command string. The
  process is spawned with structured arguments and `shell: false`.
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
  stable locks and recovery records.
  Haxe server leases and artifact locks are also exact; tooling never adopts
  or kills an unowned process.
- HXML graph replacement is registration-gap safe: tooling confirms the
  inventory after the new watcher exists and rotates the owned compiler when
  compilation identity changes.
- A source class path may not contain symbolic links. Haxe can follow such a
  link, but a safe watcher deliberately does not; rejecting the link prevents
  an outside source change from being missed.
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

## Availability before a public package release

The package is currently developed and tested inside the Genes repository; it
has not been published to npm. npm publication is intentionally deferred until
a real external host is ready to adopt a reviewed version.

The session runtime is implemented and exercised by all 12 released
conformance scenarios plus a real cold/warm Haxe integration fixture. The
package is still repository-local until the separate release and downstream
acceptance work completes; do not describe `0.1.0` as an npm release before
that immutable publication exists.

### Guidance for agents in consuming repositories

An `AGENTS.md` inside Genes or this npm package does not automatically govern a
different repository. Agent instructions follow the consuming file's parent
directories; they do not follow npm, Lix, or Git dependency edges.

The later `genes watch` delivery therefore also owns an explicit,
non-destructive install/check flow for a versioned Genes block in each
consumer's repository-root `AGENTS.md`. It will create the file when missing or
replace only its own marked block, preserve project-authored instructions, fail
closed on malformed/duplicate markers, and never modify a checkout from npm
`postinstall`. Frameworks may add narrower scoped guidance below the root, but
that does not replace the generic Genes lifecycle rules.

Until that managed flow ships, application maintainers must document their
Genes command and ownership boundary in the consuming repository themselves;
dependency-local instructions are useful reference material, not inherited
policy.

Repository development uses:

```bash
yarn --cwd tooling build
yarn --cwd tooling test
yarn test:tooling-package
```

`yarn test:tooling-package` builds a deterministic tarball, installs it into a
clean temporary project, type-checks every code subpath, imports every runtime
and conformance-data subpath, and verifies the reviewed file inventory.

The required Genes CI repeats the packed-consumer check on Node 20.9.0, which
is the package's oldest supported Node release. The runtime fixture loads JSON
exports through Node's `createRequire` API because Node 20.9 predates the newer
`with { type: "json" }` import syntax. The strict TypeScript consumer still
checks the modern static-import form. Both paths resolve the same public
package exports.

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
the repository-root package. If an external host later needs a prebuilt
GitHub-only artifact, publish the reviewed `.tgz` as an immutable,
checksum-documented GitHub Release asset and install that exact tarball URL.
No such public tooling asset is promised by the repository today.

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
  allowedRoots: [projectRoot, haxeLibraryCache],
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
  admitIntended: async (journaledPlan) =>
    validateCompleteIntendedGeneration(journaledPlan),
});
```

Recovery finalizes only when every live file matches the journaled intended
state and the host admits that exact plan. Otherwise it restores the exact
prior state. Ambiguous bytes, paths, links, locks, journals, or backups produce
an `ArtifactTransactionError` with a structured framework-neutral
`failure.kind` and `failure.subject`; recovery never guesses.

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
  resolveLibrary: (request) => ({
    arguments: resolveExactHaxelibArguments(request),
    provenanceFiles: resolveHaxelibProvenance(request),
  }),
});
```

The result is a deterministic inventory of unique HXML files, occurrences,
library provenance, class paths, library requests, and the exact flattened
argument stream. `libraryClosureComplete` distinguishes an authoritative
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
