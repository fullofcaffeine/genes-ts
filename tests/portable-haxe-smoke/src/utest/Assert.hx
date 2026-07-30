package utest;

import haxe.PosInfos;

/**
 * Small typed assertion adapter for the reviewed official-Haxe smoke subset.
 *
 * Why: the selected upstream Haxe tests use utest's assertion surface, but
 * compiling the complete historical utest runner would make strict TypeScript
 * validate unrelated reporting, reflection, and browser compatibility code.
 * That would test utest's own TS suitability instead of Genes' handling of the
 * selected Haxe language behavior.
 *
 * What: this class implements only the assertion methods referenced by the
 * pinned `unit.Test` base class. Each call increments a deterministic count;
 * a false assertion records a failure and its source position.
 *
 * How: `PortableSmokeMain` invokes the exact official test methods directly.
 * No upstream assertion is removed or rewritten. An unsupported helper would
 * fail during Haxe typing, which forces the reviewed adapter to grow explicitly
 * when the smoke inventory changes.
 */
final class Assert {
  static var assertionCount = 0;
  static var failureMessages = new Array<String>();
  #if genes.portable.inject_missing_assertion_count
  static var omitNextCount = true;
  #end

  public static function reset(): Void {
    assertionCount = 0;
    failureMessages = [];
    #if genes.portable.inject_missing_assertion_count
    omitNextCount = true;
    #end
  }

  public static function assertions(): Int {
    return assertionCount;
  }

  public static function failures(): Array<String> {
    return failureMessages.copy();
  }

  public static function equals<T>(expected: T, actual: T,
      ?pos: PosInfos): Bool {
    return record(expected == actual, "values are not equal", pos);
  }

  public static function floatEquals(expected: Float, actual: Float,
      ?pos: PosInfos): Bool {
    final equal = if (Math.isNaN(expected)) {
      Math.isNaN(actual);
    } else if (!Math.isFinite(expected) && !Math.isFinite(actual)) {
      (expected > 0) == (actual > 0);
    } else {
      Math.abs(actual - expected) <= 1e-5;
    }
    return record(equal, "floating-point values are not equal", pos);
  }

  public static function same<T>(expected: Array<T>, actual: Array<T>,
      ?pos: PosInfos): Bool {
    var equal = expected.length == actual.length;
    if (equal) {
      for (index in 0...expected.length) {
        if (expected[index] != actual[index]) {
          equal = false;
          break;
        }
      }
    }
    return record(equal, "arrays are not equal", pos);
  }

  public static function isTrue(value: Bool, ?pos: PosInfos): Bool {
    return record(value, "expected true", pos);
  }

  public static function isFalse(value: Bool, ?pos: PosInfos): Bool {
    return record(!value, "expected false", pos);
  }

  public static function fail(?message: String, ?pos: PosInfos): Bool {
    return record(false,
      message == null ? "explicit assertion failure" : message, pos);
  }

  public static function raises(callback: () -> Void, ?pos: PosInfos): Bool {
    // None of the selected smoke tests uses this helper. Keeping the call
    // explicit preserves the official base-class surface without adding a
    // broad catch boundary merely for dormant compatibility code.
    callback();
    return record(false, "expected callback to throw", pos);
  }

  public static function contains<T>(value: T, values: Array<T>,
      ?pos: PosInfos): Bool {
    var found = false;
    for (candidate in values) {
      if (candidate == value) {
        found = true;
        break;
      }
    }
    return record(found, "expected collection to contain value", pos);
  }

  static function record(success: Bool, message: String,
      pos: Null<PosInfos>): Bool {
    #if genes.portable.inject_missing_assertion_count
    // Test-only fault injection: the outer harness must reject a successful
    // assertion that silently disappears from the reviewed count contract.
    if (omitNextCount) {
      omitNextCount = false;
    } else {
      assertionCount++;
    }
    #else
    assertionCount++;
    #end
    if (!success) {
      final location = pos == null ? "<unknown>" : '${pos.fileName}:${pos.lineNumber}';
      failureMessages.push('$location: $message');
    }
    return success;
  }
}
