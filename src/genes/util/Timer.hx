package genes.util;

/**
 * Adds request-local Genes work to Haxe's authoritative `--times` tree.
 *
 * The returned callback closes one nested phase. Haxe decides whether to print
 * the timing table, so ordinary builds do not write a separate profile and a
 * warm compiler server retains no Genes timing state between requests.
 */
class Timer {
  public static function timer(id: String): Void->Void {
    #if (haxe_ver >= 4.1)
    return haxe.macro.Context.timer(id);
    #else
    return function() {}
    #end
  }
}
