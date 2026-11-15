package genes;

#if macro
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Type.TypedExpr;

/**
 * Keeps one value for each typed expression, found by the identity of the
 * expression. When the expressions have different source positions, the time
 * for one operation does not grow with the number of expressions.
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
 * object. An expression without a position (`pos == null`) is a valid key,
 * as it is for `ObjectMap`. The map has no iteration, so no output can depend
 * on its order.
 *
 * How: the source position of an expression selects a group. The position
 * only narrows the search. It never replaces identity: two different
 * expressions with the same position stay two keys. A group keeps its first
 * expression in the group itself, because most positions have one expression.
 * Each later expression of the same position goes to an `ObjectMap` of that
 * group, which compares identity in native code.
 *
 * Cost: each operation reads one position, about one microsecond. Measured
 * for `set` followed by `get` in the Haxe 4.3.7 interpreter:
 *
 * - 20,000 expressions with different positions: about 1.2 microseconds for
 *   each operation, against 40 for an `ObjectMap`.
 * - Fewer than about 500 expressions: an `ObjectMap` is faster (0.1 to 0.8
 *   microseconds). Keep `ObjectMap` for a map that holds a few selected
 *   expressions.
 * - Many expressions at one position, for example the nodes that one macro
 *   call made: the time of one `ObjectMap` with those keys, plus the position
 *   read. This map is then not faster than an `ObjectMap`, and it is slower
 *   only by the position read.
 */
final class TypedExprMap<V> {
  /**
   * The group of every expression that has no position.
   *
   * A real position can give the same number. That is harmless: the number
   * selects a group, and inside a group only identity decides.
   */
  static inline final NO_POSITION_GROUP = -1;

  final groups = new Map<Int, TypedExprGroup<V>>();

  public function new() {}

  /** Returns the value stored for this exact expression, or `null`. */
  public function get(expression: TypedExpr): Null<V> {
    final group = groups.get(groupKey(expression));
    if (group == null)
      return null;
    if (group.first == expression)
      return group.firstValue;
    final others = group.others;
    return others == null ? null : others.get(expression);
  }

  /** Returns whether a value is stored for this exact expression. */
  public function exists(expression: TypedExpr): Bool {
    final group = groups.get(groupKey(expression));
    if (group == null)
      return false;
    if (group.first == expression)
      return true;
    final others = group.others;
    return others != null && others.exists(expression);
  }

  /** Stores a value for this exact expression and replaces an earlier one. */
  public function set(expression: TypedExpr, value: V): Void {
    final key = groupKey(expression);
    final group = groups.get(key);
    if (group == null) {
      groups.set(key, new TypedExprGroup(expression, value));
      return;
    }
    if (group.first == expression) {
      group.firstValue = value;
      return;
    }
    var others = group.others;
    if (others == null) {
      others = new ObjectMap();
      group.others = others;
    }
    others.set(expression, value);
  }

  /**
   * Returns the number that selects the group of one expression.
   *
   * The number only has to be equal each time the same expression is asked.
   * Genes does not change the position of a typed expression that it holds,
   * so the start and the end of its source range meet that requirement.
   * `Context.getPosInfos` does not accept `null`, so every expression without
   * a position gets one fixed group.
   */
  static function groupKey(expression: TypedExpr): Int {
    final position = expression.pos;
    if (position == null)
      return NO_POSITION_GROUP;
    final range = Context.getPosInfos(position);
    return range.min * 31 + range.max;
  }
}

/**
 * The expressions of one position group of a `TypedExprMap`.
 *
 * `first` is the expression that made the group, with its current value.
 * `others` holds every later expression of the same group. It stays `null`
 * while the group has one expression.
 */
private final class TypedExprGroup<V> {
  public final first: TypedExpr;
  public var firstValue: V;
  public var others: Null<ObjectMap<TypedExpr, V>> = null;

  public function new(first: TypedExpr, firstValue: V) {
    this.first = first;
    this.firstValue = firstValue;
  }
}
#end
