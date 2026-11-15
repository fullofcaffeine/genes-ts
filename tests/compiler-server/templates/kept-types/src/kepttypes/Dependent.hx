package kepttypes;

/**
 * No case edits this file. Haxe types it again when `Dep` changes, because
 * the types of `value` and `local` come from `Dep.make`.
 */
class Dependent {
  public static var value = Dep.make();

  public static function read() {
    final local = Dep.make();
    final inlined = Untouched.twice([local].length);
    return [local].concat([for (_ in 0...inlined) local]);
  }
}
