package hostglobals;

/** Uses the JavaScript host's existing global console in every output profile. */
@:native("console")
extern class NodeConsole {
  static function log(value: String): Void;
}
