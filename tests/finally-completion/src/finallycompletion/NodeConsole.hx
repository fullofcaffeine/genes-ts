package finallycompletion;

/**
 * Typed boundary for the Node console used by the runtime transcript.
 *
 * Why/What/How: `@:native` binds this extern to the existing host `console`
 * value, so the fixture can report one deterministic result without raw target
 * syntax, a generated wrapper, or a broader host API.
 */
@:native("console")
extern class NodeConsole {
  public static function log(message:String):Void;
}
