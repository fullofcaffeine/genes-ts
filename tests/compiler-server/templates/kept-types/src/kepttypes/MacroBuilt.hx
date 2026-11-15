package kepttypes;

/**
 * No case edits this file. Its build macro reads `shape.txt` and the class
 * `MacroDep`, so Haxe types this module again when one of them changes.
 */
@:build(kepttypes.BuildMacro.build())
class MacroBuilt {
  public static function describe(): String {
    return Std.string(shape) + Std.string(seedCopy);
  }
}
