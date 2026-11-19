package mr;

/** The other half of the import cycle. */
class CycleB {
  public static function next(count: Int): String {
    return count > 0 ? Cycle.back() : 'end';
  }
}
