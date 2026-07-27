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
const outcome = publishArtifacts({
  projectRoot: "/real/project/root",
  plan,
});
```

Before changing a live file, the publisher checks every live and staged state,
takes a project-scoped lock, and writes a canonical durable journal. It moves
the plan's opaque `commitMarker` last. A caught filesystem or validation error
rolls back immediately. If the process exits, a later process calls
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
