package inc;

/**
 * A module whose printed text depends on metadata that only its typed body
 * holds (limit L3 of the round-3 review of genes-ts #244, genes-f8vc.9.23).
 *
 * `inc.ArgMetaMacro` writes `@:ts.type("string")` on the local variable of
 * the argument `count` of `show` (its `TVar`) from an after-typing callback.
 * The printer reads that metadata for the argument type. Haxe does not type
 * this module again, and no fingerprint, metadata comparison or recorded
 * answer reads the metadata of a local variable, so the clean rules accept
 * the module and a replay keeps the old text. The rolling replay audit must
 * find the difference by printing the module again.
 */
class ArgMeta {
  public static function show(count: Int): String {
    return "arg-meta:" + count;
  }

  public static function value(): String {
    return show(2);
  }
}
