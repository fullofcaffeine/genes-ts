package genes.util;

/**
 * Adds request-local Genes work to Haxe's authoritative `--times` tree.
 *
 * The returned callback closes one nested phase. Haxe decides whether to print
 * the timing table, so ordinary builds do not write a separate profile and a
 * warm compiler server retains no Genes timing state between requests.
 *
 * In a request whose descriptor has `"requestMeasure": true`, the same phase is also a phase of
 * `genes.incremental.RequestMeasure` (CPU time, allocated words and work
 * counts in the request report); otherwise that adds nothing.
 */
class Timer {
  public static function timer(id: String): Void->Void {
    #if (haxe_ver >= 4.1)
    final endHaxe = haxe.macro.Context.timer(id);
    #if macro
    if (genes.incremental.RequestMeasure.active) {
      final endMeasure = genes.incremental.RequestMeasure.open(id);
      return () -> {
        endMeasure();
        endHaxe();
      };
    }
    #end
    return endHaxe;
    #else
    return function() {}
    #end
  }
}
