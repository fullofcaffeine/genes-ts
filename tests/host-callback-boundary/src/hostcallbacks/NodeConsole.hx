package hostcallbacks;

@:jsRequire("node:console")
extern class NodeConsole {
  @:native("log")
  public static function log(value: Dynamic): Void;
}
