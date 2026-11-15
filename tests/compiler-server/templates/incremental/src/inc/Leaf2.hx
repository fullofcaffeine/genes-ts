package inc;

/*LEAF2_IMPORT*/
/** A second module that nothing imports. */
@:keep
class Leaf2 {
  public static function value(): String {
    return "leaf2-v1" /*LEAF2_USE*/;
  }
}
