package sideeffectevidence;

/**
 * Typed boundary for the host console used by the runtime evidence transcript.
 *
 * Why: `Sys.println` is unavailable on the JavaScript target and raw
 * `js.Syntax.code` would weaken a compiler fixture. What: `@:native` binds this
 * extern to Node's existing global `console` value without emitting a class or
 * import. How: Genes preserves the identifier and the single typed `log`
 * signature in both output profiles; the fixture uses no broader host surface.
 */
@:native("console")
extern class NodeConsole {
  public static function log(message:String):Void;
}
