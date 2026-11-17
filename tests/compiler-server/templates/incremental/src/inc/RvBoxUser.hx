package inc;

class RvBoxUser {
  public static function run(): String {
    return "rvbox:" + new RvBox<Int>(2).item /*RVBOX_USE*/;
  }
}
