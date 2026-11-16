package inc;

class GenericUse {
  public static function use(): String {
    return "box:" + new Box<Int>(1).item /*GENERIC_USE*/;
  }
}
