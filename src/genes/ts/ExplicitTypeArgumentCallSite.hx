package genes.ts;

/**
 * Typed carrier for one compiler-owned explicit-type-argument registration.
 *
 * Why: Haxe can relocate source positions inside nested macro output and drops
 * arbitrary expression metadata before generation. The compiler still needs
 * to correlate the reviewed direct extern call with its pre-erasure Haxe type.
 *
 * What: `preserve(value, id)` is an identity operation in Haxe's typed tree.
 * The private registry owns `id`; application code has no useful reason to
 * call this field.
 *
 * How: both TypeScript and classic-JavaScript emitters recognize this exact
 * compiler-internal field, emit only `value`, and discard `id`. No class,
 * import, helper call, string literal, allocation, or extra evaluation reaches
 * generated output.
 */
@:genes.compilerInternal
@:noCompletion
extern class ExplicitTypeArgumentCallSite {
  static function preserve<Value>(value: Value, id: String): Value;
}
