package arrayindexinventory;

import genes.ts.Undefinable;
import genes.ts.Unknown;

/**
 * Typed source inventory for indexed reads, writes, and native updates.
 *
 * This program inventories `TsIndexedAccessPlan` over the complete typed
 * operation matrix. The runtime fixture separately compiles and executes the
 * source-spellable cases through TypeScript, classic Genes, and standard Haxe.
 * Synthetic logical and wrapper copies remain classifier-only because the
 * probe deliberately does not mutate the compiler-owned program.
 */
class Main {
  static function plainWrite<T>(values: Array<T>, value: T): T {
    return values[0] = value;
  }

  static function arithmetic(values: Array<Float>, rhs: Float): Float {
    values[0] += rhs;
    values[0] -= rhs;
    values[0] *= rhs;
    values[0] /= rhs;
    return values[0] %= rhs;
  }

  static function bitwise(values: Array<Int>, rhs: Int): Int {
    values[0] &= rhs;
    values[0] |= rhs;
    values[0] ^= rhs;
    values[0] <<= rhs;
    values[0] >>= rhs;
    return values[0] >>>= rhs;
  }

  static function nullablePrimitive(strings: Array<Null<String>>,
      numbers: Array<Null<Int>>, suffix: String, bit: Int): Void {
    strings[0] += suffix;
    numbers[0] |= bit;
  }

  static function nullish(values: Array<Null<Bool>>,
      fallback: Null<Bool>): Null<Bool> {
    return values[0] ??= fallback;
  }

  static function updates(values: Array<Int>): Int {
    final prefixIncrement = ++values[0];
    final postfixIncrement = values[0]++;
    final prefixDecrement = --values[0];
    final postfixDecrement = values[0]--;
    ++values[0];
    values[0]++;
    --values[0];
    values[0]--;
    return prefixIncrement
      + postfixIncrement
      + prefixDecrement
      + postfixDecrement;
  }

  static function nested(matrix: Array<Array<Int>>, row: Int, column: Int,
      rhs: Int): Int {
    return matrix[row][column] += rhs;
  }

  static function nullableNested(matrix: Array<Null<Array<Int>>>, row: Int,
      column: Int, rhs: Int): Int {
    final base: Null<Array<Int>> = matrix[row];
    base[column] += rhs;
    return base[column];
  }

  static function flowNarrowed(matrix: Array<Null<Array<Int>>>, row: Int,
      rhs: Int): Int {
    final base = matrix[row];
    if (base == null)
      return rhs;
    return base[0] += rhs;
  }

  static function wrapped(values: Array<Int>, rhs: Int): Void {
    (values[0]) += rhs;
    (@:indexedInventory values[0]) += rhs;
    (cast values[0]) += rhs;
  }

  // These valid assignments are changed by ArrayIndexInventoryProbe after
  // Haxe typing. That lets the fixture exercise typed operations and wrappers
  // that ordinary Haxe source either rejects or erases before Genes runs.
  static function typedLogicalAnd(values: Array<Null<Bool>>,
      rhs: Null<Bool>): Null<Bool> {
    return values[0] = rhs;
  }

  static function typedLogicalOr(values: Array<Null<Bool>>,
      rhs: Null<Bool>): Null<Bool> {
    return values[0] = rhs;
  }

  static function typedParenthesis(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function typedMetadata(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function typedImplicitCast(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function typedRegistryWrite(values: Array<Dynamic>,
      rhs: Dynamic): Dynamic {
    return values[0] = rhs;
  }

  static function typedRegistryRead(values: Array<Dynamic>): Dynamic {
    return values[0];
  }

  static function discardedUnresolvedRead(values: Array<Int>): Void {
    final ignored = values[0];
  }

  static function rejectedReturnedRead(values: Array<Int>): Int {
    return values[0];
  }

  static function rejectedObservedLocalRead(values: Array<Int>): Int {
    final observed = values[0];
    return observed;
  }

  static function consumeRead(value: Int): Void {}

  static function rejectedArgumentRead(values: Array<Int>): Void {
    consumeRead(values[0]);
  }

  static final rejectedAssignedFieldRead = [7][0];

  static function enumParameters(value: Array<Dynamic>, other: Array<Dynamic>,
      index: Int): Dynamic {
    if (other[index] == null)
      return value[index];
    return value[index];
  }

  static function rejectedUndefined(values: Array<Undefinable<Int>>,
      rhs: Undefinable<Int>): Undefinable<Int> {
    return values[0] = rhs;
  }

  static function rejectedUnknown(values: Array<Unknown>,
      rhs: Unknown): Unknown {
    return values[0] = rhs;
  }

  static function rejectedGeneric<T>(values: Array<T>, rhs: T): T {
    return values[0] = rhs;
  }

  static function rejectedUnresolved(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function rejectedUndefinedReceiver(values: Array<Int>, rhs: Int,
      boundary: Undefinable<Array<Int>>): Int {
    return values[0] = rhs;
  }

  static function rejectedUnknownReceiver(values: Array<Int>, rhs: Int,
      boundary: Unknown): Int {
    return values[0] = rhs;
  }

  static function rejectedMetadata(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function rejectedExplicitCast(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function rejectedOperator(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function rejectedRegistryCompound(values: Array<Int>, rhs: Int): Int {
    return values[0] = rhs;
  }

  static function rejectedRegistryNested(values: Array<Array<Int>>,
      rhs: Int): Int {
    return values[0][0] = rhs;
  }

  static function rejectedRegistryReadCast(values: Array<Dynamic>): Dynamic {
    return values[0];
  }

  static function rejectedRegistryWriteMetadata(values: Array<Dynamic>,
      rhs: Dynamic): Dynamic {
    return values[0] = rhs;
  }

  static function rejectedRegistryReadMetadata(values: Array<Dynamic>): Dynamic {
    return values[0];
  }

  static function rejectedRegistryReadAlias(values: Array<Dynamic>): Dynamic {
    final alias = values;
    return alias[0];
  }

  static function rejectedRegistryReadCall(factory: Void->
    Array<Dynamic>): Dynamic {
    return factory()[0];
  }

  static function boundaryReads<T>(genericValues: Array<T>,
      nullableValues: Array<Null<String>>,
      undefinableValues: Array<Undefinable<String>>,
      unknownValues: Array<Unknown>, dynamicValues: Dynamic): Void {
    final genericValue = genericValues[0];
    final nullableValue = nullableValues[0];
    final undefinableValue = undefinableValues[0];
    final unknownValue = unknownValues[0];
    final dynamicValue = dynamicValues[0];
    genericValues[0] = genericValue;
    nullableValues[0] = nullableValue;
    undefinableValues[0] = undefinableValue;
    unknownValues[0] = unknownValue;
    dynamicValues[0] = dynamicValue;
  }

  public static function main(): Void {
    plainWrite(["before"], "after");
    arithmetic([7], 2);
    bitwise([7], 2);
    nullablePrimitive([null], [null], "x", 1);
    nullish([null], true);
    updates([7]);
    nested([[7]], 0, 0, 2);
    nullableNested([[7]], 0, 0, 2);
    flowNarrowed([[7]], 0, 2);
    wrapped([7], 2);
    typedLogicalAnd([true], false);
    typedLogicalOr([false], true);
    typedParenthesis([7], 2);
    typedMetadata([7], 2);
    typedImplicitCast([7], 2);
    typedRegistryWrite(["before"], "after");
    typedRegistryRead(["value"]);
    discardedUnresolvedRead([7]);
    enumParameters(["value"], ["other"], 0);
    boundaryReads(["value"], [null], [Undefinable.absent()],
      [Unknown.fromBoundary("unknown")], ["dynamic"]);
  }
}
