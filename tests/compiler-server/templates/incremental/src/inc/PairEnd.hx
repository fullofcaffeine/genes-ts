package inc;

/** Names `inc.PairWayA` in a type position; the walk visits it before `inc.PairStart`. */
class PairEnd {
  public static function run(): String {
    final hint: Null<PairWayA> = null;
    return hint == null ? "end" : "end?";
  }
}
