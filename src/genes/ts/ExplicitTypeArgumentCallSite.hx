package genes.ts;

/**
 * Typed carrier for one compiler-owned explicit-type-argument witness.
 *
 * Why: Haxe can relocate source positions inside nested macro output and drops
 * arbitrary expression metadata before generation. The compiler still needs
 * to correlate the reviewed direct extern call with its pre-erasure Haxe type.
 *
 * What: `preserve(value, typeFact...)` is an identity operation in Haxe's
 * typed tree. Each type fact is an inert, typed `null` placeholder followed by
 * an optional pre-erasure TypeScript spelling. Application code has no useful
 * reason to call this field.
 *
 * How: both TypeScript and classic-JavaScript emitters recognize this exact
 * compiler-internal field, emit only `value`, and discard every type fact. The
 * facts live on the exact call occurrence rather than in macro static state,
 * so cached compilation-server trees remain self-contained. No class, import,
 * helper call, string literal, allocation, or extra evaluation reaches output.
 */
@:genes.compilerInternal
@:noCompletion
extern class ExplicitTypeArgumentCallSite {
  // Dynamic is confined to this erased carrier because one generic call may
  // have heterogeneous witness types. Genes never emits, evaluates, or exposes
  // these values; callSiteMarker immediately restores precise Type objects.
  static function preserve<Value>(value: Value,
    typeFacts: haxe.extern.Rest<Dynamic>): Value;
}
