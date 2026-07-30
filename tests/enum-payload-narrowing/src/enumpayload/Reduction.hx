package enumpayload;

/**
 * Generic result whose first two failures become impossible when their
 * corresponding type parameter is `Never`.
 */
enum Reduction<Item, Safety, Quality, Result> {
  Crashed(error: Failure, at: Item):Reduction<Item, Failure, Quality, Result>;
  Failed(error: Failure):Reduction<Item, Safety, Failure, Result>;
  Reduced(result: Result):Reduction<Item, Safety, Quality, Result>;
}

class Failure {
  public final message: String;

  public function new(message: String) {
    this.message = message;
  }
}
