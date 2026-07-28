# `@genes-ts/tooling`

`@genes-ts/tooling` is an optional Node/TypeScript library for programs that
*run* Genes during development. It helps a host CLI notice Haxe input changes,
reuse an owned Haxe compilation server, serialize rebuilds, and publish the
resulting files without exposing a half-written output tree.

It is not the Genes compiler, a compiler runtime, or a framework integration:

- Haxe programs do not import it.
- Generated TypeScript and JavaScript do not depend on it.
- `genes.Generator` and `tools/ts2hx` do not depend on it.
- Framework adapters still own their commands, diagnostics, dev servers,
  validation, and “last good” policy.

For example, NextJsHx and WordPressHx can share the mechanics of watching Haxe
inputs and safely running `haxe --wait`, while keeping Next.js and WordPress
behavior in their own repositories.

## The development loop it supports

The five public areas fit together like this:

```text
HXML inventory
  -> exact files and source roots to watch
  -> reconciled watch reports an edit
  -> serialized dirty loop schedules one newest-state rebuild
  -> owned Haxe wait server performs a warm or direct compile
  -> host validates staged output
  -> artifact transaction publishes the authorized files atomically
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

## Availability before a public package release

The package is currently developed and tested inside the Genes repository; it
has not been published to npm. npm publication is intentionally deferred until
a real external host is ready to adopt a reviewed version.

Repository development uses:

```bash
yarn --cwd tooling build
yarn --cwd tooling test
yarn test:tooling-package
```

`yarn test:tooling-package` builds a deterministic tarball, installs it into a
clean temporary project, type-checks every code subpath, imports every runtime
and conformance-data subpath, and verifies the reviewed file inventory.

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

## How a host composes the pieces

The following is an integration sketch, not a complete framework CLI. Names
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
  resolveLibrary: resolveLibraryHxml,
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
to the optional host-owned `admitIntended` callback before committing. A
rejection, caught filesystem error, or validator error rolls back immediately.
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
entry files. It understands nested HXML, ordered `--cwd`, class paths,
resources, libraries, comments, quoting, escaping, and explicit environment
expansion. The host supplies allowed roots plus environment and library
resolvers:

```ts
import { inventoryHxml } from "@genes-ts/tooling/hxml";

const inventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot, haxeLibraryCache],
  environment: (name) => configuredEnvironment.get(name) ?? null,
  resolveLibrary: (request) => resolveLibraryHxml(request),
});
```

The result is a deterministic inventory of HXML files, class paths, resources,
and library requests. It contains no framework config files or watch policy.
Missing values, unsafe paths, links, malformed syntax, resolver failures, and
budgets fail through `HxmlInventoryError`.

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
