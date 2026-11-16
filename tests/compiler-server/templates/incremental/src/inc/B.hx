package inc;

class B {
  public static function run(): String {
    /*TYPE_ONLY_USE*/
    return "b:" + Shared.label("b");
  }
}
