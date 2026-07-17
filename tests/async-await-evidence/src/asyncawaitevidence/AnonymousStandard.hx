package asyncawaitevidence;

import genes.js.Async.await;
import js.lib.Promise;

/** Proves the syntax-lowered anonymous async form remains ordinary Haxe JS. */
class AnonymousStandard {
  static function main() {
    final plusOne = @:async function(value:Int):Promise<Int> {
      return await(Promise.resolve(value)) + 1;
    };
    plusOne(41).then(value -> AnonymousConsole.log(Std.string(value)));
  }
}

/** Narrow typed binding to the host console used by the runtime transcript. */
@:native("console")
private extern class AnonymousConsole {
  static function log(value:String):Void;
}
