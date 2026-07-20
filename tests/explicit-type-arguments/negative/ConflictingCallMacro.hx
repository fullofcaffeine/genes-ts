/**
 * Negative library-macro control for conflicting call-site witnesses.
 *
 * Why: copied syntax retains one source span, but two different witness types
 * cannot both describe that same generated callee safely.
 *
 * What/How: `expand` copies the caller's direct call twice and attaches a
 * different witness to each copy. The compiler must stop at macro expansion
 * with the stable conflict diagnostic rather than let printer order choose a
 * TypeScript type argument.
 */
class ConflictingCallMacro {
  /** Builds the deliberately conflicting pair without runtime evaluation. */
  public static macro function expand(call: haxe.macro.Expr,
      firstWitness: haxe.macro.Expr,
      secondWitness: haxe.macro.Expr): haxe.macro.Expr {
    return macro [
      genes.ts.TypeArguments.call($call, $firstWitness),
      genes.ts.TypeArguments.call($call, $secondWitness)
    ];
  }
}
