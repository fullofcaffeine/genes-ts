package genes.ts;

/**
 * Typed narrowing boundary for a value already proven non-nullish.
 *
 * Why: Haxe's JavaScript target accepts many nullable field reads after a
 * guard, but the typed AST may still carry `Null<T>`. A generated TypeScript
 * object/JSX prop then needs an explicit `T` boundary even though control flow
 * has already established the invariant.
 *
 * What: returns the contained `T` and throws if a caller violates the
 * non-nullish precondition. It neither supplies a fallback nor changes a valid
 * value.
 *
 * How: this is deliberately a normal typed function rather than raw syntax or
 * a cast. Both classic Genes and genes-ts retain the runtime assertion, while
 * the `T` return type gives downstream TypeScript a precise narrowed surface.
 */
class Present {
  /** Returns `value` after enforcing the non-nullish precondition. */
  public static function require<T>(value:Null<T>):T {
    if (value == null)
      throw new haxe.Exception("Expected a present value after a nullish guard.");
    return value;
  }
}
