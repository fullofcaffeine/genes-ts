package kepttypes;

/**
 * No module imports this one; the test names it on the command line. Its
 * build macro defines `kepttypes.Clone` each time Haxe types this module, so
 * an edit of this file makes a new `Clone` object.
 */
@:build(kepttypes.CloneMacro.build())
class Cloner {
  static var clone: Null<kepttypes.Clone> = null;

  public static function id(): Int {
    return 7; // cloner-body
  }
}
