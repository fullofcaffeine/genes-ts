import Main.ReviewState;

enum abstract OtherReviewState(String) to String {
  final Approved = "approved";
}

/** Proves nominal Haxe domains remain distinct before TypeScript exists. */
class WrongReviewState {
  static function accept(state: ReviewState): Void {}

  static function main(): Void {
    accept(OtherReviewState.Approved);
  }
}
