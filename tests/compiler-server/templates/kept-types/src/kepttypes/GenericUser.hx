package kepttypes;

/**
 * No module imports this one; the test names it on the command line. An edit
 * makes it the first caller of `GenericOwner.make`.
 */
class GenericUser {
  public static function run(): Int {
    return GenericOwner.plain(); // generic-user-body
  }
}
