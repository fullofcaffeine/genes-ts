package arrayindexstrict;

import genes.ts.Undefinable;

/** Same-source proof for Haxe array-read contracts under strict TypeScript. */
class Main {
  static function ordinary<T>(values: Array<T>, index: Int): T {
    return values[index];
  }

  static function nullable(values: Array<Null<String>>,
      index: Int): Null<String> {
    return values[index];
  }

  static function explicitUndefined(values: Array<Undefinable<String>>,
      index: Int): Undefinable<String> {
    return values[index];
  }

  static function replace(values: Array<Int>, first: Int,
      second: Int): Array<Int> {
    values[0] = first;
    values[1] = second;
    return values;
  }

  static function removeMissing(
      values: Array<Null<String>>): Null<String> {
    return values.shift();
  }

  public static function main(): Void {
    final undefinedValues: Array<Undefinable<String>> = [Undefinable.absent(), "present"];
    final numbers = replace([2, 3], 3, 5);
    final namedVoid = new NamedVoidRemovals();
    namedVoid.shift();
    namedVoid.pop();
    final namedValues = new NamedValueRemovals();
    final secondaryArray = RootArrayCarrier.make();
    secondaryArray.shift();
    secondaryArray.pop();
    final discarded = ["discarded"];
    discarded.shift();
    final transcript = [
      ordinary(["typed"], 0),
      nullable([null], 0) == null ? "null" : "unexpected",
      Undefinable.isAbsent(explicitUndefined(undefinedValues,
        0)) ? "undefined" : "unexpected",
      numbers.join(","),
      removeMissing([]) == null ? "missing" : "unexpected",
      namedVoid.calls == 2 ? "void-once" : "unexpected",
      secondaryArray.calls == 2 ? "secondary-array-once" : "unexpected",
      namedValues.shift(),
      namedValues.pop(),
      discarded.length == 0 ? "discarded" : "unexpected"
    ];
    NodeConsole.log(transcript.join("|"));
  }
}

/**
 * Negative control for the built-in Array rule.
 *
 * These methods happen to be named `shift` and `pop`, but they belong to this
 * user class and return `Void`. Genes must emit each as an ordinary statement;
 * treating the result as a nullable value would be invalid TypeScript.
 */
private final class NamedVoidRemovals {
  public var calls(default, null) = 0;

  public function new() {}

  public function shift(): Void {
    calls++;
  }

  public function pop(): Void {
    calls++;
  }
}

/** Same-name negative control whose methods produce ordinary string values. */
private final class NamedValueRemovals {
  public function new() {}

  public function shift(): String {
    return "named-shift";
  }

  public function pop(): String {
    return "named-pop";
  }
}
