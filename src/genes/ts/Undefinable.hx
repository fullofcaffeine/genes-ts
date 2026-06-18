package genes.ts;

/**
 * Type-only marker for a value that may be JavaScript `undefined`.
 *
 * Haxe's `Null<T>` models nullability, but TypeScript APIs often distinguish
 * `undefined` from `null`. genes-ts emits this abstract as `$0 | undefined`
 * while Haxe code can normalize through `orNull()` at the boundary.
 */
@:ts.type("$0 | undefined")
abstract Undefinable<T>(Null<T>) from T {
  /**
   * Produces JavaScript `undefined` for optional host values.
   */
  public static inline function absent<T>():Undefinable<T> {
    return cast js.Syntax.code("undefined");
  }

  /**
   * Converts JavaScript `undefined` absence into Haxe `null`.
   */
  public inline function orNull():Null<T> {
    return js.Syntax.code("{0} ?? null", this);
  }
}
