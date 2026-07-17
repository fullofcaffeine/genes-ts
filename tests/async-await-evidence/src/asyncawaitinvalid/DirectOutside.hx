package asyncawaitinvalid;

import genes.js.Async.await;
import js.lib.Promise;

/** Proves macro-style await fails before code generation outside async. */
class DirectOutside {
  static function main() {
    final value = await(Promise.resolve(42));
    trace(value);
  }
}
