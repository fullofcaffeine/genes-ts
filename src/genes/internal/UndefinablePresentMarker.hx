package genes.internal;

/**
 * Carries one proven `Undefinable<T>` value to the Genes emitters.
 *
 * Why: TypeScript's postfix `!` removes both `undefined` and a legitimate
 * nested `null`. `Undefinable<Null<T>>`, however, promises that only
 * `undefined` is absent. The emitter therefore needs the exact instantiated
 * Haxe result type before it can print a sound erased assertion.
 *
 * What: TypeScript `Undefinable.assumePresent()` emits this exact typed call
 * after the caller has performed the documented absence check, then replaces
 * it with `((value)! as T)` using the compiler-owned return type. The erased
 * postfix proof prevents TypeScript's false disjoint-cast diagnostic when a
 * stored absence boolean leaves the operand narrowed to `undefined`; the
 * final exact assertion restores a legitimate nested `null`. Classic Genes
 * uses its ordinary inline identity path and never receives this marker.
 *
 * How: this extern has no runtime implementation. Recognition uses its exact
 * typed owner and field identity through `CompilerInternal`, never the method
 * spelling alone. Generated output must never contain the marker.
 */
@:genes.compilerInternal
@:noCompletion
extern class UndefinablePresentMarker {
  /** Retains the exact `T` application until profile-specific emission. */
  public static function assumePresent<T>(value: Null<T>): T;
}
