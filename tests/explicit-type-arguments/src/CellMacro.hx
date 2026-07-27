/**
 * Reproduces how a library macro can reuse one checked call template.
 *
 * Why: both generated calls retain the input expression's same source span.
 * Position-based ownership would merge the two expansions even though they
 * are separate typed occurrences.
 *
 * What/How: `twice` copies the caller's direct extern call and witness into a
 * two-element array. `TypeArguments.call` still runs for each copy, so the
 * fixture proves both occurrence-local facts produce ordinary runtime calls in
 * source order.
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

  /**
   * Wraps the reviewed generic call in an ordinary fluent method call.
   *
   * Why: Haxe assigns both callees the enclosing macro invocation's source
   * span. Span-only ownership mistakes `seal` for the opted-in generic field.
   * What/How: the compiler must bind the witness to the exact extern target,
   * emit it on `makeCell`, and leave `seal()` ordinary in both output modes.
   */
  public static macro function seal(call: haxe.macro.Expr,
      witness: haxe.macro.Expr): haxe.macro.Expr {
    return macro genes.ts.TypeArguments.call($call, $witness).seal();
  }
}
