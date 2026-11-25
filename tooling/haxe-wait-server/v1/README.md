# Owned Haxe wait-server conformance v1

This corpus defines the framework-neutral lifecycle for a project-local Haxe
`--wait` process. It covers compatible reuse, direct fallback, exact leases,
unexpected exits, and bounded owned-process shutdown.

Hosts supply project and compatibility identities, Haxe start/probe/compile
operations, process-liveness evidence, events, and diagnostic presentation.
The shared runtime does not own application services or framework policy.

Two transports share this lifecycle:

- `loopback` (the default): the runtime reserves a loopback port for
  `haxe --wait 127.0.0.1:PORT`, and the lease
  (`genes.tooling.haxe-wait-server-lease.v1`) records `host` and `port`.
- `stdio`: the host starts `haxe --wait stdio` and talks to it on the
  process's standard streams. The runtime reserves no port, passes the fixed
  endpoint `{"transport":"stdio","argument":"stdio"}` to `start`, `probe` and
  `compileConnected`, and writes a lease without an address
  (`genes.tooling.haxe-wait-server-lease.stdio.v1`). Stale and live leases of
  either schema are claimed or respected by the same rules. The development
  session uses this transport.

The vector `stdio-transport-addressless-lease` names that contract; the
executable checks are in `tooling/src/haxe-server-test.ts`.
