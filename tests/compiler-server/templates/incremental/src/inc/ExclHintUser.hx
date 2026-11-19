package inc;

/**
 * Names the enums of `inc.ExclOwner` only in typedef fields, so the plan of
 * this module has a type-only edge to each enum, and its output imports
 * each one as a type.
 */
typedef ExclHint = {
  final ?early: inc.ExclOwner.ExclEarly;
  final ?late: inc.ExclOwner.ExclLate;
}

class ExclHintUser {
  public static function run(): String {
    final hint: Null<ExclHint> = null;
    return hint == null ? "excl" : "hint";
  }
}
