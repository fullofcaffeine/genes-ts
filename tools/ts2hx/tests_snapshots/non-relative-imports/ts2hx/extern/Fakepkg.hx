package ts2hx.extern;

@:jsRequire("fakepkg")
extern class Fakepkg {
  @:native("default") static var __default: Dynamic;
  static var add: Dynamic;
  static var PI: Dynamic;
}
