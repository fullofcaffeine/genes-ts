typedef Review = {
  final values: Array<String>;
  final ?fingerprint: String;
}

typedef Request = {final review: Review;}
typedef Box<T> = {final value: T;}

/** A non-null named record is a valid input to its nullable counterpart. */
@:keep
class NullableRecordProbe {
  static var evaluations = 0;

  public static function accept(?review: Review): Int
    return review == null ? 0 : review.values.length;

  public static function forward(request: Request): Int
    return accept(request.review);

  public static function throughLocal(request: Request): Int {
    final review: Null<Review> = request.review;
    return accept(review);
  }

  public static function identity(review: Review): Null<Review>
    return review;

  static function evaluated(review: Review): Review {
    evaluations++;
    return review;
  }

  public static function effectful(review: Review): Int
    return accept(evaluated(review));

  static function main() {
    WideningProbe.validate();
    final review: Review = {values: ["kept"]};
    final request: Request = {review: review};
    if (forward(request) != 1 || throughLocal(request) != 1)
      throw "Record changed";
    if (identity(review) != review)
      throw "Record identity changed";
    if (effectful(review) != 1 || evaluations != 1)
      throw "Evaluation count changed";
    if (accept() != 0)
      throw "Missing review changed";
  }
}
