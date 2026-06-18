package genes.ts;

/**
 * Type-only marker for an untrusted JavaScript boundary value.
 *
 * genes-ts emits this as TypeScript `unknown`, which is safer than `any`:
 * callers must narrow or decode it before they can use it. The underlying
 * `Dynamic` is contained inside this abstract because Haxe has no native
 * `unknown` top type.
 */
@:ts.type("unknown")
abstract Unknown(Dynamic) {
  /**
   * Marks a value acquired at an interop/runtime boundary as untrusted.
   */
  public static inline function fromBoundary<T>(value:T):Unknown {
    return cast value;
  }
}
