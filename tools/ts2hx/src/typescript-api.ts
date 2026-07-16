import ts from "typescript";

/**
 * Owns ts2hx's dependency on the legacy TypeScript Program/TypeChecker API.
 *
 * TypeScript 7 is used to validate generated output but does not publish this
 * JavaScript API. The repository therefore aliases `typescript` to a TS6
 * wrapper and separately pins the engine to which that wrapper delegates.
 * Keeping the import here makes the eventual post-TS7 adapter an isolated
 * front-end change rather than an emitter rewrite.
 */
export default ts;
