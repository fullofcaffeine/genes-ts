package inc;

/**
 * Has locals whose names a new top-level package or type could reserve.
 * Haxe's local-rename filter then renames them in a cold build.
 */
class Locals {
  public static function compute(count: Int): Int {
    var item = count;
    final thing = 2;
    for (index in 0...count)
      item += index;
    return item * thing;
  }
}
