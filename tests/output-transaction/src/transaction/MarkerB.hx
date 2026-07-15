package transaction;

/** Second variant-sensitive module used to detect mixed output trees. */
class MarkerB {
  public static function value(): String {
    #if output_transaction_v2
    return 'published-v2-b';
    #else
    return 'published-v1-b';
    #end
  }
}
