package inc;

class First {
  public static function value(): String {
    return "first:" + Second.value();
  }

  public static function own(): String {
    return "own";
  }
}
