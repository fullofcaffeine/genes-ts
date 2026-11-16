package inc;

class Extras {
  public static function value(): String {
    return ExtraHelper.text();
  }
}

class ExtraHelper {
  public static function text(): String {
    return "extra";
  }
}
