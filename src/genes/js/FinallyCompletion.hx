package genes.js;

/**
 * Runs callback-modeled `try/finally` while carrying an opaque completion.
 *
 * Why: Haxe has no source-level `finally`, and a source `return`, `break`, or
 * `continue` cannot directly leave the callbacks used by ts2hx. The protected
 * callback can also throw a JavaScript value that must remain the active
 * outcome unless the finalizer replaces it.
 *
 * What: `null` means that a callback completed normally. A non-null value is
 * an opaque completion chosen by the caller, such as a typed return or loop
 * target record. A non-null finalizer result replaces the protected result or
 * protected throw. A finalizer throw propagates naturally.
 *
 * How: only `body()` runs inside the catchable `try`. The normal-path
 * `finalizer()` call is deliberately outside that `try`; otherwise a throwing
 * finalizer would enter the catch branch and execute a second time. The caught
 * `Any` is the narrow host-exception boundary: this helper never inspects or
 * converts it, and rethrows the same value when the finalizer returns `null`.
 * The generic carrier keeps user-module completion records strongly typed and
 * lets standard Haxe, classic Genes, and genes-ts share this implementation.
 */
class FinallyCompletion {
  /**
   * Runs the protected callback and then the finalizer exactly once.
   *
   * The finalizer's non-null result or thrown value takes precedence. When the
   * finalizer completes normally, the protected result or exact protected
   * thrown value continues unchanged.
   */
  public static function run<C>(body:Void->Null<C>,
      finalizer:Void->Null<C>):Null<C> {
    var bodyCompletion:Null<C> = null;
    try {
      bodyCompletion = body();
    } catch (bodyError:Any) {
      final finalizerCompletion = finalizer();
      if (finalizerCompletion != null)
        return finalizerCompletion;
      throw bodyError;
    }

    final finalizerCompletion = finalizer();
    return finalizerCompletion != null
      ? finalizerCompletion
      : bodyCompletion;
  }
}
