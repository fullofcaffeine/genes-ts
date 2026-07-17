package asyncawaitinvalid;

import genes.js.Async.await;
import js.lib.Promise;

/** Proves a normal nested function does not inherit its async parent's scope. */
class NestedSynchronous {
  @:async
  static function outer():Promise<Int> {
    final synchronous = function():Int {
      return await(Promise.resolve(42));
    };
    return synchronous();
  }

  static function main() {
    outer();
  }
}
