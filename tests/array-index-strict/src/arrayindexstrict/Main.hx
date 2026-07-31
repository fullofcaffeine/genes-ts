package arrayindexstrict;

import genes.ts.Undefinable;
import haxe.extern.EitherType;
import js.Syntax;
import js.lib.Reflect as JsReflect;
import js.lib.Symbol;

using genes.js.ArrayCallbacks;

/** Same-source proof for Haxe array-read contracts under strict TypeScript. */
class Main {
  static var genericReadEffects = 0;
  static var compoundReceiverEffects = 0;
  static var compoundIndexEffects = 0;
  static var compoundGetEffects = 0;
  static var compoundRhsEffects = 0;
  static var compoundSetEffects = 0;
  static final compoundOrder = new Array<String>();

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

  /** Compound assignment reads the old slot before writing the new value. */
  static function compoundBitwise(values: Array<Int>, mask: Int): Int {
    return values[0] |= mask;
  }

  /** Side-effecting receiver used to prove compound assignment reads it once. */
  static function effectCompoundValues(values: Array<Int>): Array<Int> {
    compoundReceiverEffects++;
    compoundOrder.push("receiver");
    return values;
  }

  /** Side-effecting index used to prove compound assignment reads it once. */
  static function effectCompoundIndex(): Int {
    compoundIndexEffects++;
    compoundOrder.push("index");
    return 0;
  }

  /** Side-effecting right-hand side used to prove native operation order. */
  static function effectCompoundIncrement(): Int {
    compoundRhsEffects++;
    compoundOrder.push("rhs");
    return 3;
  }

  /**
   * Native `Proxy` boundary used only to observe one indexed operation.
   *
   * Haxe's exact Proxy handler types expose `Any` at the JavaScript trap. This
   * boundary immediately delegates the value to native Reflect and returns a
   * concrete `Array<Int>` to the typed fixture; no dynamic value enters the
   * compiler contract being tested.
   */
  static function observedArray(values: Array<Int>): Array<Int> {
    return Syntax.code('new Proxy({0}, { get: {1}, set: {2} })', values,
      observedGet, observedSet);
  }

  static function observedGet(target: Array<Int>, property: ProxyProperty,
      receiver: Null<{}>): Any {
    if (Std.string(property) == "0") {
      compoundGetEffects++;
      compoundOrder.push("get");
    }
    return JsReflect.get(target, Std.string(property), receiver);
  }

  static function observedSet(target: Array<Int>, property: ProxyProperty,
      value: Any, receiver: Null<{}>): Bool {
    if (Std.string(property) == "0") {
      compoundSetEffects++;
      compoundOrder.push("set");
    }
    return JsReflect.set(target, Std.string(property), value, receiver);
  }

  static function compoundEffects(values: Array<Int>): Void {
    effectCompoundValues(observedArray(values))[effectCompoundIndex()] += effectCompoundIncrement();
  }

  /** Nullable elements retain Haxe/JavaScript string coercion while updating. */
  static function compoundNullable(values: Array<Null<String>>,
      suffix: String): String {
    return values[0] += suffix;
  }

  /** Nullable numbers retain Haxe/JavaScript bitwise coercion while updating. */
  static function compoundNullableNumber(values: Array<Null<Int>>,
      bit: Int): Int {
    return values[0] |= bit;
  }

  /** Nullish assignment keeps authored null writable. */
  static function compoundNullCoal(values: Array<Null<String>>,
      fallback: Null<String>): Null<String> {
    return values[0] ??= fallback;
  }

  /** Every indexed receiver before the outer target keeps its own read proof. */
  static function compoundNested(matrix: Array<Array<Int>>, row: Int,
      column: Int, increment: Int): Int {
    return matrix[row][column] += increment;
  }

  /** Native prefix and postfix syntax must retain their distinct results. */
  static function updateResults(values: Array<Int>): String {
    final prefix = ++values[0];
    final postfix = values[0]++;
    --values[0];
    values[0]--;
    return [prefix, postfix, values[0]].join(",");
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
    compoundEffects(compoundValues);
    final compoundNullableResult = compoundNullable([null], "x");
    final compoundNullableNumberResult = compoundNullableNumber([null], 1);
    final compoundNullCoalResult = compoundNullCoal([null], "fallback");
    final compoundNestedValues = [[5]];
    final compoundNestedResult = compoundNested(compoundNestedValues, 0, 0, 2);
    final updateResult = updateResults([4]);
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
      compoundValues[0] == 7
      && compoundReceiverEffects == 1
      && compoundIndexEffects == 1
      && compoundGetEffects == 1
      && compoundRhsEffects == 1
      && compoundSetEffects == 1
      && compoundOrder.join(",") == "receiver,index,get,rhs,set" ? "compound-effects-once" : "unexpected",
      compoundNullableResult == "nullx"
      && compoundNullableNumberResult == 1 ? "compound-null-coercion" : "unexpected",
      compoundNullCoalResult == "fallback" ? "compound-nullish" : "unexpected",
      compoundNestedResult == 7
      && compoundNestedValues[0][0] == 7 ? "compound-nested" : "unexpected",
      updateResult == "5,5,4" ? "updates" : "unexpected",
      nullable([null], 0) == null ? "null" : "unexpected",
      Undefinable.isAbsent(explicitUndefined(undefinedValues,
        0)) ? "undefined" : "unexpected",
      numbers.join(","),
      removeMissing([]) == null ? "missing" : "unexpected",
      namedVoid.calls == 2 ? "void-once" : "unexpected",
      secondaryArray.calls == 2 ? "secondary-array-once" : "unexpected",
      namedValues.shift(),
      namedValues.pop(),
      discarded.length == 0 ? "discarded" : "unexpected",
      ["first", "match"].findIndex(value ->
        value == "match") == 1 ? "native-find-index" : "unexpected"
    ];
    NodeConsole.log(transcript.join("|"));
  }
}

/** Exact property-key union used by the native JavaScript Proxy boundary. */
private typedef ProxyProperty = EitherType<String, EitherType<Int, Symbol>>;

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
