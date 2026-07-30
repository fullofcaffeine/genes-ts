package enumpayload;

/** Minimal typed Node console boundary shared by every runtime profile. */
@:jsRequire("node:console")
extern class NodeConsole {
  @:native("log")
  public static function log(value: String): Void;
}
