package transaction;

/** First variant-sensitive module used to detect premature publication. */
class MarkerA {
  public static function value(): String {
    #if output_transaction_v2
    return 'published-v2-a';
    #else
    return 'published-v1-a';
    #end
  }
}
