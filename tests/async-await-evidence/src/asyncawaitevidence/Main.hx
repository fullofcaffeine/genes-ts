package asyncawaitevidence;

import genes.js.Async.await;
import js.lib.Error;
import js.lib.Promise;

typedef AsyncEvidenceReport = {
  final staticValue:Int;
  final instanceValue:Int;
  final anonymousValue:Int;
  final nestedValue:Int;
  final propertyAndIndex:String;
  final recoveredError:String;
  final voidCompleted:Bool;
  final evaluations:Int;
  final events:Array<String>;
}

typedef AsyncPayload = {
  final label:String;
  final values:Array<Int>;
}

/**
 * Runs one observable async/await contract through every supported JS profile.
 *
 * Why: native-looking generated source is not proof that awaited expressions,
 * nested callbacks, exceptions, and side effects retain JavaScript ordering.
 *
 * What: the final JSON report records method results, nested anonymous
 * functions, property/index access after await, rejection propagation,
 * Promise<Void> completion, and exact evaluation order.
 *
 * How: the same typed Haxe source is compiled by classic Genes and genes-ts.
 * The owning TypeScript harness compares both transcripts and separately
 * checks native source and source-map positions. Standard Haxe is a guarded
 * negative lane because it cannot emit native async methods from this API.
 */
class Main {
  static var events:Array<String> = [];
  static var evaluations = 0;

  final offset:Int;

  public function new(offset:Int) {
    this.offset = offset;
  }

  static function tracked(label:String, value:Int):Promise<AsyncPayload> {
    evaluations++;
    events.push('evaluate:$label');
    return Promise.resolve({label: label, values: [value, value + 1]});
  }

  @:async
  static function staticAsync(value:Int):Promise<Int> {
    events.push("static:before");
    final resolved = await(Promise.resolve(value));
    events.push("static:after");
    return resolved + 2;
  }

  @:async
  function instanceAsync(value:Int):Promise<Int> {
    final resolved = @:await Promise.resolve(value);
    return resolved + offset;
  }

  @:async
  static function anonymousAsync():Promise<Int> {
    final increment = @:async function(value:Int):Promise<Int> {
      return (@:await Promise.resolve(value)) + 1;
    };
    return @:await increment(41);
  }

  @:async
  static function nestedAnonymousAsync():Promise<Int> {
    final outer = @:async function(base:Int):Promise<Int> {
      final inner = @:async function(increment:Int):Promise<Int> {
        return await(Promise.resolve(base)) + increment;
      };
      return @:await inner(2);
    };
    return @:await outer(40);
  }

  @:async
  static function propertyAndIndexAsync():Promise<String> {
    final property = (@:await tracked("property", 10)).label;
    events.push("between:property:index");
    final indexed = (await(tracked("index", 20))).values[1];
    return '$property:$indexed';
  }

  @:async
  static function throwAfterAwait():Promise<Int> {
    @:await Promise.resolve(null);
    throw new Error("async-error");
  }

  @:async
  static function recoverAsyncError():Promise<String> {
    try {
      @:await throwAfterAwait();
      return "missing-error";
    } catch (error:Error) {
      return error.message;
    }
  }

  @:async
  static function voidAsync(state:Array<Bool>):Promise<Void> {
    @:await Promise.resolve(null);
    events.push("void:effect");
    state[0] = true;
  }

  @:async
  static function run():Promise<AsyncEvidenceReport> {
    events = [];
    evaluations = 0;
    final voidState = [false];
    final staticValue = @:await staticAsync(40);
    final instanceValue = @:await new Main(2).instanceAsync(40);
    final anonymousValue = @:await anonymousAsync();
    final nestedValue = @:await nestedAnonymousAsync();
    final propertyAndIndex = @:await propertyAndIndexAsync();
    final recoveredError = @:await recoverAsyncError();
    @:await voidAsync(voidState);
    return {
      staticValue: staticValue,
      instanceValue: instanceValue,
      anonymousValue: anonymousValue,
      nestedValue: nestedValue,
      propertyAndIndex: propertyAndIndex,
      recoveredError: recoveredError,
      voidCompleted: voidState[0],
      evaluations: evaluations,
      events: events.copy()
    };
  }

  static function main() {
    run().then(report -> Console.log(haxe.Json.stringify(report)));
  }
}

/** Narrow typed binding to the host console used by the runtime transcript. */
@:native("console")
private extern class Console {
  static function log(value:String):Void;
}
