package asyncawaitinvalid;

import genes.internal.NativeAsyncMarker;

/** Proves functionValue cannot authorize a copied non-function occurrence. */
class NonFunctionMarker {
  static function main() {
    NativeAsyncMarker.functionValue(1);
  }
}
