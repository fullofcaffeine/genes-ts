package hostglobals;

import hostglobals.HostGlobals.NativeFailure;

class Main {
  public static function main(): Void {
    final hostError = HostGlobals.makeError("host-error");
    final errorConstructorMatches = HostGlobals.errorConstructor() == js.lib.Error;
    final promiseConstructorMatches = HostGlobals.promiseConstructor() == js.lib.Promise;
    final exceptionConstructorRetained = HostGlobals.exceptionConstructor() != null;
    final nativeFailureConstructorRetained = HostGlobals.nativeFailureConstructor() == NativeFailure;

    // Retain Haxe's cyclic haxe.Exception superclass module in the generated
    // project, where its exact js.lib.Error base must also stay host-qualified.
    try {
      throw hostError;
    } catch (_:Dynamic) {}

    HostGlobals.acceptPromise(HostGlobals.makePromise("resolved"))
      .then(value -> {
        NodeConsole.log([
          HostGlobals.localMarkers(),
          hostError.message,
          Std.string(HostGlobals.isHostError(hostError)),
          Std.string(errorConstructorMatches),
          Std.string(promiseConstructorMatches),
          Std.string(exceptionConstructorRetained),
          Std.string(nativeFailureConstructorRetained),
          value
        ].join("|"));
        return value;
      });
  }
}
