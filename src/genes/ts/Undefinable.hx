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
   * How: Haxe types `js.Lib.undefined` through its ordinary `null` sentinel, so
   * `js.Syntax.strictEq(value, js.Lib.undefined)` would incorrectly emit
   * `value === null`. The one unavoidable target operation is contained here.
   * `js.Syntax.code` accepts arguments as non-null `Any`, so the statement-local
   * escape covers only that extern mismatch. Both Genes profiles still inline
   * this helper to `value === undefined`, and callers remain typed.
   */
  public static inline function isAbsent<T>(value: Null<T>): Bool {
    @:nullSafety(Off)
    return js.Syntax.code("({0}) === undefined", value);
  }

  /** Converts a Haxe-nullable host value into a real undefined union. */
  public static inline function fromNullable<T>(value: Null<T>): Undefinable<T> {
    return value == null ? absent() : value;
  }

  /**
   * Converts JavaScript `undefined` absence into Haxe `null`.
   *
   * Why: this abstract is stored as `Null<T>` while Haxe types the program, but
   * genes-ts deliberately projects it as `T | undefined`. Writing ordinary
   * Haxe `this ?? null` here makes Haxe introduce a `Null<T>` temporary, which
   * is the wrong TypeScript representation and rejects an actual `undefined`.
   *
   * How: preserve the target nullish-coalescing operator at this one interop
   * boundary. Haxe's `js.Syntax.code` extern accepts arguments as non-null
   * `Any`, so the statement-local escape covers only that extern mismatch; the
   * declared `Null<T>` result immediately returns to normal typed Haxe code.
   */
  public inline function orNull(): Null<T> {
    @:nullSafety(Off)
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
   * How: the active TypeScript profile retains one compiler-owned typed
   * marker, then replaces it with an assertion to the exact instantiated `T`.
   * Classic Genes and standard Haxe JavaScript emit the operand unchanged.
   * This distinction matters for `Undefinable<Null<T>>`: a postfix `!` would
   * incorrectly erase the nested `null` from the static type.
   */
  public inline function assumePresent(): T {
    #if (genes.ts && genes.generator.active)
    return genes.internal.UndefinablePresentMarker.assumePresent(this);
    #else
    @:nullSafety(Off)
    return js.Syntax.code("({0})", this);
    #end
  }
}
