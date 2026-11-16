package inc;

class C {
  public static function run(): String {
    final color: Color = Color.Red;
    return "c:" + Shared.label("c") + Consts.LIMIT + Helper.common() + color;
  }
}
