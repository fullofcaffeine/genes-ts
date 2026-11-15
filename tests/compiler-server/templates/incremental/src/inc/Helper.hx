package inc;

/** `rare` is removed by dead-code elimination until a module calls it. */
class Helper {
  public static function common(): String {
    return "common";
  }

  public static function rare(): String {
    return "rare";
  }
}
