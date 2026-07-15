package dual;

/** Emits one machine-readable line for the differential runner. */
class ConsoleOutput {
  /**
   * Serializes a typed value before crossing the console boundary.
   *
   * Haxe has no target-neutral stdout primitive on the bare JS target. The raw
   * syntax is therefore confined to this one function and receives a `String`,
   * preserving identical behavior in TS, classic ESM, vanilla ESM, and
   * standard Haxe CommonJS output.
   */
  public static function print<T>(value:T):Void {
    final json = haxe.Json.stringify(value);
    js.Syntax.code("console.log({0})", json);
  }
}
