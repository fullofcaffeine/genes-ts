package asyncawaitinvalid;

import genes.internal.NativeAsyncMarker;
import js.lib.Promise;

/** Proves exact marker identity alone cannot bridge a synchronous function. */
class DetachedReturnMarker {
  static function invalid(): Promise<Int> {
    return NativeAsyncMarker.returnValue((null : Promise<Int>), 1);
  }

  static function main() {
    invalid();
  }
}
