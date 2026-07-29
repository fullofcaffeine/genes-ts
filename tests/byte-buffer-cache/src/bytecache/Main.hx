package bytecache;

import haxe.io.Bytes;
import haxe.io.BytesData;
import js.lib.ArrayBuffer;
import js.lib.Uint8Array;
import js.node.Buffer;

/**
 * Runtime proof for the private byte caches shared by Haxe and hxnodejs.
 */
class Main {
  /**
   * Haxe's `Bytes.ofData` performs this lookup before deciding whether to
   * allocate a wrapper. A fresh JavaScript ArrayBuffer has no `hxBytes`
   * property, which JavaScript reports as `undefined`; Haxe observes that
   * missing value as `null`.
   */
  static function cached(data: BytesData): Null<Bytes> {
    return untyped data.hxBytes;
  }

  /**
   * Haxe's `Bytes.fastGet` documents the precondition that `data` has already
   * been wrapped. The constructor establishes `data.bytes` before this read.
   */
  static function initializedByte(data: BytesData, index: Int): Int {
    return untyped data.bytes[index];
  }

  /**
   * Haxe writes the original backing buffer to the private Uint8Array cache.
   */
  static function backingData(bytes: Bytes): BytesData {
    return untyped @:privateAccess bytes.b.bufferValue;
  }

  public static function main(): Void {
    final data = new ArrayBuffer(2);
    final absent = cached(data) == null;
    final bytes = Bytes.ofData(data);
    bytes.set(0, 41);
    bytes.set(1, 42);
    final sameWrapper = Bytes.ofData(data) == bytes;

    final nodeBuffer = Buffer.alloc(2);
    nodeBuffer[0] = 7;
    nodeBuffer[1] = 8;
    final nodeBytes = nodeBuffer.hxToBytes();

    final user = new NamedFieldControl(null, new Uint8Array(data), data);
    NodeConsole.log([
      Std.string(absent),
      Std.string(sameWrapper),
      Std.string(initializedByte(data, 1)),
      Std.string(backingData(bytes) == data),
      Std.string(nodeBytes.get(0)),
      Std.string(user.hxBytes == null),
      Std.string(user.bytes.byteLength),
      Std.string(user.bufferValue.byteLength)
    ].join("|"));
  }
}
