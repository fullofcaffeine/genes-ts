package sideeffectboundorder;

/**
 * Compares ordinary bound-module initialization across all JavaScript lanes.
 *
 * Why: ESM evaluates dependencies before `main`, so import declaration order
 * can change the observable order of static Haxe initializers. A source-only
 * assertion cannot distinguish semantic edge order from incidental map order.
 *
 * What: executable code encounters `BoundaryTypes` before `Placeholder`; each
 * module appends one distinct value during initialization. The same source is
 * run through standard Haxe JS, classic Genes, and genes-ts.
 *
 * How: `touch` keeps both bound modules reachable under full DCE. Its return
 * values are consumed after initialization without adding a side-effect-import
 * marker, which guarantees this fixture exercises the bound-only projection.
 */
class Main {
  public static function main():Void {
    final total = BoundaryTypes.touch() + Placeholder.touch();
    if (total < 0)
      NodeConsole.log("unreachable");
    NodeConsole.log(Events.values.join(","));
  }
}
