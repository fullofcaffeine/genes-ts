package bytecache.negative;

import haxe.io.Bytes;
import js.lib.ArrayBuffer;
import js.lib.Object;
import js.node.buffer.Buffer;

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

  static function absentBytes(data: ArrayBuffer): Int untyped {
    return data.bytes[0];
  }

  static function inlinedFastGet(data: ArrayBuffer): Int {
    return Bytes.fastGet(data, 0);
  }

  public static function main(): Void {
    trace(mismatchedPrototype());
    trace(absentBytes(new ArrayBuffer(1)));
    trace(inlinedFastGet(new ArrayBuffer(1)));
    trace(Buffer.reassignedPrototype());
  }
}
