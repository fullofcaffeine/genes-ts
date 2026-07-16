package ts2hx;

/**
 * Compiler-internal abrupt completion for translated try/finally.
 *
 * Why: a source return, break, or continue cannot directly leave the
 * synthetic callbacks used to run a finalizer exactly once.
 * What: null represents normal callback completion; enum values carry only
 * the typed transfer that still belongs to an enclosing source target.
 * How: genes.js.FinallyCompletion applies finalizer precedence, then ts2hx
 * statically dispatches or propagates the result. Host throws stay throws.
 * Genes keeps this type local to implementation and omits declarations,
 * runtime registration, public exports, and source mappings.
 */
@:genes.compilerInternal
private enum __Ts2hxFinallyAbrupt2<T> {
  ReturnValue(value:T);
  ReturnVoid;
  BreakTo(target:Int);
  ContinueTo(target:Int);
}

final events: Array<String> = [];

typedef __Ts2hxFinallyAbrupt = String;

function nestedReturn(): Float {
  final __ts2hx_completion0 = "source-local";
  events.push(__ts2hx_completion0);
  final __ts2hx_completion1:Null<__Ts2hxFinallyAbrupt2<Float>> =
    genes.js.FinallyCompletion.run(
      function():Null<__Ts2hxFinallyAbrupt2<Float>> {
        final __ts2hx_completion2:Null<__Ts2hxFinallyAbrupt2<Float>> =
          genes.js.FinallyCompletion.run(
            function():Null<__Ts2hxFinallyAbrupt2<Float>> {
              events.push("body");
              final __ts2hx_return_value3:Float = 1;
              return __Ts2hxFinallyAbrupt2.ReturnValue(__ts2hx_return_value3);
              return null;
            },
            function():Null<__Ts2hxFinallyAbrupt2<Float>> {
              events.push("inner");
              return null;
            }
          );
        if (__ts2hx_completion2 != null) return __ts2hx_completion2;
        return null;
      },
      function():Null<__Ts2hxFinallyAbrupt2<Float>> {
        events.push("outer");
        final __ts2hx_return_value4:Float = 2;
        return __Ts2hxFinallyAbrupt2.ReturnValue(__ts2hx_return_value4);
        return null;
      }
    );
  switch (__ts2hx_completion1) {
    case __Ts2hxFinallyAbrupt2.ReturnValue(value):
      return value;
    case null:
      {}
    default:
      throw new haxe.Exception("ts2hx received an unplanned completion variant.");
  }
  throw new haxe.Exception("Typed completion function nestedReturn reached impossible fallthrough.");
}

function returnOverThrow(): Float {
  final __ts2hx_completion5:Null<__Ts2hxFinallyAbrupt2<Float>> =
    genes.js.FinallyCompletion.run(
      function():Null<__Ts2hxFinallyAbrupt2<Float>> {
        throw new js.lib.Error("protected");
        return null;
      },
      function():Null<__Ts2hxFinallyAbrupt2<Float>> {
        events.push("throw-finally");
        final __ts2hx_return_value6:Float = 3;
        return __Ts2hxFinallyAbrupt2.ReturnValue(__ts2hx_return_value6);
        return null;
      }
    );
  switch (__ts2hx_completion5) {
    case __Ts2hxFinallyAbrupt2.ReturnValue(value):
      return value;
    case null:
      {}
    default:
      throw new haxe.Exception("ts2hx received an unplanned completion variant.");
  }
  throw new haxe.Exception("Typed completion function returnOverThrow reached impossible fallthrough.");
}

function bareReturn(): Void {
  final __ts2hx_completion7:Null<__Ts2hxFinallyAbrupt2<Void>> =
    genes.js.FinallyCompletion.run(
      function():Null<__Ts2hxFinallyAbrupt2<Void>> {
        events.push("void-body");
        return __Ts2hxFinallyAbrupt2.ReturnVoid;
        return null;
      },
      function():Null<__Ts2hxFinallyAbrupt2<Void>> {
        events.push("void-finally");
        return null;
      }
    );
  switch (__ts2hx_completion7) {
    case __Ts2hxFinallyAbrupt2.ReturnVoid:
      return;
    case null:
      {}
    default:
      throw new haxe.Exception("ts2hx received an unplanned completion variant.");
  }
}

function main(): Void {
  final nested = nestedReturn();
  final overridden = returnOverThrow();
  bareReturn();
  trace(("FINALLY_RETURN_OK:" + nested + ":" + overridden + ":" + events.join("|")));
}
