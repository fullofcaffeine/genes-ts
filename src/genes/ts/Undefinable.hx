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
  public static inline function absent<T>(): Undefinable<T> {
    // Haxe cannot spell JavaScript `undefined` as a normal value, so the raw
    // syntax is contained here instead of spreading through user code. The
    // declared return type carries the `T | undefined` contract for genes-ts.
    return js.Syntax.code("undefined");
  }

  /**
   * Tests exact JavaScript `undefined` without conflating it with `null`.
   *
   * Why: JavaScript and TypeScript default parameters run for omission or
   * `undefined`, but not for an explicit `null`. Haxe's ordinary `value == null`
   * comparison intentionally treats both host values alike on JavaScript, so a
   * migration/codegen boundary needs the stricter identity test.
   *
   * What: accepts a normal Haxe-nullable value as well as an
   * `Undefinable<T>` and returns true only for the raw host `undefined` value.
   *
   * How: the one unavoidable target operation is contained here. Both
   * genes-ts and classic Genes inline it to `value === undefined`; callers and
   * generated Haxe remain typed and contain no raw syntax.
   */
  public static inline function isAbsent<T>(value:Null<T>):Bool {
    return js.Syntax.code("({0}) === undefined", value);
  }

  /** Converts a Haxe-nullable host value into a real undefined union. */
  public static inline function fromNullable<T>(value: Null<T>): Undefinable<T> {
    return value == null ? absent() : value;
  }

  /**
   * Converts JavaScript `undefined` absence into Haxe `null`.
   */
  public inline function orNull(): Null<T> {
    return js.Syntax.code("{0} ?? null", this);
  }

  /**
   * Narrows a value after the caller has proved it is not `undefined`.
   *
   * Why: Haxe cannot express TypeScript's control-flow narrowing for a generic
   * `T | undefined` abstract. Default-parameter lowering performs the exact
   * `isAbsent` check and assignment first, then needs the original `T` for the
   * translated function body.
   *
   * What: returns the same runtime value with its `T` view. Calling this before
   * an exact absence check is a contract violation; it performs no fallback or
   * coercion.
   *
   * How: both output modes inline a target identity expression. Keeping the
   * operation here makes the proof boundary named and reviewable instead of
   * spreading casts through generated Haxe.
   */
  public inline function assumePresent():T {
    return js.Syntax.code("{0}", this);
  }
}
