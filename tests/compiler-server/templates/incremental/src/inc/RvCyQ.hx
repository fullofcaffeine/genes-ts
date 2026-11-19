package inc;

/** Probe 6d: the superclass of inc.RvCyP; no runtime import of inc.RvCyP until RvCyQExtra is added. */
class RvCyQ {
  public function new() {}

  public function tag(): String {
    return "q";
  }
}

/** Removed by dead-code elimination until a typedef field names it; closes RvCyP -> RvCyQ -> RvCyP. */
class RvCyQExtra extends RvCyP {
  public function new() {
    super();
  }
}
