package inc;

/** Haxe adds one static field to this class for each new type argument of `make`. */
class GenericMethod {
  @:generic public static function make<T>(value: T): Array<T> {
    return [value];
  }

  public static function plain(): Int {
    return 1;
  }
}
