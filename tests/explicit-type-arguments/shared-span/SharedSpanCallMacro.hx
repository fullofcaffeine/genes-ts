/**
 * Library-macro control for two witnesses at one copied source span.
 *
 * Why: copied syntax retains one source span. A position-keyed macro registry
 * cannot distinguish the two occurrences and either rejects them or lets
 * printer order choose one witness for both.
 *
 * What/How: `expand` copies the caller's direct call twice and attaches a
 * different witness to each copy. Occurrence-local typed carriers let the
 * compiler emit each reviewed type independently; the shared position remains
 * source-map provenance only.
 */
class SharedSpanCallMacro {
  /** Builds two independently typed occurrences without evaluating witnesses. */
  public static macro function expand(call: haxe.macro.Expr,
      firstWitness: haxe.macro.Expr,
      secondWitness: haxe.macro.Expr): haxe.macro.Expr {
    return macro [
      genes.ts.TypeArguments.call($call, $firstWitness),
      genes.ts.TypeArguments.call($call, $secondWitness)
    ];
  }
}
