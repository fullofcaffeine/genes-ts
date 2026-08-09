package arrayindexstrict;

#if macro
import genes.ts.TsIndexedAccessPlan;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Compile-time controls for exact generic array-result classification.
 *
 * These wrappers are compiler-internal `Type` values, not Haxe source syntax,
 * so the fixture checks them before target emission. The classifier must
 * return the canonical type parameter that the TypeScript printer can spell;
 * returning the original lazy or monomorphic wrapper would print `any`.
 */
@:access(genes.ts.TsIndexedAccessPlan)
class ArrayIndexTypeProbe {
  #if macro
  public static macro function validate(): Expr {
    final subject = switch Context.getType("arrayindexstrict.ArrayIndexTypeProbe.ArrayIndexTypeSubject") {
      case TInst(reference, _):
        reference.get();
      case other:
        Context.error('Expected ArrayIndexTypeSubject class, got ${other}',
          Context.currentPos());
    };
    final parameter = TsIndexedAccessPlan.exactTypeParameter(subject.params[0].t);
    if (parameter == null)
      Context.error("Could not resolve the fixture's canonical type parameter",
        Context.currentPos());

    assertCanonical("lazy", parameter, TLazy(() -> parameter));

    final unresolved = Context.makeMonomorph();
    if (TsIndexedAccessPlan.exactTypeParameter(unresolved) != null)
      Context.error("An unresolved monomorph was accepted as an exact type parameter",
        Context.currentPos());
    if (!Context.unify(unresolved, parameter))
      Context.error("Could not resolve the monomorph to the fixture type parameter",
        Context.currentPos());
    assertCanonical("resolved monomorph", parameter, unresolved);

    var tooDeep = parameter;
    for (_ in 0...66)
      tooDeep = lazy(tooDeep);
    if (TsIndexedAccessPlan.exactTypeParameter(tooDeep) != null)
      Context.error("An unexpectedly deep lazy chain bypassed the recursion guard",
        Context.currentPos());

    return macro null;
  }

  static function lazy(inner: Type): Type {
    return TLazy(() -> inner);
  }

  static function assertCanonical(label: String, expected: Type,
      wrapper: Type): Void {
    final actual = TsIndexedAccessPlan.exactTypeParameter(wrapper);
    switch [expected, actual] {
      case [TInst(expectedReference, _), TInst(actualReference, _)]
        if (expectedReference.get().module == actualReference.get().module
          && expectedReference.get().name == actualReference.get().name
          && actualReference.get().kind.match(KTypeParameter(_))):
      default:
        Context.error('${label} did not return the canonical type parameter: expected ${haxe.macro.TypeTools.toString(expected)}, got ${actual == null ? "null" : haxe.macro.TypeTools.toString(actual)}',
          Context.currentPos());
    }
  }
  #end
}

class ArrayIndexTypeSubject<T> {}
