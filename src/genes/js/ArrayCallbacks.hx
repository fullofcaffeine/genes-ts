package genes.js;

/**
 * Adds small, precisely typed JavaScript Array operations that Haxe 4.3 does
 * not provide directly.
 *
 * Why: JavaScript callbacks can receive an item's index, and JavaScript has
 * methods such as `findIndex` that Haxe's `Array` API does not expose.
 *
 * What: these helpers keep those common operations typed in Haxe. They are
 * `inline`, so application output contains the direct loop or native Array
 * call rather than an `ArrayCallbacks` runtime object.
 *
 * Import this module with `using genes.js.ArrayCallbacks` so the helpers read as
 * ordinary Array methods, for example `values.findIndex(predicate)`. The
 * explicit `ArrayCallbacks.findIndex(values, predicate)` form remains
 * available when an extension name would conflict.
 *
 * How: indexed helpers use an ordered Haxe loop. Operations missing from Haxe
 * use one narrow `js.Syntax` expression that names the matching native method.
 * Haxe arrays do not model JavaScript arrays with missing slots. The loop
 * helpers therefore promise only the normal behavior of a Haxe array.
 *
 * These are module-level functions because the module is only a namespace for
 * stateless operations. Their `inline` form removes the helper call from
 * generated output while preserving both extension and explicit call syntax.
 */
inline function mapWithIndex<T, U>(values: Array<T>,
    callback: (T, Int) -> U): Array<U> {
  return [for (index in 0...values.length) callback(values[index], index)];
}

inline function forEachWithIndex<T>(values: Array<T>,
    callback: (T, Int) -> Void): Void {
  for (index in 0...values.length)
    callback(values[index], index);
}

/**
 * Returns the first index whose value satisfies `callback`, or `-1` when no
 * value matches.
 *
 * Haxe 4.3 does not expose JavaScript's `Array.prototype.findIndex`. This
 * helper emits that native call directly, without reflection or a generated
 * search loop. Its first version deliberately gives the Haxe callback only
 * the value. JavaScript also passes the index and source array at runtime,
 * but a one-argument Haxe function simply ignores those extra arguments.
 * A future, separately named helper can expose them without changing this
 * simple callback contract.
 *
 * Prefer `values.findIndex(callback)` after importing this module with `using`.
 */
inline function findIndex<T>(values: Array<T>, callback: T->Bool): Int {
  return js.Syntax.code("{0}.findIndex({1})", values, callback);
}
