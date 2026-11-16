package inc;

class A {
  public static function run(): String {
    return "a:" + Shared.label("a") + Consts.LIMIT /*HELPER_USE*/;
  }
}
