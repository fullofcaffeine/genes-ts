package inc;

/**
 * A metadata holder in a class initializer (`__init__`), which is a typed
 * body like a field body (review of genes-ts #258). The dependency walk
 * visits it and the printer prints it, so `genes.ts.SignatureCache` must
 * keep its holders too.
 *
 * `inc.BodyMetaMacro` writes `@:ts.type("string")` on the field `sv` of the
 * structure in the declared type of the local `seen`. Without a kept holder,
 * reuse replayed `sv: number` where a cold build prints `sv: string`.
 * `inc.BodyInitGeneric` holds the other shape of the review.
 */
class BodyInit {
  public static var total = 0;

  static function __init__(): Void {
    var seen: {sv: Int} = {sv: 1};
    seen = {sv: 2};
    total = seen.sv;
  }

  public static function value(): String {
    return Std.string(total);
  }
}
