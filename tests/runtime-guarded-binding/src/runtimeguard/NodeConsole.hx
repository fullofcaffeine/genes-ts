package runtimeguard;

/**
 * Minimal typed Node console boundary shared by all three JavaScript profiles.
 *
 * `@:jsRequire` emits a real `node:console` import. The fixture needs only the
 * one precisely typed operation below, so it does not expose Node's broader
 * dynamic console surface.
 */
@:jsRequire("node:console")
extern class NodeConsole {
  @:native("log")
  public static function log(value: String): Void;
}
