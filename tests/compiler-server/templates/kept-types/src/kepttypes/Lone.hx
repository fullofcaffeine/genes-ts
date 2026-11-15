package kepttypes;

/**
 * No module imports this one; the probe names it on the command line. An edit
 * of it makes Haxe type this module again and no other module of the fixture.
 */
class Lone {
  public static var label: String = "lone-v1";

  public static function boxed(): Box<String> {
    final box = new Box<String>(label);
    return box;
  }
}
