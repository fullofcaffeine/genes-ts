package stdliboverrides;

import haxe.io.Bytes;

@:native("console")
extern class NodeConsole {
  static function log(value: String): Void;
}

final class Main {
  public static function main(): Void {
    NodeConsole.log(Bytes.ofHex("000f107f80ff").toHex());
  }
}
