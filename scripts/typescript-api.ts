import ts from "typescript";

/**
 * Stable import seam for the JavaScript TypeScript compiler API.
 *
 * Why: TypeScript 7's native compiler intentionally does not expose the legacy
 * `Program`/`TypeChecker` API. Semantic policy gates still need that API.
 *
 * What/How: the root `typescript` dependency is the TS6 wrapper from the
 * toolchain manifest. That wrapper delegates to a separately pinned TypeScript
 * engine, whose exact `ts.version` is checked by the API lane. All programmatic
 * consumers import through this module so a future adapter can be changed once
 * instead of throughout the harness.
 */
export default ts;
