package module_directives;

/** Narrow typed boundary for the host console used by the runtime fixture. */
@:native("console")
extern class HostConsole {
  public static function log(message: String): Void;
}
