package runtimeguard.negative;

import runtimeguard.GuardedFailure;

/**
 * Negative controls for bindings that are not Haxe's immediate catch lowering.
 *
 * These methods intentionally remain strict-TypeScript errors. The focused
 * harness inspects their generated source without compiling it so a broad
 * assertion cannot hide an invalidated or mismatched proof.
 */
@:access(haxe.Exception)
@:access(js.Boot)
class GuardInvalidation {
  public static function afterDirectWrite(): Void {
    var raw: Dynamic = haxe.Exception.caught(GuardedFailure.Rejected("direct"))
      .unwrap();
    if (js.Boot.__instanceof(raw, GuardedFailure)) {
      raw = "not-a-GuardedFailure";
      final typed: GuardedFailure = raw;
      trace(typed);
    }
  }

  public static function afterClosureWrite(): Void {
    var raw: Dynamic = haxe.Exception.caught(GuardedFailure.Rejected("closure"))
      .unwrap();
    if (js.Boot.__instanceof(raw, GuardedFailure)) {
      final invalidate = function(): Void {
        raw = "not-a-GuardedFailure";
      };
      invalidate();
      final typed: GuardedFailure = raw;
      trace(typed);
    }
  }

  public static function insideNestedFunction(): Void {
    var raw: Dynamic = haxe.Exception.caught(GuardedFailure.Rejected("nested"))
      .unwrap();
    if (js.Boot.__instanceof(raw, GuardedFailure)) {
      final readLater = function(): GuardedFailure {
        final typed: GuardedFailure = raw;
        return typed;
      };
      trace(readLater);
    }
  }

  public static function fromDifferentRaw(): Void {
    var raw: Dynamic = haxe.Exception.caught(GuardedFailure.Rejected("guarded"))
      .unwrap();
    final other: Dynamic = "not-a-GuardedFailure";
    if (js.Boot.__instanceof(raw, GuardedFailure)) {
      final typed: GuardedFailure = other;
      trace(typed);
    }
  }

  public static function withDifferentType(): Void {
    var raw: Dynamic = haxe.Exception.caught(GuardedFailure.Rejected("type"))
      .unwrap();
    if (js.Boot.__instanceof(raw, GuardedFailure)) {
      final typed: OtherFailure = raw;
      trace(typed);
    }
  }
}
