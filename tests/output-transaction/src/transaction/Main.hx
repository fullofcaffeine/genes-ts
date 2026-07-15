package transaction;

/**
 * Builds several independently emitted modules for output-transaction QA.
 *
 * The conditional stale module lets the harness prove that a later successful
 * compilation removes only paths named by the prior ownership manifest.
 */
class Main {
  static function values(): Array<String> {
    final result = [MarkerA.value(), MarkerB.value()];
    #if output_transaction_include_stale
    result.push(StaleMarker.value());
    #end
    return result;
  }

  static function main(): Void {
    trace(values().join(':'));
  }
}
