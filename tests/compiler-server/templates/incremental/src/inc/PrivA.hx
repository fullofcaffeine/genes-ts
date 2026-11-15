package inc;

/** Shares its name with the private type of `PrivB`. */
private class Hidden {
  public static function value(): String {
    return "hidden-a-v1";
  }
}

class UsesA {
  public static function value(): String {
    return Hidden.value();
  }
}
