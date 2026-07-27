# Owned Haxe wait-server conformance v1

This corpus defines the framework-neutral lifecycle for a project-local Haxe
`--wait` process. It covers compatible reuse, direct fallback, exact leases,
unexpected exits, and bounded owned-process shutdown.

Hosts supply project and compatibility identities, Haxe start/probe/compile
operations, process-liveness evidence, events, and diagnostic presentation.
The shared runtime does not own application services or framework policy.
