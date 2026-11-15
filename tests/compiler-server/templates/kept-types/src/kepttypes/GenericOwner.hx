package kepttypes;

/**
 * Owns a `@:generic` method. For each new type argument that a caller uses,
 * Haxe adds one static field to this class, for example `make_Int`.
 *
 * No case edits this file. `GenericUser` starts to call `make` during the
 * test. Haxe then adds `make_Int` here but does not type this class again:
 * the class object and its stamp stay, and the member list changes.
 */
class GenericOwner {
  @:generic
  public static function make<T>(value: T): Array<T> {
    final list = [value];
    return list;
  }

  public static function plain(): Int {
    return 1;
  }
}
