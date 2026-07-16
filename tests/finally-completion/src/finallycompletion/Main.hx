package finallycompletion;

import genes.js.FinallyCompletion;

/**
 * Compiler-local object used to prove raw object throw identity.
 *
 * Why/What/How: a Haxe `Exception` alone would not prove that the helper
 * preserves an arbitrary object thrown by JavaScript code. This typed token is
 * thrown and caught by identity in every JS profile, while
 * `@:genes.compilerInternal` keeps the evidence type out of application API.
 */
@:genes.compilerInternal
private class FailureToken {
  public final label:String;

  public function new(label:String) {
    this.label = label;
  }
}

/**
 * Typed carrier used to exercise the opaque `FinallyCompletion` contract.
 *
 * Why: control flow cannot leave a synthetic callback directly, so future
 * ts2hx lowering needs a value that says which source action is still pending.
 *
 * What: each constructor models a return or stable loop target. The helper
 * itself does not know this enum; it only distinguishes `null` (normal) from a
 * non-null completion.
 *
 * How: the generic payload keeps value returns strongly typed, including
 * `Void` and nullable values. `@:genes.compilerInternal` leaves the enum
 * available to local implementation typing while both Genes profiles omit it
 * from application exports, declarations, registries, and source mappings.
 */
@:genes.compilerInternal
private enum Abrupt<T> {
  ReturnValue(value:T);
  ReturnVoid;
  BreakTo(target:Int);
  ContinueTo(target:Int);
}

/** Executable precedence and exactly-once evidence for the completion runner. */
class Main {
  static function expect(condition:Bool, message:String):Void {
    if (!condition)
      throw new haxe.Exception(message);
  }

  static function expectEvents(actual:Array<String>, expected:String,
      context:String):Void {
    expect(actual.join("|") == expected,
      '$context: expected $expected, received ${actual.join("|")}');
  }

  static function intValue(completion:Null<Abrupt<Int>>,
      context:String):Int {
    return switch completion {
      case ReturnValue(value): value;
      case null: throw new haxe.Exception('$context: normal completion');
      case ReturnVoid: throw new haxe.Exception('$context: void completion');
      case BreakTo(target):
        throw new haxe.Exception('$context: break target $target');
      case ContinueTo(target):
        throw new haxe.Exception('$context: continue target $target');
    };
  }

  /** Proves normal preservation and pre-finalizer return-value evaluation. */
  static function testNormalAndPreservedValue():Void {
    final normalEvents:Array<String> = [];
    var normalBodyCalls = 0;
    var normalFinalizerCalls = 0;
    final normal:Null<Abrupt<Void>> = FinallyCompletion.run(
      function():Null<Abrupt<Void>> {
        normalBodyCalls++;
        normalEvents.push("body-normal");
        return null;
      },
      function():Null<Abrupt<Void>> {
        normalFinalizerCalls++;
        normalEvents.push("finally-normal");
        return null;
      }
    );
    expect(normal == null, "normal completion remains normal");
    expect(normalBodyCalls == 1, "normal body runs once");
    expect(normalFinalizerCalls == 1, "normal finalizer runs once");
    expectEvents(normalEvents, "body-normal|finally-normal", "normal order");

    final valueEvents:Array<String> = [];
    var evaluations = 0;
    function evaluateReturn():Int {
      evaluations++;
      valueEvents.push("return-value");
      return 7;
    }
    final preserved:Null<Abrupt<Int>> = FinallyCompletion.run(
      function():Null<Abrupt<Int>> {
        valueEvents.push("body");
        return ReturnValue(evaluateReturn());
      },
      function():Null<Abrupt<Int>> {
        valueEvents.push("finally");
        return null;
      }
    );
    expect(intValue(preserved, "preserved return") == 7,
      "normal finalizer preserves the return payload");
    expect(evaluations == 1, "return expression evaluates once");
    expectEvents(valueEvents, "body|return-value|finally",
      "return evaluation order");
  }

  /** Proves finalizer records override normal and abrupt protected results. */
  static function testRecordPrecedence():Void {
    final normalOverride:Null<Abrupt<Void>> = FinallyCompletion.run(
      function():Null<Abrupt<Void>> return null,
      function():Null<Abrupt<Void>> return ReturnVoid
    );
    expect(switch normalOverride {
      case ReturnVoid: true;
      default: false;
    }, "finalizer record overrides normal protected completion");

    final targetOverride:Null<Abrupt<Void>> = FinallyCompletion.run(
      function():Null<Abrupt<Void>> return BreakTo(1),
      function():Null<Abrupt<Void>> return ContinueTo(2)
    );
    expect(switch targetOverride {
      case ContinueTo(2): true;
      default: false;
    }, "finalizer target overrides protected target");

    final voidCompletion:Null<Abrupt<Void>> = FinallyCompletion.run(
      function():Null<Abrupt<Void>> return ReturnVoid,
      function():Null<Abrupt<Void>> return null
    );
    expect(switch voidCompletion {
      case ReturnVoid: true;
      default: false;
    }, "Void carrier needs no fabricated payload");

    final nullable:Null<Abrupt<Null<String>>> = FinallyCompletion.run(
      function():Null<Abrupt<Null<String>>> return ReturnValue(null),
      function():Null<Abrupt<Null<String>>> return null
    );
    expect(switch nullable {
      case ReturnValue(value): value == null;
      default: false;
    }, "nullable payload remains distinct from normal completion");
  }

  /** Proves body throws are preserved or replaced without changing identity. */
  static function testProtectedThrowPrecedence():Void {
    final objectError = new FailureToken("protected-object");
    var objectFinalizerCalls = 0;
    try {
      final ignored:Null<Abrupt<Void>> = FinallyCompletion.run(
        function():Null<Abrupt<Void>> throw objectError,
        function():Null<Abrupt<Void>> {
          objectFinalizerCalls++;
          return null;
        }
      );
      throw new haxe.Exception('protected object throw was lost: $ignored');
    } catch (caught:FailureToken) {
      expect(caught == objectError,
        "normal finalizer rethrows the exact protected object");
    }
    expect(objectFinalizerCalls == 1,
      "protected object throw runs its normal finalizer once");

    final stringError = "protected-string";
    var stringFinalizerCalls = 0;
    try {
      final ignored:Null<Abrupt<Void>> = FinallyCompletion.run(
        function():Null<Abrupt<Void>> throw stringError,
        function():Null<Abrupt<Void>> {
          stringFinalizerCalls++;
          return null;
        }
      );
      throw new haxe.Exception('protected string throw was lost: $ignored');
    } catch (caught:String) {
      expect(caught == stringError,
        "normal finalizer rethrows the exact protected string");
    }
    expect(stringFinalizerCalls == 1,
      "protected string throw runs its normal finalizer once");

    final nativeError = new js.lib.Error("protected-error");
    var nativeFinalizerCalls = 0;
    try {
      final ignored:Null<Abrupt<Void>> = FinallyCompletion.run(
        function():Null<Abrupt<Void>> throw nativeError,
        function():Null<Abrupt<Void>> {
          nativeFinalizerCalls++;
          return null;
        }
      );
      throw new haxe.Exception('protected native throw was lost: $ignored');
    } catch (caught:js.lib.Error) {
      expect(caught == nativeError,
        "normal finalizer rethrows the exact native Error");
    }
    expect(nativeFinalizerCalls == 1,
      "protected native Error runs its normal finalizer once");

    final bodyError = new haxe.Exception("protected-suppressed");
    final suppressed:Null<Abrupt<Int>> = FinallyCompletion.run(
      function():Null<Abrupt<Int>> throw bodyError,
      function():Null<Abrupt<Int>> return ReturnValue(19)
    );
    expect(intValue(suppressed, "throw override") == 19,
      "finalizer record suppresses a protected throw");
  }

  /** Proves a throwing finalizer wins and is never invoked twice. */
  static function testFinalizerThrowPrecedence():Void {
    final finalizerError = new haxe.Exception("finalizer");
    var successPathCalls = 0;
    try {
      final ignored:Null<Abrupt<Int>> = FinallyCompletion.run(
        function():Null<Abrupt<Int>> return ReturnValue(1),
        function():Null<Abrupt<Int>> {
          successPathCalls++;
          throw finalizerError;
        }
      );
      throw new haxe.Exception('finalizer throw was lost: $ignored');
    } catch (caught:haxe.Exception) {
      expect(caught == finalizerError,
        "finalizer throw overrides a protected return");
    }
    expect(successPathCalls == 1,
      "success-path throwing finalizer runs once");

    final bodyError = new haxe.Exception("body-before-finalizer");
    var throwPathCalls = 0;
    try {
      final ignored:Null<Abrupt<Void>> = FinallyCompletion.run(
        function():Null<Abrupt<Void>> throw bodyError,
        function():Null<Abrupt<Void>> {
          throwPathCalls++;
          throw finalizerError;
        }
      );
      throw new haxe.Exception('throwing finalizer was lost: $ignored');
    } catch (caught:haxe.Exception) {
      expect(caught == finalizerError,
        "finalizer throw overrides a protected throw");
    }
    expect(throwPathCalls == 1,
      "throw-path throwing finalizer runs once");
  }

  public static function main():Void {
    testNormalAndPreservedValue();
    testRecordPrecedence();
    testProtectedThrowPrecedence();
    testFinalizerThrowPrecedence();
    NodeConsole.log("finally-completion:ok");
  }
}
