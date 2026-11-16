package kepttypes;

/**
 * Two declarations with an open type: `items` and `keep` have no written
 * type, and nothing in this module fixes it. Haxe leaves a monomorph (a type
 * that is not known yet) there.
 *
 * No case edits this file. The after-typing gate edits `HolderUser`, which
 * then fixes both types to `Phase` from another module. Haxe does not type
 * this class again for that, so its stamp stays.
 */
@:keep
class Holder {
  public static var items = [];

  public static function keep(value) {
    return value;
  }
}
