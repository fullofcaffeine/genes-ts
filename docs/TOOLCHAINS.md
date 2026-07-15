# Toolchain compatibility contract

`config/toolchains.json` is the single machine-readable source for Node, Haxe,
and TypeScript compatibility lanes. Local runners, version policy, CI, and the
release workflow consume that file; version literals do not belong in fixture
commands or workflow matrices.

## Supported lanes

| Tool | Lane | Version | Blocking contract |
| --- | --- | --- | --- |
| TypeScript | `legacyFloor` | 5.5.4 | Generated TS/TSX and declaration compatibility floor |
| TypeScript | `apiBridge` | 6.0.2 package | Generated output plus the JavaScript `Program`/`TypeChecker` API used by semantic gates and ts2hx |
| TypeScript | `current` | 7.0.2 | Generated TS/TSX and declaration compatibility only |
| dts2hx | declaration ingestion | 0.34.0 with TypeScript 5.9.3 | Deterministic `.d.ts` → Haxe extern bridge; exact source-audit revision is in the manifest |
| Haxe | `stable` | 4.3.7 | Blocking compiler/runtime contract for classic JS and TS output |
| Haxe | `preview` | 5.0.0-preview.1 | Visible, non-blocking early-warning lane |
| Node | `stable` / `nextLts` | 20 / 22 | Blocking stable lane plus a reduced next-LTS smoke lane |

The TS6 npm package can report a slightly newer internal compiler build than
its package version. Dependency reproducibility is pinned by the package
version; the API gate separately verifies that the runtime API is major 6.

## Why output and API compatibility are separate

TypeScript 7 accepts and emits TypeScript projects but does not publish the
historical JavaScript compiler API. genes-ts therefore uses three side-by-side
dependencies:

- `@typescript/legacy` aliases the TS5 compatibility floor;
- `typescript` aliases `@typescript/typescript6`, the supported API bridge;
- `@typescript/native` aliases the current TS7 compiler.

Only `scripts/typescript-api.ts` and `tools/ts2hx/src/typescript-api.ts` import
the bridge directly. Semantic output policy and ts2hx import those adapters,
which keeps a future post-TS7 API migration isolated from compiler emitters.
TS7 is never presented as a `Program` API provider.

dts2hx keeps its own pinned TypeScript 5.9 converter dependency because its
conversion implementation is independent from genes and ts2hx. The
package-shape harness resolves the same entrypoints through the genes TS6 API
adapter, then through dts2hx. This creates a versioned boundary without forcing
both tools onto one internal compiler API.

## Test ownership

`yarn test:matrix:generated` runs the high-coverage full profile, all React
profiles, and the authoritative same-source dual-output corpus. Those runners
compile identical generated source with TS5 first, then type-check it with TS6
and TS7 using `--noEmit`. The strict classic declaration consumer uses the same
three lanes. Smaller fixtures remain on the TS5 floor to keep aggregate CI
latency bounded; their language categories are represented by the matrix-owned
profiles.

`yarn test:matrix:api` builds the harness and ts2hx with the TS6 package and
executes a real compiler-API smoke. It is included in `yarn test:ci`.

GitHub Actions reads the manifest before dependency installation. Stable Haxe
is blocking in classic and genes-ts jobs. The Haxe preview job runs classic and
minimal TS smoke tests with `continue-on-error`; a green preview is evidence,
not a support promise.

## Upgrading a lane

1. Change the version once in `config/toolchains.json` and update the matching
   package alias in `package.json`.
2. Run `yarn install` to refresh `yarn.lock`.
3. Remove configuration options that the new compiler deprecates or removes;
   do not hide diagnostics with `skipLibCheck` or weaker generated types.
4. Run `yarn test:versions`, `yarn test:matrix:api`,
   `yarn test:matrix:generated`, and finally `yarn test:ci`.
5. Update this table only when the executable gates are green. If a preview or
   current compiler exposes a real incompatibility, file a Bead with the exact
   lane and reduced fixture rather than silently dropping the lane.

`yarn test:versions` verifies package aliases and installed versions, the
stable `.haxerc`, the dts2hx package and embedded TypeScript version, modern
tsconfig assumptions, adapter-only API imports, and workflow manifest
consumption. It also rejects reintroduced hard-coded TypeScript versions in
test runners.
