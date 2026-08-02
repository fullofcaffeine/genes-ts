package arrayindexstrict;

import genes.ts.Undefinable;

/** Same-source proof for Haxe array-read contracts under strict TypeScript. */
class Main {
  static var genericReadEffects = 0;
  static var compoundReceiverEffects = 0;
  static var compoundIndexEffects = 0;

  static function ordinary<T>(values: Array<T>, index: Int): T {
    return values[index];
  }

  /** Concrete non-null control that keeps the established postfix assertion. */
  static function concrete(numbers: Array<Int>, index: Int): Int {
    return numbers[index];
  }

  /** Side-effecting receiver used to prove the assertion evaluates it once. */
  static function effectValues<T>(value: T): Array<T> {
    genericReadEffects++;
    return [value];
  }

  /** Side-effecting index used to prove the assertion evaluates it once. */
  static function effectIndex(): Int {
    genericReadEffects++;
    return 0;
  }

  static function genericEffects<T>(value: T): T {
    return effectValues(value)[effectIndex()];
  }

  /** Generic assignment control: the indexed target must remain writable. */
  static function assignGeneric<T>(values: Array<T>, value: T): T {
    return values[0] = value;
  }

  /**
   * Compound assignment is both a read and a write. TypeScript therefore
   * needs the same strict indexed-read proof without changing the operation.
   */
  static function compoundBitwise(values: Array<Int>, mask: Int): Int {
    return values[0] |= mask;
  }

  /** Side-effecting receiver used to prove compound assignment reads it once. */
  static function effectCompoundValues(values: Array<Int>): Array<Int> {
    compoundReceiverEffects++;
    return values;
  }

  /** Side-effecting index used to prove compound assignment reads it once. */
  static function effectCompoundIndex(): Int {
    compoundIndexEffects++;
    return 0;
  }

  static function compoundEffects(values: Array<Int>, increment: Int): Int {
    return effectCompoundValues(values)[effectCompoundIndex()] += increment;
  }

  /** Nullable elements retain `null` as part of the read-side source type. */
  static function compoundNullable(values: Array<Null<String>>,
      suffix: String): String {
    return values[0] += suffix;
  }

  /** Nullable numbers keep JavaScript's Haxe-accepted bitwise coercion. */
  static function compoundNullableNumber(values: Array<Null<Int>>,
      bit: Int): Int {
    return values[0] |= bit;
  }

  /**
   * Keeps Haxe's exact generic element type through TypeScript inference.
   *
   * Haxe types both `values[0]` and this complete conditional as
   * `InvariantValue<T>`. Under `noUncheckedIndexedAccess`, generated
   * TypeScript must account for a possibly missing array slot without turning
   * the authored `T` into the stronger and different `NonNullable<T>`.
   */
  static function genericConditional<T>(values: Array<T>,
      fallback: InvariantValue<T>, matched: Bool): InferenceResult<T> {
    return Converted(matched ? InvariantFactory.single(values[0]) : fallback);
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

  static function removeMissing(values: Array<Null<String>>): Null<String> {
    return values.shift();
  }

  public static function main(): Void {
    final undefinedValues: Array<Undefinable<String>> = [Undefinable.absent(), "present"];
    final nullableValues: Array<Null<String>> = [null];
    final genericResult = genericConditional(["generic"],
      new InvariantValue("fallback"), true);
    final genericEffectValue = genericEffects("effect-value");
    final assignedGeneric = assignGeneric(["before"], "assigned");
    final compoundBitwiseResult = compoundBitwise([1], 2);
    final compoundValues = [4];
    final compoundEffectResult = compoundEffects(compoundValues, 3);
    final compoundNullableResult = compoundNullable([null], "x");
    final compoundNullableNumberResult = compoundNullableNumber([null], 1);
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
      Std.string(concrete([7], 0)),
      switch genericResult {
        case Converted(value):
          value.value;
      },
      ordinary(nullableValues, 0) == null ? "generic-null" : "unexpected",
      Undefinable.isAbsent(ordinary(undefinedValues,
        0)) ? "generic-undefined" : "unexpected",
      genericEffectValue == "effect-value"
      && genericReadEffects == 2 ? "effects-once" : "unexpected",
      assignedGeneric,
      compoundBitwiseResult == 3 ? "compound-bitwise" : "unexpected",
      compoundEffectResult == 7
      && compoundValues[0] == 7
      && compoundReceiverEffects == 1
      && compoundIndexEffects == 1 ? "compound-effects-once" : "unexpected",
      compoundNullableResult == "nullx"
      && compoundNullableNumberResult == 1 ? "compound-null-coercion" : "unexpected",
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
 * Generic value whose read/write function keeps its parameter invariant.
 *
 * TypeScript therefore cannot silently substitute `NonNullable<T>` for `T`
 * when this value crosses the enum payload boundary below.
 */
private final class InvariantValue<T> {
  public final value: T;
  public final replace: T->T;

  public function new(value: T) {
    this.value = value;
    this.replace = next -> next;
  }
}

/** Generic factory whose TypeScript inference observes the indexed value. */
private final class InvariantFactory {
  public static function single<T>(value: T): InvariantValue<T> {
    return new InvariantValue(value);
  }
}

/** Exact destination used to expose an accidentally narrowed generic value. */
private enum InferenceResult<T> {
  Converted(value: InvariantValue<T>);
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
