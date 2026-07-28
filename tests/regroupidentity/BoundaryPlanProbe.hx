package tests.regroupidentity;

#if macro
import genes.ts.TsBoundaryPlan;
import genes.ts.TsBoundaryPlan.TsBoundaryRelation;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time negative controls for the TypeScript boundary proof.
 *
 * This probe compares an expected `BoundaryPair<Int, Int>` with an actual
 * `BoundaryPair<Null<Int>, String>`. A "generic slot" is one of the type
 * arguments inside the angle brackets. The first slot has the reviewed
 * nullability-only difference (`Int` versus `Null<Int>`), but the second has
 * an unrelated `Int` versus `String` mismatch. The whole relation must
 * therefore be `Incompatible`; recognizing one nullable slot is not enough to
 * authorize a TypeScript assertion for the entire pair.
 *
 * The comparison runs at macro time so the fixture can inspect those exact
 * Haxe compiler `Type` values—the compiler's structured representation of a
 * source type—without adding an invalid value assignment to the generated
 * program. Such an assignment would correctly fail the suite's
 * strict-TypeScript gate and obscure whether this focused proof behaved as
 * intended.
 */
class BoundaryPlanProbe {
  public static macro function validate(): Expr {
    final expected = Context.typeof(macro(null : tests.regroupidentity.BoundaryPlanStep.BoundaryPair<Int,
      Int>));
    final actual = Context.typeof(macro(null : tests.regroupidentity.BoundaryPlanStep.BoundaryPair<Null<Int>,
      String>));

    switch TsBoundaryPlan.compareTypes(expected, actual) {
      case Incompatible:
      case Identical | NullabilityOnly:
        Context.error("An unrelated generic sibling was accepted as nullability-only",
          Context.currentPos());
    }
    return macro null;
  }
}
