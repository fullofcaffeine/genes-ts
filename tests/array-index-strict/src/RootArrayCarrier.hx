/**
 * Produces a user-defined secondary class whose name is `Array`.
 *
 * Both types live in the root `RootArrayCarrier` module. The secondary type
 * therefore has an empty package and the class name `Array`, just like Haxe's
 * built-in Array, but its canonical module identity is `RootArrayCarrier`.
 */
class RootArrayCarrier {
  public static function make(): Array {
    return new Array();
  }
}

private class Array {
  public var calls(default, null) = 0;

  public function new() {}

  public function shift(): Void {
    calls++;
  }

  public function pop(): Void {
    calls++;
  }
}
