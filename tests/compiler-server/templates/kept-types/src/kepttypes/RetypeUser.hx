package kepttypes;

/**
 * No module imports this one; the test names it on the command line. It
 * reads `RetypeOwner.plain`, so an edit of `RetypeOwner` makes Haxe type this
 * module again. With the `Retype` module check policy Haxe does that in
 * place, in the same class object. Haxe takes the policy of a module in the
 * request that types it, so the test first edits this file with the policy
 * on.
 */
class RetypeUser {
  public static function run(): Int {
    final local = RetypeOwner.plain();
    return local + 1; // retype-user-body
  }
}
