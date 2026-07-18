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

  public static function main(): Void {
    final undefinedValues: Array<Undefinable<String>> = [Undefinable.absent(), "present"];
    final numbers = replace([2, 3], 3, 5);
    final transcript = [
      ordinary(["typed"], 0),
      nullable([null], 0) == null ? "null" : "unexpected",
      Undefinable.isAbsent(explicitUndefined(undefinedValues,
        0)) ? "undefined" : "unexpected",
      numbers.join(",")
    ];
    NodeConsole.log(transcript.join("|"));
  }
}
