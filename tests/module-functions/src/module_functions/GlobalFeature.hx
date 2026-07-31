package module_functions;

/**
 * Makes Haxe's `js.Lib.global` feature active for the whole compilation.
 *
 * Genes consequently emits its `$global` compatibility prelude in every
 * runtime module, including an otherwise helper-free direct-function module.
 */
final class GlobalFeature {
  public static function isAvailable(): Bool {
    return js.Lib.global != null;
  }
}
