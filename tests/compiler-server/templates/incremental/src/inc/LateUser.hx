package inc;

/** Names `inc.LateEnum` and `inc.LateEnum.LateBox` only inside a typedef field. */
typedef LateHint = {
  final ?late: inc.LateEnum;
  final ?box: inc.LateEnum.LateBox<{lb: Int}>;
  final ?typed: inc.LateEnum.LateTyped;
}

class LateUser {
  public static function run(): String {
    final hint: Null<LateHint> = null;
    return hint == null ? "late" : "hint";
  }
}
