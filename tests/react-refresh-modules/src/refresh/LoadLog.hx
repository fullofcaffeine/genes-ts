package refresh;

/** Records the order in which fixture modules run their static initializers. */
class LoadLog {
  public static final entries: Array<String> = [];

  public static function record(name: String): String {
    entries.push(name);
    return name;
  }
}
