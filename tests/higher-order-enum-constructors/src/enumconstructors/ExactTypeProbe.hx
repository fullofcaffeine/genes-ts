package enumconstructors;

#if macro
import genes.ts.TsBoundaryPlan;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

/**
 * Compile-time negative controls for the enum-reference identity proof.
 *
 * These types are all related enough to look tempting to a broad compatibility
 * rule. None except the first pair is literally the same callable structure.
 */
class ExactTypeProbe {
  public static macro function assertRelations(): Expr {
    final parent = type("ParentCallback");
    assertExact(parent, type("ParentCallback"), true,
      "the same callable type is exact");
    assertExact(parent, type("ChildInputCallback"), false,
      "a nominal subtype input is not exact");
    assertExact(parent, type("NullableInputCallback"), false,
      "a nullable input is not exact");
    assertExact(parent, type("OptionalInputCallback"), false,
      "an optional input is not exact");
    return macro null;
  }

  static function type(name: String): Type {
    return Context.getType('enumconstructors.CallableControls.$name');
  }

  static function assertExact(expected: Type, actual: Type, wanted: Bool,
      message: String): Void {
    final received = TsBoundaryPlan.hasExactTypeIdentity(expected, actual);
    if (received != wanted)
      Context.error('$message: expected $wanted but received $received',
        Context.currentPos());
  }
}
#end
