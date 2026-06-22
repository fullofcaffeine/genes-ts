package genes.ts;

/**
 * Read-only view of an untrusted JavaScript array.
 *
 * genes-ts emits this as `readonly unknown[]`. The classic JS output still
 * receives the same runtime array, but callers only get read operations at the
 * Haxe layer. Decode and copy elements into `Array<T>` once their schema is
 * known.
 */
@:ts.type("readonly unknown[]")
abstract UnknownArray(Array<Unknown>) {
  /**
   * Runtime array length.
   */
  public var length(get, never): Int;

  inline function get_length(): Int {
    return this.length;
  }

  /**
   * Reads an element without claiming that it exists or has been decoded.
   *
   * Out-of-range, sparse, and explicitly undefined entries remain represented
   * as `Unknown`; use record/array presence checks when absence itself matters.
   */
  public inline function get(index: Int): Unknown {
    return Unknown.fromBoundary(this[index]);
  }
}
