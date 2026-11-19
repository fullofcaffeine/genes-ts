package mr;

/** One half of an import cycle. */
class Cycle {
  public static function start(): String {
    return 'cycle ' + CycleB.next(2);
  }

  public static function back(): String {
    return 'back';
  }
}
