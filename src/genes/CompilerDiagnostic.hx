package genes;

import haxe.macro.Expr.Position;

/**
 * Raises a source-positioned compiler diagnostic through normal stack unwinding.
 *
 * Why: `Context.error()` aborts through Haxe's macro host and can bypass the
 * custom generator's Haxe exception handler. Once an emitter has created
 * private staged files, bypassing that handler would prevent deterministic
 * transaction cleanup.
 *
 * What: `fail()` produces the same `haxe.macro.Expr.Error` diagnostic shape
 * expected by Haxe, including the original source position, but throws it as a
 * regular exception which `Generator` can catch, clean up, and rethrow.
 *
 * How: use this helper for diagnostics reachable from generation planning or
 * printing. Typing-only macros may continue using `Context.error()` because no
 * output transaction exists at that phase. The generic return lets callers
 * preserve precise result types without an unreachable fallback value.
 */
class CompilerDiagnostic {
  public static function fail<T>(message: String, position: Position): T {
    throw new haxe.macro.Expr.Error(message, position);
  }
}
