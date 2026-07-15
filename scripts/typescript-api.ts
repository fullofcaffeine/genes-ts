import ts from "typescript";

/**
 * Stable import seam for the JavaScript TypeScript compiler API.
 *
 * Why: TypeScript 7's native compiler intentionally does not expose the legacy
 * `Program`/`TypeChecker` API. Semantic policy gates still need that API.
 *
 * What/How: the root `typescript` dependency is the pinned TS6 bridge from the
 * toolchain manifest. All programmatic consumers import through this module so
 * a future API adapter can be changed once instead of throughout the harness.
 */
export default ts;
