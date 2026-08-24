package genes.internal;

/**
 * Carries exact native-async values through Haxe typing to Genes.
 *
 * Why: Haxe has no native async function effect. The async authoring macro must
 * therefore type a function body as returning `Promise<T>` even though native
 * JavaScript returns `T` from that body. Raw syntax and targetless casts can
 * express the gap, but their shape does not prove that the async macro owns a
 * particular function or return occurrence.
 *
 * What/How: `functionValue` marks one anonymous function and `returnValue`
 * bridges one source return to Haxe's promised function result. Genes records
 * both calls by exact typed owner, member, and expression identity before
 * either emitter erases them. This extern has no runtime implementation and
 * must never appear in generated source.
 */
@:genes.compilerInternal
@:noCompletion
extern class NativeAsyncMarker {
  /** Retains one exact anonymous function until Genes adds native `async`. */
  public static function functionValue<T>(value: T): T;

  /** Lets Haxe type one native-async source return as `Promise<T>`. */
  public static function returnValue<T>(value: T): js.lib.Promise<T>;
}
