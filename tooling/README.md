# `@genes-ts/tooling`

Framework-neutral host tooling shared by Haxe-to-JavaScript and
Haxe-to-TypeScript projects.

The first public surface is `@genes-ts/tooling/artifacts`: a durable publisher
for an already-authorized exact set of generated-file transitions. It does not
decide ownership, validation, adoption, “last good” behavior, or user-facing
diagnostics. Those remain host policy.

The versioned protocol and conformance corpus live in
[`artifact-transactions/v1`](artifact-transactions/v1/README.md).

## Artifact transactions

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
