package asyncawaitevidence;

import genes.js.Async.await;
import js.lib.Error;
import js.lib.Promise;
import js.lib.Promise.Thenable;

typedef AsyncEvidenceReport = {
  final staticValue: Int;
  final instanceValue: Int;
  final anonymousValue: Int;
  final nestedValue: Int;
  final promisedValue: Int;
  final anonymousPromisedValue: Int;
  final widenedValue: Float;
  final thenableValue: Int;
  final anonymousThenableValue: Int;
  final authoredCastValue: String;
  final nestedSyncValue: String;
  final defaultValue: Int;
  final copiedNameValue: Int;
  final copiedRawValue: Int;
  final propertyAndIndex: String;
  final recoveredError: String;
  final voidCompleted: Bool;
  final evaluations: Int;
  final events: Array<String>;
}

typedef AsyncPayload = {
  final label: String;
  final values: Array<Int>;
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
  static var events: Array<String> = [];
  static var evaluations = 0;

  final offset: Int;

  public function new(offset: Int) {
    this.offset = offset;
  }

  static function tracked(label: String, value: Int): Promise<AsyncPayload> {
    evaluations++;
    events.push('evaluate:$label');
    return Promise.resolve({label: label, values: [value, value + 1]});
  }

  @:async
  static function staticAsync(value: Int): Promise<Int> {
    events.push("static:before");
    final resolved = await(Promise.resolve(value));
    events.push("static:after");
    return resolved + 2;
  }

  @:async
  function instanceAsync(value: Int): Promise<Int> {
    final resolved = @:await Promise.resolve(value);
    return resolved + offset;
  }

  @:async
  static function anonymousAsync(): Promise<Int> {
    final increment = @:async function(value: Int): Promise<Int> {
      return (@:await Promise.resolve(value)) + 1;
    };
    return @:await increment(41);
  }

  @:async
  static function nestedAnonymousAsync(): Promise<Int> {
    final outer = @:async function(base: Int): Promise<Int> {
      final inner = @:async function(increment: Int): Promise<Int> {
        return await(Promise.resolve(base)) + increment;
      };
      return @:await inner(2);
    };
    return @:await outer(40);
  }

  /** Proves native async adopts an already promised return value. */
  @:async
  static function promisedAsync(value: Int): Promise<Int> {
    return Promise.resolve(value);
  }

  /** Proves the same promise pass-through contract for anonymous async. */
  @:async
  static function anonymousPromisedAsync(): Promise<Int> {
    final promised = @:async function(value: Int): Promise<Int> {
      return Promise.resolve(value);
    };
    return @:await promised(42);
  }

  /** Proves the carrier preserves Haxe's valid scalar return widening. */
  @:async
  static function widenedAsync(): Promise<Float> {
    return 42;
  }

  static function promisedAsThenable(value: Int): Thenable<Int> {
    return Promise.resolve(value);
  }

  /** Proves native async adopts a Promise-compatible thenable. */
  @:async
  static function thenableAsync(value: Int): Promise<Int> {
    return promisedAsThenable(value);
  }

  /** Proves the same thenable contract for anonymous async. */
  @:async
  static function anonymousThenableAsync(): Promise<Int> {
    final promised = @:async function(value: Int): Promise<Int> {
      return promisedAsThenable(value);
    };
    return @:await promised(42);
  }

  /** Proves the macro erases only its outer return bridge. */
  @:async
  static function authoredCastAsync(value: String): Promise<String> {
    return cast value;
  }

  /** Proves a nested synchronous function does not inherit async authority. */
  @:async
  static function nestedSyncAsync(): Promise<String> {
    final identity = function(value: String): String {
      return value;
    };
    return identity(@:await Promise.resolve("42"));
  }

  /** Proves defaults do not inherit the anonymous function's async context. */
  @:async
  static function defaultAnonymousAsync(): Promise<Int> {
    final withDefault = @:async function(value: Int = 40): Promise<Int> {
      return value + 2;
    };
    return @:await withDefault();
  }

  /** A copied member name is an ordinary user call, not compiler evidence. */
  static function copiedMarkerName(value: Int): Int {
    return NativeAsyncMarker.functionValue(value);
  }

  /** A copied raw template remains authored target code, not plan authority. */
  static function copiedRawAsync(): Promise<Int> {
    final raw: () -> Promise<Int> = js.Syntax.code("async {0}",
      function(): Promise<Int> {
        return Promise.resolve(42);
      });
    return raw();
  }

  @:async
  static function propertyAndIndexAsync(): Promise<String> {
    final property = (@:await tracked("property", 10)).label;
    events.push("between:property:index");
    final indexed = (await(tracked("index", 20))).values[1];
    return '$property:$indexed';
  }

  @:async
  static function throwAfterAwait(): Promise<Int> {
    @:await Promise.resolve(null);
    throw new Error("async-error");
  }

  @:async
  static function recoverAsyncError(): Promise<String> {
    try {
      @:await throwAfterAwait();
      return "missing-error";
    } catch (error:Error) {
      return error.message;
    }
  }

  @:async
  static function voidAsync(state: Array<Bool>): Promise<Void> {
    @:await Promise.resolve(null);
    events.push("void:effect");
    state[0] = true;
  }

  @:async
  static function run(): Promise<AsyncEvidenceReport> {
    events = [];
    evaluations = 0;
    final voidState = [false];
    final staticValue = @:await staticAsync(40);
    final instanceValue = @:await new Main(2).instanceAsync(40);
    final anonymousValue = @:await anonymousAsync();
    final nestedValue = @:await nestedAnonymousAsync();
    final promisedValue = @:await promisedAsync(42);
    final anonymousPromisedValue = @:await anonymousPromisedAsync();
    final widenedValue = @:await widenedAsync();
    final thenableValue = @:await thenableAsync(42);
    final anonymousThenableValue = @:await anonymousThenableAsync();
    final authoredCastValue = @:await authoredCastAsync("42");
    final nestedSyncValue = @:await nestedSyncAsync();
    final defaultValue = @:await defaultAnonymousAsync();
    final copiedNameValue = copiedMarkerName(42);
    final copiedRawValue = @:await copiedRawAsync();
    final propertyAndIndex = @:await propertyAndIndexAsync();
    final recoveredError = @:await recoverAsyncError();
    @:await voidAsync(voidState);
    return {
      staticValue: staticValue,
      instanceValue: instanceValue,
      anonymousValue: anonymousValue,
      nestedValue: nestedValue,
      promisedValue: promisedValue,
      anonymousPromisedValue: anonymousPromisedValue,
      widenedValue: widenedValue,
      thenableValue: thenableValue,
      anonymousThenableValue: anonymousThenableValue,
      authoredCastValue: authoredCastValue,
      nestedSyncValue: nestedSyncValue,
      defaultValue: defaultValue,
      copiedNameValue: copiedNameValue,
      copiedRawValue: copiedRawValue,
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

/** Same spelling, different typed owner: this is ordinary application code. */
private class NativeAsyncMarker {
  public static function functionValue<T>(value: T): T {
    return value;
  }
}

/** Narrow typed binding to the host console used by the runtime transcript. */
@:native("console")
private extern class Console {
  static function log(value: String): Void;
}
