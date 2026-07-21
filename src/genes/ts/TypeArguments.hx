package genes.ts;

#if macro
import haxe.macro.Expr;
#end

/**
 * Compile-time preservation for generic extern types Haxe would erase.
 *
 * Most generic extern calls should rely on ordinary Haxe and TypeScript
 * inference. `call` is the narrow fallback for a library macro that has already
 * resolved a more precise Haxe type—most notably a primitive-backed abstract—
 * before Haxe erases it inside a generic application.
 */
class TypeArguments {
  /**
   * Emits `expression` unchanged while preserving explicit TS type arguments.
   *
   * Each trailing expression is a type witness only: the macro checks its Haxe
   * type, records it in generic declaration order, and removes the witness from
   * runtime output. The direct extern callee must opt in with
   * `@:ts.explicitTypeArguments`; wrong arity, broad types, aliases, and ordinary
   * functions fail closed. A compiler-owned typed carrier keeps the registration
   * attached when a library macro nests the call in a fluent expression; both
   * emitters erase that carrier, so TypeScript and classic JavaScript receive
   * only the original call and its ordinary composition.
   */
  public static macro function call(expression: Expr,
      witnesses: Array<Expr>): Expr {
    return genes.ExplicitTypeArguments.registerCall(expression, witnesses);
  }
}
