package inc;

/** Names `inc.ListedTs.ListedBox` only inside a typedef field. */
typedef ListedHint = {
  final ?box: inc.ListedTs.ListedBox;
}

class ListedUser {
  public static function run(): String {
    final hint: Null<ListedHint> = null;
    return hint == null ? "listed" : "hint";
  }
}
