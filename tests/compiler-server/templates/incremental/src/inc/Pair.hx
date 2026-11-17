package inc;

/**
 * Stage 3, slice S2: the walk adds `PairA` and `PairB` to this clean module
 * late, in the order in which it visits `inc.PairWayA` and `inc.PairWayB`.
 * The member order is the order of the declarations in `Pair.tsx`.
 */
class Pair {
  public static function value(): String {
    return "pair";
  }
}

/** Removed by dead-code elimination; `inc.PairWayA` names it. */
class PairA {
  public final a: Int;

  public function new() {
    a = 1;
  }
}

/** Removed by dead-code elimination; `inc.PairWayB` names it. */
class PairB {
  public final b: Int;

  public function new() {
    b = 2;
  }
}
