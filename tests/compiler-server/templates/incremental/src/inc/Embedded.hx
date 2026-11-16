package inc;

/**
 * Reads a resource that the build embeds with `-resource`. No module imports
 * this one; the command line names it.
 *
 * The shadow gate changes the resource file and no Haxe source. Haxe then
 * types no module again, but the output of `haxe.Resource` changes, because
 * that module holds the resource bytes.
 */
@:keep
class Embedded {
  public static function value(): String {
    final text = haxe.Resource.getString("note");
    return text == null ? "none" : text;
  }
}
