package genes.js;

#if macro
import haxe.macro.Expr;
#end

/**
 * Typed JavaScript numeric coercion for migration-generated Haxe.
 *
 * Why: TypeScript unary `+` runs JavaScript's `ToNumber` operation. Haxe has
 * no equivalent source-level operator for values such as numeric strings, and
 * spelling the operation as `Std.parseFloat` changes empty, whitespace, and
 * invalid-string behavior.
 *
 * What: `toNumber(value)` returns the exact JavaScript unary-plus result as a
 * Haxe `Float`. The helper is intentionally JS-semantic (`J1` in ts2hx's
 * portability manifest), so callers do not mistake it for portable parsing.
 *
 * How: an abstract is used only as a typed, namespaced macro surface; no
 * `Coercion` value can be constructed or reach runtime. The macro preserves the
 * caller's typed operand while expanding the call to `+operand` through one
 * contained `js.Syntax.code` boundary. Both classic Genes and genes-ts
 * therefore emit only the native operator at the call site; TypeScript can
 * validate it against the original operand type. Keeping the expansion here
 * also prevents ts2hx from scattering raw target syntax through generated
 * Haxe modules.
 */
abstract Coercion(Int) {
  /** Applies JavaScript `ToNumber` exactly once to the supplied expression. */
  public static macro function toNumber(value:Expr):ExprOf<Float> {
    return macro @:pos(value.pos) (js.Syntax.code("+({0})", $value):Float);
  }
}
