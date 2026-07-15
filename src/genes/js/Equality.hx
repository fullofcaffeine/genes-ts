package genes.js;

/**
 * Typed boundary for JavaScript strict identity comparison.
 *
 * Why: TypeScript `===`, `!==`, and switch case matching use JavaScript strict
 * equality. Haxe's cross-type equality spelling is not a portable promise of
 * those coercion rules, so a migration tool must name the host contract.
 *
 * What: compares two typed values using exact JavaScript `===` with no numeric,
 * string, Boolean, or nullish coercion.
 *
 * How: the raw operator is confined to this inline generic helper. Both genes
 * output modes erase it to a direct strict comparison while translated Haxe
 * remains typed and reviewable.
 */
class Equality {
  /** Returns JavaScript strict equality for two host values. */
  public static inline function strict<T>(left:T, right:T):Bool {
    return js.Syntax.code("(({0}) === ({1}))", left, right);
  }
}
