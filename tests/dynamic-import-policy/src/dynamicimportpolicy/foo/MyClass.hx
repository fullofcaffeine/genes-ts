package dynamicimportpolicy.foo;

/** First lazy class with the same namespace export spelling as its peer. */
class MyClass {
  public function new() {}

  public static function label(): String {
    return "foo-static";
  }

  public function toString(): String {
    return "foo";
  }
}
