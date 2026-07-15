package sideeffectevidence;

import genes.internal.SideEffectImportMarker;
import genes.ts.Imports;

/** Executes typed public and compiler-internal requests in both Genes modes. */
class Main {
  /**
   * Carries public helpers and compiler-internal markers through full Haxe DCE.
   *
   * The first four calls prove the literal-only authoring API, import
   * attributes, and duplicate coalescing. The final three calls preserve the
   * converted-module DCE evidence. Genes erases every marker after recording
   * their ordered module requests.
   */
  static function __init__():Void {
    Imports.sideEffect("./runtime/First.js");
    Imports.sideEffectWith("./runtime/config.json", "json");
    Imports.sideEffect("./runtime/Second.js");
    Imports.sideEffect("./runtime/First.js");
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
