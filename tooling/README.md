# `@genes-ts/tooling`

Framework-neutral host tooling shared by Haxe-to-JavaScript and
Haxe-to-TypeScript projects.

The first public surface is `@genes-ts/tooling/artifacts`: a durable publisher
for an already-authorized exact set of generated-file transitions. It does not
decide ownership, validation, adoption, “last good” behavior, or user-facing
diagnostics. Those remain host policy.

The versioned protocol and conformance corpus live in
[`artifact-transactions/v1`](artifact-transactions/v1/README.md).
