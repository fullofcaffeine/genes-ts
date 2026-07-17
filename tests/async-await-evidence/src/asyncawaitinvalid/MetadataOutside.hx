package asyncawaitinvalid;

import js.lib.Promise;

/** Proves metadata-style await fails before code generation outside async. */
class MetadataOutside {
  static function main() {
    final value = @:await Promise.resolve(42);
    trace(value);
  }
}
