package asyncawaitinvalid;

/** Proves JavaScript constructors cannot be marked async. */
class Constructor {
  @:async
  public function new() {}

  static function main() {
    new Constructor();
  }
}
