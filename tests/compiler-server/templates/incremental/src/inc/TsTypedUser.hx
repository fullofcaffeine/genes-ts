package inc;

/** Names `inc.TsTyped` only in a typedef field (genes-f8vc.9.27, M2a). */
typedef TsTypedHint = {
  final ?typed: inc.TsTyped;
}

class TsTypedUser {
  public static function run(): String {
    final hint: Null<TsTypedHint> = null;
    return hint == null ? "ts-typed" : "hint";
  }
}
