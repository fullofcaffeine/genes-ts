package hostglobals;

/**
 * A user-authored Haxe class that is deliberately unrelated to JavaScript's
 * built-in Promise constructor.
 */
@:keep
class Promise {
  public static function marker(): String {
    return "local-promise";
  }
}

/**
 * A user-authored Haxe class that is deliberately unrelated to JavaScript's
 * built-in Error constructor.
 */
@:keep
class Error {
  public static function marker(): String {
    return "local-error";
  }
}

/** Exercises the exact host Error in an `extends` position. */
@:keep
class NativeFailure extends js.lib.Error {
  public function new(message: String) {
    super(message);
  }
}

/**
 * Keeps local name collisions and exact host uses in the same generated module.
 */
@:keep
class HostGlobals {
  public static function localMarkers(): String {
    return Promise.marker() + "|" + Error.marker();
  }

  public static function acceptPromise(value: js.lib.Promise<String>): js.lib.Promise<String> {
    return value;
  }

  public static function makePromise(value: String): js.lib.Promise<String> {
    return new js.lib.Promise((resolve, _) -> resolve(value));
  }

  public static function resolvePromise(value: String): js.lib.Promise<String> {
    return js.lib.Promise.resolve(value);
  }

  public static function promiseConstructor(): Class<js.lib.Promise<Dynamic>> {
    return js.lib.Promise;
  }

  public static function makeError(message: String): js.lib.Error {
    return new js.lib.Error(message);
  }

  public static function errorConstructor(): Class<js.lib.Error> {
    return js.lib.Error;
  }

  public static function exceptionConstructor(): Class<haxe.Exception> {
    return haxe.Exception;
  }

  public static function nativeFailureConstructor(): Class<NativeFailure> {
    return NativeFailure;
  }

  public static function isHostError(value: Dynamic): Bool {
    return js.Syntax.instanceof(value, js.lib.Error);
  }
}
