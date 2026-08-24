package asyncawaitinvalid;

import js.lib.Promise;

/** Proves the async return carrier cannot bridge an unrelated scalar type. */
class WrongReturnType {
  @:async
  static function invalid(): Promise<Int> {
    return "not-an-int";
  }

  static function main(): Void {
    invalid();
  }
}
