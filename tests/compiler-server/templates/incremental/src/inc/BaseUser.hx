package inc;

class BaseUser {
  public static function run(): String {
    final value: Base = new Derived();
    return value.common() /*BASE_RARE*/;
  }
}
