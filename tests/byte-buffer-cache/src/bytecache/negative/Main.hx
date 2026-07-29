package bytecache.negative;

import haxe.io.Bytes;
import js.lib.Object;

/**
 * A different prototype must not authorize a `Bytes` identity assertion.
 *
 * This deliberately untyped function is compiled only for generated-source
 * inspection. Strict TypeScript should continue to reject its return value.
 */
class Main {
  static function mismatchedPrototype(): Bytes untyped {
    final value = Object.create(Array.prototype);
    value.marker = true;
    return value;
  }

  public static function main(): Void {
    trace(mismatchedPrototype());
  }
}
