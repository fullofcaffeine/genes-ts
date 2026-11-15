package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Type.TypedExpr;

/**
 * Keeps one value for each typed expression, found by the identity of the
 * expression, in a time that does not grow with the number of expressions.
 *
 * Why: a semantic plan often records a fact for every typed expression of a
 * module, and an emitter later asks for the fact of one exact expression.
 * `haxe.ds.ObjectMap` looks like the right owner, but in the Haxe 4.3.7 macro
 * interpreter it gives every key the same hash. All keys are then in one
 * list, and each `set`, `get`, or `exists` compares the key with every stored
 * key. A module with 20,000 expressions needs about 200 million comparisons
 * to fill one such map. On an application with 1,100 modules this cost
 * several seconds in each generation.
 *
 * What: `set`, `get`, and `exists` have the meaning of the same `ObjectMap`
 * operations. Two keys are equal only when they are the same expression
 * object. The map has no iteration, so no output can depend on its order.
 *
 * How: the source position of an expression selects a small group of
 * entries; inside the group, the map compares object identity. The position
 * only narrows the search. Two different expressions with the same position
 * stay two keys, and a position never replaces identity. Expressions that a
 * macro made at one position share a group, which is only slower.
 *
 * Limit: reading a position costs about one microsecond, more than a lookup
 * in an `ObjectMap` with fewer than about 500 keys. Use this map when one
 * map can hold every expression of a module. Keep `ObjectMap` for a map that
 * holds a few selected expressions.
 */
final class TypedExprMap<V> {
  final groups = new Map<Int, Array<TypedExprMapEntry<V>>>();

  public function new() {}

  /** Returns the value stored for this exact expression, or `null`. */
  public function get(expression: TypedExpr): Null<V> {
    final entry = find(expression);
    return entry == null ? null : entry.value;
  }

  /** Returns whether a value is stored for this exact expression. */
  public function exists(expression: TypedExpr): Bool {
    return find(expression) != null;
  }

  /** Stores a value for this exact expression and replaces an earlier one. */
  public function set(expression: TypedExpr, value: V): Void {
    final key = groupKey(expression);
    final group = groups.get(key);
    if (group == null) {
      groups.set(key, [new TypedExprMapEntry(expression, value)]);
      return;
    }
    for (entry in group)
      if (entry.expression == expression) {
        entry.value = value;
        return;
      }
    group.push(new TypedExprMapEntry(expression, value));
  }

  function find(expression: TypedExpr): Null<TypedExprMapEntry<V>> {
    final group = groups.get(groupKey(expression));
    if (group != null)
      for (entry in group)
        if (entry.expression == expression)
          return entry;
    return null;
  }

  /**
   * Returns the number that selects the group of one expression.
   *
   * The number only has to be equal each time the same expression is asked.
   * Haxe does not change the position of a typed expression, so the start
   * and the end of its source range meet that requirement.
   */
  static function groupKey(expression: TypedExpr): Int {
    final position = Context.getPosInfos(expression.pos);
    return position.min * 31 + position.max;
  }
}

/** One stored expression of a `TypedExprMap`, with its current value. */
private final class TypedExprMapEntry<V> {
  public final expression: TypedExpr;
  public var value: V;

  public function new(expression: TypedExpr, value: V) {
    this.expression = expression;
    this.value = value;
  }
}
#end
