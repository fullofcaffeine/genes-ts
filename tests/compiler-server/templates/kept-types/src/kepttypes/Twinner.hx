package kepttypes;

/**
 * No module imports this one; the after-typing gate names it on the command
 * line. Its build macro defines `kepttypes.Twin` each time Haxe types this
 * module, with the stamp of the earlier `Twin` (see `TwinMacro`).
 */
@:twin("phase") // twin-kind
@:build(kepttypes.TwinMacro.build())
class Twinner {
  public static function state(): String {
    return Std.string(kepttypes.Twin.state);
  }
}
