package inc;

/** Review probe (round 3): prints a call into the extern `inc.ExtApi`. */
class ExtUser {
  public static function run(): String {
    return Std.string(ExtApi.parseInt("42"));
  }
}
