package foo;

class Foo {
  public final x: Int;

  public function new(x: Int) {
    this.x = x;
  }

  public function add(y: Int): Int {
    return withPrivateOffset(y);
  }

  public static function normalize(value: String): String {
    return privateNormalize(value);
  }

  private function withPrivateOffset(y: Int): Int {
    return x + y;
  }

  @:genesLowerPrivateHelper
  private static function privateNormalize(value: String): String {
    return value.toLowerCase();
  }
}
