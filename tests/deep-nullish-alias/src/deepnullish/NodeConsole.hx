package deepnullish;

/**
 * Gives this test a typed way to print through Node.js's existing console.
 *
 * Why: each compiler profile must print the same JSON result, but this fixture
 * should not use `Dynamic` or a raw JavaScript expression merely to call
 * `console.log`.
 *
 * What: `extern` says that Node.js provides the implementation at runtime.
 * `@:native("console")` connects this Haxe name to Node's global `console`
 * object; it does not generate a new `NodeConsole` class.
 *
 * How: the single `log(String)` declaration exposes only the operation the
 * fixture needs and lets Haxe check the message type at compile time.
 */
@:native("console")
extern class NodeConsole {
  public static function log(message:String):Void;
}
