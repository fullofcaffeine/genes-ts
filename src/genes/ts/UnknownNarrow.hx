package genes.ts;

/**
 * Guarded conversions for values acquired as `genes.ts.Unknown`.
 *
 * Haxe can express the runtime checks through low-level JavaScript syntax, but
 * it cannot express TypeScript's control-flow proof that an `unknown` value is
 * now a string, array, or string-indexed record. This class is the small,
 * reusable interop island for those checks. Public methods combine the guard
 * and conversion so callers do not spread unchecked casts through application
 * code.
 */
class UnknownNarrow {
  /**
   * Converts only JavaScript strings.
   */
  public static function string(value: Unknown): Null<String> {
    return js.Syntax.code("typeof ({0}) === \"string\" ? ({0}) : null", value);
  }

  /**
   * Converts only JavaScript booleans.
   */
  public static function bool(value: Unknown): Null<Bool> {
    return js.Syntax.code("typeof ({0}) === \"boolean\" ? ({0}) : null", value);
  }

  /**
   * Converts every JavaScript number, including NaN and infinities.
   */
  public static function number(value: Unknown): Null<Float> {
    return js.Syntax.code("typeof ({0}) === \"number\" ? ({0}) : null", value);
  }

  /**
   * Converts finite JavaScript numbers only.
   */
  public static function finiteNumber(value: Unknown): Null<Float> {
    return
      js.Syntax.code("typeof ({0}) === \"number\" && Number.isFinite({0}) ? ({0}) : null",
      value);
  }

  /**
   * Converts JavaScript safe integers.
   *
   * The result stays `Float` because JavaScript safe integers are wider than
   * Haxe/TypeScript's practical signed 32-bit `Int` range.
   */
  public static function safeInteger(value: Unknown): Null<Float> {
    return
      js.Syntax.code("typeof ({0}) === \"number\" && Number.isSafeInteger({0}) ? ({0}) : null",
      value);
  }

  /**
   * Converts signed 32-bit integer values, the range Haxe `Int` code can rely
   * on portably.
   */
  public static function int32(value: Unknown): Null<Int> {
    return
      js.Syntax.code("typeof ({0}) === \"number\" && Number.isInteger({0}) && ({0}) >= -2147483648 && ({0}) <= 2147483647 ? ({0}) : null",
      value);
  }

  /**
   * Converts only JavaScript arrays and exposes a read-only unknown view.
   */
  public static function array(value: Unknown): Null<UnknownArray> {
    return js.Syntax.code("Array.isArray({0}) ? ({0}) : null", value);
  }

  /**
   * Converts non-null, non-array JavaScript objects to a record-like view.
   *
   * This deliberately does not require a plain prototype. Use a higher-level
   * decoder when a domain schema needs stricter object semantics.
   */
  public static function record(value: Unknown): Null<UnknownRecord> {
    #if genes.ts
    // TypeScript narrows this guard only to `object`; the contained assertion
    // teaches TS that string indexing is allowed after our runtime check. This
    // branch is TS-only so classic Genes still emits plain executable JS.
    return
      js.Syntax.code("typeof ({0}) === \"object\" && ({0}) !== null && !Array.isArray({0}) ? ({0} as Readonly<Record<string, unknown>>) : null",
      value);
    #else
    return
      js.Syntax.code("typeof ({0}) === \"object\" && ({0}) !== null && !Array.isArray({0}) ? ({0}) : null",
      value);
    #end
  }

  /**
   * Checks for exact JavaScript null.
   */
  public static inline function isNull(value: Unknown): Bool {
    return js.Syntax.code("(({0}) === null)", value);
  }

  /**
   * Checks for exact JavaScript undefined.
   */
  public static inline function isUndefined(value: Unknown): Bool {
    return js.Syntax.code("(({0}) === undefined)", value);
  }
}
