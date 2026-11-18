package inc;

import inc.FableMix.FableShade;

/** Prints the type `inc.FableMix.FableShade` (review of genes-ts #249). */
class FableMixUser {
  public static var current: FableShade = Dark;

  public static function value(): String {
    final shade: FableShade = Light;
    return (shade == current ? "same" : "other")
      + FableMix.twice(2)
      + FableMixPlain.thrice(1);
  }
}
