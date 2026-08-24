package asyncawaitinvalid;

import genes.internal.NativeAsyncMarker;
import js.lib.Promise;

/** Proves an effectful value cannot impersonate the inert return witness. */
class EffectfulReturnWitness {
  static function effectful(): Promise<Int> {
    return Promise.resolve(0);
  }

  @:jsAsync
  static function invalid(): Promise<Int> {
    return NativeAsyncMarker.returnValue(effectful(), 1);
  }

  static function main(): Void {
    invalid();
  }
}
