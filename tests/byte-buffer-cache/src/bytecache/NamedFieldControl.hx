package bytecache;

import haxe.io.Bytes;
import js.lib.ArrayBuffer;
import js.lib.Uint8Array;

/**
 * Same-spelled user fields are ordinary typed properties.
 *
 * The byte-cache plan must require Haxe's original dynamic native-buffer
 * access, not merely one of these three names.
 */
class NamedFieldControl {
  public final hxBytes: Null<Bytes>;
  public final bytes: Uint8Array;
  public final bufferValue: ArrayBuffer;

  public function new(hxBytes: Null<Bytes>, bytes: Uint8Array,
      bufferValue: ArrayBuffer) {
    this.hxBytes = hxBytes;
    this.bytes = bytes;
    this.bufferValue = bufferValue;
  }
}
