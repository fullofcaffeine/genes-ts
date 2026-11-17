package inc;

/** Probe 6a: a late member that is renamed. */
class RvName {
  public static function value(): String {
    return "name";
  }
}

class RvNameOld {
  public final o: Int;

  public function new() {
    o = 1;
  }
}
