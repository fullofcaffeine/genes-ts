package enumpayload;

/**
 * Same constructor spelling and indexes as `Reduction`.
 *
 * The compile-time probe uses it to prove constructor names are not treated as
 * enum identity.
 */
enum ShadowReduction<Item, Safety, Quality, Result> {
  Crashed(error: ShadowFailure,
    at: Item):ShadowReduction<Item, ShadowFailure, Quality, Result>;
  Failed(error: ShadowFailure):ShadowReduction<Item, Safety, ShadowFailure,
    Result>;
  Reduced(result: Result):ShadowReduction<Item, Safety, Quality, Result>;
}

class ShadowFailure {
  public function new() {}
}
