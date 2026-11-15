package inc;

private class Hidden {
  public static function value(): String {
    return "hidden-b";
  }
}

class UsesB {
  public static function value(): String {
    return Hidden.value();
  }
}
