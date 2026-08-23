package mapdynamic;

/** Precise extern for the Node-hosted JavaScript console used by this fixture. */
@:native("console")
extern class NodeConsole {
  static function log(value: String): Void;
}
