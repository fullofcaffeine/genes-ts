package inc;

/** Prints the type `inc.Shade` (genes-f8vc.9.27, M2b). */
class ShadeUser {
  public static var current: Shade = Dark;

  public static function value(): String {
    final shade: Shade = Light;
    return shade == current ? "same" : "other";
  }
}
