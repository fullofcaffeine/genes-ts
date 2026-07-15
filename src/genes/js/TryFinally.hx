package genes.js;

/**
 * Typed JavaScript boundary for a protected computation with `finally`.
 *
 * Why: Haxe has portable `try/catch` but no source-level `finally`, while
 * TypeScript migration must preserve finalizer ordering for normal completion
 * and thrown exceptions. Expanding raw JavaScript in every translated module
 * would make that contract invisible and difficult to audit.
 *
 * What: runs `body`, always runs `finalizer`, returns the body's value on
 * success, and rethrows the original exception unless the finalizer throws.
 * This is exactly JavaScript's `try/finally` completion behavior for a callback
 * region.
 *
 * How: `js.Syntax.code` is intentionally confined to this inline helper. The
 * ts2hx semantic planner rejects `return`, `break`, or `continue` that would
 * cross the callback boundary, so both genes-ts and classic Genes may safely
 * erase this helper to a small native-JavaScript IIFE.
 */
class TryFinally {
  /** Runs a typed computation and its unconditional finalizer. */
  public static inline function run<T>(body:Void->T, finalizer:Void->Void):T {
    return js.Syntax.code(
      "(function(body, finalizer) { try { return body(); } finally { finalizer(); } })({0}, {1})",
      body,
      finalizer
    );
  }
}
