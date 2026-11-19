package mr;

/** Values that other modules read. */
class Theme {
  public static function color(): String {
    return 'blue';
  }

  public static function size(): Int {
    return 12;
  }

  public static function spacing(): Int {
    return 4;
  }
}
