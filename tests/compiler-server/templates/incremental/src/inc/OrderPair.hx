package inc;

/**
 * Two members of one module (genes-zt9w). A static initializer of
 * `inc.OrderA` that names `OrderPairB` makes Haxe list `OrderPairB` first,
 * so the printed order of the module changes. Haxe does not type this
 * module again; the request must generate in full.
 */
@:keep
class OrderPairA {
  public static function size(): Int {
    return 1;
  }
}

@:keep
class OrderPairB {
  public static function size(): Int {
    return 2;
  }
}
