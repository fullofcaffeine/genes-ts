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
 * How: inline indexed loops preserve source order and return the same mapped
 * values or `Void`. Sparse-array behavior is intentionally outside this typed
 * Haxe array boundary because Haxe arrays do not model JavaScript holes.
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
}
