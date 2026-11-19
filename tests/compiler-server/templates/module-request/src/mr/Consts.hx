package mr;

/** An inline constant: other modules copy its value while Haxe types them. */
class Consts {
  public static inline final LIMIT = 3;

  public static function describe(): String {
    return 'limit ' + LIMIT;
  }
}
