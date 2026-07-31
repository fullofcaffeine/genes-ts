package dynamicimportpolicy.bar;

/** Second lazy class with the same namespace export spelling as its peer. */
class MyClass {
  public function new() {}

  public static function label(): String {
    return "bar-static";
  }

  public function toString(): String {
    return "bar";
  }
}
