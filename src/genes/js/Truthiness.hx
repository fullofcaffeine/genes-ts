package genes.js;

/**
 * Typed boundary for JavaScript truthiness tests emitted by migration tools.
 *
 * Why: TypeScript permits arbitrary values in conditions and logical value
 * expressions, while Haxe requires `Bool`. Migration-generated Haxe needs the
 * original JavaScript test without weakening every participating value type.
 *
 * What: `isTruthy` returns JavaScript's exact boolean coercion for its value.
 *
 * How: raw target syntax is intentionally contained in this single generic
 * runtime/compiler boundary. Both classic Genes JavaScript and genes-ts output
 * erase the inline call to `!!value`; application code remains fully typed.
 */
class Truthiness {
  public static inline function isTruthy<T>(value: T): Bool {
    return js.Syntax.code("!!{0}", value);
  }
}
