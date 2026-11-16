package inc;

class PropUser {
  public static function run(): Int {
    final prop = new Prop();
    prop.level = 2; /*PROP_WRITE*/
    return prop.level;
  }
}
