#if macro
import genes.ts.TsBoundaryPlan;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/** Checks the type proof directly, including cases Haxe itself would reject. */
class WideningProbe {
  public static macro function validate(): Expr {
    final record = Context.typeof(macro(null : NullableRecordProbe.Review));
    final nullable = Context.typeof(macro(null : Null<NullableRecordProbe.Review>));
    if (!TsBoundaryPlan.acceptsTopLevelWidening(nullable, record))
      Context.error("A named record must widen to its nullable type",
        Context.currentPos());
    if (TsBoundaryPlan.acceptsTopLevelWidening(record, nullable))
      Context.error("Removing null must not count as widening",
        Context.currentPos());

    final expected = Context.typeof(macro(null : Null<NullableRecordProbe.Box<String>>));
    final unrelated = Context.typeof(macro(null : NullableRecordProbe.Box<Int>));
    final nested = Context.typeof(macro(null : NullableRecordProbe.Box<Null<String>>));
    if (TsBoundaryPlan.acceptsTopLevelWidening(expected, unrelated)
      || TsBoundaryPlan.acceptsTopLevelWidening(expected, nested))
      Context.error("An outer Null must not authorize a different generic argument",
        Context.currentPos());
    return macro null;
  }
}
