package sideeffectprojection;

import genes.internal.SideEffectImportMarker;

/** Host binding used to prove aliases remain canonical after request merging. */
@:native("String")
@:jsRequire("gamma-loader", "String")
extern class ExternalString {
  public static function touch():Void;
}

/** Supplies shape-only external requests for ordered projection assertions. */
class Main {
  /**
   * Proves attribute-aware request identity without executing fake packages.
   *
   * Equal beta requests coalesce at their first occurrence. Alpha requests
   * remain distinct because their loader attributes differ, even though their
   * literal path is equal. This fixture is compiled and inspected in both
   * profiles but deliberately is not linked or executed.
   */
  static function __init__():Void {
    SideEffectImportMarker.external("gamma-loader", null);
    ExternalString.touch();
    SideEffectImportMarker.external("alpha-loader", "json");
    SideEffectImportMarker.external("beta-loader", null);
    SideEffectImportMarker.external("alpha-loader", "file");
    SideEffectImportMarker.external("beta-loader", null);
  }

  public static function main():Void {}
}
