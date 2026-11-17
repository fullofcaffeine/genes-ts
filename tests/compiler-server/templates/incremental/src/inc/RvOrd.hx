package inc;

/** Probe 6b: two late members whose order follows the visit order. */
class RvOrd {
  public static function value(): String {
    return "ord";
  }
}

class RvOrdX {
  public final x: Int;

  public function new() {
    x = 1;
  }
}

class RvOrdY {
  public final y: Int;

  public function new() {
    y = 2;
  }
}
