package tests.typedexprmap;

#if macro
import genes.TypedExprMap;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Compile-time checks that `genes.TypedExprMap` finds a typed expression by
 * its identity, as `haxe.ds.ObjectMap` does.
 *
 * Why at macro time: the keys are the compiler's typed expressions, and the
 * map exists only in the macro interpreter. Generated output cannot show
 * which of two equal-looking expressions a plan read.
 *
 * What it protects: `TypedExprMap` uses the source position of an expression
 * to select a group, and then compares identity. If a change made the
 * position decide alone, two expressions that one macro call made at one
 * position would share one plan entry, and Genes could emit the fact of the
 * wrong expression. The "copy" case below fails for that mistake.
 *
 * Cases: a miss in an empty map, two expressions with different positions,
 * replacement, a copy that has the position of a stored expression, 200
 * expressions at one position, and expressions that have no position.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails.
 */
class TypedExprMapProbe {
  public static macro function validate(): Expr {
    final separate = typedElements(Context.parseInlineString("[10, 20, 30]",
      Context.currentPos()));
    final first = separate[0];
    final second = separate[1];
    final third = separate[2];
    require(range(first) != range(second) && range(second) != range(third),
      "Probe setup: the parsed elements must have different positions");

    final map = new TypedExprMap<String>();
    require(!map.exists(first) && map.get(first) == null,
      "An empty map reported a value");
    map.set(first, "first");
    map.set(second, "second");
    require(map.exists(first)
      && map.get(first) == "first"
      && map.exists(second)
      && map.get(second) == "second",
      "Two expressions with different positions did not keep their own values");
    require(!map.exists(third) && map.get(third) == null,
      "An expression that was never stored was found");
    map.set(first, "replaced");
    require(map.get(first) == "replaced" && map.get(second) == "second",
      "A second set for one expression did not replace only its value");

    // The copy is a different object with the same kind, position, and type.
    final copy: TypedExpr = {expr: first.expr, pos: first.pos, t: first.t};
    require(range(copy) == range(first),
      "Probe setup: the copy must have the position of the stored expression");
    require(!map.exists(copy) && map.get(copy) == null,
      "A copy with the position of a stored expression was found. " +
      "The position may only narrow the search; the key is the expression object");
    map.set(copy, "copy");
    require(map.get(copy) == "copy" && map.get(first) == "replaced",
      "A copy with the position of a stored expression replaced that expression");
    map.set(copy, "copy replaced");
    require(map.get(copy) == "copy replaced" && map.get(first) == "replaced",
      "A second set for the later expression of a position did not replace only its value");

    // `Context.makeExpr` gives every node the one position it receives.
    final shared = typedElements(Context.makeExpr([for (index in 0...200) index],
      Context.currentPos()));
    final absent = shared[shared.length - 1];
    require(range(shared[0]) == range(absent),
      "Probe setup: the generated elements must share one position");
    final sharedMap = new TypedExprMap<Int>();
    for (index in 0...shared.length - 1)
      sharedMap.set(shared[index], index);
    for (index in 0...shared.length - 1)
      require(sharedMap.get(shared[index]) == index,
        'Expression $index of 199 at one position did not keep its own value');
    require(!sharedMap.exists(absent) && sharedMap.get(absent) == null,
      "An expression that was never stored was found among 199 at its position");
    sharedMap.set(shared[0], -1);
    sharedMap.set(shared[150], -150);
    require(sharedMap.get(shared[0]) == -1
      && sharedMap.get(shared[150]) == -150 && sharedMap.get(shared[1]) == 1
      && sharedMap.get(shared[151]) == 151,
      "A replacement among 199 expressions at one position changed another value");

    // `haxe.ds.ObjectMap` accepts a key without a position, so this map must.
    final unpositioned: TypedExpr = {expr: first.expr, pos: null, t: first.t};
    final otherUnpositioned: TypedExpr = {expr: second.expr, pos: null,
      t: second.t};
    require(!map.exists(unpositioned) && map.get(unpositioned) == null,
      "An expression without a position was found before it was stored");
    map.set(unpositioned, "no position");
    require(map.get(unpositioned) == "no position"
      && !map.exists(otherUnpositioned),
      "Two expressions without a position were treated as one key");
    map.set(otherUnpositioned, "other no position");
    require(map.get(unpositioned) == "no position"
      && map.get(otherUnpositioned) == "other no position"
      && map.get(first) == "replaced"
      && map.get(copy) == "copy replaced",
      "A key without a position changed the value of another key");
    return macro null;
  }

  #if macro
  /** Types an array literal and returns its typed elements. */
  static function typedElements(literal: Expr): Array<TypedExpr> {
    return switch Context.typeExpr(literal).expr {
      case TArrayDecl(elements): elements;
      default:
        Context.fatalError("TypedExprMap probe setup: expected a typed array literal",
          Context.currentPos());
    }
  }

  /** Returns the source range of one expression as text, for comparison. */
  static function range(expression: TypedExpr): String {
    final infos = Context.getPosInfos(expression.pos);
    return infos.file + ":" + infos.min + "-" + infos.max;
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.fatalError("TypedExprMap probe failed: " + message,
        Context.currentPos());
  }
  #end
}
