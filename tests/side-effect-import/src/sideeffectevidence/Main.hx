package sideeffectevidence;

import genes.internal.SideEffectImportMarker;

/** Executes the marker-retained initialization evidence in both Genes modes. */
class Main {
  /**
   * Carries three effectful typed markers through full Haxe DCE.
   *
   * The compile-time probe checks this exact typed encounter order. Genes then
   * erases the calls, while the internal references keep `First` and `Second`
   * reachable and ordered as ordinary dependencies for this evidence step.
   */
  static function __init__():Void {
    SideEffectImportMarker.internal(First.__ts2hxInit);
    SideEffectImportMarker.internal(Second.__ts2hxInit);
    SideEffectImportMarker.internal(First.__ts2hxInit);
    if (First.sentinel < 0)
      NodeConsole.log("unreachable");
  }

  public static function main():Void {
    NodeConsole.log(Events.values.join(","));
  }
}
