package genes.js;

/**
 * Typed JavaScript-style indexed callbacks for arrays emitted by migration tools.
 *
 * Why: JavaScript `Array.map` and `Array.forEach` callbacks receive both value
 * and index, while Haxe's ordinary `Array` methods expose only the value.
 *
 * What: the helpers retain the common two-argument callback contract without
 * casts, reflection, or dynamic callback invocation.
 *
 * How: indexed helpers preserve source order, while operations that Haxe does
 * not expose call the corresponding native Array method directly. Sparse-array
 * behavior is intentionally outside this typed Haxe array boundary because
 * Haxe arrays do not model JavaScript holes.
 */
class ArrayCallbacks {
  public static inline function mapWithIndex<T, U>(values: Array<T>,
      callback: (T, Int) -> U): Array<U> {
    return [for (index in 0...values.length) callback(values[index], index)];
  }

  public static inline function forEachWithIndex<T>(values: Array<T>,
      callback: (T, Int) -> Void): Void {
    for (index in 0...values.length)
      callback(values[index], index);
  }

  /**
   * Returns the first index whose value satisfies `callback`, or `-1`.
   *
   * Haxe 4.3 does not expose JavaScript's `Array.prototype.findIndex`. This
   * typed helper keeps the familiar JS operation available without reflection
   * or a generated indexed loop. The callback receives only the value because
   * that is the portable contract represented here; a future indexed overload
   * can be added without changing this method.
   */
  public static inline function findIndex<T>(values: Array<T>,
      callback: T->Bool): Int {
    return js.Syntax.code("{0}.findIndex({1})", values, callback);
  }
}
