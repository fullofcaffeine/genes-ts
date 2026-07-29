package js.node.buffer;

import haxe.io.Bytes;
import js.lib.Object;

/**
 * Negative-only stand-in for the hxnodejs module.
 *
 * The module, owner, and field identities deliberately match the real helper,
 * but this version reassigns the prototype-backed local before returning it.
 * That isolates the planner's reassignment check from its owner check.
 */
class Buffer {
  public static function reassignedPrototype(): Bytes {
    return Helper.bytesOfBuffer();
  }
}

private class Helper {
  public static function bytesOfBuffer(): Bytes untyped {
    var value = Object.create(Bytes.prototype);
    value = {};
    return value;
  }
}
