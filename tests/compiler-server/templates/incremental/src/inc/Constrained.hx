package inc;

/**
 * Anonymous structures in type-parameter constraints (genes-f8vc.9.26, L5
 * of the review of genes-ts #245).
 *
 * `inc.Mark3Macro` writes `@:ts.type("string")` on a field of one of these
 * structures from another module, after typing. Haxe does not type this
 * module again, so only the fingerprint of this module shows the change.
 * Each structure is in the constraint of another kind of type parameter: a
 * method, a class, a typedef, an abstract and an enum constructor. `rank`
 * and `order` have constraints that name their own parameter, so the
 * fingerprint must not walk a constraint from inside a type.
 */
class Constrained {
  public static var hold: ConstrainedEnum = Hold({e: 5});

  public static function pick<T: {v: Int}>(item: T): Int {
    return item.v;
  }

  public static function rank<T: {final r: Int; final ?next: T;}>(item: T): Int {
    return item.r;
  }

  public static function order<T: Ordered<T>>(left: T, right: T): Int {
    return left.compareTo(right);
  }

  public static function value(): String {
    final box = new ConstrainedBox({c: 2});
    final def: ConstrainedDef<{d: Int}> = {item: {d: 3}};
    final abs = new ConstrainedAbs({a: 4});
    final held = switch hold {
      case Hold(item): item.e;
    }
    final ranked: Ranked = {r: 6};
    return Std.string(pick({v: 1})
      + rank(ranked)
      + box.item.c
      + def.item.d
      + abs.get().a
      + held
      + order(new Score(7), new Score(8)));
  }
}

/** A type that meets the constraint of `Constrained.rank`. */
typedef Ranked = {
  final r: Int;
  final ?next: Ranked;
}

/** A class with a structure in the constraint of its type parameter. */
class ConstrainedBox<T:{c: Int}> {
  public final item: T;

  public function new(item: T) {
    this.item = item;
  }
}

/** A typedef with a structure in the constraint of its type parameter. */
typedef ConstrainedDef<T:{d: Int}> = {
  final item: T;
}

/** An abstract with a structure in the constraint of its type parameter. */
abstract ConstrainedAbs<T:{a: Int}>(T) {
  public inline function new(value: T) {
    this = value;
  }

  public function get(): T {
    return this;
  }
}

/** An enum constructor with a structure in the constraint of its own type parameter. */
enum ConstrainedEnum {
  Hold<T:{e: Int}>(item: T);
}

/** A constraint that names its own parameter (`T: Ordered<T>`). */
interface Ordered<T> {
  function compareTo(other: T): Int;
}

class Score implements Ordered<Score> {
  final points: Int;

  public function new(points: Int) {
    this.points = points;
  }

  public function compareTo(other: Score): Int {
    return points - other.points;
  }
}
