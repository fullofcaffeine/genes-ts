package inc;

/**
 * A real enum. Genes prints extra runtime facts for every enum when the
 * feature `js.Boot.isEnum` is on; the edit of `inc.EnumCheck` turns it on.
 */
enum Shape {
  Circle(radius: Int);
  Square;
}
