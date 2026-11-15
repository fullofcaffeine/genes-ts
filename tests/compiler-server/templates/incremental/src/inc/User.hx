package inc;

/** Names `Source` only; the type `Target` arrives by inference. */
class User {
  public static function describe(): String {
    final made = Source.make();
    return made.name();
  }
}
