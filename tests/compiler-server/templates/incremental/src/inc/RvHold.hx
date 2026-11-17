package inc;

/** Probe 6c: one late member that two clean typedef modules name. */
class RvHold {
  public static function value(): String {
    return "hold";
  }
}

/** Removed by dead-code elimination; inc.RvWayA and inc.RvWayB name it. */
class RvHoldNote {
  public final n: Int;

  public function new() {
    n = 1;
  }
}
