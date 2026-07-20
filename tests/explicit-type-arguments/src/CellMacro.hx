/**
 * Reproduces how a library macro can reuse one checked call template.
 *
 * Why: both generated calls retain the input expression's same source span.
 * A registry that assumes every span belongs to exactly one expansion would
 * reject the second call even though its type witness is identical.
 *
 * What/How: `twice` copies the caller's direct extern call and witness into a
 * two-element array. `TypeArguments.call` still runs for each copy, so the
 * fixture proves that equivalent registrations share one semantic fact while
 * producing two ordinary runtime calls in source order.
 */
class CellMacro {
  /** Expands one checked call/witness pair twice without evaluating it early. */
  public static macro function twice(call: haxe.macro.Expr,
      witness: haxe.macro.Expr): haxe.macro.Expr {
    return macro [
      genes.ts.TypeArguments.call($call, $witness),
      genes.ts.TypeArguments.call($call, $witness)
    ];
  }
}
